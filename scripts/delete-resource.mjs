// DURU KOREAN — delete one download by its exact title
//
// The same thing as "Delete this download" on the download's page, for
// when an admin asks for it without opening the site: the row goes (its
// files, versions, sources and reviews go with it, on delete cascade),
// then the PDFs and the cover it pointed at.
//
// It deletes only when exactly one download has that title; two or none
// and it stops and says so. Signed in as the admin bot, so the same
// row-level security as an admin applies.
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD   the site's admin bot account
//   SUPABASE_URL / SUPABASE_ANON_KEY     the live project
//
//   node scripts/delete-resource.mjs "<exact title>" [--dry-run]

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

async function signIn() {
  const email = process.env.DURU_BOT_EMAIL;
  const password = process.env.DURU_BOT_PASSWORD;
  if (!email || !password) throw new Error('DURU_BOT_EMAIL 과 DURU_BOT_PASSWORD 가 필요합니다.');
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ').');
  return body.access_token;
}

function headers(token, extra) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, ...(extra || {}) };
}

async function rest(token, path, init = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init, headers: headers(token, { 'Content-Type': 'application/json', ...(init.headers || {}) })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(path.split('?')[0] + ' ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

async function removeObjects(token, bucket, keys) {
  if (!keys.length) return;
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket, {
    method: 'DELETE',
    headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: keys })
  });
  // The row is already gone; a file left behind is only clutter.
  console.log('  ' + bucket + ' 파일 ' + keys.length + '개 삭제: ' + (res.ok ? '완료' : '실패 ' + res.status));
}

export async function run(title, { dry = false } = {}) {
  title = String(title || '').trim();
  if (!title) throw new Error('지울 자료의 제목을 정확히 적어 주세요.');
  const token = await signIn();
  const rows = await rest(token, 'resources?select=id,title,status,cover_key,' +
    'resource_files(lang,storage_key,draft_key)&title=eq.' + encodeURIComponent(title));
  if (rows.length !== 1) {
    throw new Error('제목이 "' + title + '"인 자료가 ' + rows.length + '개입니다. 정확히 1개일 때만 지웁니다.');
  }
  const r = rows[0];
  const files = r.resource_files || [];
  const published = files.map((f) => f.storage_key).filter(Boolean);
  const drafts = files.map((f) => f.draft_key).filter(Boolean).map((k) => k.replace(/^resource-drafts\//, ''));
  console.log('찾음: ' + r.title + ' (' + r.id + ', ' + r.status + ') — 파일 ' + files.length + '개');
  if (dry) { console.log('--dry-run: 지우지 않았습니다.'); return r.id; }

  const gone = await rest(token, 'resources?id=eq.' + r.id, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!gone || !gone.length) throw new Error('삭제되지 않았습니다 (관리자 권한을 확인하세요).');
  console.log('삭제했습니다: ' + r.title);
  await removeObjects(token, 'resources', published);
  await removeObjects(token, 'resource-drafts', drafts);
  await removeObjects(token, 'resource-covers', r.cover_key ? [r.cover_key] : []);
  return r.id;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const args = process.argv.slice(2);
  run(args.find((a) => !a.startsWith('--')), { dry: args.includes('--dry-run') })
    .catch((err) => { console.error(err.message || err); process.exit(1); });
}
