// DURU KOREAN — tell search engines about new pages (IndexNow)
//
// IndexNow is one message that reaches Bing, Naver, Yandex, Seznam and
// the other engines that share it: "these addresses are new or changed,
// come and read them". Without it they find a new page on their own
// schedule, days later.
//
// Runs every hour (in .github/workflows/publish-missing.yml) and sends
// every address of what was published since the last run — a blog post
// or a download in all eight languages, plus the plain address. It reads
// only what the public can read, so it cannot announce a draft.
//
// The key is the file <key>.txt at the site's root, which IndexNow
// fetches to check that the message came from this site. It is not a
// secret: it only proves the site and the sender are the same.
//
//   node scripts/indexnow.mjs                  what went out in the last 75 minutes
//   node scripts/indexnow.mjs --all            every public page, post and download
//   node scripts/indexnow.mjs --dry-run        print, send nothing

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.durukorean.com';
const HOST = 'www.durukorean.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const LANGS = ['en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh'];
const PAGES = ['/', '/learning-korean.html', '/book-resources.html', '/free-resources.html',
  '/blog.html', '/stories.html', '/about.html', '/faq.html'];

const args = process.argv.slice(2);
const ALL = args.includes('--all') || process.env.INDEXNOW_ALL === 'true';
const DRY = args.includes('--dry-run');
const SINCE_MIN = Number((args.find((a) => a.startsWith('--since-minutes=')) || '').split('=')[1]) || 75;

export function key() {
  const f = fs.readdirSync(ROOT).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (!f) throw new Error('IndexNow 키 파일(<32자리>.txt)이 사이트 루트에 없습니다.');
  const k = fs.readFileSync(path.join(ROOT, f), 'utf8').trim();
  if (k + '.txt' !== f) throw new Error('키 파일 이름과 내용이 다릅니다: ' + f);
  return k;
}

// Every address a page has: one per language, and the plain one.
export function addresses(bare) {
  const plain = SITE + bare;
  return [plain].concat(LANGS.map((l) => SITE + '/' + l + (bare === '/' ? '' : bare)));
}

async function db(query) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + query, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(query.split('?')[0] + ' ' + res.status + ': ' + (await res.text()).slice(0, 160));
  return res.json();
}

export async function collect({ all, sinceMinutes }) {
  const since = new Date(Date.now() - sinceMinutes * 60000).toISOString();
  const posts = await db('posts?select=slug&published=eq.true' +
    (all ? '' : '&published_at=gte.' + since) + '&limit=5000');
  const resources = await db('resources?select=id' +
    (all ? '' : '&first_published_at=gte.' + since) + '&limit=5000');
  const bare = (all ? PAGES : [])
    .concat(posts.map((p) => '/blog/post/' + encodeURIComponent(p.slug)))
    .concat(resources.map((r) => '/resource/' + encodeURIComponent(r.id)));
  // A new post or download changes the lists it appears on, too.
  if (!all && (posts.length || resources.length)) {
    if (posts.length) bare.push('/blog.html');
    if (resources.length) bare.push('/free-resources.html');
    bare.push('/');
  }
  return { urls: [...new Set(bare.flatMap(addresses))], posts: posts.length, resources: resources.length };
}

export async function submit(urls, k) {
  let sent = 0;
  for (let i = 0; i < urls.length; i += 10000) {
    const chunk = urls.slice(i, i + 10000);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: k, keyLocation: SITE + '/' + k + '.txt', urlList: chunk }),
      signal: AbortSignal.timeout(30000)
    });
    // 200 OK and 202 Accepted are both success; 202 means the key is
    // still being checked.
    if (res.status !== 200 && res.status !== 202) {
      throw new Error('IndexNow ' + res.status + ': ' + (await res.text()).slice(0, 200));
    }
    sent += chunk.length;
  }
  return sent;
}

export async function run() {
  const k = key();
  const { urls, posts, resources } = await collect({ all: ALL, sinceMinutes: SINCE_MIN });
  console.log('IndexNow — ' + (ALL ? '전체' : '최근 ' + SINCE_MIN + '분') + ': 글 ' + posts + '편, 자료 ' + resources + '개, 주소 ' + urls.length + '개');
  if (!urls.length) { console.log('새로 알릴 주소가 없습니다.'); return 0; }
  if (DRY) { urls.slice(0, 12).forEach((u) => console.log('  ' + u)); return 0; }
  const sent = await submit(urls, k);
  console.log('보냄: ' + sent + '개 (빙·네이버·얀덱스 등에 전달됩니다)');
  return sent;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}
