#!/usr/bin/env node
// DURU KOREAN — the "Read it here" files for the download pages
//
// A download's page shows the sheet's own content next to its PDF
// (js/resource-detail.js, read/<resource id>/<lang>.json). This copies,
// from a sheet's content (content/sheets/<id>/<lang>.json), only what a
// reader sees: never the checking notes (checkThese) or the report.
// No model is called.
//
//   node scripts/build-read.mjs            every sheet in content/sheets
//   node scripts/build-read.mjs <id> ...   only these

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const SRC = 'content/sheets', OUT = 'read';
// What a reader sees. Not: checkThese, tags, keyword, report, watchOutMark…
export const KEEP = ['title', 'objective', 'summary', 'level', 'minutes', 'category', 'setting', 'note', 'task',
  'words', 'letters', 'forms', 'watchOut', 'sections', 'dialogue', 'passage', 'exercises', 'answers'];

export function readable(sheet) {
  const out = {};
  for (const k of KEEP) if (sheet[k] != null && !(Array.isArray(sheet[k]) && !sheet[k].length)) out[k] = sheet[k];
  return out;
}

export function writeRead(id, lang, sheet, root = OUT) {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, lang + '.json'), JSON.stringify(readable(sheet)));
}

export function buildAll(ids) {
  let n = 0;
  for (const id of ids) {
    const dir = path.join(SRC, id);
    if (!existsSync(dir)) { console.log('no content for', id); continue; }
    for (const f of readdirSync(dir)) {
      const m = /^([a-zA-Z-]+)\.json$/.exec(f);
      if (!m || m[1] === 'report') continue;
      writeRead(id, m[1], JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
      n += 1;
    }
  }
  return n;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(SRC);
  console.log(buildAll(ids) + ' files for ' + ids.length + ' sheets');
}
