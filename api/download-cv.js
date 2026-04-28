import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const CV_URL = 'https://raw.githubusercontent.com/larixa/larixa.github.io/main/CV_Larissa%20Paiva%202026.pdf';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  // Get IP
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'Unknown';

  const userAgent = req.headers['user-agent'] || 'Unknown';
  const downloadedAt = new Date().toISOString();

  try {
    // 1. Save to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    await supabase.from('cv_downloads').insert([{ email, ip_address: ip, user_agent: userAgent }]);

    // 2. Fetch original PDF
    const pdfResponse = await fetch(CV_URL);
    if (!pdfResponse.ok) throw new Error('Failed to fetch CV PDF');
    const pdfBytes = await pdfResponse.arrayBuffer();

    // 3. Add watermark
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const pages = pdfDoc.getPages();

    const watermarkText = `Downloaded by: ${email}  |  IP: ${ip}  |  ${new Date(downloadedAt).toUTCString()}`;
    const fontSize = 7;
    const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);

    pages.forEach(page => {
      const { width } = page.getSize();
      const x = (width - textWidth) / 2;
      page.drawText(watermarkText, {
        x,
        y: 14,
        size: fontSize,
        font,
        color: rgb(0.6, 0.6, 0.6),
        opacity: 0.7,
      });
    });

    const watermarkedPdf = await pdfDoc.save();

    // 4. Return watermarked PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="CV_Larissa_Paiva_2026.pdf"');
    res.setHeader('Content-Length', watermarkedPdf.length);
    return res.status(200).send(Buffer.from(watermarkedPdf));

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
