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
// Writing systems settle most of it, by share rather than by presence.
// Learners quote Korean all the time — a Vietnamese post about the word
// "그리움" is still Vietnamese — so one Hangul character used to be
// enough to call a post Korean, and was wrong on exactly the posts this
// site exists for. Now a script decides only when it makes up a good
// part of the letters: Hangul is Korean, kana (with the Han characters
// around it) is Japanese, Han with no kana is Chinese. Otherwise the
// Latin passes below decide, and the quoted Korean is ignored.
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
  var LETTER = /[A-Za-zÀ-ɏḀ-ỿ]/;

  // Letters only one of these languages writes with. Vietnamese is the
  // easiest to be sure of — it stacks two marks on one vowel, which no
  // other language here does.
  var MARKS = [
    // â, ê and ô are left out: Portuguese writes them too (você, câmera).
    { code: 'vi', re: /[ăđơư]|[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i },
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
    var letters = 0, hangul = 0, kana = 0, han = 0;
    for (var c = 0; c < s.length; c += 1) {
      var ch = s.charAt(c);
      if (HANGUL.test(ch)) hangul += 1;
      else if (KANA.test(ch)) kana += 1;
      else if (HAN.test(ch)) han += 1;
      else if (!LETTER.test(ch)) continue;
      letters += 1;
    }
    if (!letters) return null;
    var enough = letters * 0.4;
    if (kana && kana + han >= enough) return 'ja';
    if (hangul >= enough) return 'ko';
    if (han >= enough && !kana) return 'zh';

    // The Latin passes look at the text with the quoted Korean, Japanese
    // or Chinese taken out, so it cannot tip them either way.
    var latin = s.replace(/[가-힣ᄀ-ᇿ㄰-㆏぀-ゟ゠-ヿ㐀-䶿一-鿿]+/g, ' ');
    for (var i = 0; i < MARKS.length; i += 1) {
      if (MARKS[i].re.test(latin)) return MARKS[i].code;
    }
    var found = byWords(latin);
    if (found) return found;
    // Nothing in the Latin part says which; a script that is there at
    // all is still the best remaining guess.
    if (hangul) return 'ko';
    if (kana) return 'ja';
    if (han) return 'zh';
    return null;
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
