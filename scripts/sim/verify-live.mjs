// DURU KOREAN — the daily check, on the LIVE Community's sample threads
//
// The same promises verify.mjs checks on the test project, checked on
// the real site with the sample writers' threads (live.mjs):
//
//   작성 언어 감지     each sample post is stored in the language its
//                     writer writes in, so readers of every other
//                     language are offered a translation of it
//   번역 보기          a reader in each of the eight languages gets the
//                     sample threads in their language, marked as
//                     translated — replies included
//   원문 보기          "Show original" brings back the stored words
//   주제 필터          each topic shows only its own posts, and as many
//                     as the database has
//   커뮤니티           one post per writer, on the writer's topic, 50–400
//                     characters, and questions get answers
//
// It only reads. The browser opens the site itself
// (https://www.durukorean.com, or VERIFY_SITE), as a visitor who is not
// signed in; the bot account is used only to read who the sample
// writers are (sample_personas is admins-only). Real members' threads
// are never opened.
//
// Writes sim-report.md, sim-report.json and sim-shots/; exits 1 if a
// promise was broken.
//
//   SUPABASE_URL, SUPABASE_ANON_KEY, DURU_BOT_EMAIL, DURU_BOT_PASSWORD
//
//   node scripts/sim/verify-live.mjs [--langs=en,ko] [--threads=3] [--days=10]

import fs from 'node:fs';
import { DETECT, LANGS, LANG_NAMES, log, ROOT } from './lib.mjs';
import { liveEnv, signInBot, client } from './live.mjs';
import { checkPages, markdown } from './verify.mjs';

const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const READ_LANGS = (arg('langs') || LANGS.join(',')).split(',').filter((l) => LANGS.includes(l));
const THREADS = Number(arg('threads')) || 3;
const DAYS = Number(arg('days')) || 10;
const OUT = arg('out') || ROOT;
const SITE = String(process.env.VERIFY_SITE || 'https://www.durukorean.com').replace(/\/+$/, '');

// What the database says, for the sample rows of the last DAYS days.
export function examine(personas, stories, failures) {
  const byNick = new Map(personas.map((p) => [p.nickname, p]));
  const detect = {}; const missed = []; const unreadable = {};
  LANGS.forEach((l) => { detect[l] = { n: 0, right: 0, none: 0, as: {} }; });
  for (const s of stories) {
    const writer = byNick.get(s.display_name);
    if (!writer || !detect[writer.lang]) continue;
    const d = detect[writer.lang];
    d.n += 1;
    const guess = DETECT.detect(s.body);
    if (!guess) d.none += 1;
    else if (guess === writer.lang) d.right += 1;
    else {
      d.as[guess] = (d.as[guess] || 0) + 1;
      if (missed.length < 12) missed.push({ wrote: writer.lang, detected: guess, text: s.body.slice(0, 90) });
    }
    // Stored as another language: a reader of that language is never
    // offered a translation — the page takes it to be theirs already.
    if (s.lang && s.lang !== writer.lang) unreadable[s.lang] = (unreadable[s.lang] || 0) + 1;
  }
  Object.entries(unreadable).forEach(([L, n]) =>
    failures.push(LANG_NAMES[L] + ' 독자에게 번역이 제공되지 않는 글/답글 ' + n + '건 — 다른 언어인데 ' +
                  LANG_NAMES[L] + '로 저장됐습니다 (작성 언어 감지 오류)'));

  const roots = stories.filter((s) => !s.parent_id);
  const rootsBy = {};
  roots.forEach((r) => { (rootsBy[r.display_name] = rootsBy[r.display_name] || []).push(r); });
  const twice = Object.entries(rootsBy).filter(([, list]) => list.length > 1);
  if (twice.length) failures.push('원문 글을 두 건 이상 쓴 예시 작성자 ' + twice.length + '명: ' + twice.slice(0, 5).map(([n]) => n).join(', '));
  const offTopic = roots.filter((r) => { const p = byNick.get(r.display_name); return p && p.topic !== r.category; });
  if (offTopic.length) failures.push('정해진 주제가 아닌 곳에 쓴 글 ' + offTopic.length + '건');
  const badLength = roots.filter((r) => { const n = [...r.body].length; return n < 50 || n > 400; });
  if (badLength.length) failures.push('50~400자를 벗어난 글 ' + badLength.length + '건');
  const cutoff = Date.now() - 3 * 3600000;
  const asks = roots.filter((r) => r.category === 'ask' && new Date(r.created_at).getTime() < cutoff);
  const answered = asks.filter((r) => stories.some((s) => s.parent_id === r.id && s.display_name !== r.display_name));
  const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const recent = personas.filter((p) => p.joined_on >= since);
  return {
    unreadable, detection: detect, missed, original: null,
    community: {
      members: recent.length, posted: recent.filter((p) => p.posted_at).length,
      posts: roots.length, replies: stories.length - roots.length,
      askAnswered: asks.length ? Math.round(100 * answered.length / asks.length) + '%' : '—'
    }
  };
}

export async function verifyLive() {
  const env = liveEnv();
  const bot = await signInBot(env);
  const asBot = client(env, bot.token);
  const anon = client(env);
  const failures = [];
  const report = { site: SITE, when: new Date().toISOString(), db: {}, readers: {}, filters: {}, failures };

  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const personas = await asBot('sample_personas?select=nickname,lang,topic,joined_on,posted_at&limit=10000');
  const stories = await anon('stories?select=id,display_name,body,lang,category,parent_id,created_at' +
    '&is_sample=is.true&created_at=gte.' + since + '&order=created_at.desc&limit=5000');
  report.db = examine(personas, stories, failures);
  report.db.days = DAYS;
  if (!stories.length) failures.push('최근 ' + DAYS + '일 동안 예시 글이 없습니다 (live 작업이 멈췄는지 확인하세요)');

  const only = new Set(stories.filter((s) => !s.parent_id).map((s) => s.id));
  await checkPages({ base: SITE, anon, langs: READ_LANGS, threads: THREADS, out: OUT, report, only });

  fs.writeFileSync(OUT + '/sim-report.json', JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT + '/sim-report.md', markdown(report));
  log(markdown(report));
  return report;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  verifyLive().then((r) => process.exit(r.failures.length ? 1 : 0))
    .catch((err) => { console.error(err.message || err); process.exit(1); });
}
