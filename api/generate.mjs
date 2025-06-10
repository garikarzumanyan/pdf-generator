import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import PDFMerger from 'pdf-merger-js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export default async function handler(req, res) {
  const slug = req.query.slug || 'cpc';
  const base = `https://www.officialmediaguide.com/${slug}`;

  const urls = [
    `${base}/`,
    `${base}/print/`,
    `${base}/print1/`,
    `${base}/print1/?product=Digital%20Edition/`,
    `${base}/print1/?product=Direct%20Mail/`,
    `${base}/print1/content-calendar//`,
    `${base}/print2/`,
    `${base}/print2/?product=Digital%20Edition/`,
    `${base}/print2/?product=Direct%20Mail/`,
    `${base}/print2/?product=MLE/`,
    `${base}/print2/?product=Profiles/`,
    `${base}/enews1/`,
    `${base}/web1/`,
    `${base}/obg1/`,
    `${base}/obg1/?product=Profiles/`,
    `${base}/obg1/?product=Sponsored%20Content`,
    `${base}/contact/`
  ];

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  const merger = new PDFMerger();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`Processing (${i + 1}/${urls.length}): ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

      // Inject custom CSS to hide unwanted parts (optional)
      /*
      await page.addStyleTag({
        content: `
          header, footer, .download-button, .no-print {
            display: none !important;
          }
        `
      });
      */

      const dimensions = await page.evaluate(() => {
        const width = document.documentElement.scrollWidth;
        const height = document.documentElement.scrollHeight;
        return {
          width: Math.min(width, 1280), // Cap width at 1280px
          height
        };
      });

      const filePath = path.join(tempDir, `page${i + 1}.pdf`);
      console.log(`Rendering PDF: ${filePath} (${dimensions.width}x${dimensions.height})`);
      
      await page.pdf({
        path: filePath,
        printBackground: true,
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        pageRanges: '1',
        preferCSSPageSize: true
      });

      merger.add(filePath);
    } catch (err) {
      console.warn(`Skipping ${url} due to error:`, err.message);
    }
  }

  const finalPdf = path.join(tempDir, `${slug}.pdf`);
  await merger.save(finalPdf);
  await browser.close();

  const file = fs.readFileSync(finalPdf);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
  res.send(file);
};