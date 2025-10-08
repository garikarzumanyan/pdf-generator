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

    // Replace YouTube iframes with thumbnails
    console.log('Replacing YouTube videos with thumbnails...');
    const videoReplacements = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
      const replacements = [];
      
      iframes.forEach(iframe => {
        // Extract video ID from YouTube URL
        const src = iframe.src;
        let videoId = null;
        
        // Handle different YouTube URL formats
        if (src.includes('youtube.com/embed/')) {
          videoId = src.split('youtube.com/embed/')[1].split('?')[0];
        } else if (src.includes('youtu.be/')) {
          videoId = src.split('youtu.be/')[1].split('?')[0];
        }
        
        if (videoId) {
          // Get iframe dimensions
          const width = iframe.width || iframe.offsetWidth || 560;
          const height = iframe.height || iframe.offsetHeight || 315;
          
          // Create replacement container with thumbnail
          const container = document.createElement('div');
          container.style.cssText = `
            width: ${width}px;
            height: ${height}px;
            position: relative;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
          `;
          
          // Add thumbnail image
          const thumbnail = document.createElement('img');
          thumbnail.src = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
          thumbnail.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
          `;
          
          // Add play button overlay
          const playButton = document.createElement('div');
          playButton.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 68px;
            height: 48px;
            background: rgba(255, 0, 0, 0.8);
            border-radius: 12px;
            cursor: pointer;
          `;
          playButton.innerHTML = `
            <svg viewBox="0 0 68 48" width="68" height="48" style="display: block;">
              <path d="M66.52,7.74c-0.78-2.93-2.49-5.41-5.42-6.19C55.79,.13,34,0,34,0S12.21,.13,6.9,1.55 C3.97,2.33,2.27,4.81,1.48,7.74C0.06,13.05,0,24,0,24s0.06,10.95,1.48,16.26c0.78,2.93,2.49,5.41,5.42,6.19 C12.21,47.87,34,48,34,48s21.79-0.13,27.1-1.55c2.93-0.78,4.64-3.26,5.42-6.19C67.94,34.95,68,24,68,24S67.94,13.05,66.52,7.74z" fill="currentColor"></path>
              <path d="M 45,24 27,14 27,34" fill="#fff"></path>
            </svg>
          `;
          
          container.appendChild(thumbnail);
          container.appendChild(playButton);
          
          // Replace iframe with container
          iframe.parentNode.replaceChild(container, iframe);
          
          replacements.push({
            videoId: videoId,
            width: width,
            height: height
          });
        }
      });
      
      return replacements;
    });
    
    console.log('Replaced YouTube videos:', JSON.stringify(videoReplacements, null, 2));

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
