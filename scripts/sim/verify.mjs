// DURU KOREAN — Community simulation: did the site do its job?
//
// Checks, against the TEST project, each thing the multilingual
// community promises:
//
//   작성 언어 감지     the language stored for each post is the one the
//                     site's detector chose, and how often that choice
//                     matched the language the writer actually used
//   원문 저장          every post and reply is stored exactly as written
//                     (fingerprint of the stored body = what was sent),
//                     and no translation ever replaced it
//   번역 보기          a reader in each of the eight languages gets the
//                     posts in their language, marked as translated
//   원문 보기          "Show original" brings back the author's exact words
//   주제 필터          each of the three topics shows only its own posts,
//                     and as many as the database has
//   댓글 번역          the replies under a post are translated with it
//
// The browser part runs the real pages and the real translation
// endpoint (scripts/sim/serve.mjs). Writes sim-report.md and
// sim-report.json; exits 1 if a promise was broken. How often the
// detector guessed right is reported, not failed on — it is a guess by
// design, and the number is the point.
//
//   node scripts/sim/verify.mjs [--langs=en,ko] [--threads=3]

import fs from 'node:fs';
import { simEnv, assertSimDatabase, rest, DETECT, LANGS, LANG_NAMES, TOPICS, log, ROOT } from './lib.mjs';
import { startSite } from './serve.mjs';

const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const READ_LANGS = (arg('langs') || LANGS.join(',')).split(',').filter((l) => LANGS.includes(l));
const THREADS = Number(arg('threads')) || 3;
const OUT = arg('out') || ROOT;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Is this text in language L? The site's detector answers "Korean" for
// anything with one Hangul letter in it, and a translation for learners
// of Korean quotes Korean all the time ("the difference between 은 and
// 는"). So for any language but Korean the Hangul is set aside before
// asking, and for Korean it must actually be there.
function inLanguage(text, L) {
  if (L === 'ko') return /[가-힣]/.test(text) ? 'ko' : DETECT.detect(text);
  return DETECT.detect(String(text).replace(/[가-힣ᄀ-ᇿ㄰-㆏]+/g, ' '));
}

export async function verify() {
  const env = simEnv();
  await assertSimDatabase(env);
  const anon = rest(env);
  const failures = [];
  const report = { when: new Date().toISOString(), db: {}, readers: {}, filters: {}, failures };

  /* ---------- in the database ---------- */
  const logs = await anon('sim_log?select=*&order=created_at.desc&limit=3000');
  const ids = logs.map((l) => l.story_id);
  const stories = [];
  for (let i = 0; i < ids.length; i += 150) {
    stories.push(...await anon('stories?select=id,user_id,body,lang,category,parent_id,created_at' +
      '&id=in.(' + ids.slice(i, i + 150).join(',') + ')'));
  }
  const byId = new Map(stories.map((s) => [s.id, s]));
  const personas = await anon('sim_personas?select=user_id,nickname,lang,topic,joined_on,posted_at&limit=5000');

  let kept = 0; const altered = [];
  const detect = {}; const missed = [];
  LANGS.forEach((l) => { detect[l] = { n: 0, right: 0, none: 0, as: {} }; });
  for (const l of logs) {
    const s = byId.get(l.story_id);
    if (!s) continue;
    if (DETECT.hashText(s.body) === l.body_hash) kept += 1; else altered.push(s.id);
    const d = detect[l.intended_lang]; if (!d) continue;
    d.n += 1;
    if (s.lang !== (l.detected_lang || l.intended_lang)) failures.push('저장된 언어가 감지 결과와 다릅니다: ' + s.id);
    if (!l.detected_lang) d.none += 1;
    else if (l.detected_lang === l.intended_lang) d.right += 1;
    else {
      d.as[l.detected_lang] = (d.as[l.detected_lang] || 0) + 1;
      if (missed.length < 12) missed.push({ wrote: l.intended_lang, detected: l.detected_lang, text: s.body.slice(0, 90) });
    }
  }
  if (altered.length) failures.push('원문이 바뀐 글 ' + altered.length + '건: ' + altered.slice(0, 5).join(', '));

  // A post stored as language X is never offered in translation to a
  // reader of X — the page takes it to be in their language already. So
  // a Vietnamese post stored as Korean is unreadable to a Korean reader.
  const unreadable = {};
  for (const l of logs) {
    const s = byId.get(l.story_id);
    if (s && s.lang && s.lang !== l.intended_lang) unreadable[s.lang] = (unreadable[s.lang] || 0) + 1;
  }
  report.db.unreadable = unreadable;
  Object.entries(unreadable).forEach(([L, n]) =>
    failures.push(LANG_NAMES[L] + ' 독자에게 번역이 제공되지 않는 글/답글 ' + n + '건 — 다른 언어인데 ' +
                  LANG_NAMES[L] + '로 저장됐습니다 (작성 언어 감지 오류)'));
  report.db.original = { checked: logs.length, kept, altered: altered.length };
  report.db.detection = detect;
  report.db.missed = missed;

  const rootsBy = {};
  const roots = stories.filter((s) => !s.parent_id);
  roots.forEach((r) => { (rootsBy[r.user_id] = rootsBy[r.user_id] || []).push(r); });
  const twice = Object.entries(rootsBy).filter(([, list]) => list.length > 1);
  if (twice.length) failures.push('원문 글을 두 건 이상 쓴 회원 ' + twice.length + '명');
  const offTopic = roots.filter((r) => { const p = personas.find((x) => x.user_id === r.user_id); return p && p.topic !== r.category; });
  if (offTopic.length) failures.push('정해진 주제가 아닌 곳에 쓴 글 ' + offTopic.length + '건');
  const badLength = roots.filter((r) => { const n = [...r.body].length; return n < 50 || n > 400; });
  if (badLength.length) failures.push('50~400자를 벗어난 글 ' + badLength.length + '건');
  const hourAgo = Date.now() - 3 * 3600000;
  const asks = roots.filter((r) => r.category === 'ask' && new Date(r.created_at).getTime() < hourAgo);
  const answered = asks.filter((r) => stories.some((s) => s.parent_id === r.id && s.user_id !== r.user_id));
  report.db.community = {
    members: personas.length, posted: personas.filter((p) => p.posted_at).length,
    posts: roots.length, replies: stories.length - roots.length,
    askAnswered: asks.length ? Math.round(100 * answered.length / asks.length) + '%' : '—'
  };

  /* ---------- in the browser ---------- */
  const site = await startSite();
  try {
    await checkPages({ base: site.base, anon, langs: READ_LANGS, threads: THREADS, out: OUT, report });
  } finally {
    site.server.close();
  }

  fs.writeFileSync(OUT + '/sim-report.json', JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT + '/sim-report.md', markdown(report));
  log(markdown(report));
  return report;
}

// The pages themselves, in a real browser: the topic filters, and for a
// reader in each language, the translations, the replies' translations
// and "Show original". `base` is the site to open; `anon` reads the same
// database the pages read; `only`, when given, limits the threads looked
// at to those root ids.
export async function checkPages({ base, anon, langs, threads, out, report, only = null }) {
  const { chromium } = await import('playwright');
  const failures = report.failures;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    // The three topics, once: the filter does not depend on the language.
    {
      const page = await openCommunity(browser, base, 'en');
      for (const topic of TOPICS) {
        const expected = (await anon('stories?select=id&parent_id=is.null&category=eq.' + topic + '&limit=10000')).length;
        // A click before the page has wired its cards up follows the link
        // instead; wait for the card to say it is chosen, then for the
        // list to settle.
        const card = '.cat-card[data-filter="' + topic + '"]';
        await page.click(card);
        await page.waitForSelector(card + '[aria-pressed="true"]', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const cats = await page.$$eval('#storyList > .story-card .story-cat', (e) => e.map((x) => x.className));
        const stray = cats.filter((c) => !c.includes('story-cat--' + topic)).length;
        const pressed = await page.$eval('.cat-card[data-filter="' + topic + '"]', (e) => e.getAttribute('aria-pressed'));
        const countText = await page.$eval('#storyCount', (e) => e.textContent).catch(() => '');
        const shownCount = Number((/\d+/.exec(countText) || [])[0] || (cats.length ? NaN : 0));
        report.filters[topic] = { expected, cards: cats.length, stray, count: countText.trim(), pressed };
        if (stray) failures.push('주제 필터 ' + topic + ': 다른 주제 글 ' + stray + '건이 섞여 있습니다');
        if (pressed !== 'true') failures.push('주제 필터 ' + topic + ': 선택 표시가 없습니다');
        if (expected && shownCount !== expected) failures.push('주제 필터 ' + topic + ': 화면 ' + countText.trim() + ' / DB ' + expected + '건');
        await page.click(card);                                              // step back out
        await page.waitForSelector(card + '[aria-pressed="false"]', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      await page.context().close();
    }

    for (const L of langs) {
      const page = await openCommunity(browser, base, L);
      const r = { threads: 0, translated: 0, replies: 0, repliesTranslated: 0, wrongLang: 0, original: 0, originalOk: 0, notes: [] };
      // The list is redrawn every time a translation lands, so a card is
      // found again by its post id each time rather than held on to.
      const rootIds = await page.$$eval('#storyList > .story-card', (e) => e.map((c) => c.dataset.story));
      for (const rootId of rootIds) {
        if (r.threads >= threads) break;
        if (only && !only.has(rootId)) continue;                           // not one of the threads being checked
        const card = '#storyList > .story-card[data-story="' + rootId + '"]';
        // Whether the thread has anything in another language is read from
        // the language each entry was written in (its chip), not from the
        // text showing: a translation made earlier and kept is already on
        // screen by the time the page is looked at.
        const rows = await page.$$eval(card + ' .story-lang, ' + card + ' .story-body',
          (e) => e.map((b) => b.getAttribute('lang')));
        if (!rows.some((code) => code && code !== L)) continue;              // nothing to translate here
        r.threads += 1;
        await page.locator(card).scrollIntoViewIfNeeded();
        let done = await waitTranslated(page, card, L, 30000);
        if (!done) {                                                         // the reader's own button, then
          for (const b of await page.locator(card + ' .story-mt-go').all()) await b.click().catch(() => {});
          done = await waitTranslated(page, card, L, 45000);
        }
        const state = await page.$$eval(card + ' .story-body', (e) => e.map((b) => ({
          lang: b.getAttribute('lang'), text: b.innerText,
          reply: !!b.closest('.story-reply'),
          on: !!(b.nextElementSibling && b.nextElementSibling.classList.contains('is-on'))
        })));
        for (const st of state) {
          if (st.reply && (st.on || st.lang !== L)) r.replies += 1;     // a reply that needed translating
          if (st.lang !== L) { r.notes.push('번역되지 않음: ' + norm(st.text).slice(0, 50)); continue; }
          if (!st.on) continue;                         // written in L to begin with
          if (st.reply) r.repliesTranslated += 1; else r.translated += 1;
          const got = inLanguage(st.text, L);
          if (got && got !== L) { r.wrongLang += 1; r.notes.push(L + ' 가 아닌 번역(' + got + '): ' + norm(st.text).slice(0, 140)); }
        }
        // "Show original" on the post itself.
        const orig = page.locator(card + ' .story-mt-orig[data-id="' + rootId + '"]');
        if (await orig.count()) {
          r.original += 1;
          await orig.click();
          await page.waitForTimeout(600);
          const shown = await page.$eval(card + ' > .story-body', (b) => ({ text: b.innerText, lang: b.getAttribute('lang') }));
          const row = (await anon('stories?select=body,lang&id=eq.' + rootId))[0];
          const back = await page.locator(card + ' .story-mt-go[data-id="' + rootId + '"]').count();
          if (row && norm(shown.text) === norm(row.body) && shown.lang === row.lang && back) r.originalOk += 1;
          else r.notes.push('원문 보기가 원문과 다릅니다: ' + rootId);
        }
      }
      if (r.notes.some((n) => /번역되지 않음/.test(n))) failures.push(LANG_NAMES[L] + ' 독자: 번역되지 않은 글/답글이 있습니다');
      if (r.wrongLang) failures.push(LANG_NAMES[L] + ' 독자: 다른 언어로 번역된 것이 ' + r.wrongLang + '건');
      if (r.original !== r.originalOk) failures.push(LANG_NAMES[L] + ' 독자: 원문 보기 ' + (r.original - r.originalOk) + '건 실패');
      report.readers[L] = r;
      // What a reader in L sees, for the person who cannot open the test
      // project in a browser: kept with the report.
      fs.mkdirSync(out + '/sim-shots', { recursive: true });
      await page.evaluate(() => window.scrollTo(0, document.getElementById('storyList').offsetTop - 120));
      await page.waitForTimeout(800);
      await page.screenshot({ path: out + '/sim-shots/community-' + L + '.png', fullPage: false });
      await page.context().close();
    }
  } finally {
    await browser.close();
  }

}

export async function openCommunity(browser, base, L) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  if (process.env.SIM_SUPABASE_JS) {
    await page.route('**/cdn.jsdelivr.net/npm/@supabase/**', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.SIM_SUPABASE_JS, 'utf8') }));
  }
  await page.goto(base + '/stories.html?lang=' + encodeURIComponent(L));
  await page.waitForSelector('#storyList > .story-card', { timeout: 30000 });
  await page.waitForTimeout(1200);
  return page;
}

export async function waitTranslated(page, card, L, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const left = await page.$$eval(card + ' .story-body', (e, want) =>
      e.filter((b) => b.getAttribute('lang') && b.getAttribute('lang') !== want).length, L);
    if (!left) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

export function markdown(r) {
  const d = r.db;
  const lines = ['# Community 다국어 검증' + (r.site ? ' (' + r.site + ')' : '') + ' — ' + r.when.slice(0, 16).replace('T', ' ') + ' UTC', ''];
  lines.push(r.failures.length ? '**결과: 실패 ' + r.failures.length + '건**' : '**결과: 모두 통과**', '');
  r.failures.forEach((f) => lines.push('- ❌ ' + f));
  lines.push('', '## 커뮤니티', '',
    '회원 ' + d.community.members + '명 · 글 쓴 회원 ' + d.community.posted + '명 · 원문 글 ' + d.community.posts +
    '건 · 답글 ' + d.community.replies + '건 · 3시간 넘은 질문 중 답이 달린 비율 ' + d.community.askAnswered, '');
  if (d.original) lines.push('## 원문 저장', '', '확인 ' + d.original.checked + '건 · 그대로 ' + d.original.kept + '건 · 바뀜 ' + d.original.altered + '건', '');
  lines.push('## 작성 언어 감지', '', '| 쓴 언어 | 글 | 맞음 | 감지 못함 (쓴 언어로 저장) | 다른 언어로 감지 |', '|---|---|---|---|---|');
  Object.entries(d.detection).forEach(([l, x]) => {
    if (!x.n) return;
    lines.push('| ' + LANG_NAMES[l] + ' | ' + x.n + ' | ' + x.right + ' (' + Math.round(100 * x.right / x.n) + '%) | ' +
      x.none + ' | ' + (Object.entries(x.as).map(([k, v]) => k + ' ' + v).join(', ') || '—') + ' |');
  });
  if (d.missed.length) {
    lines.push('', '다르게 감지된 예:');
    d.missed.forEach((m) => lines.push('- ' + m.wrote + ' → ' + m.detected + ': ' + m.text.replace(/\s+/g, ' ')));
  }
  lines.push('', '## 주제 필터', '', '| 주제 | DB | 화면 카드 | 다른 주제 섞임 | 선택 표시 |', '|---|---|---|---|---|');
  Object.entries(r.filters).forEach(([t, f]) => lines.push('| ' + t + ' | ' + f.expected + ' | ' + f.cards + ' (' + f.count + ') | ' + f.stray + ' | ' + f.pressed + ' |'));
  lines.push('', '## 번역 보기 · 원문 보기 · 댓글 번역', '',
    '글타래마다 원래 독자 언어가 아닌 글과 답글만 셉니다.', '',
    '| 독자 언어 | 확인한 글타래 | 번역된 글 | 번역된 답글 / 번역이 필요한 답글 | 다른 언어로 번역 | 원문 보기 |', '|---|---|---|---|---|---|');
  Object.entries(r.readers).forEach(([l, x]) => lines.push('| ' + LANG_NAMES[l] + ' | ' + x.threads + ' | ' + x.translated + ' | ' +
    x.repliesTranslated + ' / ' + x.replies + ' | ' + x.wrongLang + ' | ' + x.originalOk + ' / ' + x.original + ' |'));
  // What went wrong, line by line, so the log alone is enough.
  const notes = Object.entries(r.readers).filter(([, x]) => x.notes && x.notes.length);
  if (notes.length) {
    lines.push('', '## 확인할 것', '');
    notes.forEach(([l, x]) => x.notes.slice(0, 8).forEach((n) => lines.push('- ' + LANG_NAMES[l] + ' 독자 — ' + n.replace(/\s+/g, ' '))));
  }
  return lines.join('\n') + '\n';
}

if (import.meta.url === 'file://' + process.argv[1]) {
  verify().then((r) => process.exit(r.failures.length ? 1 : 0))
    .catch((err) => { console.error(err.message || err); process.exit(1); });
}
