// DURU KOREAN — what each kind of download looks like
//
// One function per shelf. Each takes the structured sheet the model
// wrote and returns the body of the page; the furniture around it —
// masthead, objective, footer, answer page — is the same for all six
// and lives in render.mjs.
//
// Keeping them apart matters because the shelves are genuinely
// different documents. A vocabulary sheet is a table. A reading sheet
// is a passage with a glossary beside it and questions under it. A
// Hangul sheet is mostly empty boxes to write in. Pouring all three
// through one template would produce three things that look the same
// and none that is right.
//
// Everything here escapes what it is given. The text comes from a
// model, which is not a reason to trust it with markup.

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const list = (x) => (Array.isArray(x) ? x : []);

// An ending is one thing: "-는", "-(으)ㄴ" never break after the hyphen
// ("Add -" at the end of one line, "는" on the next). Takes escaped
// text; a hyphen that starts a word and is followed by Hangul keeps
// the Hangul with it.
export function keepEndings(html) {
  return String(html).replace(/(^|[\s(\/,])-(\(?[\u3131-\u318e\uac00-\ud7a3][\u3131-\u318e\uac00-\ud7a3()]*)/g,
    '$1<span class="nb">-$2</span>');
}
const prose = (x) => keepEndings(esc(x));

// A sprout, for the boxes that say what a sheet or a task is for.
export const SPROUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-9"/>' +
  '<path class="leaf" d="M12 13C12 8.6 9 6 4.5 6c0 4.4 3 7 7.5 7z"/>' +
  '<path class="leaf" d="M12 11c0-4.4 3-7 7.5-7 0 4.4-3 7-7.5 7z"/></svg>';

// A numbered question with room to answer it. `lines` is how much room;
// a question that asked for more than one line is marked, so a design
// that sets short questions on a single card can still leave room for
// the ones that are written out.
function question(text, i, lines = 1, design, items) {
  // The owner's design sets the number in a disc, where "1)" reads as a typo.
  // A question with parts (① … ② …) lists each part on its own line
  // under the instruction (the owner's kiosk sheet, 2026-09-26).
  const parts = list(items).length
    ? '<div class="q-parts">' + list(items).map((it, j) =>
        '<div class="q-part"><span class="q-pn">' + String.fromCharCode(0x2460 + j) + '</span>' + esc(it) + '</div>').join('') + '</div>'
    : '';
  return '<div class="q' + (lines > 1 ? ' q-lines' : '') + (parts ? ' q-multi' : '') + '"><div class="q-ask"><span class="n">' + (i + 1) +
    (design === 'v2' ? '' : ')') + '</span>' +
    (parts ? '<div class="q-body"><div>' + esc(text) + '</div>' + parts + '</div>' : esc(text)) + '</div>' +
    '<div class="rule"></div>'.repeat(Math.max(1, lines)) + '</div>';
}

// "j (plain): soft and relaxed" — the name of the sound in bold, when
// the line starts with one.
function soundHTML(sound) {
  const m = /^([^:：]{1,40})([:：])(.*)$/s.exec(String(sound || ''));
  return m ? '<b>' + esc(m[1] + m[2]) + '</b>' + esc(m[3]) : esc(sound);
}

function wordRows(words, heads) {
  return '<table><thead><tr>' +
    heads.map((h, i) => '<th' + (i === 0 ? ' style="width:26%"' : '') + '>' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' +
    list(words).map((w) =>
      '<tr><td><div class="word" lang="ko">' + esc(w.korean) + '</div>' +
      (w.roman ? '<div class="rom">' + esc(w.roman) + '</div>' : '') + '</td>' +
      '<td>' + esc(w.meaning) + '</td>' +
      '<td>' + (w.example
        ? '<div class="ex-kr" lang="ko">' + esc(w.example) + '</div>' +
          (w.exampleMeaning ? '<div class="ex-tr">' + esc(w.exampleMeaning) + '</div>' : '')
        : '') + '</td></tr>').join('') +
    '</tbody></table>';
}

/* ---- vocabulary -------------------------------------------------- */
// Words, what they mean, and one real sentence each. The sentence is
// the part that makes it a worksheet rather than a list.
function vocab(s, L) {
  return '<section><h2>' + esc(L.words) + '</h2>' +
    wordRows(s.words, [L.word, L.meaning, L.inUse]) + '</section>' +
    (s.note ? '<section><div class="note"><b>' + esc(L.goodToKnow) + '</b> ' + esc(s.note) + '</div></section>' : '') +
    practice(s, L);
}

/* ---- reading ----------------------------------------------------- */
// The one shelf that is connected text. The glossary sits under the
// passage rather than beside it, because a reader who has to look
// sideways mid-sentence has lost the thread.
function reading(s, L) {
  return '<section><h2>' + esc(L.passage) + '</h2>' +
    '<div class="passage" lang="ko">' +
    list(s.passage).map((p) => '<p>' + esc(p) + '</p>').join('') +
    '</div></section>' +
    (list(s.words).length
      ? '<section><h2>' + esc(L.glossary) + '</h2>' + wordRows(s.words, [L.word, L.meaning, L.inUse]) + '</section>'
      : '') +
    practice(s, L);
}

// An example sentence with the words that show the pattern in bold and
// underlined — "지금 커피를 **마시는** 사람이…" (the owner, 2026-09-25).
// `marks` are copied from the sentence by the writer; one that is not
// in it marks nothing, so a wrong mark can hide nothing and add nothing.
// A mark starts a word — "산" marks "산 사람", not the 산 inside 산책 —
// and the longest one wins where two start at the same place.
const HANGUL = /[\uac00-\ud7a3]/;
export function markedHTML(text, marks) {
  const s = String(text == null ? '' : text);
  const want = list(marks).map((m) => String(m || '').trim()).filter((m) => m && s.includes(m))
    .sort((a, b) => b.length - a.length);
  if (!want.length) return esc(s);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const hit = (i === 0 || !HANGUL.test(s[i - 1])) && want.find((m) => s.startsWith(m, i));
    if (hit) { out += '<b class="mark">' + esc(hit) + '</b>'; i += hit.length; } else { out += esc(s[i]); i += 1; }
  }
  return out;
}

/* ---- grammar ----------------------------------------------------- */
// The pattern stated once, then what it does, then where it goes
// wrong. The last part is what people actually keep the sheet for.
function grammar(s, L) {
  return '<section><h2>' + esc(L.pattern) + '</h2>' +
    '<table class="forms"><tbody>' + list(s.forms).map((f) =>
      '<tr><td><div class="word" lang="ko">' + prose(f.form) + '</div>' +
      (f.when ? '<div class="rom">' + prose(f.when) + '</div>' : '') + '</td>' +
      '<td>' + prose(f.means) + '</td>' +
      '<td><div class="ex-kr" lang="ko">' + markedHTML(f.example, f.mark) + '</div>' +
      (f.exampleMeaning ? '<div class="ex-tr">' + esc(f.exampleMeaning) + '</div>' : '') +
      '</td></tr>').join('') + '</tbody></table></section>' +
    (list(s.watchOut).length
      ? '<section><h2>' + esc(L.watchOut) + '</h2>' +
        // The wrong form and the right one, underlined: "맛있은 음식 (X) → 맛있는 음식 (O)".
        list(s.watchOut).map((w, i) => '<div class="note" style="margin-bottom:8px">' +
          keepEndings(markedHTML(w, list(s.watchOutMark)[i])) + '</div>').join('') +
        '</section>'
      : '') +
    practice(s, L);
}

/* ---- real-life --------------------------------------------------- */
// A situation, played out. Who says what has to be readable at a
// glance, so it is a dialogue rather than a paragraph.
function reallife(s, L) {
  return (s.setting ? '<section><div class="note">' + esc(s.setting) + '</div></section>' : '') +
    '<section><h2>' + esc(L.dialogue) + '</h2>' +
    list(s.dialogue).map((t) =>
      '<div class="turn"><div class="who">' + esc(t.who) + '</div>' +
      '<div class="said"><div class="ex-kr" lang="ko">' + esc(t.korean) + '</div>' +
      (t.meaning ? '<div class="ex-tr">' + esc(t.meaning) + '</div>' : '') + '</div></div>').join('') +
    '</section>' +
    (list(s.words).length
      ? '<section><h2>' + esc(L.phrases) + '</h2>' + wordRows(s.words, [L.phrase, L.meaning, L.inUse]) + '</section>'
      : '') +
    practice(s, L);
}

/* ---- hangul ------------------------------------------------------ */
// Mostly empty space on purpose: this one is printed and written on.
// The boxes are square because Hangul is written in squares.
function hangul(s, L) {
  return '<section><h2>' + esc(L.letters) + '</h2>' +
    '<table class="letters"><thead><tr><th style="width:26%">' + esc(L.letter) + '</th><th>' + esc(L.sound) +
    '</th><th>' + esc(L.practice) + '</th></tr></thead><tbody>' +
    list(s.letters).map((l) =>
      '<tr><td><div class="word" lang="ko" style="font-size:24px">' + esc(l.letter) + '</div></td>' +
      '<td><div class="sound">' + soundHTML(l.sound) + '</div>' + (l.as ? '<div class="rom">' + esc(l.as) + '</div>' : '') + '</td>' +
      '<td><div class="boxes">' + '<div class="box"></div>'.repeat(8) + '</div></td></tr>').join('') +
    '</tbody></table></section>' +
    (list(s.words).length
      ? '<section><h2>' + esc(L.nowTheWords) + '</h2>' + wordRows(s.words, [L.word, L.meaning, L.inUse]) + '</section>'
      : '') +
    practice(s, L);
}

/* ---- everything else --------------------------------------------- */
// The catch-all has no shape of its own, so it takes whatever blocks
// the sheet happens to carry.
function etc(s, L) {
  return (list(s.words).length
      ? '<section><h2>' + esc(L.words) + '</h2>' + wordRows(s.words, [L.word, L.meaning, L.inUse]) + '</section>'
      : '') +
    list(s.sections).map((sec) =>
      '<section><h2>' + esc(sec.heading) + '</h2>' + flowSteps(sec.steps) + itemRows(sec.items) +
      (sec.box && list(sec.paragraphs).length
        ? '<div class="tip-box">' + list(sec.paragraphs).map((p) => '<p>' + prose(p) + '</p>').join('') + '</div>'
        : list(sec.paragraphs).map((p) => '<p>' + esc(p) + '</p>').join('')) +
      (sec.note ? '<div class="note">' + esc(sec.note) + '</div>' : '') + '</section>').join('') +
    (s.note ? '<section><div class="note">' + esc(s.note) + '</div></section>' : '') +
    practice(s, L);
}

// A process at a glance: numbered steps left to right, joined by arrows
// (the owner's kiosk sheet). One block — never split over a page.
function flowSteps(steps) {
  if (!list(steps).length) return '';
  return '<div class="flow">' + list(steps).map((st, i) =>
    (i ? '<span class="flow-arrow">→</span>' : '') +
    '<div class="flow-step"><span class="flow-n">' + (i + 1) + '</span><div class="flow-card"><b>' + esc(st.ko) + '</b>' +
    (st.en ? '<span>(' + esc(st.en) + ')</span>' : '') + '</div></div>').join('') + '</div>';
}

// Numbered rows, one column: the Korean term (and what it is called in
// the reader's language), a rule, then what it does and an example.
function itemRows(items) {
  if (!list(items).length) return '';
  return '<div class="rows">' + list(items).map((it, i) =>
    '<div class="row"><span class="row-n">' + (i + 1) + '</span>' +
    '<div class="row-term"><b>' + esc(it.term) + '</b>' + (it.gloss ? ' <span>(' + esc(it.gloss) + ')</span>' : '') + '</div>' +
    '<div class="row-text">' + prose(it.text) + (it.example ? ' <span class="row-ex">예: ' + esc(it.example) + '</span>' : '') + '</div>' +
    '</div>').join('') + '</div>';
}

// The part the learner fills in. Shared, because every shelf has one —
// a sheet with nothing to do on it is a reference card, not a
// worksheet.
function practice(s, L) {
  const qs = list(s.exercises);
  if (!qs.length) return '';
  // What the questions ask the learner to do, said once above them —
  // "Choose the right word". Optional; the owner's design shows it.
  const task = s.task && s.task.title && L.design === 'v2'
    ? '<div class="task"><span class="obj-icon">' + SPROUT + '</span><div><b>' + esc(s.task.title) + '</b>' +
      (s.task.line ? '<span>' + esc(s.task.line) + '</span>' : '') + '</div></div>'
    : '';
  return '<section><h2>' + esc(L.yourTurn) + '</h2>' + task +
    qs.map((q, i) => question(typeof q === 'string' ? q : q.ask, i,
      (typeof q === 'object' && q.lines) || 1, L.design, typeof q === 'object' ? q.items : null)).join('') +
    '</section>';
}

export const TEMPLATES = { vocab, reading, grammar, reallife, hangul, etc };

export function bodyFor(category, sheet, labels) {
  const make = TEMPLATES[category] || TEMPLATES.etc;
  return make(sheet, labels);
}
