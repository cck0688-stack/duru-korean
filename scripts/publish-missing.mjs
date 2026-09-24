// DURU KOREAN — finish publishing the languages that were left behind
//
// A worksheet is written in eight languages and approved as one. The
// approval copies each language's PDF from the private drafts bucket to
// the public one and asks the database to publish it, one at a time;
// until the change beside this script, one failed copy stopped every
// language after it. Sheets went out in English and Korean and stayed
// that way.
//
// This finds every download that an admin has already published and
// that still has languages waiting in the drafts bucket, and publishes
// those the same way — through publish_resource_file, so the database
// still refuses anything whose PDF check failed or whose sources are not
// cleared. It publishes nothing that was not approved: a download still
// in the review queue is left alone.
//
// It also lists the downloads that do not exist in all eight languages
// at all, so a person can see which ones need a new edition.
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD   the site's admin bot account
//   SUPABASE_URL / SUPABASE_ANON_KEY     the live project
//
//   node scripts/publish-missing.mjs [--dry-run]

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const DRY = process.argv.includes('--dry-run');
const LANGS = ['en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh'];

const log = (...a) => console.log(...a);

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

async function copyToPublic(token, draftKey, target) {
  const from = draftKey.replace(/^resource-drafts\//, '');
  const got = await fetch(SUPABASE_URL + '/storage/v1/object/resource-drafts/' + from, { headers: headers(token) });
  if (!got.ok) throw new Error('초안 내려받기 실패 (' + got.status + ')');
  const bytes = Buffer.from(await got.arrayBuffer());
  const put = await fetch(SUPABASE_URL + '/storage/v1/object/resources/' + target, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }),
    body: bytes
  });
  if (!put.ok) throw new Error('공개 버킷 올리기 실패 (' + put.status + '): ' + (await put.text()).slice(0, 160));
  return bytes.length;
}

async function withRetries(what, fn) {
  let last;
  for (let i = 0; i < 3; i += 1) {
    try { return await fn(); } catch (err) {
      last = err;
      log('    ' + what + ' — ' + err.message + (i < 2 ? ' / 다시' : ''));
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

export async function run() {
  const token = await signIn();
  const rows = await rest(token, 'resources?select=id,title,status,published,publish_location,' +
    'resource_files(id,lang,version,published,draft_key,file_size,check_result)' +
    '&publish_location=eq.free-resources&order=created_at.desc&limit=5000');

  let fixed = 0, failed = 0;
  const short = [];
  for (const r of rows) {
    const files = r.resource_files || [];
    const langs = new Set(files.map((f) => f.lang));
    const missing = LANGS.filter((l) => !langs.has(l));
    if (missing.length && r.status !== 'rejected') short.push(r.title + ' — 없음: ' + missing.join(', '));

    // Only what an admin already approved.
    if (!r.published || r.status !== 'published') continue;
    const publishedLangs = new Set(files.filter((f) => f.published).map((f) => f.lang));
    const newest = {};
    files.forEach((f) => {
      if (!f.draft_key || f.published || publishedLangs.has(f.lang)) return;
      if (!newest[f.lang] || (f.version || 1) > (newest[f.lang].version || 1)) newest[f.lang] = f;
    });
    const waiting = Object.values(newest);
    if (!waiting.length) continue;

    log('· ' + r.title + ' — 공개 안 된 언어: ' + waiting.map((f) => f.lang).join(', '));
    for (const f of waiting) {
      if (DRY) { log('    (연습) ' + f.lang); continue; }
      const target = 'auto/' + r.id + '/' + f.lang + '-v' + (f.version || 1) + '.pdf';
      try {
        const size = await withRetries(f.lang + ' 복사', () => copyToPublic(token, f.draft_key, target));
        const blocked = await withRetries(f.lang + ' 게시', () => rest(token, 'rpc/publish_resource_file', {
          method: 'POST',
          body: JSON.stringify({ p_file_id: f.id, p_storage_key: target, p_file_size: f.file_size || size })
        }));
        if (Array.isArray(blocked) && blocked.length) {
          failed += 1;
          log('    ' + f.lang + ': 데이터베이스가 거부 — ' + blocked.join(', '));
        } else {
          fixed += 1;
          log('    ' + f.lang + ': 공개됨');
        }
      } catch (err) {
        failed += 1;
        log('    ' + f.lang + ': 실패 — ' + err.message);
      }
    }
  }

  log('\n공개로 마저 올린 언어: ' + fixed + '개' + (failed ? ', 실패 ' + failed + '개' : ''));
  if (short.length) {
    log('\n8개 언어가 다 있지 않은 자료 ' + short.length + '개 (새로 만들어야 하는 언어):');
    short.forEach((s) => log('  - ' + s));
  } else {
    log('모든 자료가 8개 언어로 있습니다.');
  }
  return { fixed, failed, short };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}
