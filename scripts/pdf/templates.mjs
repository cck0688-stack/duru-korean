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
function question(text, i, lines = 1, design, items, opts = {}) {
  // The owner's design sets the number in a disc, where "1)" reads as a typo.
  // A question with parts (① … ② …) lists each part on its own line
  // under the instruction (the owner's kiosk sheet, 2026-09-26); `plain`
  // parts are lines without a number. `write` leaves a line to answer on.
  const parts = list(items).length
    ? '<div class="q-parts">' + list(items).map((it, j) =>
        '<div class="q-part">' + (opts.plain ? '' : '<span class="q-pn">' + String.fromCharCode(0x2460 + j) + '</span>') + esc(it) + '</div>').join('') + '</div>'
    : '';
  const rules = opts.write ? Math.max(1, lines) : lines;
  return '<div class="q' + (rules > 1 || opts.write ? ' q-lines' : '') + (parts ? ' q-multi' : '') + '"><div class="q-ask"><span class="n">' + (i + 1) +
    (design === 'v2' ? '' : ')') + '</span>' +
    (parts ? '<div class="q-body"><div>' + esc(text) + '</div>' + parts + '</div>' : esc(text)) + '</div>' +
    '<div class="rule"></div>'.repeat(Math.max(1, rules)) + '</div>';
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
  // A long glossary may be split where the owner's design breaks it:
  // the rest continues under the same number, "(continued)".
  const words = list(s.words);
  const cut = s.wordsBreak > 0 && s.wordsBreak < words.length ? s.wordsBreak : words.length;
  const heads = [L.word, L.meaning, L.inUse];
  return '<section><h2>' + esc(L.passage) + '</h2>' +
    '<div class="passage' + (s.passageBox ? ' passage-box' : '') + '" lang="ko">' +
    list(s.passage).map((p) => '<p>' + esc(p) + '</p>').join('') +
    '</div></section>' +
    (words.length
      ? '<section><h2>' + esc(L.glossary) + '</h2>' + wordRows(words.slice(0, cut), heads) + '</section>' +
        (cut < words.length
          ? '<section class="continued"><h2>' + esc(L.glossary) + ' <small>(' + esc(s.continuedLabel || 'continued') + ')</small></h2>' +
            wordRows(words.slice(cut), heads) + '</section>'
          : '')
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
    // A long heading is set a size smaller so it stays on one line; a
    // section may be one outlined card (the owner's signs sheet).
    list(s.sections).map((sec) => '<section' + (sec.card ? ' class="sec-card"' : '') + '>' +
      '<h2' + (String(sec.heading || '').length > 34 ? ' class="long"' : '') + '>' + esc(sec.heading) + '</h2>' +
      (sec.card ? '<div class="card-body">' + sectionBody(sec) + '</div>' : sectionBody(sec)) + '</section>').join('') +
    (s.note ? '<section><div class="note">' + esc(s.note) + '</div></section>' : '') +
    practice(s, L);
}

// What a section of the catch-all shelf may hold (the owner's designs,
// 2026-09-26): a line of introduction, a real-life screen or document,
// a flow of steps, rows of words or labels, numbered points, cards,
// panels, a tip in a box (with a side note), an example bar and a note.
// Each is used only when the content carries it.
function sectionBody(sec) {
  const box = !!sec.box;
  const paras = list(sec.paragraphs);
  const intro = box ? '' : paras.map((p) => '<p>' + esc(p) + '</p>').join('');
  const boxed = box && paras.length
    ? '<div class="tip-box">' + paras.map((p) => '<p>' + prose(p) + '</p>').join('') + '</div>'
    : '';
  return intro + screenBlock(sec.screen) + flowSteps(sec.steps) + itemRows(sec.items, sec) + pointRows(sec.points) +
    docBlock(sec.doc) + cardsBlock(sec.cards) + list(sec.panels).map(panelBlock).join('') +
    (sec.aside ? '<div class="duo">' + boxed + asideBlock(sec.aside) + '</div>' : boxed) +
    (sec.example ? '<div class="ex-bar"><b>예:</b> <span lang="ko">' + esc(sec.example.ko) + '</span>' +
      (sec.example.en ? ' <span class="ex-bar-tr">(' + esc(sec.example.en) + ')</span>' : '') + '</div>' : '') +
    (sec.note ? '<div class="note">' + prose(sec.note) + '</div>' : '');
}

// A process at a glance: numbered steps left to right, joined by arrows
// (the owner's kiosk sheet). One block — never split over a page.
function flowSteps(steps) {
  if (!list(steps).length) return '';
  return '<div class="flow">' + list(steps).map((st, i) =>
    (i ? '<span class="flow-arrow">→</span>' : '') +
    '<div class="flow-step"><span class="flow-n">' + (i + 1) + '</span><div class="flow-card"><b>' + esc(st.ko) + '</b>' +
    (st.en && st.en !== st.ko ? '<span>(' + esc(st.en) + ')</span>' : '') + '</div></div>').join('') + '</div>';
}

// Rows of words, labels or buttons, one column: the Korean (with its
// romanisation or its name in the reader's language), then what it is.
// Numbered unless the section says `numbered: false`; the term set on a
// tinted label when `pill` is 'sage' or 'pink'; "= meaning" when the
// section `define`s; an example inline ("예: …") or, with a
// translation, on a line of its own.
function itemRows(items, sec = {}) {
  if (!list(items).length) return '';
  const numbered = sec.numbered !== false;
  const cls = ['rows', numbered ? 'rows-n' : 'rows-plain', sec.pill ? 'pill-' + sec.pill : '', sec.define ? 'rows-def' : '',
    sec.romanBelow ? 'rows-rb' : ''].filter(Boolean).join(' ');
  return '<div class="' + cls + '">' + list(items).map((it, i) =>
    '<div class="row">' + (numbered ? '<span class="row-n">' + (i + 1) + '</span>' : '') +
    '<div class="row-term"><b lang="ko">' + esc(it.term) + '</b>' +
      (it.roman ? (sec.romanBelow ? '<span class="row-rom">(' + esc(it.roman) + ')</span>' : ' <span class="row-rom">(' + esc(it.roman) + ')</span>') : '') +
      (it.gloss && it.gloss !== it.term ? ' <span>(' + esc(it.gloss) + ')</span>' : '') + '</div>' +
    '<div class="row-text">' + (sec.define ? '= ' : '') + prose(it.text) +
      (it.example && it.exampleMeaning
        ? '<span class="row-exl"><span lang="ko">' + esc(it.example) + '</span> <span class="row-ex">(' + esc(it.exampleMeaning) + ')</span></span>'
        : (it.example ? ' <span class="row-ex">예: ' + esc(it.example) + '</span>' : '')) + '</div>' +
    '</div>').join('') + '</div>';
}

// Numbered points: "① 요일 확인: Is that day a 휴무?" — the lead in bold.
function pointRows(points) {
  if (!list(points).length) return '';
  return '<div class="rows rows-n rows-points">' + list(points).map((pt, i) =>
    '<div class="row"><span class="row-n">' + (i + 1) + '</span><div class="row-text"><b lang="ko">' + esc(pt.lead) + '</b> ' +
    prose(pt.text) + '</div></div>').join('') + '</div>';
}

// A real-life document — a notice, a shop sign — drawn simply: a title
// bar and label/value lines. `tone` colours the bar. Never split.
function docBlock(doc) {
  if (!doc) return '';
  return '<div class="doc doc-' + esc(doc.tone || 'green') + '" lang="ko">' +
    (doc.title ? '<div class="doc-title">' + esc(doc.title) + '</div>' : '') +
    '<div class="doc-rows">' + list(doc.rows).map((r) =>
      '<div class="doc-row"><span class="doc-label">' + esc(r.label) + '</span><span class="doc-value">' +
      String(r.value == null ? '' : r.value).split('\n').map(esc).join('<br>') + '</span></div>').join('') + '</div></div>';
}

const ICONS = {
  sun: '<svg viewBox="0 0 24 24" class="ic ic-sun"><circle cx="12" cy="12" r="5"/><g stroke-width="2" stroke-linecap="round"><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></g></svg>',
  rain: '<svg viewBox="0 0 24 24" class="ic ic-rain"><path d="M7 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 7.5a3.8 3.8 0 0 1-.5 7.5z"/><g stroke-width="1.8" stroke-linecap="round"><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></g></svg>',
  umbrella: '<svg viewBox="0 0 24 24" class="ic ic-umbrella"><path d="M2.5 12a9.5 9.5 0 0 1 19 0z"/><path d="M12 12v7a2 2 0 0 1-4 0" fill="none" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mask: '<svg viewBox="0 0 24 24" class="ic ic-mask"><rect x="5" y="7" width="14" height="10" rx="4"/><path d="M5 10H2.5M5 14H2.5M19 10h2.5M19 14h2.5M8 11h8M8 13.5h8" fill="none" stroke-width="1.4" stroke-linecap="round"/></svg>'
};

// A phone screen with the day's values: a row per day, each value under
// its label; a level (good / normal / bad) sets a coloured badge.
function screenBlock(sc) {
  if (!sc) return '';
  return '<div class="screen" lang="ko">' + list(sc.rows).map((r) =>
    '<div class="scr-row"><span class="scr-day scr-' + esc(r.tone || 'pink') + '">' + esc(r.head) + '</span>' +
    '<span class="scr-sky">' + (ICONS[r.icon] || '') + '<b>' + esc(r.sky || '') + '</b></span>' +
    list(r.cells).map((c) => '<span class="scr-cell"><small>' + esc(c.label) + '</small>' +
      (c.level ? '<span class="badge badge-' + esc(c.level) + '">' + esc(c.value) + '</span>' : '<b>' + esc(c.value) + '</b>') + '</span>').join('') +
    '</div>').join('') + '</div>';
}

// Two rule cards side by side, each with its example answer.
function cardsBlock(cards) {
  if (!list(cards).length) return '';
  return '<div class="cards">' + list(cards).map((c) =>
    '<div class="card">' + '<div class="card-top">' + (ICONS[c.icon] ? '<span class="card-ic">' + ICONS[c.icon] + '</span>' : '') +
    '<div><b>' + esc(c.title) + '</b><span>' + prose(c.text) + '</span></div></div>' +
    (c.example ? '<div class="card-ex" lang="ko">' + String(c.example).split('\n').map(esc).join('<br>') + '</div>' : '') +
    '</div>').join('') + '</div>';
}

// A titled panel: model answers as bullets, or one quoted line.
function panelBlock(pn) {
  return '<div class="panel panel-' + esc(pn.style || 'bullets') + '"><b class="panel-title">' + esc(pn.title) + '</b>' +
    list(pn.lines).map((l) => '<div class="panel-line" lang="ko">' + esc(l) + '</div>').join('') + '</div>';
}

// A note set beside a tip: "Pronunciation notes".
function asideBlock(a) {
  return '<div class="aside"><b>' + esc(a.title) + '</b>' + list(a.lines).map((l) => '<p>' + prose(l) + '</p>').join('') + '</div>';
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
    // A line of instruction with no title: a plain bar (the weather sheet).
    : (s.task && s.task.line && L.design === 'v2' ? '<div class="task task-line">' + esc(s.task.line) + '</div>' : '');
  return '<section><h2>' + esc(L.yourTurn) + '</h2>' + task +
    qs.map((q, i) => {
      const own = typeof q === 'object' ? q : withParts(q);
      return question(own.ask, i, own.lines || 1, L.design, own.items, { plain: own.plain, write: own.write });
    }).join('') +
    '</section>';
}

// "Read and answer: ① 카드가 없어요. … ② 체크카드로 …" — the instruction,
// then each part on its own line (the owner's kiosk design). Only a
// question with at least ① and ② is split; anything else stays whole.
function withParts(text) {
  const t = String(text == null ? '' : text);
  const at = t.search(/\s①\s?/);
  if (at < 0 || !/②/.test(t.slice(at))) return { ask: t };
  const parts = t.slice(at).split(/\s*[①-⑳]\s*/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? { ask: t.slice(0, at).trim(), items: parts } : { ask: t };
}

export const TEMPLATES = { vocab, reading, grammar, reallife, hangul, etc };

export function bodyFor(category, sheet, labels) {
  const make = TEMPLATES[category] || TEMPLATES.etc;
  return make(sheet, labels);
}
