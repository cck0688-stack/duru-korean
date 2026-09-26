// DURU KOREAN — every worksheet, one folder per language
//
// The owner's order (2026-09-26): the newest PDF of every auto
// worksheet on the free-resources shelf, sorted into a folder per
// language and named "(<language>)<keyword>.pdf" — "(en)receipt.pdf".
// Held drafts are included (they are what the owner is checking).
// Nothing on the site is changed; the files are only read.
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD, SUPABASE_URL / SUPABASE_ANON_KEY
//
//   node scripts/bundle-sheets.mjs --out=DIR

import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGE_NAMES } from '../api/_providers.js';
import { rest, where, download } from './relayout-sheets.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const LANGS = Object.keys(LANGUAGE_NAMES);
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const log = (...a) => console.log(...a);

async function signIn() {
  const email = process.env.DURU_BOT_EMAIL;
  const password = process.env.DURU_BOT_PASSWORD;
  if (!email || !password) throw new Error('DURU_BOT_EMAIL 과 DURU_BOT_PASSWORD 가 필요합니다.');
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ').');
  return body.access_token;
}

// The same keyword the site's download button uses (js/resource-common.js).
const clean = (raw) => String(raw || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 16);
function keywordFor(r) {
  const own = clean(r.keyword);
  if (own.length >= 2) return { word: own, own: true };
  for (const t of r.tags || []) {
    const tag = clean(String(t).split(/\s+/).slice(0, 2).join(''));
    if (tag.length >= 3) return { word: tag, own: false };
  }
  const en = (r.i18n && r.i18n.en && r.i18n.en.title) || r.description || '';
  const words = String(en).toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'how', 'your', 'what', 'when'].includes(w));
  const guess = clean(words.slice(0, 2).join(''));
  return { word: guess.length >= 2 ? guess : 'durukorean', own: false };
}

async function run() {
  const out = path.resolve(arg('out') || 'bundle');
  let token = await signIn();
  const rows = await rest(token, 'resources?select=*,resource_files(id,lang,version,published,storage_key,draft_key)' +
    '&origin=eq.auto&status=neq.rejected&publish_location=eq.free-resources&order=created_at.asc&limit=5000');
  log('학습지 ' + rows.length + '개');

  fs.rmSync(out, { recursive: true, force: true });
  LANGS.forEach((l) => fs.mkdirSync(path.join(out, l), { recursive: true }));
  const used = new Set();
  const index = [['keyword', 'title', 'category', 'status', 'published', 'languages', 'id']];
  const missing = [];
  let count = 0;

  for (const r of rows) {
    const newest = {};
    (r.resource_files || []).forEach((f) => {
      if (!where(f) || !LANGS.includes(f.lang)) return;
      if (!newest[f.lang] || (f.version || 1) > (newest[f.lang].version || 1)) newest[f.lang] = f;
    });
    // Two sheets on one keyword: the later one gets a number.
    const k = keywordFor(r);
    let word = k.word;
    for (let n = 2; used.has(word); n += 1) word = k.word + n;
    used.add(word);
    const got = [];
    if (count % 10 === 0) token = await signIn();
    for (const lang of LANGS) {
      const f = newest[lang];
      if (!f) { missing.push(word + ' ' + lang); continue; }
      try {
        const bytes = await download(token, where(f));
        fs.writeFileSync(path.join(out, lang, '(' + lang + ')' + word + '.pdf'), bytes);
        got.push(lang);
      } catch (err) {
        missing.push(word + ' ' + lang + ' (' + err.message + ')');
      }
    }
    count += 1;
    log('· ' + word + (k.own ? '' : ' (키워드 없음 — 추정)') + ' — ' + r.title + ' — ' + got.length + '개 언어');
    index.push([word, r.title, r.category, r.status, String(!!r.published), got.join(' '), r.id]);
  }

  const csv = index.map((row) => row.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  fs.writeFileSync(path.join(out, 'index.csv'), '﻿' + csv + '\n');
  log('');
  LANGS.forEach((l) => log(l + ': ' + fs.readdirSync(path.join(out, l)).length + '개'));
  if (missing.length) { log('없는 파일 ' + missing.length + '개:'); missing.forEach((m) => log('  - ' + m)); }
}

run().catch((err) => { console.error(err.message || err); process.exit(1); });
