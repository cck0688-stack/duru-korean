// DURU KOREAN — which language is this written in?
//
// Load before js/stories.js. Used in one place: the composer, to fill
// in the language field while someone types, so that in the ordinary
// case they never have to think about it. It is a starting guess and
// the writer can always override it — which is why a small honest
// heuristic is the right size of tool here, rather than a model call
// on every keystroke.
//
// ── How it decides ────────────────────────────────────────────────
//
// Writing systems settle most of it outright. Hangul is Korean, kana is
// Japanese, and Han characters with no kana and no Hangul are Chinese.
// Nothing else on this site is written in those scripts, so one
// character is enough.
//
// The Latin languages are the hard part, and they are separated in two
// passes. First the letters: Vietnamese, Spanish and Portuguese each
// use marks the others do not (ệ, ñ, ã), which is usually decisive in a
// sentence or two. Then, only if the letters say nothing, the words —
// a short list of the ones that appear in almost any paragraph.
//
// ── When it says nothing ──────────────────────────────────────────
//
// It returns null rather than guessing at "hi" or "ok". The caller
// falls back to the language the site is being read in, which is the
// better guess anyway: someone reading in Vietnamese is probably about
// to write in Vietnamese.

(function () {
  'use strict';

  var HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
  var KANA = /[぀-ゟ゠-ヿ]/;
  var HAN = /[㐀-䶿一-鿿]/;

  // Letters only one of these languages writes with. Vietnamese is the
  // easiest to be sure of — it stacks two marks on one vowel, which no
  // other language here does.
  var MARKS = [
    { code: 'vi', re: /[ăâđêôơư]|[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i },
    { code: 'pt-BR', re: /[ãõ]|ç[aou]/i },
    { code: 'es', re: /[ñ¿¡]/ }
  ];

  // Words common enough to appear in almost any paragraph, and rare or
  // absent in the others. Scored, not matched: one shared word should
  // not outvote three that disagree.
  var WORDS = {
    en: ['the', 'and', 'is', 'to', 'of', 'in', 'it', 'you', 'that', 'for', 'have', 'with', 'this', 'but'],
    id: ['yang', 'dan', 'saya', 'tidak', 'untuk', 'dengan', 'ini', 'itu', 'ada', 'bisa', 'juga', 'kalau', 'sudah', 'akan'],
    es: ['que', 'de', 'la', 'el', 'en', 'los', 'una', 'por', 'con', 'para', 'pero', 'como', 'muy', 'cuando'],
    'pt-BR': ['que', 'de', 'não', 'uma', 'com', 'para', 'mas', 'como', 'muito', 'quando', 'você', 'está', 'são', 'também'],
    vi: ['và', 'là', 'của', 'có', 'không', 'được', 'trong', 'người', 'này', 'cho', 'một', 'những', 'tôi', 'rất']
  };

  function words(text) {
    return String(text || '').toLowerCase().split(/[^0-9a-zà-ỹ]+/i).filter(Boolean);
  }

  function byWords(text) {
    var list = words(text);
    if (list.length < 4) return null;          // too short to count anything
    var seen = Object.create(null);
    list.forEach(function (w) { seen[w] = true; });

    var best = null;
    var bestScore = 0;
    var runnerUp = 0;
    Object.keys(WORDS).forEach(function (code) {
      var score = WORDS[code].filter(function (w) { return seen[w]; }).length;
      if (score > bestScore) { runnerUp = bestScore; bestScore = score; best = code; }
      else if (score > runnerUp) { runnerUp = score; }
    });
    // A tie is not an answer. Spanish and Portuguese share "que", "de",
    // "como" — if that is all there is, say nothing.
    if (bestScore < 2 || bestScore === runnerUp) return null;
    return best;
  }

  function detect(text) {
    var s = String(text || '');
    if (!s.trim()) return null;
    if (HANGUL.test(s)) return 'ko';
    if (KANA.test(s)) return 'ja';
    if (HAN.test(s)) return 'zh';

    for (var i = 0; i < MARKS.length; i += 1) {
      if (MARKS[i].re.test(s)) return MARKS[i].code;
    }
    return byWords(s);
  }

  // A fingerprint of the text a translation was made from, so that an
  // edited post stops showing the translation of what it used to say.
  //
  // FNV-1a, 32 bits, as eight hex characters. It is not a security
  // hash and is not asked to be one — nothing is trusted because it
  // matches, it only stops a stale entry being used. The same function
  // exists in api/community-translate.js, because that side runs in
  // Node and cannot load this file; test_community_mt.mjs compares the
  // two against a list of strings so they cannot drift apart.
  function hashText(text) {
    var s = String(text == null ? '' : text);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  window.DURU_LANGDETECT = { detect: detect, hashText: hashText };
})();
