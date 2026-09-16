// DURU KOREAN — lightweight i18n engine (homepage scope for now)
//
// Elements are translated via data-i18n="key" (textContent) or
// data-i18n-html="key" (innerHTML, for the rare string with inline markup).
// Anything marked class="kr" is Korean example text and is never touched —
// same for the logo and, on pages that have them, real personal names.
(function () {
  'use strict';

  var STORAGE_KEY = 'duru_lang';
  var DEFAULT_LANG = 'en';
  var LANGS = [
    { code: 'en', label: 'English' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'ko', label: '한국어' }
  ];

  var dictCache = {};

  function getStoredLang() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v && LANGS.some(function (l) { return l.code === v; })) return v;
    } catch (e) {}
    return DEFAULT_LANG;
  }

  function setStoredLang(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
  }

  function loadDict(code) {
    if (dictCache[code]) return Promise.resolve(dictCache[code]);
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

  function applyDict(dict) {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key] != null) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (dict[key] != null) el.innerHTML = dict[key];
    });
  }

  function setLang(code, opts) {
    opts = opts || {};
    document.documentElement.setAttribute('lang', code);
    return loadDict(code).then(function (dict) {
      applyDict(dict);
      if (opts.persist !== false) setStoredLang(code);
      updateSwitcherUI(code);
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
    var lang = getStoredLang();
    buildSwitcher(lang);
    setLang(lang, { persist: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
