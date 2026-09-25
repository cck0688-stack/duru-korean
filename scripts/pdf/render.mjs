// DURU KOREAN — turning a sheet into a PDF somebody would print
//
// HTML through the Chromium this project already carries for its
// browser tests, which means full CSS, the site's own typeface, and
// text that stays text. Nothing new is installed.
//
// Two decisions worth stating, because both are requirements in
// section 5.5 of the brief rather than preferences:
//
// The text is real text. Chromium's page.pdf() writes glyphs, not a
// picture of them, so a reader can select a Korean word out of the
// sheet and paste it into a dictionary. A PDF made of images would
// look identical and be useless for that, and there is no way to tell
// by looking — which is why render() measures it instead.
//
// Fonts are embedded rather than named. A sheet that renders here and
// turns into boxes on somebody's machine has failed, and Korean,
// Vietnamese tone marks and Japanese are exactly where that happens.
// The font files are fetched once and inlined as data URIs, so the
// PDF carries its own typeface and does not care what the reader has.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bodyFor, esc, SPROUT } from './templates.mjs';

// Imported when a PDF is actually rendered, not when this file loads.
// Playwright is a build-time dependency — it makes the files, it is not
// part of the site — so anything that only wants sheetHTML() or the
// labels (a test, the checker) does not need it installed.
async function browserEngine() {
  const { chromium } = await import('playwright');
  return chromium;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The families the sheets actually use. Latin, Korean, and the two
// other scripts the site publishes in.
const FONT_CSS =
  'https://fonts.googleapis.com/css2' +
  '?family=Inter:wght@400;600;700' +
  '&family=Noto+Sans+KR:wght@400;500;700' +
  '&family=Noto+Sans+JP:wght@400;700' +
  '&family=Noto+Sans+SC:wght@400;700' +
  '&display=swap';
// The owner's design (v2) adds an italic for the notes under a letter
// and a serif for the section titles.
const FONT_CSS_V2 = FONT_CSS
  .replace('Inter:wght@400;600;700', 'Inter:ital,wght@0,400;0,600;0,700;1,400')
  .replace('&display=swap', '&family=Cormorant+Garamond:wght@600;700&display=swap');

// Column headings and section titles, in the language of the sheet.
// Deliberately not the site dictionary: these live with the templates
// that use them, and a sheet is rendered in Node where no page is.
const LABELS = {
  en: { words: 'Words', word: 'Word', phrase: 'Phrase', meaning: 'Meaning', inUse: 'In use',
        passage: 'Read this', glossary: 'Words in the passage', pattern: 'The pattern',
        watchOut: 'Watch out', dialogue: 'The conversation', phrases: 'Phrases to keep',
        letters: 'The letters', letter: 'Letter', sound: 'Sound', practice: 'Trace and copy',
        nowTheWords: 'Now the words', yourTurn: 'Your turn', goodToKnow: 'Good to know —',
        level: 'Level', minutes: 'min', objective: 'What this is for',
        answers: 'Answers', sources: 'Sources checked while writing this' },
  ko: { words: '낱말', word: '낱말', phrase: '표현', meaning: '뜻', inUse: '쓰임',
        passage: '읽어 보세요', glossary: '지문 속 낱말', pattern: '문형',
        watchOut: '조심할 것', dialogue: '대화', phrases: '익혀 둘 표현',
        letters: '글자', letter: '글자', sound: '소리', practice: '따라 쓰기',
        nowTheWords: '낱말로 연습하기', yourTurn: '직접 해 보세요', goodToKnow: '알아두면 좋은 것 —',
        level: '수준', minutes: '분', objective: '이 자료의 목표',
        answers: '정답', sources: '작성하며 확인한 자료' },
  vi: { words: 'Từ vựng', word: 'Từ', phrase: 'Mẫu câu', meaning: 'Nghĩa', inUse: 'Dùng thế nào',
        passage: 'Đọc đoạn sau', glossary: 'Từ trong bài đọc', pattern: 'Mẫu ngữ pháp',
        watchOut: 'Lưu ý', dialogue: 'Hội thoại', phrases: 'Mẫu câu cần nhớ',
        letters: 'Chữ cái', letter: 'Chữ', sound: 'Âm', practice: 'Tô và viết lại',
        nowTheWords: 'Luyện với từ', yourTurn: 'Đến lượt bạn', goodToKnow: 'Nên biết —',
        level: 'Trình độ', minutes: 'phút', objective: 'Mục tiêu của tài liệu này',
        answers: 'Đáp án', sources: 'Nguồn đã tham khảo' },
  ja: { words: '単語', word: '単語', phrase: '表現', meaning: '意味', inUse: '使い方',
        passage: '読んでみましょう', glossary: '本文の単語', pattern: '文型',
        watchOut: '注意', dialogue: '会話', phrases: '覚えたい表現',
        letters: '文字', letter: '文字', sound: '音', practice: 'なぞって書く',
        nowTheWords: '単語で練習', yourTurn: 'やってみましょう', goodToKnow: '知っておくと —',
        level: 'レベル', minutes: '分', objective: 'この資料のねらい',
        answers: '解答', sources: '作成時に確認した資料' },
  zh: { words: '词汇', word: '词', phrase: '句型', meaning: '意思', inUse: '用法',
        passage: '请阅读', glossary: '课文生词', pattern: '句型',
        watchOut: '注意', dialogue: '对话', phrases: '要记住的句型',
        letters: '字母', letter: '字母', sound: '发音', practice: '描红与抄写',
        nowTheWords: '用词练习', yourTurn: '轮到你了', goodToKnow: '小知识 —',
        level: '级别', minutes: '分钟', objective: '本资料的学习目标',
        answers: '答案', sources: '编写时查证的资料' },
  es: { words: 'Vocabulario', word: 'Palabra', phrase: 'Expresión', meaning: 'Significado', inUse: 'En uso',
        passage: 'Lee esto', glossary: 'Palabras del texto', pattern: 'La estructura',
        watchOut: 'Cuidado con', dialogue: 'La conversación', phrases: 'Expresiones para recordar',
        letters: 'Las letras', letter: 'Letra', sound: 'Sonido', practice: 'Traza y copia',
        nowTheWords: 'Ahora las palabras', yourTurn: 'Te toca', goodToKnow: 'Conviene saber —',
        level: 'Nivel', minutes: 'min', objective: 'Para qué sirve esta hoja',
        answers: 'Respuestas', sources: 'Fuentes consultadas' },
  id: { words: 'Kosakata', word: 'Kata', phrase: 'Ungkapan', meaning: 'Arti', inUse: 'Contoh pemakaian',
        passage: 'Bacalah', glossary: 'Kata dalam bacaan', pattern: 'Pola',
        watchOut: 'Perhatikan', dialogue: 'Percakapan', phrases: 'Ungkapan untuk diingat',
        letters: 'Huruf', letter: 'Huruf', sound: 'Bunyi', practice: 'Tebalkan dan salin',
        nowTheWords: 'Sekarang katanya', yourTurn: 'Giliranmu', goodToKnow: 'Perlu diketahui —',
        level: 'Level', minutes: 'menit', objective: 'Tujuan lembar ini',
        answers: 'Kunci jawaban', sources: 'Sumber yang diperiksa' },
  'pt-BR': { words: 'Vocabulário', word: 'Palavra', phrase: 'Expressão', meaning: 'Significado', inUse: 'Em uso',
        passage: 'Leia isto', glossary: 'Palavras do texto', pattern: 'A estrutura',
        watchOut: 'Atenção', dialogue: 'A conversa', phrases: 'Expressões para guardar',
        letters: 'As letras', letter: 'Letra', sound: 'Som', practice: 'Cubra e copie',
        nowTheWords: 'Agora as palavras', yourTurn: 'Sua vez', goodToKnow: 'Bom saber —',
        level: 'Nível', minutes: 'min', objective: 'Para que serve esta folha',
        answers: 'Respostas', sources: 'Fontes consultadas' }
};

export function labelsFor(lang) { return LABELS[lang] || LABELS.en; }

const cachedFonts = new Map();

// The stylesheet Google Fonts serves, with every font file it points at
// pulled in and inlined. Done once per process; a run that makes fifty
// sheets fetches nothing after the first.
async function embeddedFonts(url = FONT_CSS) {
  if (cachedFonts.has(url)) return cachedFonts.get(url);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
  });
  if (!res.ok) throw new Error('could not fetch the font stylesheet: ' + res.status);
  let css = await res.text();

  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))];
  const files = await Promise.all(urls.map(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error('could not fetch a font file: ' + u);
    const buf = Buffer.from(await r.arrayBuffer());
    const kind = u.endsWith('.woff2') ? 'font/woff2' : 'font/woff';
    return [u, 'data:' + kind + ';base64,' + buf.toString('base64')];
  }));
  for (const [u, data] of files) css = css.split(u).join(data);

  cachedFonts.set(url, css);
  return css;
}

// The @font-face rules a page header or footer needs. Chromium draws
// those apart from the page, so the page's fonts are not theirs; they
// get only the rules whose unicode-range covers a character they print
// — a few slices of Korean for the title, not the whole family.
export function fontsFor(css, text) {
  const wanted = [...new Set([...String(text)].map((c) => c.codePointAt(0)))];
  const covers = (range) => range.split(',').some((part) => {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) return false;
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = parseInt((m[2] || m[1]).replace(/\?/g, 'f'), 16);
    return wanted.some((c) => c >= lo && c <= hi);
  });
  return (String(css).match(/@font-face\s*{[^}]*}/g) || []).filter((rule) => {
    const family = /font-family:\s*['"]?([^;'"]+)/.exec(rule);
    if (!family || !/^(Inter|Noto Sans (KR|JP|SC))$/.test(family[1].trim())) return false;
    if (/font-style:\s*italic/.test(rule)) return false;
    const range = /unicode-range:\s*([^;]+)/.exec(rule);
    return !range || covers(range[1]);
  }).join('\n');
}

function masthead(sheet, L) {
  const tags = [];
  if (sheet.level) tags.push(esc(L.level) + ' · ' + esc(sheet.level));
  if (sheet.minutes) tags.push(esc(String(sheet.minutes)) + ' ' + esc(L.minutes));
  return '<div class="mast">' +
    '<span class="mast-brand">DURU KOREAN · FREE DOWNLOADS</span>' +
    '<span class="mast-tags">' + tags.map((t) => '<span class="tag">' + t + '</span>').join('') + '</span>' +
    '</div>';
}

function answersPage(sheet, L) {
  const answers = Array.isArray(sheet.answers) ? sheet.answers : [];
  if (!answers.length) return '';
  // Numbered the same way the questions are — "1)" — so the two halves
  // of the sheet read as one list, not as "1." over here and "1)" there.
  const list = answers.map((a, i) => '<div class="a"><span class="n">' + (i + 1) + ')</span>' +
      esc(typeof a === 'string' ? a : a.answer) +
      (a && a.why ? ' <span class="ex-tr">— ' + esc(a.why) + '</span>' : '') + '</div>').join('');
  return '<div class="answers"><h2>' + esc(L.answers) + '</h2>' +
    (L.design === 'v2' ? '<div class="answer-box">' + list + '</div>' : list) + '</div>';
}

// Section 5.4: the sources used to check facts are shown, separately
// from any rights notice for material actually reproduced. Nothing is
// reproduced in a generated sheet, so this is the reference list only.
function credits(sources, L) {
  const rows = (sources || []).filter((s) => s && s.source_url);
  if (!rows.length) return '';
  return '<div class="credits"><b>' + esc(L.sources) + '</b><br>' +
    rows.map((s) => esc(s.source_title || s.source_url) +
      (s.creator ? ' — ' + esc(s.creator) : '') + ' · ' + esc(s.source_url) +
      (s.credit_text ? ' · ' + esc(s.credit_text) : '')).join('<br>') + '</div>';
}

// The owner's worksheet design (2026-09-25), drawn as a mockup of the
// ㅈ·ㅊ·ㅉ sheet: logo and an ink landscape at the top of every page,
// numbered serif section titles, soft boxes, a copyright bar. The
// default since the owner approved it; 'v1' is the plain layout every
// sheet had before it, kept for comparison.
export const DESIGNS = ['v1', 'v2'];
const designOf = (opts) => (DESIGNS.includes(opts.design) ? opts.design : 'v2');

// The letters a Hangul sheet is about, in red: "— ㅈ·ㅊ·ㅉ 소리 익히기".
// Only bare jamo, which is what a sheet about letters names them by;
// on other shelves a jamo in a title is part of an ending ("-(으)ㄴ").
function titleHTML(title) {
  return esc(title).replace(/[\u3131-\u3163](?:[·・\s]*[\u3131-\u3163])*/g,
    (m) => '<span class="jamo">' + m + '</span>');
}

export async function sheetHTML(sheet, opts = {}) {
  const lang = opts.lang || 'en';
  const design = designOf(opts);
  const v2 = design === 'v2';
  const L = { ...labelsFor(lang), design };
  const fonts = opts.fonts != null ? opts.fonts : await embeddedFonts(v2 ? FONT_CSS_V2 : FONT_CSS);
  let css = await fs.readFile(path.join(HERE, 'sheet.css'), 'utf8');
  if (v2) css += '\n' + await fs.readFile(path.join(HERE, 'sheet-v2.css'), 'utf8');

  return '<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8">' +
    '<title>' + esc(sheet.title) + '</title>' +
    '<style>' + fonts + '</style><style>' + css + '</style></head><body' + (v2 ? ' class="v2"' : '') + '>' +
    (v2 ? '' : masthead(sheet, L)) +
    '<h1' + (lang === 'ko' ? ' lang="ko"' : '') + '>' +
    (v2 && (opts.category || sheet.category) === 'hangul' ? titleHTML(sheet.title) : esc(sheet.title)) + '</h1>' +
    (sheet.summary ? '<p class="summary">' + esc(sheet.summary) + '</p>' : '') +
    (sheet.objective
      ? (v2
        ? '<div class="objective"><span class="obj-icon">' + SPROUT + '</span><div class="obj-text"><b>' +
          esc(L.objective) + '</b><div class="obj-line">' + esc(sheet.objective) + '</div></div></div>'
        : '<div class="objective"><b>' + esc(L.objective) + '</b><br>' + esc(sheet.objective) + '</div>')
      : '') +
    bodyFor(opts.category || sheet.category || 'etc', sheet, L) +
    credits(opts.sources, L) +
    answersPage(sheet, L) +
    '</body></html>';
}

// What is printed around the sheet on every page. Chromium's header
// and footer rather than the stylesheet's: a CSS `position: fixed`
// footer looks like it should repeat on every page and does not — it
// drew once and landed halfway down page two. These repeat, and can
// count the pages, which is worth having on something that gets
// printed and handed out in a pile.
function frameV1(sheet) {
  return {
    margin: { top: '17mm', bottom: '18mm', left: '15mm', right: '15mm' },
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-size:7.5pt;color:#9aa5a1;' +
      'font-family:Inter,sans-serif;padding:0 15mm;display:flex;' +
      'justify-content:space-between;border-top:1px solid #e8ecea;padding-top:4px;">' +
      '<span>durukorean.com</span>' +
      '<span>' + esc(sheet.title) + '</span>' +
      '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
      '</div>'
  };
}

// The owner's design. The logo is a JPEG made for print
// (assets/sheet-logo.jpg, from the site's logo): a PDF carries a JPEG
// as it is, where the site's transparent WebP would be stored
// uncompressed and make every download a few hundred KB heavier.
const LANDSCAPE =
  '<svg viewBox="0 0 300 90" style="position:absolute;right:-15mm;top:-4mm;width:92mm;height:26mm" aria-hidden="true">' +
  '<defs><linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c7c1"/>' +
  '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fa69e"/>' +
  '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>' +
  '<circle cx="262" cy="20" r="12" fill="#f2c4ba"/>' +
  '<path d="M140 90 L180 54 L195 63 L226 20 L247 43 L263 35 L286 56 L300 74 L300 90 Z" fill="url(#far)"/>' +
  '<path d="M200 90 L232 60 L245 67 L268 46 L290 66 L300 80 L300 90 Z" fill="url(#near)"/>' +
  '<g fill="none" stroke="#d9c9ae" stroke-width="1.6" stroke-linecap="round">' +
  '<path d="M20 80 C60 74 92 82 128 72 C150 66 158 56 172 58 C186 60 186 74 174 75 C164 76 163 66 171 65"/>' +
  '<path d="M150 70 C168 76 190 72 206 64 C216 59 226 60 228 67 C230 74 220 76 217 70"/>' +
  '<path d="M60 86 C100 84 130 88 160 82"/></g></svg>';
const LOCK = '<svg viewBox="0 0 24 24" style="width:11px;height:11px;flex:none" aria-hidden="true">' +
  '<rect x="4" y="10" width="16" height="11" rx="2" fill="#b83a2a"/>' +
  '<path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#b83a2a" stroke-width="2.4"/></svg>';
const RIGHTS = "For personal and educational use only. Commercial use, redistribution, or reproduction " +
  "without the author's permission is prohibited.";
// The owner's wording (2026-09-25). The year is the year the sheet is made.
const COPYRIGHT = () => 'Copyright © ' + new Date().getFullYear() + ' DURU KOREAN. All rights reserved.';
let logo = null;

// Everything the page header and footer print, for a comparison of what
// two editions of a sheet say (scripts/pdf/pdftext.py) to set aside —
// it is printed on every page, and not part of the sheet.
export function frameText(sheet, lang) {
  const L = labelsFor(lang);
  const out = ['www.durukorean.com', 'durukorean.com', COPYRIGHT(), RIGHTS,
    'DURU KOREAN · FREE DOWNLOADS'];
  if (sheet.level) out.push(L.level + ' · ' + sheet.level);
  if (sheet.minutes) out.push(sheet.minutes + ' ' + L.minutes);
  return out;
}

async function frameV2(sheet, L, fonts) {
  if (!logo) logo = 'data:image/jpeg;base64,' + (await fs.readFile(path.join(HERE, 'assets', 'sheet-logo.jpg'))).toString('base64');
  const pills = [];
  if (sheet.level) pills.push([esc(L.level) + ' · ' + esc(sheet.level), '#eef1ea', '#b9c6bd']);
  if (sheet.minutes) pills.push([esc(String(sheet.minutes)) + ' ' + esc(L.minutes), '#f8e9e5', '#e5c2b9']);
  const font = "font-family:Inter,'Noto Sans KR','Noto Sans JP','Noto Sans SC',sans-serif;";
  // The header and the footer are drawn apart from the page, without
  // its fonts: each gets the few it prints with.
  const style = (text) => '<style>' + fontsFor(fonts, text) + '</style>';
  const box = 'width:100%;padding:0 15mm;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;' + font;
  const headText = 'www.durukorean.com' + pills.map((p) => p[0]).join('');
  const footText = 'durukorean.com0123456789/|' + COPYRIGHT() + sheet.title + RIGHTS;
  return {
    margin: { top: '44mm', bottom: '27mm', left: '15mm', right: '15mm' },
    headerTemplate: style(headText) +
      '<div style="' + box + 'color:#16302b;">' +
      '<div style="position:relative;height:18mm;display:flex;align-items:flex-end;">' +
      '<img src="' + logo + '" style="height:15.5mm;display:block;position:relative;z-index:1" alt="DURU KOREAN">' +
      LANDSCAPE + '</div>' +
      '<div style="border-top:0.8px solid #dba79c;margin-top:2.2mm;"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:2.2mm 0;">' +
      '<span style="color:#b83a2a;font-size:12px;font-weight:700;letter-spacing:.13em;">www.durukorean.com</span>' +
      '<span style="display:flex;gap:2.2mm;">' + pills.map(([t, bg, line]) =>
        '<span style="font-size:10px;font-weight:600;padding:1.1mm 3.4mm;border-radius:999px;background:' + bg +
        ';border:0.8px solid ' + line + ';white-space:nowrap;">' + t + '</span>').join('') + '</span></div>' +
      '<div style="border-top:2px solid #16302b;"></div></div>',
    footerTemplate: style(footText) +
      '<div style="' + box + 'color:#16302b;">' +
      '<div style="border-top:1px solid #16302b;display:flex;justify-content:space-between;align-items:center;' +
      'padding-top:1.8mm;font-size:9.5px;">' +
      '<span>durukorean.com</span>' +
      '<span>' + esc(sheet.title) + '&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;' +
      '<span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' +
      '<div style="margin-top:2mm;background:#f8e9e5;border-radius:3mm;padding:1.6mm 4mm;display:flex;' +
      'align-items:center;gap:2.4mm;font-size:8px;line-height:1.35;color:#5b6b66;">' + LOCK +
      '<span><b style="color:#b83a2a;font-weight:600;">' + esc(COPYRIGHT()) + '</b>' +
      '<br>' + esc(RIGHTS) + '</span></div></div>'
  };
}

// Renders one sheet and hands back the bytes plus everything the
// version row wants written down: page count, size, hash, and what the
// technical checks made of it.
export async function renderSheet(sheet, opts = {}) {
  const design = designOf(opts);
  const fonts = opts.fonts != null ? opts.fonts
    : await embeddedFonts(design === 'v2' ? FONT_CSS_V2 : FONT_CSS);
  const html = await sheetHTML(sheet, { ...opts, fonts });
  const frame = design === 'v2'
    ? await frameV2(sheet, labelsFor(opts.lang || 'en'), fonts)
    : frameV1(sheet);
  const chromium = opts.browser ? null : await browserEngine();
  const browser = opts.browser || await chromium.launch(
    { executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const print = () => page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      ...frame
    });
    let pdf = await print();
    let used = html;
    // The owner's rule (2026-09-25): the answers follow the questions,
    // not a page of their own. When they do not fit under the last
    // question — the sheet is a page longer with them than without —
    // the sheet is set a little tighter and the answers in two columns,
    // and that is kept if it saves the page.
    if (opts.fit !== false && await page.$('.answers')) {
      const { pageBreakdown } = await import('./check.mjs');
      const pages = (x) => pageBreakdown(x).pages;
      const withAnswers = pages(pdf);
      await page.evaluate(() => { document.querySelector('.answers').style.display = 'none'; });
      const without = pages(await print());
      await page.evaluate(() => { document.querySelector('.answers').style.display = ''; });
      if (withAnswers > without) {
        await page.evaluate(() => document.body.classList.add('fit'));
        const tight = await print();
        if (pages(tight) < withAnswers) {
          pdf = tight;
          used = html.replace(/<body(?: class="([^"]*)")?>/, (m, c) => '<body class="' + (c ? c + ' ' : '') + 'fit">');
        } else {
          await page.evaluate(() => document.body.classList.remove('fit'));
        }
      }
    }
    // The owner's rule (2026-09-25): the answers sit at the very foot of
    // the last page, however much room that leaves above them, so a
    // learner working down the page does not see them first. A gap goes
    // in above the answers, as tall as it can be without adding a page —
    // found by trying, because only the printed PDF knows where Chromium
    // breaks its pages. A dozen quick prints for a sheet.
    if (opts.pin !== false && await page.$('.answers')) {
      const { pageBreakdown } = await import('./check.mjs');
      const pages = (x) => pageBreakdown(x).pages;
      const want = pages(pdf);
      const gap = (px) => page.evaluate((h) => {
        let el = document.querySelector('.answers-gap');
        if (!el) {
          el = document.createElement('div');
          el.className = 'answers-gap';
          el.setAttribute('aria-hidden', 'true');
          const a = document.querySelector('.answers');
          a.parentNode.insertBefore(el, a);
        }
        el.style.height = h + 'px';
      }, px);
      let lo = 0, hi = 1200, best = 0;   // an A4 page is 1123px
      while (hi - lo > 3) {
        const mid = Math.floor((lo + hi) / 2);
        await gap(mid);
        if (pages(await print()) === want) { best = mid; lo = mid; } else { hi = mid; }
      }
      // A few pixels short of the bottom, not one over it.
      best = Math.max(0, best - 2);
      await gap(best);
      if (best > 0) {
        pdf = await print();
        const div = '<div class="answers-gap" aria-hidden="true" style="height:' + best + 'px"></div>';
        used = used.replace('<div class="answers">', div + '<div class="answers">');
      }
    }
    const checks = opts.check === false ? null : await (await inspector())(page, pdf, sheet);
    return {
      pdf,
      html: used,
      bytes: pdf.length,
      hash: crypto.createHash('sha256').update(pdf).digest('hex'),
      check: checks
    };
  } finally {
    await context.close();
    if (!opts.browser) await browser.close();
  }
}

// The rules live in check.mjs; this file's job is to make the file.
// Loaded lazily so that the two can be tested apart.
let inspect = null;
export function useInspector(fn) { inspect = fn; }

async function inspector() {
  if (!inspect) ({ inspect } = await import('./check.mjs'));
  return inspect;
}
