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
   
    page.setDefaultTimeout(150000);
   
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 150000
    });
   
    await new Promise(resolve => setTimeout(resolve, 10000));
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
    // Replace iframes with video player placeholder
    console.log('Replacing iframes with video player placeholders...');
    const iframeReplacements = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      const replacements = [];
     
      iframes.forEach((iframe, index) => {
        try {
          const rect = iframe.getBoundingClientRect();
          const style = window.getComputedStyle(iframe);
          const width = iframe.width || iframe.offsetWidth || rect.width || 560;
          const height = iframe.height || iframe.offsetHeight || rect.height || 315;
         
          // Check if visible
          const isVisible = rect.width > 0 &&
                           rect.height > 0 &&
                           style.display !== 'none' &&
                           style.visibility !== 'hidden' &&
                           style.opacity !== '0';
         
          if (isVisible && iframe.src) {
            const src = iframe.src;
            let embedType = 'Video';
           
            // Determine embed type
            if (src.includes('youtube.com') || src.includes('youtu.be')) {
              embedType = 'YouTube Video';
            } else if (src.includes('vimeo.com')) {
              embedType = 'Vimeo Video';
            } else if (src.includes('canva.com')) {
              embedType = 'Canva Presentation';
            } else if (src.includes('player') || src.includes('video')) {
              embedType = 'Video';
            } else {
              embedType = 'Embedded Content';
            }
           
            // Create video player placeholder
            const placeholder = document.createElement('div');
            placeholder.style.cssText = `
              width: ${width}px;
              height: ${height}px;
              position: relative;
              display: flex;
              align-items: center;
              justify-content: center;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              border-radius: 8px;
              overflow: hidden;
            `;
           
            // Create play button
            const playButton = document.createElement('div');
            playButton.style.cssText = `
              width: 80px;
              height: 80px;
              background: rgba(255, 255, 255, 0.9);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            `;
           
            // Create play triangle
            const playTriangle = document.createElement('div');
            playTriangle.style.cssText = `
              width: 0;
              height: 0;
              border-style: solid;
              border-width: 15px 0 15px 25px;
              border-color: transparent transparent transparent #667eea;
              margin-left: 6px;
            `;
           
            playButton.appendChild(playTriangle);
            placeholder.appendChild(playButton);
           
            // Add label at bottom
            const label = document.createElement('div');
            label.style.cssText = `
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              background: rgba(0, 0, 0, 0.7);
              color: white;
              padding: 12px 16px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              text-align: center;
            `;
            label.textContent = embedType;
           
            placeholder.appendChild(label);
           
            // Replace iframe
            iframe.parentNode.replaceChild(placeholder, iframe);
           
            replacements.push({ embedType, width, height });
          }
        } catch (err) {
          console.error('Error replacing iframe:', err);
        }
      });
     
      return replacements;
    });
   
    console.log(`Replaced ${iframeReplacements.length} iframes:`, JSON.stringify(iframeReplacements, null, 2));
    // Check and open accordions
    console.log('Checking and opening accordions...');
    const accordionResults = await page.evaluate(() => {
      const summaries = document.querySelectorAll('summary.e-n-accordion-item-title');
      const count = summaries.length;
     
      summaries.forEach(summary => {
        summary.click();
      });
     
      return {
        count,
        opened: count > 0
      };
    });
    console.log(`Accordion check: Found ${accordionResults.count} elements. Opened: ${accordionResults.opened}`);
    // Wait for any animations or newly revealed content to settle
    await new Promise(resolve => setTimeout(resolve, 10000));
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
   
    await new Promise(resolve => setTimeout(resolve, 10000));
   
    console.log('Scrolling back to top...');
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
   
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Emulate print media before measuring dimensions to account for print-specific layout changes
    await page.emulateMediaType('print');

    const dimensions = await page.evaluate(() => {
      return {
        width: Math.min(document.documentElement.scrollWidth, 1600),
        height: document.documentElement.scrollHeight,
      };
    });
    console.log(`Page loaded. Dimensions: ${dimensions.width}x${dimensions.height}`);

    // Append hidden zero-height div to body as a layout sentinel
    await page.evaluate(() => {
      const sentinel = document.createElement('div');
      sentinel.style.cssText = 'height: 0px; overflow: hidden; visibility: hidden;';
      document.body.appendChild(sentinel);
    });
    // Re-calculate height after adding sentinel (in case it affects layout)
    dimensions.height = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`Dimensions after sentinel: ${dimensions.width}x${dimensions.height}`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const filePath = path.join(tempDir, `${slug}.pdf`);
    console.log('Starting PDF generation...');
   
    await page.pdf({
      path: filePath,
      printBackground: true,
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`,
      preferCSSPageSize: false,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
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
