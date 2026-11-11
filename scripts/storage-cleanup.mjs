#!/usr/bin/env node
// DURU KOREAN — storage clean-up (owner, 2026-11-11: the project hit the 1 GB free quota at 16 GB).
//
// A published worksheet file is stored twice: the public copy (bucket `resources`, resource_files.storage_key)
// and the draft it was copied from (bucket `resource-drafts`, resource_files.draft_key). This finds the drafts
// of published files whose public copy exists and is the same size, and — only with --delete — removes those
// drafts and clears draft_key on their rows. Nothing else is touched: no public copy, no unpublished file.
//
//   node scripts/storage-cleanup.mjs                 report only (default)
//   node scripts/storage-cleanup.mjs --delete        remove the verified duplicate drafts
//   node scripts/storage-cleanup.mjs --limit=200     look at the first N rows only
//   node scripts/storage-cleanup.mjs --verify        also download both copies and compare the bytes; only identical ones are deleted
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DELETE = process.argv.includes('--delete');
const LIMIT = Number(arg('limit')) || 0;
const VERIFY = process.argv.includes('--verify');
import crypto from 'node:crypto';

const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
let token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const auth = () => ({ apikey: KEY, Authorization: 'Bearer ' + token });
const rest = async (p, init = {}) => {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + p, { ...init, headers: { ...auth(), 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(p.split('?')[0] + ' ' + r.status + ' ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
};
// The size of one stored object, or null when it is not there.
const sizeOf = async (bucket, key) => {
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/info/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/'), { headers: auth() });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const n = j && (j.size ?? (j.metadata && j.metadata.size));
  return Number.isFinite(Number(n)) ? Number(n) : null;
};

// The SHA-256 of one stored object (downloaded), or null.
const hashOf = async (bucket, key) => {
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/'), { headers: auth() });
  if (!r.ok) return null;
  return crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
};

// --check-cleaned: the public copies of the files whose draft was removed are all still there.
if (process.argv.includes('--check-cleaned')) {
  const done = await rest('resource_files?select=id,storage_key&published=eq.true&draft_key=is.null&order=id.asc&limit=' + (LIMIT || 1000));
  let ok = 0, gone = 0;
  for (const f of done) { if (f.storage_key && (await sizeOf('resources', f.storage_key)) != null) ok += 1; else gone += 1; }
  console.log('초안을 지운 공개 파일 ' + done.length + '개 중 공개 사본이 있는 것: ' + ok + ' · 없는 것: ' + gone);
  process.exit(gone ? 1 : 0);
}

// Every published file that still has a draft.
const rows = [];
for (let from = 0; ; from += 1000) {
  const page = await rest('resource_files?select=id,resource_id,lang,storage_key,draft_key,file_size,published&published=eq.true&draft_key=not.is.null&order=id.asc',
    { headers: { Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
  rows.push(...page);
  if (page.length < 1000 || (LIMIT && rows.length >= LIMIT)) break;
}
const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
console.log('초안이 남은 공개 파일: ' + todo.length + '개');

const verdict = { same: [], noPublic: [], contentDiffers: 0, differentSize: 0, publicMissing: 0, draftMissing: 0, noPublicKey: 0 };
let sameBytes = 0, i = 0;
async function worker() {
  while (i < todo.length) {
    const f = todo[i++];
    if (!f.storage_key) { verdict.noPublicKey += 1; continue; }
    const draftKey = f.draft_key.replace(/^resource-drafts\//, '');
    const [d, p] = await Promise.all([sizeOf('resource-drafts', draftKey), sizeOf('resources', f.storage_key)]);
    if (d == null) verdict.draftMissing += 1;
    else if (p == null) { verdict.publicMissing += 1; verdict.noPublic.push(f); }
    else if (d !== p) verdict.differentSize += 1;
    else {
      if (VERIFY) {
        const [hd, hp] = await Promise.all([hashOf('resource-drafts', draftKey), hashOf('resources', f.storage_key)]);
        if (!hd || !hp || hd !== hp) { verdict.contentDiffers += 1; continue; }
      }
      verdict.same.push({ id: f.id, draftKey, size: d }); sameBytes += d;
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

console.log('공개 사본과 크기가 같은 초안(지워도 되는 것): ' + verdict.same.length + '개 · ' + (sameBytes / 1048576).toFixed(0) + ' MB');
console.log('크기가 달라서 건드리지 않음: ' + verdict.differentSize + (VERIFY ? ' · 내용이 달라서 건드리지 않음: ' + verdict.contentDiffers : ''));
console.log('공개 사본이 없어서 건드리지 않음: ' + verdict.publicMissing);
console.log('초안 파일이 이미 없음: ' + verdict.draftMissing + ' · 공개 경로가 없는 행: ' + verdict.noPublicKey);

// Who the files without a public copy belong to, so they can be looked at.
if (verdict.noPublic.length) {
  const ids = [...new Set(verdict.noPublic.map((f) => f.resource_id))];
  const res = await rest('resources?select=id,title,status,created_at&id=in.(' + ids.join(',') + ')');
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  console.log('공개 사본이 없는 파일 ' + verdict.noPublic.length + '개 (자료 ' + ids.length + '개):');
  for (const f of verdict.noPublic) {
    const r = by[f.resource_id] || {};
    console.log('  · ' + (r.title || f.resource_id) + ' [' + (r.status || '?') + ', ' + String(r.created_at || '').slice(0, 10) + '] ' + f.lang + ' → ' + f.storage_key);
  }
}

if (!DELETE) { console.log('--delete 가 없어서 아무것도 지우지 않았습니다.'); process.exit(0); }

let removed = 0, cleared = 0;
for (let k = 0; k < verdict.same.length; k += 100) {
  const chunk = verdict.same.slice(k, k + 100);
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/resource-drafts', {
    method: 'DELETE', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: chunk.map((c) => c.draftKey) })
  });
  if (!res.ok) { console.log('  삭제 실패 ' + res.status + ': ' + (await res.text()).slice(0, 160)); continue; }
  removed += chunk.length;
  // The rows say there is no draft any more, so nothing looks for one.
  await rest('resource_files?id=in.(' + chunk.map((c) => c.id).join(',') + ')',
    { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ draft_key: null }) });
  cleared += chunk.length;
  if ((k / 100) % 10 === 0) console.log('  … ' + removed + '개 삭제');
}
console.log('삭제한 초안: ' + removed + '개 · draft_key 비운 행: ' + cleared + '개');
