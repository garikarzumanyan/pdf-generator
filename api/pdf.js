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

  console.log(`Starting PDF generation for: ${url} with slug: ${slug}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s to allow lazy content

    // Wait for Elementor counters to complete their animation
    try {
      console.log('Waiting for Elementor counters to complete...');
      await page.waitForFunction(() => {
        const counters = document.querySelectorAll('.elementor-counter-number');
        
        if (counters.length === 0) {
          console.log('No Elementor counters found, proceeding immediately');
          return true;
        }
        
        console.log(`Found ${counters.length} Elementor counters, checking values...`);
        
        // Check if all counters have reached their target values
        const allComplete = Array.from(counters).every(counter => {
          const currentValue = parseInt(counter.textContent.replace(/,/g, ''));
          const targetValue = parseInt(counter.dataset.toValue);
          const isComplete = currentValue === targetValue && currentValue > 0;
          
          if (!isComplete) {
            console.log(`Counter not complete: current=${currentValue}, target=${targetValue}`);
          }
          
          return isComplete;
        });
        
        if (allComplete) {
          console.log('All Elementor counters have completed their animation');
        }
        
        return allComplete;
      }, { 
        timeout: 15000, // 15 second timeout
        polling: 100    // Check every 100ms
      });
    } catch (waitError) {
      if (waitError.name === 'TimeoutError') {
        console.log('Elementor counters timeout - proceeding with PDF generation anyway');
      } else {
        console.log('Error waiting for Elementor counters:', waitError.message);
      }
      // Continue with PDF generation even if waiting fails
    }

    if (hideSelectors) {
      const safeSelectors = hideSelectors.replace(/[^a-zA-Z0-9.#,\s:-]/g, '');
      await page.addStyleTag({ content: `${safeSelectors} { display: none !important; }` });
    }

    const dimensions = await page.evaluate(() => {
      return {
        width: Math.min(document.documentElement.scrollWidth, 1280),
        height: document.documentElement.scrollHeight,
      };
    });

    console.log(`Page loaded. Dimensions: ${dimensions.width}x${dimensions.height}`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const filePath = path.join(tempDir, `${slug}.pdf`);

    await page.pdf({
      path: filePath,
      printBackground: true,
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`,
      preferCSSPageSize: true,
    });

    const pdfBuffer = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
    res.send(pdfBuffer);

    fs.unlinkSync(filePath);
    fs.rmdirSync(tempDir, { recursive: true });

    console.log(`PDF generation successful for: ${url}`);
  } catch (err) {
    console.error(`PDF generation failed for ${url}:`, err.message);
    res.status(500).json({ error: 'PDF generation failed.', detail: err.message });
  } finally {
    if (browser) await browser.close();
  }
}
