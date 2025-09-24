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
    
    // Set a proper viewport to prevent scaling issues
    await page.setViewport({
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    });
    
    await page.goto(url, { 
      waitUntil: 'networkidle0', 
      timeout: 30000 
    });
    
    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 3000));

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

    // Remove footer elements completely to prevent page splitting
    console.log('Removing footer elements...');
    await page.evaluate(() => {
      // Remove the entire colophon element
      const colophon = document.getElementById('colophon');
      if (colophon) {
        colophon.remove();
      }
      
      // Remove any other footer-related elements
      const footerElements = document.querySelectorAll('footer, .footer, .site-footer, #bottom-footer');
      footerElements.forEach(el => el.remove());
      
      // Remove cookie consent elements
      const cookieElements = document.querySelectorAll('#wpconsent-root, .cookie-consent, .cookie-notice');
      cookieElements.forEach(el => el.remove());
    });

    // Add CSS to ensure clean layout and prevent page breaks
    await page.addStyleTag({ 
      content: `
        /* Ensure body has no bottom spacing */
        body {
          margin-bottom: 0 !important;
          padding-bottom: 0 !important;
          min-height: auto !important;
          height: auto !important;
        }
        
        /* Remove any remaining footer spacing */
        .site-content,
        .content-area,
        .main-content,
        .page-content {
          margin-bottom: 0 !important;
          padding-bottom: 0 !important;
        }
        
        /* Prevent page breaks */
        * {
          page-break-after: avoid !important;
          page-break-before: avoid !important;
          page-break-inside: avoid !important;
        }
        
        /* Remove any sticky positioning that might cause issues */
        .sticky,
        .fixed,
        .fixed-top,
        .fixed-bottom {
          position: static !important;
        }
        
        /* Ensure no overflow issues */
        html, body {
          overflow-x: hidden !important;
          overflow-y: visible !important;
        }
      `
    });

    // Handle any existing exclude selectors from the WordPress plugin
    if (hideSelectors) {
      const safeSelectors = hideSelectors.replace(/[^a-zA-Z0-9.#,\s:-]/g, '');
      await page.addStyleTag({ content: `${safeSelectors} { display: none !important; }` });
    }

    // Get accurate page dimensions
    const dimensions = await page.evaluate(() => {
      // Get the actual content height
      const bodyHeight = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );
      
      return {
        width: Math.min(document.documentElement.scrollWidth, 1280),
        height: bodyHeight,
      };
    });

    console.log(`Page loaded. Dimensions: ${dimensions.width}x${dimensions.height}`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const filePath = path.join(tempDir, `${slug}.pdf`);

    // Generate PDF with proper parameters to prevent page splitting
    await page.pdf({
      path: filePath,
      printBackground: true,
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`,
      preferCSSPageSize: false, // Changed to false to use our dimensions
      margin: {
        top: '0px',
        right: '0px',
        bottom: '0px',
        left: '0px'
      },
      displayHeaderFooter: false,
      scale: 1,
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
