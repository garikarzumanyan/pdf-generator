// 1. Fix rendering of URLs with ?product=...
// 2. Add splitting logic to batch requests into groups of 5 and auto-merge.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
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

  const batchSize = 5;
  const chunks = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    chunks.push(urls.slice(i, i + batchSize));
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });

  const mergedPdf = await PDFDocument.create();

  for (const [index, group] of chunks.entries()) {
    const page = await browser.newPage();
    for (const [i, url] of group.entries()) {
      try {
        console.log(`Rendering [Batch ${index + 1}] Page: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

        const dimensions = await page.evaluate(() => {
          return {
            width: Math.min(document.documentElement.scrollWidth, 1280),
            height: document.documentElement.scrollHeight
          };
        });

        const tempFilePath = path.join(os.tmpdir(), `page-${index}-${i}.pdf`);
        await page.pdf({
          path: tempFilePath,
          printBackground: true,
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          pageRanges: '1',
          preferCSSPageSize: true
        });

        const file = await fs.readFile(tempFilePath);
        const tempPdf = await PDFDocument.load(file);
        const copiedPages = await mergedPdf.copyPages(tempPdf, tempPdf.getPageIndices());
        copiedPages.forEach(p => mergedPdf.addPage(p));

        await fs.unlink(tempFilePath);
      } catch (err) {
        console.warn(`Skipping ${url} due to error:`, err.message);
      }
    }
    await page.close();
  }

  await browser.close();

  const finalPdfBytes = await mergedPdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
  res.send(Buffer.from(finalPdfBytes));
}