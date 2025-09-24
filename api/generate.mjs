import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument } from 'pdf-lib';

const urlsMap = {
  cpc: [
    `/`,
    `/print1/?product=Display%20Advertising`,
    `/print1/?product=Digital%20Edition`,
    `/print1/?product=Direct%20Mail`,
    `/print1/?product=Marketplace`,
    `/print1/?product=MLE`,
    `/print1/?product=Profiles`,
    `/print1/?product=Sponsored%20Content`,
    `/print1/content-calendar`,
    `/print2/?product=Display%20Advertising`,
    `/print2/?product=Digital%20Edition`,
    `/print2/?product=Direct%20Mail`,
    `/print2/?product=Marketplace`,
    `/print2/?product=MLE`,
    `/print2/?product=Profiles`,
    `/print2/?product=Sponsored%20Content`,
    `/print2/content-calendar`,
    `/enews1/?product=Display%20Advertising`,
    `/enews1/?product=Digital%20Edition`,
    `/enews1/?product=Direct%20Mail`,
    `/enews1/?product=Marketplace`,
    `/enews1/?product=MLE`,
    `/enews1/?product=Profil`/`,es`,
    `/enews1/?product=Sponsored%20Content`,
    `/enews1/content-calendar`,
    `/web1/?product=Display%20Advertising`,
    `/web1/?product=Digital%20Edition`,
    `/web1/?product=Direct%20Mail`,
    `/web1/?product=Marketplace`,
    `/web1/?product=MLE`,
    `/web1/?product=Profiles`,
    `/web1/?product=Sponsored%20Content`,
    `/web1/content-calendar`,
    `/obg1/?product=Display%20Advertising`,
    `/obg1/?product=Digital%20Edition`,
    `/obg1/?product=Direct%20Mail`,
    `/obg1/?product=Marketplace`,
    `/obg1/?product=MLE`,
    `/obg1/?product=Profiles`,
    `/obg1/?product=Sponsored%20Content`,
    `/obg1/content-calendar`
  ]
};

// Helper function to wait for Elementor counters
async function waitForElementorCounters(page, url) {
  try {
    console.log(`Waiting for Elementor counters on: ${url}`);
    await page.waitForFunction(() => {
      const counters = document.querySelectorAll('.elementor-counter-number');
      
      if (counters.length === 0) {
        console.log(`No Elementor counters found on ${url}, proceeding immediately`);
        return true;
      }
      
      console.log(`Found ${counters.length} Elementor counters on ${url}, checking values...`);
      
      // Check if all counters have reached their target values
      const allComplete = Array.from(counters).every(counter => {
        const currentValue = parseInt(counter.textContent.replace(/,/g, ''));
        const targetValue = parseInt(counter.dataset.toValue);
        const isComplete = currentValue === targetValue && currentValue > 0;
        
        if (!isComplete) {
          console.log(`Counter not complete on ${url}: current=${currentValue}, target=${targetValue}`);
        }
        
        return isComplete;
      });
      
      if (allComplete) {
        console.log(`All Elementor counters completed on ${url}`);
      }
      
      return allComplete;
    }, { 
      timeout: 15000, // 15 second timeout
      polling: 100    // Check every 100ms
    });
  } catch (waitError) {
    if (waitError.name === 'TimeoutError') {
      console.log(`Elementor counters timeout on ${url} - proceeding with PDF generation anyway`);
    } else {
      console.log(`Error waiting for Elementor counters on ${url}:`, waitError.message);
    }
    // Continue with PDF generation even if waiting fails
  }
}

export default async function handler(req, res) {
  const slug = req.query.slug || 'cpc';
  const base = `https://www.officialmediaguide.com/${slug}`;
  const urls = (urlsMap[slug] || []).map(u => `${base}${u.startsWith('/') ? '' : '/'}${u}`);

  const batchSize = 4;
  const tempDir = path.join(os.tmpdir(), `pdf-gen-${slug}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const mergedPdf = await PDFDocument.create();

  for (let batch = 0; batch < Math.ceil(urls.length / batchSize); batch++) {
    const start = batch * batchSize;
    const end = start + batchSize;
    const batchUrls = urls.slice(start, end);

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    for (let i = 0; i < batchUrls.length; i++) {
      const url = batchUrls[i];
      try {
        console.log(`Rendering [Batch ${batch}] Page: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

        // Wait for Elementor counters to complete
        await waitForElementorCounters(page, url);

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

        const pdfBytes = fs.readFileSync(filePath);
        const tempPdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(tempPdf, tempPdf.getPageIndices());
        copiedPages.forEach(p => mergedPdf.addPage(p));
      } catch (err) {
        console.warn(`Skipping ${url} due to error:`, err.message);
      }
    }

    await browser.close();
  }

  const finalPdfBytes = await mergedPdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
  res.send(Buffer.from(finalPdfBytes));
}
