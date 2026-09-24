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

  /* ---------------- Language in the address ----------------
   *
   * Every page exists once, and is reachable under each language:
   * /vi/free-resources.html, /ko/blog, /pt-BR/community and so on
   * (vercel.json serves the same file for all of them). The address is
   * what search engines index and what people share, so it has to say
   * the language — a ?lang= parameter or a choice in localStorage is
   * invisible to both.
   *
   * The plain address without a prefix (/, /blog.html) is the
   * "no language chosen yet" entry: English for a first-time visitor and
   * for crawlers, and the visitor's saved language otherwise, in which
   * case the address is corrected to carry it.
   */
  var LANG_PATH = new RegExp('^/(' + VALID_CODES.map(function (c) {
    return c.replace(/[-]/g, '\\-');
  }).join('|') + ')(?=/|$)');

  function pathLang(path) {
    var m = LANG_PATH.exec(path == null ? window.location.pathname : path);
    return m ? m[1] : null;
  }

  // "/vi/blog/post/x" -> "/blog/post/x"; "/vi" -> "/"; "/index.html" -> "/".
  function barePath(path) {
    var out = String(path || '/').replace(LANG_PATH, '') || '/';
    if (out.charAt(0) !== '/') out = '/' + out;
    return out === '/index.html' ? '/' : out;
  }

  function langPath(path, code) {
    var bare = barePath(path);
    return code ? '/' + code + bare : bare;
  }

  // Pages, not files: links to scripts, styles, pictures, downloads and
  // the api keep the address they were given.
  function isPagePath(path) {
    if (/^\/(api|js|css|assets|supabase|node_modules)(\/|$)/.test(barePath(path))) return false;
    var last = path.split('/').pop();
    return !last || /\.html$/i.test(last) || last.indexOf('.') === -1;
  }

  // The language the links on this page carry: the one in the address,
  // or none on a plain address.
  function linkLang() {
    return pathLang();
  }

  function localizeHref(raw, code) {
    if (!raw || /^(#|mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return null;
    var u;
    try { u = new URL(raw, document.baseURI); } catch (e) { return null; }
    if (u.origin !== window.location.origin || !isPagePath(u.pathname)) return null;
    // An older ?lang= on the link says which language it is for; it
    // becomes the prefix rather than being lost.
    var asked = u.searchParams.get('lang');
    if (isValidLang(asked)) code = asked;
    u.searchParams.delete('lang');
    var path = langPath(u.pathname, code);
    var out = path + u.search + u.hash;
    return out;
  }

  function localizeLinks(root) {
    var code = linkLang();
    var scope = root || document;
    var list = [];
    if (scope.nodeType === 1 && scope.matches && scope.matches('a[href]')) list.push(scope);
    if (scope.querySelectorAll) list = list.concat(Array.prototype.slice.call(scope.querySelectorAll('a[href]')));
    list.forEach(function (a) {
      if (a.hasAttribute('data-no-lang')) return;
      var raw = a.getAttribute('href');
      var next = localizeHref(raw, code);
      if (next != null && next !== raw) a.setAttribute('href', next);
    });
  }

  // Links added later — blog cards, search results, the list of
  // downloads — are put in the page's language as they arrive.
  function watchLinks() {
    if (!window.MutationObserver || !document.body) return;
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        if (r.type === 'attributes') { localizeLinks(r.target); return; }
        r.addedNodes.forEach(function (n) { if (n.nodeType === 1) localizeLinks(n); });
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }

  // Pages that rewrite their own address (a blog shelf, a community
  // topic) build it from the plain path; the language is put back in.
  var rawReplace = window.history && history.replaceState ? history.replaceState.bind(history) : null;

  function wrapHistory() {
    if (!window.history || !history.replaceState) return;
    ['pushState', 'replaceState'].forEach(function (name) {
      var orig = history[name];
      history[name] = function (state, title, url) {
        if (typeof url === 'string' && url) {
          var next = localizeHref(url, linkLang());
          if (next != null) url = next;
        }
        return orig.call(history, state, title, url);
      };
    });
  }

  // Put the chosen language into the address, without a reload, and
  // drop a ?lang= that brought the visitor here.
  function syncAddress(code) {
    var loc = window.location;
    var params = new URLSearchParams(loc.search);
    params.delete('lang');
    var qs = params.toString();
    var next = langPath(loc.pathname, code) + (qs ? '?' + qs : '') + loc.hash;
    if (next !== loc.pathname + loc.search + loc.hash) {
      try { (rawReplace || history.replaceState.bind(history))(history.state, '', next); } catch (e) {}
    }
  }

  // What search engines read: the one address for this page in this
  // language, and every other language's address for it.
  function paintHead(code) {
    var head = document.head;
    if (!head) return;
    Array.prototype.slice.call(head.querySelectorAll('link[data-duru-lang]')).forEach(function (l) { l.remove(); });
    var origin = window.location.origin;
    var params = new URLSearchParams(window.location.search);
    params.delete('lang');
    var qs = params.toString() ? '?' + params.toString() : '';
    var bare = barePath(window.location.pathname);
    function link(rel, href, hreflang) {
      var el = document.createElement('link');
      el.rel = rel; el.href = href; el.setAttribute('data-duru-lang', '');
      if (hreflang) el.hreflang = hreflang;
      head.appendChild(el);
    }
    link('canonical', origin + (pathLang() ? langPath(bare, code) : bare) + qs);
    VALID_CODES.forEach(function (c) { link('alternate', origin + langPath(bare, c) + qs, c); });
    link('alternate', origin + bare + qs, 'x-default');
  }

  // At once, not on page ready: a page may set its own address before then.
  wrapHistory();

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
      // A language someone chose goes into the address; the plain
      // address stays plain only for a first-time visitor on English.
      if (opts.persist !== false || pathLang()) syncAddress(code);
      paintHead(code);
      localizeLinks(document);
      updateSwitcherUI(code);
      window.DURU_I18N.lang = code;
      // Says that `lang` above is a language this engine actually
      // applied, not the placeholder it starts life with. Anything that
      // has to know the visitor's language before the dictionary lands
      // reads the same chain as init() until this turns true.
      window.DURU_I18N.ready = true;
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
    // Priority: the language in the address (/vi/…), then an older
    // ?lang= link, then a returning visitor's saved choice, then English.
    // A country/IP guess is deliberately never part of this chain.
    var fromAddress = pathLang() || getUrlLang();
    var lang = fromAddress || getStoredLang() || DEFAULT_LANG;
    watchLinks();
    buildSwitcher(lang);
    setLang(lang, { persist: !!fromAddress || !!getStoredLang() });
  }

  window.DURU_I18N = {
    lang: currentLang,
    ready: false,
    t: t,
    apply: function (root) { applyDict(currentDict, root); },
    setLang: setLang,
    // The address helpers, for scripts that build links themselves.
    pathLang: function () { return pathLang(); },
    barePath: barePath,
    langPath: langPath,
    url: function (path) { return localizeHref(path, linkLang()) || path; },
    // The languages the site publishes, each under its own name.
    // js/langbar.js needs them to say "Stay in 한국어" rather than
    // "Stay in ko"; a copy, so nothing outside can reorder the list.
    LANGS: LANGS.map(function (l) { return { code: l.code, label: l.label }; })
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
