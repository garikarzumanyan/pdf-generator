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
    
    page.setDefaultTimeout(120000);
    
    await page.goto(url, { 
      waitUntil: 'networkidle0',
      timeout: 120000
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Setting Elementor counter values to target values...');
    
    const counterResults = await page.evaluate(() => {
      const counters = document.querySelectorAll('.elementor-counter-number');
      const results = [];
      
      counters.forEach(counter => {
        const targetValue = counter.dataset.toValue;
        const originalValue = counter.textContent;
        
        if (targetValue) {
          counter.textContent = targetValue;
          
          if (originalValue.includes('+')) {
            counter.textContent += '+';
          } else if (originalValue.includes('%')) {
            counter.textContent += '%';
          }
          
          results.push({
            originalValue: originalValue,
            targetValue: targetValue,
            finalValue: counter.textContent
          });
        }
      });
      
      return results;
    });
    
    console.log('Counter updates:', JSON.stringify(counterResults, null, 2));

    // Replace iframes with screenshots
    console.log('Processing iframes (Canva, YouTube, etc.)...');
    const iframeReplacements = await page.evaluate(async () => {
      const iframes = document.querySelectorAll('iframe');
      const replacements = [];
      
      for (const iframe of iframes) {
        try {
          // Get iframe dimensions
          const rect = iframe.getBoundingClientRect();
          const width = iframe.width || iframe.offsetWidth || rect.width || 560;
          const height = iframe.height || iframe.offsetHeight || rect.height || 315;
          
          // Mark iframe for screenshot
          iframe.setAttribute('data-iframe-index', replacements.length);
          
          replacements.push({
            index: replacements.length,
            src: iframe.src,
            width: width,
            height: height
          });
        } catch (err) {
          console.error('Error processing iframe:', err);
        }
      }
      
      return replacements;
    });
    
    console.log(`Found ${iframeReplacements.length} iframes to process`);

    // Take screenshots of each iframe and replace them
    for (const iframeInfo of iframeReplacements) {
      try {
        const iframe = await page.$(`iframe[data-iframe-index="${iframeInfo.index}"]`);
        
        if (iframe) {
          // Check if iframe is visible
          const isVisible = await iframe.evaluate(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && 
                   rect.height > 0 && 
                   style.display !== 'none' && 
                   style.visibility !== 'hidden' &&
                   style.opacity !== '0';
          });
          
          if (!isVisible) {
            console.log(`Skipping hidden iframe ${iframeInfo.index} (${iframeInfo.src})`);
            continue;
          }
          
          // Take screenshot of the iframe
          const screenshotBuffer = await iframe.screenshot({ encoding: 'base64' });
          
          // Replace iframe with image
          await page.evaluate((index, screenshot, width, height) => {
            const iframe = document.querySelector(`iframe[data-iframe-index="${index}"]`);
            if (iframe) {
              const img = document.createElement('img');
              img.src = `data:image/png;base64,${screenshot}`;
              img.style.cssText = `
                width: ${width}px;
                height: ${height}px;
                display: block;
                border: 1px solid #ddd;
              `;
              iframe.parentNode.replaceChild(img, iframe);
            }
          }, iframeInfo.index, screenshotBuffer, iframeInfo.width, iframeInfo.height);
          
          console.log(`Replaced iframe ${iframeInfo.index} (${iframeInfo.src}) with screenshot`);
        }
      } catch (err) {
        console.error(`Failed to screenshot iframe ${iframeInfo.index}:`, err.message);
      }
    }

    await page.addStyleTag({ 
      content: `
        #colophon > .naylor-footer-background {
            background: transparent !important
        }
      `
    });

    if (hideSelectors) {
      const safeSelectors = hideSelectors.replace(/[^a-zA-Z0-9.#,\s:-]/g, '');
      await page.addStyleTag({ 
        content: `${safeSelectors} { display: none !important; }` 
      });
      console.log(`Applied hide selectors: ${safeSelectors}`);
    }

    console.log('Scrolling to bottom to trigger lazy-loaded images...');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('Scrolling back to top...');
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    const dimensions = await page.evaluate(() => {
      return {
        width: Math.min(document.documentElement.scrollWidth, 1280),
        height: document.documentElement.scrollHeight,
      };
    });

    console.log(`Page loaded. Dimensions: ${dimensions.width}x${dimensions.height}`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const filePath = path.join(tempDir, `${slug}.pdf`);

    console.log('Starting PDF generation...');
    
    await page.pdf({
      path: filePath,
      printBackground: true,
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`,
      preferCSSPageSize: true,
    });

    console.log('PDF generation completed');

    const pdfBuffer = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
    res.send(pdfBuffer);

    fs.unlinkSync(filePath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`PDF generation successful for: ${url}`);
  } catch (err) {
    console.error(`PDF generation failed for ${url}:`, err.message);
    console.error('Full error:', err);
    res.status(500).json({ 
      error: 'PDF generation failed.', 
      detail: err.message 
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
