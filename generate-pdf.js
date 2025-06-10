const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const PDFMerger = require('pdf-merger-js').default;

const slug = process.argv[2] || 'cpc'; // dynamic association slug
const urls = [
  `https://www.officialmediaguide.com/${slug}/`,
  `https://www.officialmediaguide.com/${slug}/print/`,
  `https://www.officialmediaguide.com/${slug}/print1/`,
  // `https://www.officialmediaguide.com/${slug}/print1/?product=Digital%20Edition`,
  // `https://www.officialmediaguide.com/${slug}/print1/?product=Direct%20Mail`,
  // `https://www.officialmediaguide.com/${slug}/print1/content-calendar/`,
  // `https://www.officialmediaguide.com/${slug}/print2/`,
  // `https://www.officialmediaguide.com/${slug}/print2/?product=Digital%20Edition`,
  // `https://www.officialmediaguide.com/${slug}/print2/?product=Direct%20Mail`,
  // `https://www.officialmediaguide.com/${slug}/print2/?product=MLE`,
  // `https://www.officialmediaguide.com/${slug}/print2/?product=Profiles`,
  // `https://www.officialmediaguide.com/${slug}/enews1/`,
  // `https://www.officialmediaguide.com/${slug}/web1/`,
  // `https://www.officialmediaguide.com/${slug}/obg1/`,
  // `https://www.officialmediaguide.com/${slug}/obg1/?product=Profiles`,
  // `https://www.officialmediaguide.com/${slug}/obg1/?product=Sponsored%20Content`,
    `https://www.officialmediaguide.com/${slug}/contact/`
];

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const merger = new PDFMerger();
  const tempDir = path.resolve(__dirname, 'pdf-temp');

  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const filePath = path.resolve(tempDir, `page${i + 1}.pdf`);
    console.log(`Checking: ${url}`);

    try {
      const response = await page.goto(url, { waitUntil: 'networkidle2' });

      if (!response || response.status() >= 400) {
        console.warn(`Skipping (status ${response ? response.status() : 'unknown'}): ${url}`);
        continue;
      }

      // Measure page content size
      const dimensions = await page.evaluate(() => {
        const width = document.documentElement.scrollWidth;
        const height = document.documentElement.scrollHeight;
        return {
          width: Math.min(width, 1920), // Cap width at 1280px
          height
        };
      });

      /*
      await page.addStyleTag({
        content: `
          header, footer {
            display: none !important;
            height: 0 !important;
            width: 0 !important;
            overflow: hidden !important;
          }
        `
      });

      await page.evaluate(() => {
        const selectorsToHide = ['header', 'footer'];
        selectorsToHide.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });
      });
      */

      await page.pdf({
        path: filePath,
        printBackground: true,
        // width: '1200px',
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        scale: 1,
        pageRanges: '1',
        preferCSSPageSize: true
      });

      merger.add(filePath);
      console.log(`✔ Rendered: ${url}`);

    } catch (err) {
      console.warn(`❌ Error rendering ${url}: ${err.message}`);
    }
  }

  const outputPath = path.resolve(__dirname, `output-${slug}.pdf`);
  await merger.save(outputPath);
  await browser.close();

  console.log(`✅ PDF generated: ${outputPath}`);
})();