#!/usr/bin/env node
// DURU KOREAN — does a presigned R2 link (api/_r2.js) really work? Takes a few published keys, asks R2 for them.
import { presign, r2FromEnv } from '../api/_r2.js';
const r2 = r2FromEnv();
if (!r2) throw new Error('R2_* 변수가 없습니다');
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const rows = await (await fetch(SUPABASE_URL + '/rest/v1/resource_files?select=storage_key,file_size&published=eq.true&limit=3&order=id.asc', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json();
let bad = 0;
for (const f of rows) {
  const head = await fetch(presign({ ...r2, key: f.storage_key, method: 'HEAD', expires: 60 }), { method: 'HEAD' });
  const get = await fetch(presign({ ...r2, key: f.storage_key, method: 'GET', download: 'bank(en).pdf' }));
  const buf = Buffer.from(await get.arrayBuffer());
  const ok = head.status === 200 && get.status === 200 && buf.slice(0, 5).toString() === '%PDF-' && buf.length === f.file_size;
  console.log((ok ? '✔ ' : '✗ ') + f.storage_key + ' · HEAD ' + head.status + ' · GET ' + get.status + ' · ' + buf.length + ' bytes (기록 ' + f.file_size + ') · ' +
    'type=' + get.headers.get('content-type') + ' · disposition=' + get.headers.get('content-disposition'));
  if (!ok) bad += 1;
}
const miss = await fetch(presign({ ...r2, key: 'auto/does-not-exist/xx.pdf', method: 'HEAD', expires: 60 }), { method: 'HEAD' });
console.log((miss.status === 404 ? '✔ ' : '✗ ') + '없는 파일은 HEAD ' + miss.status + ' (404 이어야 합니다)');
if (miss.status !== 404) bad += 1;
// The daily-limit counter (api/file-link.js) is a small object written and read through signed links.
const ck = '_limits/_test/' + Date.now();
const put = await fetch(presign({ ...r2, key: ck, method: 'PUT', expires: 60 }), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: 7 }) });
const got = await fetch(presign({ ...r2, key: ck, method: 'GET', expires: 60 }));
const n = got.ok ? (await got.json()).n : null;
const del = await fetch(presign({ ...r2, key: ck, method: 'DELETE', expires: 60 }), { method: 'DELETE' });
const okCounter = put.ok && n === 7;
console.log((okCounter ? '✔ ' : '✗ ') + '일일 횟수 기록: PUT ' + put.status + ' · GET ' + got.status + ' → n=' + n + ' · 지움 ' + del.status);
if (!okCounter) bad += 1;
process.exit(bad ? 1 : 0);
