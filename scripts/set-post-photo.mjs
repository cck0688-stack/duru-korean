// DURU KOREAN — give one blog post another photograph (owner, 2026-10-25: the bus post had a blue sky).
//   node scripts/set-post-photo.mjs --like="서울 버스는 왜" --query="Seoul city bus" [--must=bus] [--dry-run]
// Searches the photo service, drops photographs another post already uses, keeps those whose description
// contains --must, takes the first, and writes it (with its credit) to the post.
import { resolvePhotos, photoKey } from '../api/_photos.js';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DRY = process.argv.includes('--dry-run');
const like = arg('like'); const queries = String(arg('query') || '').split('|').map((x) => x.trim()).filter(Boolean);
const must = new RegExp(arg('must') || '.', 'i');
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const h = { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const api = async (p, init) => { const r = await fetch(SUPABASE_URL + '/rest/v1/' + p, { headers: h, ...init }); const t = await r.text(); if (!r.ok) throw new Error(p.split('?')[0] + ' ' + r.status + ' ' + t.slice(0, 200)); return t ? JSON.parse(t) : null; };
const found = await api('posts?select=id,title,image_url&title=ilike.*' + encodeURIComponent(like) + '*&limit=5');
if (found.length !== 1) throw new Error('글을 하나로 정하지 못했습니다: ' + found.map((p) => p.title).join(' / '));
const post = found[0];
console.log('글: ' + post.title + '\n지금 사진: ' + post.image_url);
const used = new Set((await api('posts?select=image_url&image_url=not.is.null&limit=1000')).map((r) => photoKey(r.image_url)));
const photoCfg = resolvePhotos(process.env);
if (!photoCfg) throw new Error('사진 서비스 키가 없습니다');
let pick = null;
for (const q of queries) {
  const list = await photoCfg.service.search(photoCfg.key, q, 30);
  console.log('검색 "' + q + '": ' + list.length + '장');
  const fresh = list.filter((p) => !used.has(photoKey(p.url)));
  const ok = fresh.filter((p) => must.test(p.alt || ''));
  ok.slice(0, 5).forEach((p) => console.log('   후보: ' + p.alt + ' · ' + p.credit + ' · ' + p.url.slice(0, 80)));
  if (ok.length) { pick = { ...ok[0], query: q }; break; }
}
if (!pick) throw new Error('설명에 "' + (arg('must') || '') + '" 가 들어간 새 사진을 찾지 못했습니다');
console.log('고른 사진: ' + pick.alt + ' (' + pick.credit + ', ' + pick.source + ')\n' + pick.url);
if (DRY) process.exit(0);
await photoCfg.service.used(photoCfg.key, pick);
await api('posts?id=eq.' + post.id, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify({
  image_url: pick.url, image_alt: pick.alt || null, image_credit: pick.credit || null, image_credit_url: pick.creditUrl || null,
  image_source: pick.source || null, image_status: 'READY', updated_at: new Date().toISOString() }) });
console.log('바꿨습니다.');
