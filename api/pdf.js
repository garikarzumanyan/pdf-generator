// api/pdf.js (to be hosted externally)

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export default async function handler(req, res) {
  const { slug, url, hideSelectors = '' } = req.query;

  if (!slug || !url) {
    return res.status(400).json({ error: 'Missing slug or url.' });
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    if (hideSelectors) {
      // Basic sanitization: disallow characters that could break CSS syntax
      const safeSelectors = hideSelectors.replace(/[^a-zA-Z0-9.#,\s:-]/g, '');
      await page.addStyleTag({
        content: `${safeSelectors} { display: none !important; }`
      });
    }

    const dimensions = await page.evaluate(() => {
      return {
        width: Math.min(document.documentElement.scrollWidth, 1280),
        height: document.documentElement.scrollHeight,
      };
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const filename = `${slug}.pdf`; // consistent filename for caching/deduplication
    const filePath = path.join(tempDir, filename);

    await page.pdf({
      path: filePath,
      printBackground: true,
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`,
      preferCSSPageSize: true
    });

    const pdfBuffer = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
    res.send(pdfBuffer);

    // Clean up the temporary PDF file and directory
    fs.unlinkSync(filePath);
    fs.rmdirSync(tempDir, { recursive: true });

  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'PDF generation failed.' });
  } finally {
    await browser.close();
  }
}