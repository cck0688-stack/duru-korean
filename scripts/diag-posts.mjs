// DURU KOREAN — read-only: the posts that are not public yet, and whether the admin window's query works.
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const get = async (p) => { const r = await fetch(SUPABASE_URL + '/rest/v1/' + p, { headers: { apikey: KEY, Authorization: 'Bearer ' + token } }); const t = await r.text(); return { ok: r.ok, status: r.status, body: t }; };
const mine = await get('posts?select=id,slug,title,excerpt,body,category,post_date,created_at,image_url,image_alt,tags,published,rejected_at&published=eq.false&rejected_at=is.null&order=post_date.desc&limit=300');
console.log('admin-window query:', mine.status, mine.ok ? JSON.parse(mine.body).length + ' rows' : mine.body.slice(0, 300));
for (const col of ['rejected_at', 'approved_at', 'published_at', 'image_alt', 'image_url', 'excerpt', 'tags', 'post_date']) {
  const r = await get('posts?select=' + col + '&limit=1');
  console.log('column posts.' + col + ':', r.ok ? 'exists' : 'MISSING');
}
const cnt = await get('posts?select=id&published=eq.false&limit=200');
console.log('published=false count:', cnt.ok ? JSON.parse(cnt.body).length : cnt.body.slice(0, 200));
const all = await get('posts?select=id,title,category,post_date,published&published=eq.false&order=post_date.desc&limit=300');
const rows = all.ok ? JSON.parse(all.body) : [];
console.log('not published (any):', rows.length, '| rejected:', 0);
for (const r of rows.slice(0, 30)) console.log(' ', r.post_date, r.category, '', String(r.title).slice(0, 60));
const res = await get('resources?select=id,title,status,published&status=neq.published&status=neq.rejected&limit=300');
console.log('resources waiting:', res.ok ? JSON.parse(res.body).length : res.body.slice(0, 200));
const res2 = await get('resources?select=id,title,status,published&published=eq.false&limit=300');
console.log('resources published=false:', res2.ok ? JSON.parse(res2.body).map((r) => r.status + ' ' + r.title.slice(0, 30)).join(' | ') : res2.body.slice(0, 200));
