#!/usr/bin/env node
// DURU KOREAN — remove the asterisks (**bold**, *italic*) from the posts already written (owner, 2026-11-12).
// "- **계량기함 뚜껑**: 닫혀있고" becomes "- 계량기함 뚜껑: 닫혀있고", in the Korean body, in every translation's
// sentences, in an admin's own translation (posts.i18n) and in the title and summary. The translation and the
// word list are stamped with a fingerprint of the body, so each is stamped again with the new body's fingerprint
// when its sentences still line up with it; a post whose sentence count would change is listed instead, to be
// translated again (scripts/add-languages.mjs does that).
//   node scripts/strip-asterisks.mjs            report only
//   node scripts/strip-asterisks.mjs --apply    write the changes
import { MT } from './lib/mt.mjs';
import { plain } from './lib/generate.mjs';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const APPLY = process.argv.includes('--apply');
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const h = { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const posts = [];
for (let from = 0; ; from += 500) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/posts?select=id,title,excerpt,body,tags,i18n,mt,study,published,post_date&order=id.asc',
    { headers: { ...h, Range: from + '-' + (from + 499), 'Range-Unit': 'items' } });
  if (!r.ok) throw new Error('글 목록 ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const page = await r.json(); posts.push(...page);
  if (page.length < 500) break;
}
const star = (v) => JSON.stringify(v == null ? '' : v).includes('*');
const deep = (v) => Array.isArray(v) ? v.map(deep) : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : typeof v === 'string' ? plain(v) : v;

let changed = 0, retranslate = 0;
for (const p of posts) {
  if (!['body', 'title', 'excerpt', 'tags', 'i18n', 'mt', 'study'].some((k) => star(p[k]))) continue;
  const body = plain(p.body || '');
  const oldHash = MT.fingerprint(p.body || ''), newHash = MT.fingerprint(body);
  const oldN = MT.sentences(p.body || '').length, newN = MT.sentences(body).length;
  const patch = {};
  if (body !== p.body) patch.body = body;
  for (const k of ['title', 'excerpt']) if (star(p[k])) patch[k] = plain(p[k]);
  if (star(p.tags)) patch.tags = deep(p.tags);
  if (star(p.i18n)) patch.i18n = deep(p.i18n);
  const stale = [];
  if (p.mt) {
    const mt = deep(p.mt);
    for (const [c, m] of Object.entries(mt)) {
      if (m && m.hash === oldHash) {
        if (Array.isArray(m.sentences) && m.sentences.length === newN && oldN === newN) m.hash = newHash;
        else stale.push(c);                       // its sentences no longer line up: translated again later
      }
    }
    if (star(p.mt) || JSON.stringify(mt) !== JSON.stringify(p.mt)) patch.mt = mt;
  }
  if (p.study) {
    const st = deep(p.study);
    if (st.hash === oldHash && oldN === newN) st.hash = newHash;
    if (JSON.stringify(st) !== JSON.stringify(p.study)) patch.study = st;
  }
  if (!Object.keys(patch).length) continue;
  changed += 1; if (stale.length) retranslate += 1;
  console.log((p.published ? '' : '[초안] ') + p.post_date + ' ' + p.title.slice(0, 44) + ' — ' + Object.keys(patch).join(',') +
    (stale.length ? ' · 문장 수가 달라져 다시 번역할 언어: ' + stale.join(',') : ''));
  if (APPLY) {
    patch.updated_at = new Date().toISOString();
    const r = await fetch(SUPABASE_URL + '/rest/v1/posts?id=eq.' + p.id, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    if (!r.ok) console.log('   저장 실패 ' + r.status + ' ' + (await r.text()).slice(0, 160));
  }
}
console.log('글 ' + posts.length + '편 중 별표가 있던 글 ' + changed + '편 (다시 번역이 필요한 글 ' + retranslate + '편)' + (APPLY ? ' — 저장했습니다' : ' — 아직 저장하지 않았습니다 (--apply 가 없습니다)'));
