#!/usr/bin/env node
// DURU KOREAN — French and German for the posts already written
//
// The site learned two more languages on 2026-09-26. Every post written
// before that has its sentence-by-sentence translation (posts.mt) in
// the other languages but not in these, and a Korean post's "words to
// know" list explains each word in those languages only. This fills in
// just what is missing: the posts are not translated again into the
// languages they already have, and the word list keeps the same five
// words — each word's English meaning and explanation are translated
// into the new languages, so a reader switching language sees the same
// words explained, not a different list.
//
// Nothing is published or unpublished. A translation an admin wrote by
// hand (posts.i18n) always wins and is never overwritten. Run it again
// and it only does what is still missing.
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD, SUPABASE_URL / SUPABASE_ANON_KEY,
//   and the model account the daily drafts use.
//
//   node scripts/add-languages.mjs [--langs=fr,de] [--dry-run] [--limit=N]
//   node scripts/add-languages.mjs --report   (which languages each post can be read in)

import { resolveProvider, translate, LANGUAGES } from '../api/_providers.js';
import { withPatience } from './lib/patiently.mjs';
import { useSubscription, subscriptionAccount } from './lib/claude-code.mjs';
import { MT, translateInto } from './lib/mt.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DRY = args.includes('--dry-run');
const REPORT = args.includes('--report');
const LIMIT = Number(arg('limit')) || 0;
const NEW = (arg('langs') || 'fr,de').split(',').map((x) => x.trim()).filter((c) => LANGUAGES[c]);
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

async function rest(token, p, init = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + p, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(p.split('?')[0] + ' ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

// The languages this post still lacks: not its own, not one an admin
// translated by hand, not one whose stored translation still fits.
function missingFor(post) {
  const human = post.i18n || {};
  const mt = post.mt || {};
  const hash = MT.fingerprint(post.body || '');
  return NEW.filter((c) => c !== (post.lang || 'en') &&
    !(human[c] && String(human[c].body || '').trim()) &&
    !(mt[c] && mt[c].hash === hash && Array.isArray(mt[c].sentences)));
}

// The same five words, explained in the new languages too. The English
// explanation is the source (every list has it unless the post is
// English, in which case the Korean word itself is explained from the
// language the list was built for first).
async function widenStudy(cfg, post) {
  const st = post.study;
  if (!st || !Array.isArray(st.words) || !st.words.length) return null;
  if (st.from !== (post.lang || 'en') || st.hash !== MT.fingerprint(post.body || '')) return null;
  const want = NEW.filter((c) => c !== st.from && st.words.some((w) => !(w.by && w.by[c] && w.by[c].meaning)));
  if (!want.length) return null;
  const src = ['en', 'ko', 'es', 'vi'].find((c) => c !== st.from && st.words.every((w) => w.by && w.by[c] && w.by[c].meaning));
  if (!src) return null;
  const lines = [];
  st.words.forEach((w) => { lines.push(w.by[src].meaning, w.by[src].explanation || ' '); });
  const { translations } = await translate({ from: src, fromName: LANGUAGES[src], targets: want, sentences: lines }, cfg);
  const words = st.words.map((w, i) => {
    const by = { ...(w.by || {}) };
    want.forEach((c) => {
      const got = translations[c] || [];
      if (got.length !== lines.length) return;
      by[c] = { meaning: String(got[i * 2] || '').trim(), explanation: String(got[i * 2 + 1] || '').trim() };
    });
    return { ...w, by };
  });
  return { ...st, words };
}

// What a reader actually gets in each language, post by post, by the
// reader's own rules (js/auto-translate.js): the post's language, a
// human translation with a body, or a machine one that still pairs
// sentence for sentence with the body. Changes nothing.
function readable(post, c) {
  if (c === (post.lang || 'en')) return 'own';
  const human = (post.i18n || {})[c];
  if (human && String(human.body || '').trim()) return 'human';
  const mt = (post.mt || {})[c];
  if (!mt || !Array.isArray(mt.sentences)) return 'none';
  if (mt.from && mt.from !== (post.lang || 'en')) return 'wrong-source';
  if (mt.hash !== MT.fingerprint(post.body || '')) return 'stale';
  if (mt.sentences.length !== MT.sentences(post.body || '').length) return 'short';
  return 'mt';
}

function report(posts) {
  const all = Object.keys(LANGUAGES);
  const gaps = {};
  posts.forEach((post) => {
    const bad = all.map((c) => [c, readable(post, c)]).filter(([, s]) => !['own', 'human', 'mt'].includes(s));
    const st = post.study && Array.isArray(post.study.words) ? post.study : null;
    const noWords = st ? NEW.filter((c) => c !== st.from && st.words.some((w) => !(w.by && w.by[c] && w.by[c].meaning))) : [];
    const state = post.published ? '' : '[초안] ';
    log('· ' + state + post.title + ' (' + (post.lang || 'en') + ')' +
      (bad.length ? ' — 못 읽음: ' + bad.map(([c, s]) => c + ':' + s).join(', ') : ' — 10개 언어 모두') +
      (noWords.length ? ' · 단어 목록 없음: ' + noWords.join(',') : ''));
    bad.forEach(([c]) => { gaps[c] = (gaps[c] || 0) + 1; });
  });
  log('');
  log('언어별 못 읽는 글: ' + (Object.keys(gaps).length ? all.filter((c) => gaps[c]).map((c) => c + ' ' + gaps[c]).join(', ') : '없음'));
}

async function main() {
  const cfg = withPatience(useSubscription(process.env, 'BLOG_PROVIDER')
    ? Object.assign(subscriptionAccount(process.env.BLOG_MODEL || 'sonnet'), { timeoutMs: 300000 })
    : resolveProvider(process.env), log);
  log('새 언어: ' + NEW.join(', ') + ' · ' + cfg.label + ' / ' + cfg.model + (DRY ? ' · 연습 (저장하지 않음)' : ''));

  let token = await signIn();
  let posts = await rest(token, 'posts?select=id,title,excerpt,tags,body,lang,i18n,mt,study,published&order=created_at.desc&limit=2000');
  posts = posts.filter((p) => String(p.body || '').trim());
  if (LIMIT) posts = posts.slice(0, LIMIT);
  log('글 ' + posts.length + '편');
  if (REPORT) { report(posts); return; }

  let done = 0, failed = 0, skipped = 0;
  for (const [i, post] of posts.entries()) {
    if (i % 10 === 0) token = await signIn();
    const langs = missingFor(post);
    const patch = {};
    const note = [];
    try {
      if (langs.length) {
        const fresh = await translateInto(cfg, post, langs);
        const got = Object.keys(fresh);
        if (got.length) {
          patch.mt = { ...(post.mt || {}), ...fresh };
          note.push('번역 ' + got.join(','));
        }
        if (got.length < langs.length) note.push('빠짐 ' + langs.filter((c) => !got.includes(c)).join(','));
      }
      const study = await widenStudy(cfg, post);
      if (study) { patch.study = study; note.push('단어 목록'); }
      if (!Object.keys(patch).length) {
        // Nothing came back for a language it lacks: a failure, not
        // "already there".
        if (langs.length) { failed += 1; log('✗ ' + post.title + ' — ' + note.join(' · ')); continue; }
        skipped += 1; continue;
      }
      if (!DRY) {
        await rest(token, 'posts?id=eq.' + post.id, { method: 'PATCH', body: JSON.stringify(patch) });
      }
      done += 1;
      log('· ' + (post.published ? '' : '[초안] ') + post.title + ' — ' + note.join(' · '));
    } catch (err) {
      failed += 1;
      log('✗ ' + post.title + ' — ' + err.message);
    }
  }
  log('');
  log('채움 ' + done + '편 · 이미 있음 ' + skipped + '편 · 실패 ' + failed + '편');
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
