import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument } from 'pdf-lib';

export default async function handler(req, res) {
  const slug = req.query.slug || 'cpc';
  const base = `https://www.officialmediaguide.com/${slug}`;

  const urls = [
    `${base}/`,
    `${base}/print/`,
    `${base}/print1/`,
    `${base}/print1/?product=Digital%20Edition`,
    `${base}/print1/?product=Direct%20Mail`,
    `${base}/print1/content-calendar`,
    `${base}/print2/`,
    `${base}/print2/?product=Digital%20Edition`,
    `${base}/print2/?product=Direct%20Mail`,
    `${base}/print2/?product=MLE`,
    `${base}/print2/?product=Profiles`,
    `${base}/enews1/`,
    `${base}/web1/`,
    `${base}/obg1/`,
    `${base}/obg1/?product=Profiles`,
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));

  // Split URLs into batches of 4
  const batchSize = 4;
  const batches = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    batches.push(urls.slice(i, i + batchSize));
  }

  const mergedPdf = await PDFDocument.create();

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchPaths = [];

    for (let i = 0; i < batch.length; i++) {
      const url = batch[i];
      try {
        console.log(`Rendering [Batch ${b + 1}] Page: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

        const dimensions = await page.evaluate(() => {
          const width = document.documentElement.scrollWidth;
          const height = document.documentElement.scrollHeight;
          return {
            width: Math.min(width, 1280),
            height,
          };
        });

        const filePath = path.join(tempDir, `batch${b + 1}_page${i + 1}.pdf`);
        await page.pdf({
          path: filePath,
          printBackground: true,
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          pageRanges: '1',
          preferCSSPageSize: true,
        });

        batchPaths.push(filePath);
      } catch (err) {
        console.warn(`Skipping ${url} due to error:`, err.message);
      }
    }

    for (const pdfPath of batchPaths) {
      const pdfBytes = fs.readFileSync(pdfPath);
      const tempPdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(tempPdf, tempPdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }
  }

  await browser.close();
  const finalPdfBytes = await mergedPdf.save();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
  res.send(Buffer.from(finalPdfBytes));
}