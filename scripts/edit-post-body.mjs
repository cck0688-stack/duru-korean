#!/usr/bin/env node
// DURU KOREAN — change one sentence in one post's body (owner-approved edits only).
//   node scripts/edit-post-body.mjs --like="운동회" --from="..." --to="..." [--dry-run]
// The post must be found by --like, and --from must occur exactly once in its body.
// Nothing else in the post changes. The post's other translations are not touched; the
// translations of the changed body are made again afterwards with scripts/add-languages.mjs.
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const like = arg('like'), from = arg('from'), to = arg('to');
const DRY = process.argv.includes('--dry-run');
if (!like || from == null || to == null) throw new Error('--like, --from, --to are needed');
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const h = { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const api = async (p, init) => { const r = await fetch(SUPABASE_URL + '/rest/v1/' + p, { headers: h, ...init }); const t = await r.text(); if (!r.ok) throw new Error(p.split('?')[0] + ' ' + r.status + ' ' + t.slice(0, 200)); return t ? JSON.parse(t) : null; };
const found = await api('posts?select=id,title,body&title=ilike.*' + encodeURIComponent(like) + '*&limit=5');
if (found.length !== 1) throw new Error('글을 하나로 정하지 못했습니다: ' + found.map((p) => p.title).join(' / '));
const post = found[0];
const n = post.body.split(from).length - 1;
if (n !== 1) throw new Error('--from 이 본문에 ' + n + '번 나옵니다 (한 번이어야 합니다)');
const body = post.body.replace(from, to);
console.log('글: ' + post.title + '\n바꿀 문장: ' + from + '\n→ ' + to);
if (DRY) process.exit(0);
await api('posts?id=eq.' + post.id, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify({ body, updated_at: new Date().toISOString() }) });
console.log('바꿨습니다.');
