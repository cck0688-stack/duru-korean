#!/usr/bin/env node
// DURU KOREAN — look at the live site the way a visitor does
//
// For checking what a page really shows (the sandbox the site is built
// from cannot reach it): each address is opened in Chromium, and a
// full-page screenshot plus a short text summary are written to --out.
// Reads only; signs in as nobody.
//
//   node scripts/site-shots.mjs --out=DIR URL [URL …]
//   A URL ending in "#first-post" opens the page, then the first post
//   card on it.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = (args.find((a) => a.startsWith('--out=')) || '--out=shots').slice(6);
const urls = args.filter((a) => !a.startsWith('--'));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const summary = [];
for (const [i, raw] of urls.entries()) {
  const firstPost = raw.endsWith('#first-post');
  const url = raw.replace(/#first-post$/, '');
  for (const [w, tag] of [[1280, 'desk'], [390, 'phone']]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2500);
      if (firstPost) {
        const link = page.locator('article.res-card h3 a').first();
        await link.click({ timeout: 15000 });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500);
      }
      const name = String(i + 1).padStart(2, '0') + '-' + tag;
      await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
      const info = await page.evaluate(() => ({
        url: location.href,
        htmlLang: document.documentElement.lang,
        selects: [...document.querySelectorAll('select')].map((s) => ({
          id: s.id, value: s.value, options: [...s.options].map((o) => o.textContent.trim())
        })),
        headings: [...document.querySelectorAll('h1, h2, h3')].slice(0, 20).map((h) => h.textContent.trim().slice(0, 120)),
        text: document.body.innerText.slice(0, 1500)
      }));
      summary.push({ name, requested: raw, errors, ...info });
    } catch (err) {
      summary.push({ name: String(i + 1) + '-' + tag, requested: raw, failed: String(err.message || err), errors });
    }
    await page.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.map((s) => ({ name: s.name, url: s.url, lang: s.htmlLang, failed: s.failed, errors: (s.errors || []).slice(0, 3), selects: s.selects })), null, 1));
