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
    
    // Set global timeout to 60 seconds for all Puppeteer operations
    page.setDefaultTimeout(60000);
    
    // Navigate to page with increased timeout and more lenient wait strategy
    await page.goto(url, { 
      waitUntil: 'networkidle0',  // Wait until no network connections for 500ms
      timeout: 60000  // 60-second timeout
    });
    
    // Wait additional time for lazy-loaded content and animations
    await new Promise(resolve => setTimeout(resolve, 3000)); // Increased to 3 seconds

    // Replace Elementor counter text with target values
    console.log('Setting Elementor counter values to target values...');
    
    const counterResults = await page.evaluate(() => {
      const counters = document.querySelectorAll('.elementor-counter-number');
      const results = [];
      
      counters.forEach(counter => {
        const targetValue = counter.dataset.toValue;
        const originalValue = counter.textContent;
        
        if (targetValue) {
          // Set the counter text to the target value
          counter.textContent = targetValue;
          
          // Also add the "+" or "%" suffix if it was in the original text
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

    // Add CSS to ensure clean layout
    await page.addStyleTag({ 
      content: `
        /* Ensure body has no bottom spacing */
        #colophon > .naylor-footer-background {
            background: transparent !important
        }
      `
    });

    // Handle any existing exclude selectors from the WordPress plugin
    if (hideSelectors) {
      const safeSelectors = hideSelectors.replace(/[^a-zA-Z0-9.#,\s:-]/g, '');
      await page.addStyleTag({ 
        content: `${safeSelectors} { display: none !important; }` 
      });
      console.log(`Applied hide selectors: ${safeSelectors}`);
    }

    // Get page dimensions for PDF
    const dimensions = await page.evaluate(() => {
      return {
        width: Math.min(document.documentElement.scrollWidth, 1280),
        height: document.documentElement.scrollHeight,
      };
    });

    console.log(`Page loaded. Dimensions: ${dimensions.width}x${dimensions.height}`);

    // Create temporary directory for PDF
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const filePath = path.join(tempDir, `${slug}.pdf`);

    // Generate PDF with the calculated dimensions
    await page.pdf({
      path: filePath,
      printBackground: true,
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`,
      preferCSSPageSize: true,
    });

    // Read PDF and send response
    const pdfBuffer = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
    res.send(pdfBuffer);

    // Cleanup temporary files
    fs.unlinkSync(filePath);
    fs.rmdirSync(tempDir, { recursive: true });

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
