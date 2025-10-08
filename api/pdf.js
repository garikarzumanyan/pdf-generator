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

    // Scroll to load all lazy iframes
    console.log('Scrolling to load lazy iframes...');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get iframe information
    console.log('Processing iframes (Canva, YouTube, etc.)...');
    const iframeReplacements = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      const replacements = [];
      
      for (const iframe of iframes) {
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
            iframe.setAttribute('data-iframe-index', replacements.length);
            
            replacements.push({
              index: replacements.length,
              src: iframe.src,
              width: width,
              height: height
            });
          }
        } catch (err) {
          console.error('Error processing iframe:', err);
        }
      }
      
      return replacements;
    });
    
    console.log(`Found ${iframeReplacements.length} visible iframes to process`);

    // Screenshot each iframe by opening its URL in a new page
    for (const iframeInfo of iframeReplacements) {
      try {
        console.log(`Screenshotting iframe ${iframeInfo.index} (${iframeInfo.src})...`);
        
        // Open iframe URL in new page
        const iframePage = await browser.newPage();
        await iframePage.setViewport({
          width: Math.floor(iframeInfo.width),
          height: Math.floor(iframeInfo.height)
        });
        
        try {
          await iframePage.goto(iframeInfo.src, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
          });
          
          // Wait for content to render
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Take screenshot
          const screenshotBuffer = await iframePage.screenshot({ 
            encoding: 'base64',
            fullPage: false
          });
          
          await iframePage.close();
          
          // Replace iframe with image in main page
          await page.evaluate((index, screenshot, width, height, src) => {
            const iframe = document.querySelector(`iframe[data-iframe-index="${index}"]`);
            if (iframe) {
              const container = document.createElement('div');
              container.style.cssText = `
                width: ${width}px;
                height: ${height}px;
                position: relative;
                display: block;
                background: #f5f5f5;
                border: 1px solid #ddd;
                overflow: hidden;
              `;
              
              const img = document.createElement('img');
              img.src = `data:image/png;base64,${screenshot}`;
              img.style.cssText = `
                width: 100%;
                height: 100%;
                display: block;
                object-fit: cover;
              `;
              
              // Add small badge
              const badge = document.createElement('div');
              badge.style.cssText = `
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: rgba(0,0,0,0.75);
                color: white;
                padding: 4px 10px;
                font-size: 10px;
                border-radius: 3px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              `;
              badge.textContent = 'Embedded Content';
              
              container.appendChild(img);
              container.appendChild(badge);
              
              iframe.parentNode.replaceChild(container, iframe);
            }
          }, iframeInfo.index, screenshotBuffer, iframeInfo.width, iframeInfo.height, iframeInfo.src);
          
          console.log(`✓ Replaced iframe ${iframeInfo.index} with screenshot`);
          
        } catch (err) {
          console.error(`Failed to load iframe URL ${iframeInfo.src}:`, err.message);
          await iframePage.close();
          
          // Create placeholder for failed iframe
          await page.evaluate((index, width, height, src) => {
            const iframe = document.querySelector(`iframe[data-iframe-index="${index}"]`);
            if (iframe) {
              const placeholder = document.createElement('div');
              placeholder.style.cssText = `
                width: ${width}px;
                height: ${height}px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #f0f0f0;
                border: 2px dashed #ccc;
                color: #666;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 14px;
                text-align: center;
                padding: 20px;
              `;
              placeholder.innerHTML = `<div>Embedded Content<br><small style="font-size: 11px; opacity: 0.7;">(${new URL(src).hostname})</small></div>`;
              
              iframe.parentNode.replaceChild(placeholder, iframe);
            }
          }, iframeInfo.index, iframeInfo.width, iframeInfo.height, iframeInfo.src);
        }
        
      } catch (err) {
        console.error(`Failed to process iframe ${iframeInfo.index}:`, err.message);
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

    console.log('Final scroll to load any remaining lazy images...');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));

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
