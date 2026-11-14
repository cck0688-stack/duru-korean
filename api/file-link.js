// DURU KOREAN — POST /api/file-link
//
// The published worksheet files live in a private Cloudflare R2 bucket (owner, 2026-11-11: Supabase's free
// plan holds 1 GB, the worksheets are 6 GB). A signed-in visitor asks here for a link to one file and gets
// one that works for five minutes — the same thing Supabase's signed links were, with the same rule: no
// login, no link.
//
//   POST { key: "auto/<resource id>/en-v1.pdf", download: "bank(en).pdf" | true | "" }
//   Authorization: Bearer <the visitor's Supabase access token>
//   → 200 { url }   401 not signed in   404 no such published file, or it is not in R2 (the page then
//                   falls back to Supabase)   503 R2 is not set up
//
// Only keys that are a published resource_files.storage_key are linked; anything else is refused.
//
// Owner, 2026-11-14: a robot that signs up and then takes the worksheets one by one is stopped by a daily limit
// per member (FILE_DAILY_LIMIT, 80 by default; admins are exempt). The count is a small object in R2
// (_limits/<member>/<Seoul day>), so no table is needed. 429 = the day's limit is used up.

import { presign, r2FromEnv } from './_r2.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const DAILY_LIMIT = Number(process.env.FILE_DAILY_LIMIT) || 80;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  const r2 = r2FromEnv();
  if (!r2) return send(res, 503, { error: 'R2 is not set up.' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return send(res, 401, { error: 'Sign in first.' });
  let user;
  try {
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
    if (!u.ok) return send(res, 401, { error: 'Sign in first.' });
    user = await u.json();
  } catch (err) { return send(res, 503, { error: 'Could not check the login.' }); }
  if (!user || !user.id) return send(res, 401, { error: 'Sign in first.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  body = body || {};
  const key = String(body.key || '');
  if (!key || key.length > 300 || key.includes('..') || key.startsWith('/')) return send(res, 400, { error: 'Bad key.' });
  const download = body.download === true ? true : String(body.download || '').slice(0, 200);

  // The key must be a published file's own.
  try {
    const q = await fetch(SUPABASE_URL + '/rest/v1/resource_files?select=id&published=eq.true&limit=1&storage_key=eq.' + encodeURIComponent(key),
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
    const rows = q.ok ? await q.json() : [];
    if (!Array.isArray(rows) || !rows.length) return send(res, 404, { error: 'No such file.' });
  } catch (err) { return send(res, 503, { error: 'Could not look the file up.' }); }

  // Is it in R2? (Until the copy is finished, or for a file added since, it is not.)
  try {
    const head = await fetch(presign({ ...r2, key, method: 'HEAD', expires: 60 }), { method: 'HEAD' });
    if (head.status === 404) return send(res, 404, { error: 'Not in R2.' });
    if (!head.ok) return send(res, 503, { error: 'R2 said ' + head.status });
  } catch (err) { return send(res, 503, { error: 'R2 could not be reached.' }); }

  // The day's count for this member (admins are not counted).
  try {
    const adm = await fetch(SUPABASE_URL + '/rest/v1/admin_users?select=user_id&limit=1&user_id=eq.' + encodeURIComponent(user.id),
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
    const isAdmin = adm.ok && (await adm.json()).length > 0;
    if (!isAdmin) {
      const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);   // Seoul
      const counter = '_limits/' + user.id + '/' + day;
      const got = await fetch(presign({ ...r2, key: counter, method: 'GET', expires: 60 }));
      const used = got.ok ? Number((await got.json().catch(() => ({}))).n) || 0 : 0;
      if (used >= DAILY_LIMIT) return send(res, 429, { error: 'Daily limit reached.', limit: DAILY_LIMIT });
      await fetch(presign({ ...r2, key: counter, method: 'PUT', expires: 60 }), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: used + 1 }) });
    }
  } catch (err) { /* a counter that cannot be kept never stops a visitor */ }

  return send(res, 200, { url: presign({ ...r2, key, method: 'GET', expires: 300, download }) });
}
