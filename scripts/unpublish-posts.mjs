// DURU KOREAN — take posts down (published = false) after keeping their text
// (owner, 2026-10-24: duplicates of a post that stays). Nothing is deleted.
//   node scripts/unpublish-posts.mjs --ids=id,id --backup=DIR
import fs from 'node:fs';
import path from 'node:path';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await res.json()).access_token;
if (!token) throw new Error('로그인 실패');
const h = { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const dir = path.resolve(arg('backup'));
fs.mkdirSync(dir, { recursive: true });
for (const id of (arg('ids') || '').split(',').filter(Boolean)) {
  const old = await (await fetch(SUPABASE_URL + '/rest/v1/posts?id=eq.' + id + '&select=*', { headers: h })).json();
  if (!old[0]) { console.log('없는 글 ' + id); continue; }
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(old[0], null, 2));
  const r = await fetch(SUPABASE_URL + '/rest/v1/posts?id=eq.' + id, {
    method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify({ published: false })
  });
  const t = await r.text();
  console.log((r.ok && t !== '[]' ? '비공개로 돌렸습니다: ' : '실패 (' + r.status + '): ') + old[0].title + (r.ok && t !== '[]' ? '' : ' ' + t.slice(0, 150)));
}
