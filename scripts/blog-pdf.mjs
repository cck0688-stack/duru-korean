#!/usr/bin/env node
// DURU KOREAN — a blog post as a PDF, in every language it can be read in
//
// The owner's request (2026-09-28): a blog post can be downloaded as a
// PDF the way a free resource is, starting with one post as a trial.
// One A4 file per language, in the worksheets' frame (logo, address,
// page numbers, the rights line): the title, the Korean it was written
// in, the post sentence by sentence — the Korean line with the reader's
// language under it, as on the site — and the Words & Phrases list.
// The Korean edition is the Korean text alone.
//
// Files go to the private `resources` bucket under blog/<post id>/, so
// only a signed-in reader gets them, exactly like the worksheets; the
// post records which languages exist in posts.pdf (schema §44), with a
// fingerprint of the body so an edited post does not offer a stale file.
//
//   node scripts/blog-pdf.mjs                     (every post whose files are missing or out of date)
//   node scripts/blog-pdf.mjs --shard=0/8 [--force] (one eighth of them; --force makes all again)
//   node scripts/blog-pdf.mjs --find="목돈" [--langs=en,ko] [--dry-run] [--out=DIR]
//   node scripts/blog-pdf.mjs --slug=some-post-slug
//   node scripts/blog-pdf.mjs --post-json=post.json --out=DIR   (a preview: no sign-in, nothing uploaded)

import fs from 'node:fs';
import path from 'node:path';
import { MT } from './lib/mt.mjs';
import { embeddedFonts, frameV2, labelsFor, FONT_CSS_V2 } from './pdf/render.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const BUCKET = 'resources';
const ALL = ['en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh', 'fr', 'de'];
const LOCALE = { en: 'en-US', vi: 'vi-VN', es: 'es-ES', id: 'id-ID', 'pt-BR': 'pt-BR', ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN', fr: 'fr-FR', de: 'de-DE' };
const MD_HEAD = /^\s*#{1,4}\s+/;
const MD_HEAD_NUMBERED = /^\s*\d{1,3}[.)]\s*#{1,4}\s+/;

const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const POST_JSON = arg('post-json');
const DRY = args.includes('--dry-run') || !!POST_JSON;
const OUT = arg('out');
const LANGS = (arg('langs') || ALL.join(',')).split(',').map((x) => x.trim()).filter((c) => ALL.includes(c));
const log = (...a) => console.log(...a);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DICT = {};
function t(lang, key, fallback) {
  if (!DICT[lang]) {
    try { DICT[lang] = JSON.parse(fs.readFileSync(new URL('../js/i18n/' + lang + '.json', import.meta.url), 'utf8')); }
    catch (e) { DICT[lang] = {}; }
  }
  return DICT[lang][key] || (DICT.en && DICT.en[key]) || fallback;
}

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
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
  if (!res.ok) throw new Error(p.split('?')[0] + ' ' + res.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

async function upload(token, key, bytes) {
  for (let tries = 1; ; tries += 1) {
    try { return await uploadOnce(token, key, bytes); }
    catch (err) {
      if (tries >= 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * tries));
    }
  }
}

async function uploadOnce(token, key, bytes) {
  const url = SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + key;
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token };
  // The bucket lets an admin add and remove files, not overwrite them:
  // a new edition replaces the old one by removing it first.
  await fetch(url, { method: 'DELETE', headers }).catch(() => {});
  const res = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: bytes });
  if (!res.ok) throw new Error('올리기 실패 ' + key + ' (' + res.status + '): ' + (await res.text()).slice(0, 200));
}

// ── what the reader in `lang` gets, by the site's own rules ───────────

function titleIn(post, lang) {
  const human = post.i18n && post.i18n[lang] && post.i18n[lang].title;
  if (human && String(human).trim()) return human;
  if (lang === (post.lang || 'ko')) return post.title;
  return MT.head(post, lang, 'title') || post.title;
}

function formatDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  try { return new Intl.DateTimeFormat(LOCALE[lang] || 'en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d); }
  catch (e) { return m[0]; }
}

function bodyHTML(post, lang) {
  const src = post.lang || 'ko';
  const human = post.i18n && post.i18n[lang] && post.i18n[lang].body;
  const pairs = lang !== src && !(human && String(human).trim()) ? MT.paired(post, lang) : null;
  if (pairs) {
    return pairs.map((para) => '<div class="para">' + para.map((pair) => {
      const head = MD_HEAD.test(pair.src);
      const s = head ? String(pair.src).replace(MD_HEAD, '') : pair.src;
      const o = head ? String(pair.out || '').replace(MD_HEAD_NUMBERED, '').replace(MD_HEAD, '') : pair.out;
      return '<div class="pair' + (head ? ' pair--head' : '') + '"><p class="src" lang="' + esc(src) + '">' + esc(s) + '</p>' +
        '<p class="out" lang="' + esc(lang) + '">' + esc(o) + '</p></div>';
    }).join('') + '</div>').join('');
  }
  // Written in this language (or translated by hand): the text alone.
  const text = lang === src ? post.body : human;
  if (!text) return null;
  return String(text).split(/\n{2,}/).map((block) => {
    const b = block.trim();
    if (!b) return '';
    if (MD_HEAD.test(b)) return '<h3 class="head">' + esc(b.replace(MD_HEAD, '')) + '</h3>';
    return '<p class="plain">' + esc(b).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function studyHTML(post, lang) {
  if ((post.lang || 'ko') !== 'ko' || lang === 'ko') return '';
  const words = MT.studyFor(post, lang);
  if (!words) return '';
  const item = (w) => {
      const e = w.by[lang];
      return '<li><div class="w-head"><span class="w-term" lang="ko">' + esc(w.word) + '</span>' +
        (w.romanization ? '<span class="w-rom">' + esc(w.romanization) + '</span>' : '') +
        (w.pos ? '<span class="w-pos">' + esc(w.pos) + '</span>' : '') + '</div>' +
        '<p class="w-mean">' + esc(e.meaning) + '</p>' +
        (e.explanation ? '<p class="w-note">' + esc(e.explanation) + '</p>' : '') +
        (w.sentence ? '<p class="w-src" lang="ko">' + esc(w.sentence) + '</p>' : '') + '</li>';
  };
  // The heading never ends a page on its own: it and the first word
  // share one unbreakable block.
  return '<section class="study"><div class="study-start"><h2 class="study-title"><span class="dia"></span><span class="study-ring"><span class="study-label">' +
    esc(t(lang, 'study.heading', 'Words & Phrases')) + '</span></span><span class="dia"></span></h2>' +
    '<ol class="study-list">' + item(words[0]) + '</ol></div>' +
    (words.length > 1 ? '<ol class="study-list">' + words.slice(1).map(item).join('') + '</ol>' : '') + '</section>';
}

const CSS = `
@page { size: A4; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: Inter, 'Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', sans-serif; color: #16302b; font-size: 11pt; }
:lang(ko) { font-family: 'Noto Sans KR', Inter, sans-serif; }
:lang(ja) { font-family: 'Noto Sans JP', 'Noto Sans KR', Inter, sans-serif; }
:lang(zh) { font-family: 'Noto Sans SC', 'Noto Sans KR', Inter, sans-serif; }
.dia { display: inline-block; width: 6px; height: 6px; background: #cf8a52; transform: rotate(45deg); border-radius: 1px; flex: none; }
.head-block { text-align: center; }
.cat { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 8.5pt; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #b8492f; margin: 0 0 8px; }
.box { border-top: 3px double #103f35; border-bottom: 3px double #103f35; padding: 12px 6px 11px; margin: 0 0 9px; }
h1 { font-size: 20pt; line-height: 1.22; margin: 0; }
.ko-title { margin: 7px 0 0; font-size: 11pt; color: #4c635c; }
.ko-title::before { content: "\\300C\\00A0"; color: #cf8a52; } .ko-title::after { content: "\\00A0\\300D"; color: #cf8a52; }
.meta { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; font-size: 9pt; color: #4c635c; }
.aud { font-size: 8pt; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.aud--tourists { background: #e3f3ea; color: #1b6b43; } .aud--students { background: #e2edfa; color: #19538f; } .aud--expats { background: #efe6fa; color: #5c3590; }
.photo { margin: 14px 0 4px; } .photo img { width: 100%; max-height: 72mm; object-fit: cover; border-radius: 3mm; display: block; }
.credit { font-size: 7.5pt; color: #6b7a75; margin: 0 0 6px; text-align: right; }
.body { margin-top: 12px; }
.para { margin: 0 0 3mm; }
.pair { break-inside: avoid; border-left: 2px solid #e1d8c8; padding: 1.2mm 0 1.2mm 3.5mm; margin: 0 0 1.6mm; }
.pair .src { margin: 0; font-size: 11pt; line-height: 1.6; }
.pair .out { margin: .6mm 0 0; font-size: 9.8pt; line-height: 1.55; color: #4c635c; }
.pair--head { border-left: 0; padding-left: 0; margin-top: 3mm; break-after: avoid; }
h3.head { break-after: avoid; }
.pair--head .src, .pair--head .out { font-weight: 700; display: table; background: #fbe3a6; padding: .4mm 2mm; border-radius: 1mm; }
.pair--head .out { margin-top: 1mm; font-size: 10pt; color: #16302b; }
.plain { font-size: 11pt; line-height: 1.75; margin: 0 0 3mm; }
h3.head { font-size: 12pt; margin: 4mm 0 2mm; display: inline-block; background: #fbe3a6; padding: .4mm 2mm; border-radius: 1mm; }
.study { margin-top: 7mm; break-inside: auto; counter-reset: w; }
.study-start { break-inside: avoid; }
.study-title { display: flex; align-items: center; gap: 8px; margin: 0 0 4mm; }
.study-title::before, .study-title::after { content: ""; flex: 1; height: 1px; background: #cf8a52; }
/* Two rings, drawn as borders: an outline is left behind on the page before when the block moves on. */
.study-ring { display: inline-block; padding: 2.4px; border-radius: 999px; border: 1.2px solid #103f35; }
.study-label { display: inline-block; padding: 1.6mm 6mm; border-radius: 999px; border: 1.6px solid #103f35; color: #103f35; font-size: 11.5pt; font-weight: 800; letter-spacing: .04em; }
.study-list { list-style: none; margin: 0; padding: 0; }
.study-list li { counter-increment: w; position: relative; padding-left: 8mm; margin: 0 0 3.2mm; break-inside: avoid; }
.study-list li::before { content: counter(w); position: absolute; left: 0; top: .6mm; width: 5mm; height: 5mm; border-radius: 50%; background: #16302b; color: #fff; font-size: 7.5pt; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.w-head { display: flex; align-items: baseline; gap: 2.2mm; flex-wrap: wrap; }
.w-term { font-size: 12.5pt; font-weight: 700; } .w-rom { font-size: 9pt; color: #4c635c; font-style: italic; }
.w-pos { font-size: 7pt; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #b8492f; background: rgba(184,73,45,.1); padding: .4mm 1.6mm; border-radius: 1mm; }
.w-mean { margin: .8mm 0 0; font-weight: 600; font-size: 10.5pt; } .w-note { margin: .6mm 0 0; font-size: 9.5pt; line-height: 1.5; color: #4c635c; }
.w-src { margin: 1mm 0 0; padding-left: 2.6mm; border-left: 2px solid #e1d8c8; font-size: 9.2pt; color: #4c635c; }
.online { margin-top: 6mm; text-align: center; font-size: 8.5pt; color: #6b7a75; }

/* The print edition (no photo) tightens step by step until it fits on
   two pages: first the spacing, then the type a little, then the word
   list in two columns. */
.fit1 .cat { margin-bottom: 5px; } .fit1 .box { padding: 8px 6px 7px; margin-bottom: 6px; } .fit1 h1 { font-size: 17pt; }
.fit1 .ko-title { margin-top: 4px; font-size: 10pt; }
.fit1 .body { margin-top: 8px; } .fit1 .para { margin-bottom: 1.6mm; }
.fit1 .pair { padding: .6mm 0 .6mm 3mm; margin-bottom: 1mm; } .fit1 .pair .src { line-height: 1.45; } .fit1 .pair .out { line-height: 1.4; margin-top: .3mm; }
.fit1 .pair--head { margin-top: 2mm; } .fit1 .plain { line-height: 1.6; margin-bottom: 2mm; } .fit1 h3.head { margin: 3mm 0 1.5mm; }
.fit1 .study { margin-top: 4mm; } .fit1 .study-title { margin-bottom: 2.6mm; } .fit1 .study-list li { margin-bottom: 2mm; }
.fit1 .w-note { line-height: 1.4; } .fit1 .online { margin-top: 3mm; }
.fit2 .pair .src, .fit2 .plain { font-size: 10pt; } .fit2 .pair .out { font-size: 9pt; }
.fit2 .w-term { font-size: 11pt; } .fit2 .w-mean { font-size: 9.6pt; } .fit2 .w-note { font-size: 8.8pt; } .fit2 .w-src { font-size: 8.6pt; }
.fit3 .study > .study-list, .fit3 .study-start + .study-list { column-count: 2; column-gap: 7mm; }
.fit3 .study-list li { break-inside: avoid; }
.fit4 .pair .src, .fit4 .plain { font-size: 9.6pt; line-height: 1.38; } .fit4 .pair .out { font-size: 8.6pt; line-height: 1.35; }
.fit4 .pair { margin-bottom: .6mm; padding: .4mm 0 .4mm 2.6mm; } .fit4 .para { margin-bottom: 1mm; }
.fit4 .w-note { font-size: 8.4pt; } .fit4 .study-list li { margin-bottom: 1.4mm; }
`;
// How tight each step is: 0 is the download edition's spacing.
// The last step also shortens the logo row at the top of each page.
const FIT = ['', 'fit1', 'fit1 fit2', 'fit1 fit2 fit3', 'fit1 fit2 fit3 fit4'];
const COMPACT_FRAME = FIT.length - 1;

function pageHTML(post, lang, fonts, withUrl = true, edition = { photo: true, fit: 0 }) {
  const src = post.lang || 'ko';
  const body = bodyHTML(post, lang);
  if (!body) return null;
  const title = titleIn(post, lang);
  const auds = (post.audiences || []).filter((a) => ['tourists', 'students', 'expats'].includes(a));
  const photo = edition.photo && post.image_url
    ? '<div class="photo"><img src="' + esc(post.image_url) + '" alt=""></div>' +
      (post.image_credit ? '<p class="credit">Photo: ' + esc(post.image_credit) + (post.image_source ? ' · ' + esc(post.image_source === 'unsplash' ? 'Unsplash' : post.image_source === 'pexels' ? 'Pexels' : post.image_source) : '') + '</p>' : '')
    : '';
  const url = 'www.durukorean.com' + (lang === 'en' ? '' : '/' + lang) + '/blog/post/' + post.slug;
  return '<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8"><style>' + fonts + '</style><style>' + CSS + '</style></head><body class="' + FIT[edition.fit || 0] + '">' +
    '<div class="head-block">' +
      '<p class="cat"><span class="dia"></span><span>' + esc(t(lang, 'blog.cat.' + post.category, post.category)) + '</span><span class="dia"></span></p>' +
      '<div class="box"><h1>' + esc(title) + '</h1>' +
        (lang !== src && title !== post.title ? '<p class="ko-title" lang="' + esc(src) + '">' + esc(post.title) + '</p>' : '') + '</div>' +
      '<div class="meta">' + auds.map((a) => '<span class="aud aud--' + a + '">' + esc(t(lang, 'blog.aud.' + a, a)) + '</span>').join('') +
        (auds.length ? '<span class="dia"></span>' : '') + '<span>' + esc(formatDate(post.post_date || post.created_at, lang)) + '</span></div>' +
    '</div>' + photo +
    '<div class="body">' + body + '</div>' + studyHTML(post, lang) +
    (withUrl ? '<p class="online">' + esc(url) + '</p>' : '') +
    '</body></html>';
}

const COLS = 'id,slug,title,excerpt,tags,body,lang,i18n,mt,study,category,audiences,post_date,created_at,image_url,image_credit,image_source,published,pdf';

async function allPosts(token) {
  try {
    return await rest(token, 'posts?select=' + COLS + '&order=created_at.desc&limit=2000');
  } catch (err) {
    if (/pdf/.test(err.message)) throw new Error('posts.pdf 칸이 없습니다 — schema.sql §44 를 먼저 실행해 주세요. (' + err.message + ')');
    throw err;
  }
}

function pick(posts) {
  const slug = arg('slug');
  const find = arg('find');
  if (slug) return posts.filter((p) => p.slug === slug);
  if (!find) return posts;
  const f = find.toLowerCase();
  return posts.filter((p) => (p.title || '').toLowerCase().includes(f) || (p.slug || '').includes(f) ||
    Object.values(p.mt || {}).some((m) => String((m && m.title) || '').toLowerCase().includes(f)));
}

// Everything a file shows, fingerprinted: the body and title in every
// language, the word list, the photo, the shelf, the day — and this
// script's own version, so a change of design makes every file again.
const DESIGN = 'blog-pdf/2'; // 2: the print edition (no photo, two pages)
function sourceHash(post) {
  const mt = {};
  Object.keys(post.mt || {}).sort().forEach((c) => { mt[c] = [post.mt[c].hash, post.mt[c].title, (post.mt[c].sentences || []).length]; });
  return MT.fingerprint(JSON.stringify([DESIGN, post.body, post.title, post.lang, post.i18n || {}, mt,
    post.study || null, post.category, post.audiences || [], post.post_date || post.created_at,
    post.image_url || '', post.image_credit || '', post.slug]));
}

async function makePost(browser, fonts, token, post) {
  const files = {};
  for (const lang of LANGS) {
    if (!pageHTML(post, lang, fonts)) continue;
    const frame = await frameV2({ title: titleIn(post, lang) }, labelsFor(lang), fonts);
    const tight = await frameV2({ title: titleIn(post, lang) }, labelsFor(lang), fonts, true);
    const render = async (withUrl, edition) => {
      const page = await browser.newPage();
      try {
        await page.setContent(pageHTML(post, lang, fonts, withUrl, edition), { waitUntil: 'networkidle', timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        const bytes = await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, ...(edition.fit === COMPACT_FRAME ? tight : frame) });
        return [bytes, (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length];
      } finally {
        await page.close();
      }
    };
    // The address line at the end never gets a page to itself: a page
    // with nothing else on it is left off (the footer says where it
    // came from anyway).
    const best = async (edition) => {
      let [bytes, n] = await render(true, edition);
      if (n > 1) {
        const [short, fewer] = await render(false, edition);
        if (fewer < n) [bytes, n] = [short, fewer];
      }
      return [bytes, n];
    };
    const [pdf, pages] = await best({ photo: true, fit: 0 });
    // The print edition (the owner's call, 2026-09-28): no photo, and
    // two pages where the post allows — the spacing tightens, then the
    // type, then the word list goes into two columns, and it stops at
    // the first step that fits.
    let printed = null;
    // --print-fit=N: one step only, to look at it.
    const only = arg('print-fit') !== null ? Number(arg('print-fit')) : null;
    for (let fit = only !== null ? only : 0; fit < (only !== null ? only + 1 : FIT.length); fit += 1) {
      const [bytes, n] = await best({ photo: false, fit });
      if (!printed || n < printed[1]) printed = [bytes, n, fit];
      if (n <= 2) break;
    }
    const name = post.slug + '(' + lang + ').pdf';
    const printName = post.slug + '(' + lang + ')-print.pdf';
    if (OUT) {
      const dir = ONE ? OUT : path.join(OUT, post.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), pdf);
      fs.writeFileSync(path.join(dir, printName), printed[0]);
    }
    const key = 'blog/' + post.id + '/' + lang + '.pdf';
    const printKey = 'blog/' + post.id + '/' + lang + '-print.pdf';
    if (!DRY) { await upload(token, key, pdf); await upload(token, printKey, printed[0]); }
    files[lang] = { key, name, size: pdf.length, pages, print: { key: printKey, pages: printed[1], fit: printed[2] } };
  }
  return files;
}

let ONE = false;

async function main() {
  let token = POST_JSON ? null : await signIn();
  let posts = POST_JSON ? [JSON.parse(fs.readFileSync(POST_JSON, 'utf8'))] : pick(await allPosts(token));
  posts = posts.filter((p) => String(p.body || '').trim());
  ONE = !!(arg('slug') || arg('find') || POST_JSON);
  if (ONE && posts.length !== 1) throw new Error('글을 하나로 찾지 못했습니다 (' + posts.length + '편): ' + posts.map((p) => p.title).join(' / '));
  // Several machines at once: --shard=2/8 takes every eighth post.
  const shard = /^(\d+)\/(\d+)$/.exec(arg('shard') || '');
  if (shard) posts = posts.filter((p, i) => i % Number(shard[2]) === Number(shard[1]));
  // Only what is missing or out of date, unless told to make them all.
  const force = args.includes('--force') || ONE;
  const todo = force ? posts : posts.filter((p) => !(p.pdf && p.pdf.src === sourceHash(p)));
  // --count: how many are waiting, and nothing else (the workflow asks
  // first, and skips installing a browser when the answer is none).
  if (args.includes('--count')) { console.log(String(todo.length)); return; }
  log('글 ' + posts.length + '편 중 만들 것 ' + todo.length + '편' + (shard ? ' (몫 ' + shard[1] + '/' + shard[2] + ')' : '') + (DRY ? ' · 연습' : ''));
  if (!todo.length) return;

  // The font files come from Google over the network; a passing
  // "fetch failed" is tried again rather than ending the run.
  let fonts = null;
  for (let tries = 1; !fonts; tries += 1) {
    try { fonts = await embeddedFonts(FONT_CSS_V2); }
    catch (err) {
      if (tries >= 4) throw err;
      log('글꼴 받기 실패, 다시 시도 (' + tries + '): ' + err.message);
      await new Promise((r) => setTimeout(r, 5000 * tries));
    }
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let done = 0, failed = 0;
  try {
    for (const [i, post] of todo.entries()) {
      if (token && i && i % 8 === 0) token = await signIn();
      try {
        const files = await makePost(browser, fonts, token, post);
        const langs = Object.keys(files);
        if (!DRY) {
          const record = { hash: MT.fingerprint(post.body || ''), src: sourceHash(post), at: new Date().toISOString(), files };
          await rest(token, 'posts?id=eq.' + post.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ pdf: record }) });
        }
        done += 1;
        log('· ' + (post.published ? '' : '[초안] ') + post.title + ' — ' + langs.length + '개 언어 (' +
          langs.map((c) => c + ' ' + files[c].pages + '쪽/인쇄 ' + files[c].print.pages + '쪽').join(', ') + ')');
      } catch (err) {
        failed += 1;
        log('✗ ' + post.title + ' — ' + err.message);
      }
    }
  } finally {
    await browser.close();
  }
  log('');
  log('만듦 ' + done + '편 · 실패 ' + failed + '편' + (DRY ? ' (연습 — 올리지 않았습니다)' : ''));
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
