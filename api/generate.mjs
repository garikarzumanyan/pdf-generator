import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument } from 'pdf-lib';

const urlsMap = {
  cpc: [
    `/`,
    `/print/`,
    `/print1/`,
    `/print1/?product=Digital%20Edition`,
    `/print1/?product=Direct%20Mail`,
    `/print1/content-calendar`,
    `/print2/`,
    `/print2/?product=Digital%20Edition`,
    `/print2/?product=Direct%20Mail`,
    `/print2/?product=MLE`,
    `/print2/?product=Profiles`,
    `/enews1/`,
    `/web1/`,
    `/obg1/`,
    `/obg1/?product=Profiles`,
    `/obg1/?product=Sponsored%20Content`,
    `/contact/`
  ]
};

export default async function handler(req, res) {
  const slug = req.query.slug || 'cpc';
  const base = `https://www.officialmediaguide.com/${slug}`;
  const urls = (urlsMap[slug] || []).map(u => `${base}${u.startsWith('/') ? '' : '/'}${u}`);

  const batchSize = 4;
  const tempDir = path.join(os.tmpdir(), `pdf-gen-${slug}`);

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  // === Render All Batches Sequentially ===
  const totalBatches = Math.ceil(urls.length / batchSize);
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();

  for (let batch = 0; batch < totalBatches; batch++) {
    const start = batch * batchSize;
    const end = start + batchSize;
    const batchUrls = urls.slice(start, end);

    for (let i = 0; i < batchUrls.length; i++) {
      const url = batchUrls[i];
      try {
        console.log(`Rendering [Batch ${batch}] Page: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

        const dimensions = await page.evaluate(() => {
          const width = document.documentElement.scrollWidth;
          const height = document.documentElement.scrollHeight;
          return {
            width: Math.min(width, 1280),
            height,
          };
        });

        const filePath = path.join(tempDir, `batch${batch}_page${i + 1}.pdf`);
        await page.pdf({
          path: filePath,
          printBackground: true,
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          pageRanges: '1',
          preferCSSPageSize: true,
        });
      } catch (err) {
        console.warn(`Skipping ${url} due to error:`, err.message);
      }
    }
  }

  await browser.close();

  // === Merge All PDFs ===
  const pdfDoc = await PDFDocument.create();
  const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.pdf'));

  for (const file of files) {
    const pdfPath = path.join(tempDir, file);
    const pdfBytes = fs.readFileSync(pdfPath);
    const tempPdf = await PDFDocument.load(pdfBytes);
    const copiedPages = await pdfDoc.copyPages(tempPdf, tempPdf.getPageIndices());
    copiedPages.forEach(p => pdfDoc.addPage(p));
  }

  const finalPdfBytes = await pdfDoc.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
  res.send(Buffer.from(finalPdfBytes));
}