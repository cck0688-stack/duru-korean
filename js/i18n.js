// DURU KOREAN — site-wide i18n engine
//
// LANGS below is the whole list: its order is the order of the picker,
// and each code names a dictionary at js/i18n/<code>.json.
//
// Elements are translated via data-i18n="key" (textContent) or
// data-i18n-html="key" (innerHTML, for the rare string with inline markup).
// Anything marked class="kr" is Korean example text and is never touched —
// same for the logo, author personal names, and the blog category glyphs
// (앎/말/삶/길), which are marked aria-hidden and never carry data-i18n.
//
// Load this script AFTER js/auth.js and js/resources.js on every page: both
// inject markup with data-i18n attributes synchronously on DOMContentLoaded,
// and this engine's own DOMContentLoaded listener (registered later, so it
// runs later) does the first translation pass — by then that markup already
// exists. Later language switches re-scan the live DOM, so anything added
// after that (e.g. a lazily-built modal) just needs to call
// window.DURU_I18N.apply() once right after inserting itself.
(function () {
  'use strict';

  var STORAGE_KEY = 'duru_lang';
  var DEFAULT_LANG = 'en';
  var LANGS = [
    { code: 'en', label: 'English' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'es', label: 'Español' },
    { code: 'id', label: 'Bahasa Indonesia' },
    { code: 'pt-BR', label: 'Português (BR)' },
    { code: 'ko', label: '한국어' },
    { code: 'ja', label: '日本語' },
    { code: 'zh', label: '中文' }
  ];
  var VALID_CODES = LANGS.map(function (l) { return l.code; });

  var dictCache = {};
  var currentLang = DEFAULT_LANG;
  var currentDict = {};

  function isValidLang(code) {
    return VALID_CODES.indexOf(code) !== -1;
  }

  function getUrlLang() {
    try {
      var params = new URLSearchParams(window.location.search);
      var v = params.get('lang');
      return isValidLang(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function getStoredLang() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (isValidLang(v)) return v;
    } catch (e) {}
    return null;
  }

  function setStoredLang(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
  }

  function loadDict(code) {
    if (dictCache[code]) return Promise.resolve(dictCache[code]);
    // Relative path — works under a GitHub Pages project subpath too,
    // since every page here already lives at the site root.
    return fetch('js/i18n/' + code + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('i18n fetch failed: ' + code);
        return r.json();
      })
      .then(function (dict) {
        dictCache[code] = dict;
        return dict;
      })
      .catch(function () {
        return {};
      });
  }

  function applyDict(dict, root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key] != null) el.textContent = dict[key];
    });
    scope.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (dict[key] != null) el.innerHTML = dict[key];
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (dict[key] != null) el.setAttribute('placeholder', dict[key]);
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria-label');
      if (dict[key] != null) el.setAttribute('aria-label', dict[key]);
    });
    if (scope === document && window.DURU_PAGE_TITLE_KEY && dict[window.DURU_PAGE_TITLE_KEY]) {
      document.title = dict[window.DURU_PAGE_TITLE_KEY];
    }
  }

  function t(key) {
    if (currentDict[key] != null) return currentDict[key];
    if (dictCache[DEFAULT_LANG] && dictCache[DEFAULT_LANG][key] != null) return dictCache[DEFAULT_LANG][key];
    return key;
  }

  function setLang(code, opts) {
    opts = opts || {};
    document.documentElement.setAttribute('lang', code);
    return loadDict(code).then(function (dict) {
      currentLang = code;
      currentDict = dict;
      applyDict(dict, document);
      if (opts.persist !== false) setStoredLang(code);
      updateSwitcherUI(code);
      window.DURU_I18N.lang = code;
      document.dispatchEvent(new CustomEvent('duru:langchange', { detail: { lang: code } }));
    });
  }

  var switcherRoot, trigger, menu, currentLabelEl;

  function buildSwitcher(initialCode) {
    switcherRoot = document.getElementById('langSwitcher');
    if (!switcherRoot) return;

    switcherRoot.innerHTML =
      '<button type="button" class="lang-trigger" id="langTrigger" aria-haspopup="listbox" aria-expanded="false">' +
        '<span class="lang-globe" aria-hidden="true">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z"/></svg>' +
        '</span>' +
        '<span class="lang-current" id="langCurrentLabel"></span>' +
      '</button>' +
      '<ul class="lang-menu" id="langMenu" role="listbox" hidden></ul>';

    trigger = document.getElementById('langTrigger');
    menu = document.getElementById('langMenu');
    currentLabelEl = document.getElementById('langCurrentLabel');

    menu.innerHTML = LANGS.map(function (l) {
      return '<li role="option" data-lang="' + l.code + '" tabindex="-1">' + l.label + '</li>';
    }).join('');

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden ? openMenu() : closeMenu();
    });

    menu.querySelectorAll('li').forEach(function (li) {
      li.addEventListener('click', function () {
        var code = li.getAttribute('data-lang');
        closeMenu();
        setLang(code);
      });
    });

    document.addEventListener('click', function (e) {
      if (!switcherRoot.contains(e.target)) closeMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu();
        trigger.focus();
      }
    });

    updateSwitcherUI(initialCode);
  }

  function openMenu() {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    if (!menu) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function updateSwitcherUI(code) {
    if (!currentLabelEl) return;
    var match = LANGS.filter(function (l) { return l.code === code; })[0];
    currentLabelEl.textContent = match ? match.label : code;
    if (menu) {
      menu.querySelectorAll('li').forEach(function (li) {
        var active = li.getAttribute('data-lang') === code;
        li.setAttribute('aria-selected', active ? 'true' : 'false');
        li.classList.toggle('is-active', active);
      });
    }
  }

  function init() {
    // Priority: explicit ?lang= link (shareable), then a returning
    // visitor's saved choice, then English. A country/IP guess is
    // deliberately never part of this chain.
    var lang = getUrlLang() || getStoredLang() || DEFAULT_LANG;
    buildSwitcher(lang);
    setLang(lang, { persist: !!getUrlLang() || !!getStoredLang() });
  }

  window.DURU_I18N = {
    lang: currentLang,
    t: t,
    apply: function (root) { applyDict(currentDict, root); },
    setLang: setLang,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
