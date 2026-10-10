// DURU KOREAN — the first series, one zip per shelf, English only
//
// The owner (2026-10-10): when all 300 are made, a zip each for Hangul
// Starter, Grammar Cheat Sheets and Vocabulary, English PDFs only.
// The series is every auto sheet on those three shelves made since the
// series began (--since); held drafts are included, rejected ones not.
// Nothing on the site is changed; the files are only read.
//
//   node scripts/series-zip.mjs --out=DIR [--since=2026-10-09T02:00:00Z]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rest, where, download } from './relayout-sheets.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const log = (...a) => console.log(...a);
const SHELVES = { hangul: 'Hangul-Starter', grammar: 'Grammar-Cheat-Sheets', vocab: 'Vocabulary' };
const SINCE = arg('since') || '2026-10-09T02:00:00Z';

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ').');
  return body.access_token;
}

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sheet';

async function run() {
  const out = path.resolve(arg('out') || 'series-zip');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  let token = await signIn();
  const index = [['shelf', 'no', 'file', 'title', 'status', 'id']];
  for (const [shelf, name] of Object.entries(SHELVES)) {
    const rows = await rest(token, 'resources?select=id,title,status,i18n,created_at,resource_files(lang,version,storage_key,draft_key)' +
      '&origin=eq.auto&status=neq.rejected&publish_location=eq.free-resources&category=eq.' + shelf +
      '&created_at=gte.' + SINCE + '&order=created_at.asc&limit=1000');
    const dir = path.join(out, name);
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const r of rows) {
      const files = (r.resource_files || []).filter((f) => f.lang === 'en' && where(f));
      files.sort((a, b) => (b.version || 1) - (a.version || 1));
      if (!files.length) { log('  English PDF 없음: ' + r.title); continue; }
      if (n % 10 === 0) token = await signIn();
      const bytes = await download(token, where(files[0]));
      n += 1;
      const en = (r.i18n && r.i18n.en && r.i18n.en.title) || r.title;
      const file = String(n).padStart(3, '0') + '-' + slug(en) + '.pdf';
      fs.writeFileSync(path.join(dir, file), bytes);
      index.push([shelf, n, file, en, r.status, r.id]);
    }
    log(name + ': ' + n + '편 (목표 100)');
    const zip = path.join(out, name + '-EN.zip');
    execFileSync('zip', ['-qr', zip, name], { cwd: out });
    fs.rmSync(dir, { recursive: true, force: true });
    log('  → ' + zip + ' (' + Math.round(fs.statSync(zip).size / 1024 / 1024 * 10) / 10 + ' MB)');
  }
  const csv = index.map((row) => row.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  fs.writeFileSync(path.join(out, 'index.csv'), '﻿' + csv + '\n');
}

run().catch((err) => { console.error(err.message || err); process.exit(1); });
