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
import { bodyFor, esc } from './templates.mjs';

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

let cachedFonts = null;

// The stylesheet Google Fonts serves, with every font file it points at
// pulled in and inlined. Done once per process; a run that makes fifty
// sheets fetches nothing after the first.
async function embeddedFonts() {
  if (cachedFonts) return cachedFonts;
  const res = await fetch(FONT_CSS, {
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

  cachedFonts = css;
  return css;
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
  return '<div class="answers"><h2>' + esc(L.answers) + '</h2>' +
    answers.map((a, i) => '<div class="a"><span class="n">' + (i + 1) + ')</span>' +
      esc(typeof a === 'string' ? a : a.answer) +
      (a && a.why ? ' <span class="ex-tr">— ' + esc(a.why) + '</span>' : '') + '</div>').join('') +
    '</div>';
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

export async function sheetHTML(sheet, opts = {}) {
  const lang = opts.lang || 'en';
  const L = labelsFor(lang);
  const fonts = opts.fonts != null ? opts.fonts : await embeddedFonts();
  const css = await fs.readFile(path.join(HERE, 'sheet.css'), 'utf8');

  return '<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8">' +
    '<title>' + esc(sheet.title) + '</title>' +
    '<style>' + fonts + '</style><style>' + css + '</style></head><body>' +
    masthead(sheet, L) +
    '<h1' + (lang === 'ko' ? ' lang="ko"' : '') + '>' + esc(sheet.title) + '</h1>' +
    (sheet.summary ? '<p class="summary">' + esc(sheet.summary) + '</p>' : '') +
    (sheet.objective
      ? '<div class="objective"><b>' + esc(L.objective) + '</b><br>' + esc(sheet.objective) + '</div>'
      : '') +
    bodyFor(opts.category || sheet.category || 'etc', sheet, L) +
    credits(opts.sources, L) +
    answersPage(sheet, L) +
    '</body></html>';
}

// Renders one sheet and hands back the bytes plus everything the
// version row wants written down: page count, size, hash, and what the
// technical checks made of it.
export async function renderSheet(sheet, opts = {}) {
  const html = await sheetHTML(sheet, opts);
  const chromium = opts.browser ? null : await browserEngine();
  const browser = opts.browser || await chromium.launch(
    { executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // The footer is Chromium's rather than the stylesheet's. A CSS
    // `position: fixed` footer looks like it should repeat on every
    // page and does not — it drew once and landed halfway down page
    // two. This one repeats, and can count the pages, which is worth
    // having on something that gets printed and handed out in a pile.
    const print = () => page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '17mm', bottom: '18mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:7.5pt;color:#9aa5a1;' +
        'font-family:Inter,sans-serif;padding:0 15mm;display:flex;' +
        'justify-content:space-between;border-top:1px solid #e8ecea;padding-top:4px;">' +
        '<span>durukorean.com</span>' +
        '<span>' + esc(sheet.title) + '</span>' +
        '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
        '</div>'
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
          used = html.replace('<body>', '<body class="fit">');
        } else {
          await page.evaluate(() => document.body.classList.remove('fit'));
        }
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
