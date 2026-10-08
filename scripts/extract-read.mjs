#!/usr/bin/env node
// DURU KOREAN — "Read it here" files for the sheets that have only a PDF
//
// 48 sheets have their content on file (content/sheets) and were
// converted by build-read.mjs. The rest were made before the content was
// kept; their PDF is all there is. This reads each published PDF's text
// (PyMuPDF), has the model put it into the sheet's own shape — copying,
// never rewriting — and writes read/<resource id>/<lang>.json.
//
// Guard: the Korean words the model lists must be found in the PDF's
// text; a file where they are not is not written.
//
//   node scripts/extract-read.mjs --out=dir [--ids=a,b] [--limit=n] [--langs=en,ko] [--text-only]

import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { signIn, api } from './generate-sheets.mjs';
import { writeRead } from './build-read.mjs';
import { sheetSchema } from './lib/sheets.mjs';
import { resolveProvider } from '../api/_providers.js';
import { withPatience } from './lib/patiently.mjs';
import { subscriptionConfig, useSubscription, stage, usageReport } from './lib/claude-code.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const OUT = arg('out') || 'read-output';
const IDS = (arg('ids') || '').split(',').filter(Boolean);
const LIMIT = Number(arg('limit')) || 0;
const LANGS = (arg('langs') || '').split(',').filter(Boolean);
const TEXT_ONLY = args.includes('--text-only');
const log = (...a) => console.log(...a);

async function fetchFile(token, key) {
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/resources/' + key, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    }).catch(() => null);
    if (res && res.ok) return Buffer.from(await res.arrayBuffer());
    if (res && res.status < 500 && res.status !== 429) return null;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  return null;
}

const PY = 'import sys,fitz\n' +
  'd=fitz.open(sys.argv[1])\n' +
  'for i,p in enumerate(d):\n' +
  '    print("=== page %d ===" % (i+1))\n' +
  '    for b in p.get_text("blocks", sort=True):\n' +
  '        t=b[4].strip()\n' +
  '        if t: print(t.replace("\\n"," / "))\n';
function pdfText(file) {
  return execFileSync('python3', ['-P', '-c', PY, file], { encoding: 'utf8', maxBuffer: 20e6 });
}

const SYSTEM = [
  'You put the text of a printed Korean-language worksheet (a PDF, read as text, in reading order)',
  'into a fixed JSON shape so that a web page can show it.',
  '',
  '- Copy. Every word, sentence, question and answer is taken exactly as printed, in the language it is printed in.',
  '  Never correct, improve, translate, shorten or add. Korean stays exactly as written.',
  '- Leave out page furniture: the DURU KOREAN name, web address, page numbers ("1 / 2"), licence and',
  '  copyright lines, "Answers" page headers (the answers themselves go in answers).',
  '- Fill a field only from what is printed. A field the sheet does not have is "" (text), 0 (minutes) or [].',
  '  level and minutes only if printed (e.g. "Level 1", "15 min").',
  '- words: each vocabulary row (Korean, romanization, meaning, example sentence and its meaning).',
  '- exercises: one string per question, in order, with its number removed and any choices kept in the string.',
  '- answers: one string per answer, in order.',
  '- task: the heading and instruction line that sit above the exercises.',
  '- keyword, tags, checkThese: always "" / [].',
  '- If a table or box cannot be told apart in the text, keep its rows in order; do not guess.'
].join('\n');

const strip = (s) => String(s || '').replace(/\s+/g, '').replace(/[“”"'‘’.,!?~·\-–—:;()/]/g, '');
// The Korean the model listed must be in the PDF, else the file is not trusted.
function grounded(sheet, text) {
  const hay = strip(text);
  const items = [];
  for (const w of sheet.words || []) items.push(w.korean);
  for (const d of sheet.dialogue || []) items.push(d.korean);
  for (const f of sheet.forms || []) items.push(f.example);
  for (const p of sheet.passage || []) items.push(p);
  const korean = items.filter((s) => /[가-힣]/.test(s || ''));
  if (!korean.length) return { ok: true, miss: 0, n: 0 };
  const missed = korean.filter((s) => !hay.includes(strip(s)));
  const miss = missed.length;
  // One line in a short sheet may sit across two blocks of the PDF's text.
  return { ok: miss <= Math.max(1, Math.floor(korean.length * 0.1)), miss, n: korean.length, missed };
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (['keyword', 'tags', 'checkThese', 'watchOutMark'].includes(k)) continue;
    if (v == null || v === '' || v === 0 || (Array.isArray(v) && !v.length)) continue;
    if (k === 'task' && !(v.title || v.line)) continue;
    out[k] = v;
  }
  return out;
}

async function main() {
  const onSub = useSubscription(process.env, 'SHEET_PROVIDER');
  let cfg;
  if (onSub) { cfg = withPatience(subscriptionConfig(process.env).translator, log); }
  else if (!TEXT_ONLY) { cfg = withPatience(resolveProvider(process.env), log); }
  if (cfg) cfg.timeoutMs = Number(process.env.DURU_CALL_TIMEOUT_MS) || 240000;
  if (cfg) log('model: ' + cfg.label + ' / ' + cfg.model);

  const { token } = await signIn();
  const call = api(token);
  let rows = await call('resources?select=id,title,category&status=eq.published&order=first_published_at');
  rows = rows.filter((r) => (!IDS.length || IDS.includes(r.id)) && !existsSync(path.join('content/sheets', r.id)));
  const tmp = path.join(OUT, '_pdf'); mkdirSync(tmp, { recursive: true });
  let done = 0, skipped = 0, bad = 0, sheets = 0;
  for (const r of rows) {
    if (LIMIT && sheets >= LIMIT) break;
    const files = await call('resource_files?select=lang,storage_key&published=eq.true&resource_id=eq.' + r.id + '&order=lang');
    const want = files.filter((f) => !LANGS.length || LANGS.includes(f.lang));
    sheets += 1;
    for (const f of want) {
      const dest = path.join(OUT, r.id, f.lang + '.json');
      if (!IDS.length && (existsSync(dest) || existsSync(path.join('read', r.id, f.lang + '.json')))) { skipped += 1; continue; }
      const pdf = await fetchFile(token, f.storage_key);
      if (!pdf) { bad += 1; log('  no file: ' + r.title + ' ' + f.lang); continue; }
      const file = path.join(tmp, r.id + '-' + f.lang + '.pdf'); writeFileSync(file, pdf);
      const text = pdfText(file);
      if (TEXT_ONLY) { log('##### ' + r.id + ' ' + f.lang + ' ' + r.category + ' ' + r.title + '\n' + text); continue; }
      try {
        stage('extract');
        const strictSchema = cfg.provider.strictSchema !== false;
        const raw = await cfg.provider.chat(cfg, SYSTEM + '\n\nShelf: ' + r.category, text, sheetSchema(r.category, strictSchema));
        const sheet = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const g = grounded(sheet, text);
        if (!g.ok) { bad += 1; log('  not matching the PDF (' + g.miss + '/' + g.n + '): ' + r.title + ' ' + f.lang + ' → ' + g.missed.join(' | ').slice(0, 200)); continue; }
        if (g.miss) log('  1 line not found in the PDF text, kept: ' + g.missed.join(' | ').slice(0, 120));
        writeRead(r.id, f.lang, { ...clean(sheet), category: r.category }, OUT);
        done += 1;
      } catch (e) { bad += 1; log('  failed: ' + r.title + ' ' + f.lang + ' — ' + (e.message || e)); }
    }
    log(r.category + ' · ' + r.title + ' (' + want.length + ')');
  }
  log('written ' + done + ', already there ' + skipped + ', failed ' + bad);
  const u = usageReport(); if (u) log(u);
  if (bad && !done) process.exitCode = 1;
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
