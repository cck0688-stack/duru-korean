#!/usr/bin/env node
// DURU KOREAN — remove every blog PDF from storage (owner, 2026-11-11: downloaded first, then deleted to free
// 5.6 GB). Deletes the objects under resources/blog/ and clears posts.pdf, so the blog shows no PDF/print
// button (it offers them only while a post has a PDF record). Report only unless --delete.
//   node scripts/delete-blog-pdfs.mjs [--delete]
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const DELETE = process.argv.includes('--delete');
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
let token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const auth = () => ({ apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' });
const list = async (prefix) => {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(SUPABASE_URL + '/storage/v1/object/list/resources', { method: 'POST', headers: auth(), body: JSON.stringify({ prefix, limit: 1000, offset }) });
    if (!r.ok) throw new Error('목록 ' + prefix + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
};
const top = await list('blog');
const keys = [];
for (const entry of top) {
  if (entry.id) { keys.push('blog/' + entry.name); continue; }   // a file directly under blog/
  for (const f of await list('blog/' + entry.name)) if (f.id) keys.push('blog/' + entry.name + '/' + f.name);
}
let bytes = 0;
console.log('blog/ 아래 폴더 ' + top.length + '개 · 파일 ' + keys.length + '개');
const withRec = await (await fetch(SUPABASE_URL + '/rest/v1/posts?select=id&pdf=not.is.null&limit=2000', { headers: auth() })).json();
console.log('PDF 기록이 있는 글: ' + withRec.length + '편');
if (!DELETE) { console.log('--delete 가 없어서 아무것도 지우지 않았습니다.'); process.exit(0); }

let removed = 0;
for (let k = 0; k < keys.length; k += 100) {
  const chunk = keys.slice(k, k + 100);
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/resources', { method: 'DELETE', headers: auth(), body: JSON.stringify({ prefixes: chunk }) });
  if (!r.ok) { console.log('  삭제 실패 ' + r.status + ': ' + (await r.text()).slice(0, 160)); continue; }
  removed += chunk.length;
  if ((k / 100) % 10 === 0) console.log('  … ' + removed + '개 삭제');
}
console.log('삭제한 파일: ' + removed + '개 / ' + keys.length);
if (removed !== keys.length) { console.log('모두 지우지 못해서 글의 PDF 기록은 그대로 둡니다.'); process.exit(1); }
const p = await fetch(SUPABASE_URL + '/rest/v1/posts?pdf=not.is.null', { method: 'PATCH', headers: { ...auth(), Prefer: 'return=minimal' }, body: JSON.stringify({ pdf: null }) });
console.log('글의 PDF 기록 비움: ' + (p.ok ? '완료' : '실패 ' + p.status + ' ' + (await p.text()).slice(0, 160)));
