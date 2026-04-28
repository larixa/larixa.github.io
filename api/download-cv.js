const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const CV_URL = 'https://raw.githubusercontent.com/larixa/larixa.github.io/main/CV_Larissa%20Paiva%202026.pdf';

// Rate limit: max 3 downloads per IP per hour
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MINUTES = 60;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    'Unknown';

  const userAgent = req.headers['user-agent'] || 'Unknown';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── RATE LIMITING ──────────────────────────────────────
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

    const { count, error: countError } = await supabase
      .from('cv_downloads')
      .select('*', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', windowStart);

    if (countError) {
      console.error('Rate limit check error:', countError);
    } else if (count >= RATE_LIMIT_MAX) {
      // Log the blocked attempt
      await supabase.from('cv_downloads').insert([{
        email,
        ip_address: ip,
        user_agent: userAgent,
        blocked: true,
        block_reason: `Rate limit exceeded: ${count} downloads in ${RATE_LIMIT_WINDOW_MINUTES} minutes`
      }]);

      res.setHeader('Retry-After', String(RATE_LIMIT_WINDOW_MINUTES * 60));
      return res.status(429).json({
        error: 'Too many requests. You have reached the download limit. Please try again later.',
        retry_after_minutes: RATE_LIMIT_WINDOW_MINUTES,
        downloads_in_window: count
      });
    }
  } catch (err) {
    console.error('Rate limit error:', err);
    // Don't block if rate limit check fails — fail open
  }

  try {
    // ── LOG TO SUPABASE ─────────────────────────────────
    const { error: dbError } = await supabase
      .from('cv_downloads')
      .insert([{ email, ip_address: ip, user_agent: userAgent, blocked: false }]);

    if (dbError) console.error('Supabase insert error:', dbError);

    // ── FETCH ORIGINAL PDF ──────────────────────────────
    const pdfResponse = await fetch(CV_URL);
    if (!pdfResponse.ok) throw new Error('Failed to fetch CV PDF');
    const pdfBuffer = await pdfResponse.arrayBuffer();

    // ── ADD WATERMARK ───────────────────────────────────
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const pages = pdfDoc.getPages();
    const now = new Date().toUTCString();
    const watermark = `Downloaded by: ${email}  |  IP: ${ip}  |  ${now}`;
    const fontSize = 7;
    const textWidth = font.widthOfTextAtSize(watermark, fontSize);

    pages.forEach(page => {
      const { width } = page.getSize();
      page.drawText(watermark, {
        x: (width - textWidth) / 2,
        y: 12,
        size: fontSize,
        font,
        color: rgb(0.55, 0.55, 0.55),
        opacity: 0.65,
      });
    });

    const watermarkedBytes = await pdfDoc.save();

    // ── RETURN PDF ──────────────────────────────────────
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="CV_Larissa_Paiva_2026.pdf"');
    res.setHeader('Content-Length', watermarkedBytes.length);
    return res.status(200).send(Buffer.from(watermarkedBytes));

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
