#!/usr/bin/env node
// DURU KOREAN — copy one language's blog PDFs out of storage, named by date and slug (owner, 2026-11-11:
// the blog PDFs are to be deleted from Supabase, so they are downloaded first).
//   node scripts/blog-pdf-backup.mjs --lang=en --out=backup
// Only published posts. Writes <out>/<lang>/<date>_<slug>.pdf and <out>/<lang>/print/<date>_<slug>-print.pdf.
import fs from 'node:fs';
import path from 'node:path';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const lang = arg('lang'), out = arg('out') || 'backup';
if (!lang) throw new Error('--lang is needed');
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
let token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const auth = () => ({ apikey: KEY, Authorization: 'Bearer ' + token });

const posts = [];
for (let from = 0; ; from += 1000) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/posts?select=id,slug,post_date,created_at,pdf&published=eq.true&order=post_date.desc,id.asc',
    { headers: { ...auth(), Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
  if (!r.ok) throw new Error('글 목록 ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const page = await r.json();
  posts.push(...page);
  if (page.length < 1000) break;
}
const jobs = [];
for (const p of posts) {
  const f = p.pdf && p.pdf.files && p.pdf.files[lang];
  if (!f || !f.key) continue;
  const day = String(p.post_date || p.created_at || '').slice(0, 10) || 'undated';
  const base = day + '_' + String(p.slug || p.id).replace(/[^A-Za-z0-9._-]/g, '-');
  jobs.push({ key: f.key, file: path.join(out, lang, base + '.pdf') });
  if (f.print && f.print.key) jobs.push({ key: f.print.key, file: path.join(out, lang, 'print', base + '-print.pdf') });
}
console.log(lang + ': 공개된 글 ' + posts.length + '편, 내려받을 파일 ' + jobs.length + '개');

let i = 0, ok = 0, bad = 0, bytes = 0;
async function worker() {
  while (i < jobs.length) {
    const j = jobs[i++];
    try {
      let r = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/resources/' + j.key.split('/').map(encodeURIComponent).join('/'), { headers: auth() });
      if (!r.ok) throw new Error(String(r.status));
      const buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(j.file), { recursive: true });
      fs.writeFileSync(j.file, buf);
      ok += 1; bytes += buf.length;
    } catch (err) { bad += 1; console.log('  실패 ' + j.key + ' — ' + err.message); }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(lang + ': 내려받음 ' + ok + '개 (' + (bytes / 1048576).toFixed(0) + ' MB) · 실패 ' + bad);
if (bad) process.exit(1);
