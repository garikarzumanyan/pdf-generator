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

    // Enhanced debugging for Elementor counters
    console.log('=== DEBUGGING ELEMENTOR COUNTERS ===');
    
    // First, let's see what's on the page
    const pageContent = await page.evaluate(() => {
      const counters = document.querySelectorAll('.elementor-counter-number');
      const allElements = document.querySelectorAll('*');
      
      return {
        totalElements: allElements.length,
        counterElements: counters.length,
        counterDetails: Array.from(counters).map(counter => ({
          textContent: counter.textContent,
          toValue: counter.dataset.toValue,
          fromValue: counter.dataset.fromValue,
          duration: counter.dataset.duration
        })),
        pageTitle: document.title,
        bodyClasses: document.body.className
      };
    });
    
    console.log('Page analysis:', JSON.stringify(pageContent, null, 2));

    // Try to trigger Elementor counter animations
    console.log('Attempting to trigger Elementor counter animations...');
    
    await page.evaluate(() => {
      // Scroll to trigger animations
      window.scrollTo(0, 0);
      setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 100);
      setTimeout(() => window.scrollTo(0, 0), 200);
      
      // Try to trigger Elementor waypoint animations
      if (typeof elementorFrontend !== 'undefined') {
        console.log('Elementor frontend found, triggering waypoints...');
        elementorFrontend.hooks.doAction('frontend/element_ready/global', {});
      }
      
      // Try to trigger any intersection observer animations
      if (typeof IntersectionObserver !== 'undefined') {
        console.log('IntersectionObserver available');
      }
      
      // Force trigger any jQuery animations
      if (typeof $ !== 'undefined') {
        console.log('jQuery found, triggering animations...');
        $('.elementor-counter-number').each(function() {
          $(this).trigger('inview');
        });
      }
    });

    // Wait a bit for animations to start
    await new Promise(resolve => setTimeout(resolve, 1000));

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
        timeout: 20000, // Increased to 20 seconds
        polling: 100    // Check every 100ms
      });
    } catch (waitError) {
      if (waitError.name === 'TimeoutError') {
        console.log('Elementor counters timeout - proceeding with PDF generation anyway');
        
        // Log final counter values for debugging
        const finalValues = await page.evaluate(() => {
          const counters = document.querySelectorAll('.elementor-counter-number');
          return Array.from(counters).map(counter => ({
            textContent: counter.textContent,
            toValue: counter.dataset.toValue
          }));
        });
        console.log('Final counter values:', JSON.stringify(finalValues, null, 2));
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
