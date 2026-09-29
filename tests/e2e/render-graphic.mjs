// Render store/feature-graphic.html to a PNG at an exact size.
//   cd tests/e2e && node render-graphic.mjs ../../store/feature-graphic.html ../../store/feature-graphic-1200x600.png 1200 600
// Needs Chromium at CHROME_PATH or /usr/bin/chromium.
import puppeteer from 'puppeteer-core';
const [src, out, w, h] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await b.newPage();
await p.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
await p.goto('file://' + (await import('node:path')).resolve(src), { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: out });
await b.close();
