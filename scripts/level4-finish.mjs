// DURU KOREAN — finishing the Level 4 series (owner, 2026-10-13)
//
//   --do=reset-samples   the five English-only samples are deleted (rows, files) and
//                        their ids are taken out of each shelf's plan, so the chain
//                        makes them again in ten languages
//   --do=zip --out=DIR   per shelf, a zip of the English PDFs and a zip of all ten languages
//
// Held drafts are included in the zips; rejected ones are not. Nothing is published.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rest, where, download } from './relayout-sheets.mjs';
import { loadPlan, savePlan } from './generate-sheets.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const log = (...a) => console.log(...a);
const SAMPLES = { grammar: ['63c868a3-de55-45b3-9e12-6904fec5d67f', 'G4-07'], vocab: ['dd7858da-c0d9-4be1-951c-610833fbe933', 'V4-11'],
  reading: ['0437aa4a-4dee-4add-a999-f10b9807df39', 'R4-21'], reallife: ['f3ff9c32-e834-40c1-9688-a3b8c5db3d2c', 'L4-12'], etc: ['a121ae1e-2096-42ea-95a3-36d80d38a0e8', 'E4-01'] };
const SHELVES = { grammar: 'Grammar-Cheat-Sheets', vocab: 'Vocabulary', reading: 'Reading-Practice', reallife: 'Real-life-Korean', etc: 'Everything-Else' };
const SINCE = arg('since') || '2026-10-13T01:30:00Z';

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ')');
  return body.access_token;
}
const headers = (t, x) => ({ apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + t, ...(x || {}) });
async function removeObjects(token, bucket, keys) {
  if (!keys.length) return;
  await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket, { method: 'DELETE', headers: headers(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: keys }) });
}

async function resetSamples() {
  // Every Level 4 sheet that has only English (the five samples and any made in English-only mode)
  // is deleted and its curriculum id opened again, so the chain makes it in ten languages.
  // Resources and plan ids pair up in the order they were made.
  const token = await signIn();
  const read = arg('read');
  for (const shelf of Object.keys(SHELVES)) {
    const rows = await rest(token, 'resources?select=id,title,status,created_at,cover_key,resource_files(lang,storage_key,draft_key)' +
      '&origin=eq.auto&status=neq.rejected&publish_location=eq.free-resources&category=eq.' + shelf +
      '&created_at=gte.' + SINCE + '&order=created_at.asc&limit=1000');
    const l4 = rows.filter((r) => { try { return JSON.parse(fs.readFileSync(path.join(read, r.id, 'en.json'), 'utf8')).level === 'Intermediate'; } catch { return false; } });
    const plan = await loadPlan(token, shelf);
    const ids = (plan.done || []).filter((x) => /^[A-Z]4-\d+$/.test(x));
    const paired = ids.length === l4.length;
    log(shelf + ': 시트 ' + l4.length + '개, 계획의 Level 4 항목 ' + ids.length + '개' + (paired ? '' : ' — 짝이 안 맞아 알려진 샘플만 처리'));
    const drop = new Set();
    for (let i = 0; i < l4.length; i++) {
      const r = l4[i];
      const langs = new Set((r.resource_files || []).map((f) => f.lang));
      const known = r.id === SAMPLES[shelf][0];
      if (langs.size > 3 || (!paired && !known)) continue;
      const files = r.resource_files || [];
      await rest(token, 'resources?id=eq.' + r.id, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      await removeObjects(token, 'resources', files.map((f) => f.storage_key).filter(Boolean));
      await removeObjects(token, 'resource-drafts', files.map((f) => f.draft_key).filter(Boolean).map((k) => k.replace(/^resource-drafts\//, '')));
      drop.add(paired ? ids[i] : SAMPLES[shelf][1]);
      log('  지움: ' + r.title + ' → ' + (paired ? ids[i] : SAMPLES[shelf][1]) + ' 다시 엽니다');
    }
    if (drop.size) {
      plan.done = (plan.done || []).filter((x) => !drop.has(x));
      if (plan.tried) for (const d of drop) delete plan.tried[d];
      await savePlan(token, shelf, plan);
    }
  }
}

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sheet';

async function zipAll() {
  const out = path.resolve(arg('out') || 'level4-zip');
  const read = arg('read');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  let token = await signIn();
  const index = [['shelf', 'no', 'file', 'title', 'status', 'id']];
  for (const [shelf, name] of Object.entries(SHELVES)) {
    const rows = await rest(token, 'resources?select=id,title,status,keyword,created_at,resource_files(lang,version,storage_key,draft_key)' +
      '&origin=eq.auto&status=neq.rejected&publish_location=eq.free-resources&category=eq.' + shelf +
      '&created_at=gte.' + SINCE + '&order=created_at.asc&limit=1000');
    const dirEn = path.join(out, 'Level4-' + name + '-EN'); const dirAll = path.join(out, 'Level4-' + name + '-ALL-LANGUAGES');
    fs.mkdirSync(dirEn, { recursive: true }); fs.mkdirSync(dirAll, { recursive: true });
    let n = 0;
    // Only Level 4 sheets: the level says Intermediate, and the shelf's plan lists how many Level 4 items are done.
    // The last sheets of the second series were made in the same hours; when there are more candidates than
    // plan items, the earliest extras are those (they are named in the log).
    let cand = rows.filter((r) => { try { return JSON.parse(fs.readFileSync(path.join(read, r.id, 'en.json'), 'utf8')).level === 'Intermediate'; } catch { return false; } });
    const plan = await loadPlan(token, shelf);
    const want = (plan.done || []).filter((x) => /^[A-Z]4-\d+$/.test(x)).length;
    if (want && cand.length > want) { log('  Level 4가 아닌 것으로 보고 뺌: ' + cand.slice(0, cand.length - want).map((r) => r.title).join(' / ')); cand = cand.slice(cand.length - want); }
    for (const r of cand) {
      if (n % 10 === 0) token = await signIn();
      n += 1;
      const key = slug(r.keyword || '') !== 'sheet' ? slug(r.keyword) : r.id.slice(0, 8);
      const base = String(n).padStart(2, '0') + '-' + key;
      const byLang = new Map();
      for (const f of (r.resource_files || []).filter((x) => where(x)).sort((a, b) => (b.version || 1) - (a.version || 1))) if (!byLang.has(f.lang)) byLang.set(f.lang, f);
      for (const [lang, f] of byLang) {
        const bytes = await download(token, where(f));
        fs.writeFileSync(path.join(dirAll, base + '(' + lang + ').pdf'), bytes);
        if (lang === 'en') fs.writeFileSync(path.join(dirEn, base + '.pdf'), bytes);
      }
      index.push([shelf, n, base, r.title, r.status, r.id + ' [' + [...byLang.keys()].join('/') + ']']);
    }
    log(name + ': ' + n + '편 (목표 40)');
    for (const d of [dirEn, dirAll]) { execFileSync('zip', ['-qr', d + '.zip', path.basename(d)], { cwd: out }); fs.rmSync(d, { recursive: true, force: true }); log('  → ' + d + '.zip (' + Math.round(fs.statSync(d + '.zip').size / 1048576 * 10) / 10 + ' MB)'); }
  }
  fs.writeFileSync(path.join(out, 'index.csv'), '﻿' + index.map((row) => row.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n') + '\n');
}

const what = arg('do');
(what === 'reset-samples' ? resetSamples() : what === 'zip' ? zipAll() : Promise.reject(new Error('--do=reset-samples 또는 --do=zip')))
  .catch((err) => { console.error(err.message || err); process.exit(1); });
