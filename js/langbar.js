// DURU KOREAN — "this page exists in your language"
//
// Load after js/i18n.js on every page.
//
// The language switcher in the header is the one control a visitor has
// to use while the page is in a language they cannot read. That is a
// bad position to put anyone in: they have to recognise a globe, guess
// what it does, open it, and find their own language in a list — all
// without a single word of help they can read.
//
// They do not have to. The browser already says which languages its
// owner reads, in `navigator.languages`, because they typed it into
// their own settings. So the site offers first, in their language, and
// they never have to find anything.
//
// ── Three rules ────────────────────────────────────────────────────
//
// 1. Offer, never impose. A Korean-American with a Korean phone may
//    want the English site; switching under them takes that choice
//    away. The bar proposes and waits.
//
// 2. The offer is written in the visitor's language, not the page's.
//    That is the entire point, and it is why these sentences live here
//    as a fixed table rather than going through the site dictionary —
//    the dictionary translates into the language on screen, which is
//    precisely the one they cannot read.
//
// 3. Once. Any answer — yes, no, or the close button — is remembered,
//    and the bar never appears again.
//
// This is not an IP or country guess. js/i18n.js says in so many words
// that a country guess is never part of choosing a language, and it is
// right: an address says where a request came from, which a VPN, a
// holiday or an expatriate life makes meaningless. `navigator.languages`
// is not a guess at all. It is a statement the visitor typed.

(function () {
  'use strict';

  var DISMISSED_KEY = 'duru_langbar_seen';
  var STORAGE_KEY = 'duru_lang';       // the same key js/i18n.js writes

  // What the offer says, in each language it is offered in. English is
  // absent on purpose: an English-speaking visitor already has the
  // site in English, and there is nothing to offer them.
  var OFFERS = {
    vi: { line: 'Trang này có bản tiếng Việt.', go: 'Xem bằng tiếng Việt' },
    es: { line: 'Esta página está disponible en español.', go: 'Ver en español' },
    id: { line: 'Halaman ini tersedia dalam Bahasa Indonesia.', go: 'Lihat dalam Bahasa Indonesia' },
    'pt-BR': { line: 'Esta página está disponível em português.', go: 'Ver em português' },
    ko: { line: '이 페이지는 한국어로도 볼 수 있습니다.', go: '한국어로 보기' },
    ja: { line: 'このサイトは日本語でご覧いただけます。', go: '日本語で見る' },
    zh: { line: '本站有中文版。', go: '用中文浏览' }
  };

  // A browser says "pt-PT", "zh-Hant-TW", "en-GB". Only the part before
  // the first dash is reliable, so the base is what is matched on —
  // with two exceptions the site has made a choice about: it publishes
  // one Portuguese (Brazilian) and one Chinese (simplified), and a
  // reader of either variety is better served by that than by English.
  function toSiteLang(tag) {
    var raw = String(tag || '').toLowerCase();
    var base = raw.split('-')[0];
    if (base === 'pt') return 'pt-BR';
    if (base === 'zh') return 'zh';
    if (OFFERS[base]) return base;
    if (base === 'en') return 'en';
    return null;
  }

  // The first language the visitor listed that this site publishes.
  // Their order is their preference, so it is kept.
  function preferred() {
    var list = [];
    try {
      list = (navigator.languages && navigator.languages.length)
        ? navigator.languages
        : [navigator.language || navigator.userLanguage];
    } catch (e) { return null; }
    for (var i = 0; i < list.length; i += 1) {
      var code = toSiteLang(list[i]);
      if (code) return code;
    }
    return null;
  }

  function seen() {
    try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch (e) { return false; }
  }

  function remember() {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch (e) {}
  }

  function chosenBefore() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
  }

  function askedFor() {
    try { return !!new URLSearchParams(window.location.search).get('lang'); } catch (e) { return false; }
  }

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var out = window.DURU_I18N.t(key);
    return out === key ? fallback : out;
  }

  function labelOf(code) {
    var langs = (window.DURU_I18N && window.DURU_I18N.LANGS) || [];
    for (var i = 0; i < langs.length; i += 1) {
      if (langs[i].code === code) return langs[i].label;
    }
    return code;
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function build(code) {
    var offer = OFFERS[code];
    var here = (window.DURU_I18N && window.DURU_I18N.lang) || 'en';

    var bar = document.createElement('div');
    bar.className = 'langbar';
    bar.id = 'langBar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', offer.line);
    bar.innerHTML =
      '<div class="langbar-in">' +
        '<span class="langbar-mark" aria-hidden="true">文A</span>' +
        '<span class="langbar-line" lang="' + escapeHTML(code) + '">' +
          escapeHTML(offer.line) + '</span>' +
        '<button type="button" class="langbar-go" id="langBarGo" lang="' + escapeHTML(code) + '">' +
          escapeHTML(offer.go) + '</button>' +
        '<button type="button" class="langbar-stay" id="langBarStay">' +
          // In the language on screen, because this is the one line
          // meant for someone who is content with what they are seeing.
          escapeHTML(t('langbar.stay', 'Stay in {lang}').replace('{lang}', labelOf(here))) +
        '</button>' +
        '<button type="button" class="langbar-x" id="langBarClose" aria-label="' +
          escapeHTML(t('langbar.close', 'Close')) + '">&times;</button>' +
      '</div>';

    document.body.insertBefore(bar, document.body.firstElementChild);

    function close() {
      remember();
      bar.remove();
    }

    document.getElementById('langBarGo').addEventListener('click', function () {
      remember();
      bar.remove();
      if (window.DURU_I18N && window.DURU_I18N.setLang) window.DURU_I18N.setLang(code);
    });
    document.getElementById('langBarStay').addEventListener('click', close);
    document.getElementById('langBarClose').addEventListener('click', close);
  }

  function maybeShow() {
    if (document.getElementById('langBar')) return;
    // Four ways to have already answered the question.
    if (seen() || chosenBefore() || askedFor()) return;

    var want = preferred();
    if (!want || !OFFERS[want]) return;          // English, or a language we do not publish
    var here = (window.DURU_I18N && window.DURU_I18N.lang) || 'en';
    if (want === here) return;                    // already looking at it

    build(want);
  }

  function start() {
    // js/i18n.js announces itself when the first dictionary lands. Until
    // then `lang` is a placeholder, and asking "is this already their
    // language?" would get the wrong answer.
    if (window.DURU_I18N && window.DURU_I18N.ready) { maybeShow(); return; }
    document.addEventListener('duru:langchange', function once() {
      document.removeEventListener('duru:langchange', once);
      maybeShow();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // For the test, and for an admin who wants to see it again.
  window.DURU_LANGBAR = {
    OFFERS: OFFERS,
    toSiteLang: toSiteLang,
    preferred: preferred,
    reset: function () {
      try { localStorage.removeItem(DISMISSED_KEY); } catch (e) {}
    }
  };
})();
