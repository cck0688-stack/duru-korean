// Render the stored English text of some sheets to PDF (pictures are made by the workflow).
//   node scripts/shot-sheets.mjs --read=<read dir> --ids=a,b,c --out=dir
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { renderSheet } from './pdf/render.mjs';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
fs.mkdirSync(arg('out'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const id of arg('ids').split(',')) {
  const ed = JSON.parse(fs.readFileSync(path.join(arg('read'), id, (arg('lang') || 'en') + '.json'), 'utf8'));
  const r = await renderSheet(ed, { category: ed.category, lang: arg('lang') || 'en', browser });
  fs.writeFileSync(path.join(arg('out'), id.slice(0, 8) + '.pdf'), r.pdf);
  console.log(id.slice(0, 8), ed.category, r.check.pages + '쪽', r.check.ok ? 'ok' : 'check: ' + JSON.stringify(r.check.problems || r.check.why || ''));
}
await browser.close();
