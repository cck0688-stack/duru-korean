// DURU KOREAN — read-only: what stands between a held resource and its Publish button.
//   node scripts/diag-resource.mjs --like=축제 [--id=<uuid>]
// Prints the resource, each file (language, version, draft, published) and each source's rights status.
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const get = async (p) => { const r = await fetch(SUPABASE_URL + '/rest/v1/' + p, { headers: { apikey: KEY, Authorization: 'Bearer ' + token } }); const t = await r.text(); if (!r.ok) throw new Error(p.split('?')[0] + ' ' + r.status + ' ' + t.slice(0, 200)); return JSON.parse(t); };
const id = arg('id');
const like = arg('like');
const rows = await get('resources?select=id,title,status,published,category,publish_location,origin,created_at,updated_at,resource_files(id,lang,version,draft_key,storage_key,published,file_size,file_type),resource_sources(*)' +
  (id ? '&id=eq.' + id : '&title=ilike.*' + encodeURIComponent(like) + '*') + '&order=created_at.desc&limit=10');
for (const r of rows) {
  console.log('== ' + r.id + ' · ' + r.title + '\n   status=' + r.status + ' published=' + r.published + ' category=' + r.category + ' location=' + r.publish_location + ' origin=' + r.origin + ' updated=' + r.updated_at);
  for (const f of (r.resource_files || []).sort((a, b) => a.lang.localeCompare(b.lang) || (a.version || 0) - (b.version || 0)))
    console.log('   file ' + f.lang + ' v' + (f.version || 1) + ' published=' + f.published + ' draft=' + (f.draft_key ? 'yes' : 'NO') + ' public=' + (f.storage_key ? 'yes' : 'no') + ' size=' + f.file_size + ' ' + f.file_type);
  for (const s of r.resource_sources || []) console.log('   source ' + s.rights_status + ' · ' + JSON.stringify(s).slice(0, 160));
}
