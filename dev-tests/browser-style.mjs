import assert from 'node:assert/strict';
import { assertReadable } from './browser-style-utils.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>body{background:white}.dim{background:rgba(0,0,0,.2)}.half{background:rgba(0,0,0,.5)}</style>
    <div class="dim"><span id="readable" style="color:black">Black on translucent gray</span>
      <span id="unreadable" style="color:white">White on translucent gray</span></div>
    <div class="half"><div class="half"><span id="nested" style="color:white">White on two translucent layers</span>
      <span id="nested-unreadable" style="color:black">Black on two translucent layers</span></div></div>
    <span id="text-alpha" style="color:rgba(0,0,0,.25)">Translucent text on white</span>
    <div style="background:rgb(0,0,0)"><span id="transparent" style="color:white;background:rgba(255,255,255,0)">Transparent layer on black</span></div>`);
  for (const selector of ['#readable', '#nested', '#transparent']) await assertReadable(page, selector);
  for (const selector of ['#unreadable', '#nested-unreadable', '#text-alpha']) {
    await assert.rejects(() => assertReadable(page, selector), /Unreadable text/);
  }
  await page.setContent('<body style="background:transparent"><span id="no-backing">Unknown canvas background</span>');
  await assert.rejects(() => assertReadable(page, '#no-backing'), /No opaque background/);
  console.log('PASS: translucent/nested backgrounds, transparent layers, text alpha, opaque backing required (7 cases).');
} finally { await browser.close(); }
