#!/usr/bin/env node
// DURU KOREAN — copy the published worksheet files from Supabase storage to Cloudflare R2 (owner, 2026-11-11:
// Free Downloads are not made any more and the site goes back to the free Supabase plan, whose storage is 1 GB).
// The R2 key is the same as the Supabase key (resource_files.storage_key). A file whose public copy is missing
// is taken from its draft copy (this also restores the 22 files left without a public copy).
//   node scripts/r2-migrate.mjs --out=r2files --manifest=manifest.json        download from Supabase, write the manifest
//   node scripts/r2-migrate.mjs --verify=listing.txt --manifest=manifest.json  compare `aws s3 ls --recursive` with it
import fs from 'node:fs';
import path from 'node:path';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const manifestPath = arg('manifest') || 'manifest.json';

if (arg('verify')) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const have = new Map();
  for (const line of fs.readFileSync(arg('verify'), 'utf8').split('\n')) {
    const m = /^\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line.trim());
    if (m) have.set(m[2], Number(m[1]));
  }
  let ok = 0; const missing = [], wrong = [];
  for (const f of manifest) {
    const size = have.get(f.key);
    if (size == null) missing.push(f.key);
    else if (size !== f.size) wrong.push(f.key + ' (' + size + ' ≠ ' + f.size + ')');
    else ok += 1;
  }
  console.log('R2 확인: 맞는 파일 ' + ok + ' / ' + manifest.length + ' · 없음 ' + missing.length + ' · 크기 다름 ' + wrong.length);
  missing.slice(0, 10).forEach((k) => console.log('  없음 ' + k));
  wrong.slice(0, 10).forEach((k) => console.log('  다름 ' + k));
  process.exit(missing.length || wrong.length ? 1 : 0);
}

const out = arg('out') || 'r2files';
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
let token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const auth = () => ({ apikey: KEY, Authorization: 'Bearer ' + token });
const rows = [];
for (let from = 0; ; from += 1000) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/resource_files?select=id,storage_key,draft_key,file_size&published=eq.true&order=id.asc',
    { headers: { ...auth(), Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
  if (!r.ok) throw new Error('목록 ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const page = await r.json();
  rows.push(...page);
  if (page.length < 1000) break;
}
console.log('공개 파일 ' + rows.length + '개');
const enc = (k) => k.split('/').map(encodeURIComponent).join('/');
const manifest = [];
let i = 0, ok = 0, fromDraft = 0, bad = 0, bytes = 0;
async function worker() {
  while (i < rows.length) {
    const f = rows[i++];
    try {
      const tries = [['resources', f.storage_key, false]];
      if (f.draft_key) tries.push(['resource-drafts', f.draft_key.replace(/^resource-drafts\//, ''), true]);
      let buf = null, usedDraft = false;
      for (const [bucket, key, isDraft] of tries) {
        if (!key) continue;
        const r = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/' + bucket + '/' + enc(key), { headers: auth() });
        if (r.ok) { buf = Buffer.from(await r.arrayBuffer()); usedDraft = isDraft; break; }
      }
      if (!buf) throw new Error('원본을 찾지 못했습니다');
      const dest = path.join(out, f.storage_key);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      manifest.push({ key: f.storage_key, size: buf.length, expected: f.file_size });
      ok += 1; bytes += buf.length; if (usedDraft) fromDraft += 1;
    } catch (err) { bad += 1; console.log('  실패 ' + f.storage_key + ' — ' + err.message); }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
const off = manifest.filter((m) => m.expected != null && m.expected !== m.size).length;
console.log('내려받음 ' + ok + '개 (' + (bytes / 1048576).toFixed(0) + ' MB) · 초안에서 가져온 것 ' + fromDraft + ' · 실패 ' + bad + ' · 기록된 크기와 다른 것 ' + off);
if (bad) process.exit(1);
