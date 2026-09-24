// DURU KOREAN — what the community is for
//
// Load before js/stories.js. Exposes window.DURU_COMMUNITY.
//
// The same shape as js/blog-categories.js, and for the same reason: the
// ids live in one file, the names are translated, and nothing else on
// the site keeps a second list that can drift out of step.
//
// Three shelves, because there are three things people come here to do
// — ask something, say something, meet somebody. A fourth would be one
// nobody could tell apart from the others, and an empty shelf reads as
// a dead page.

(function () {
  'use strict';

  // The language in the address this page was opened under (/vi/…), so
  // that the addresses built here stay in it.
  function langPrefix() {
    var m = /^\/(en|ko|vi|es|id|pt-BR|ja|zh)(?=\/|$)/.exec(window.location.pathname);
    return m ? '/' + m[1] : '';
  }

  var CATEGORIES = [
    { id: 'ask' },
    { id: 'share' },
    { id: 'meet' }
  ];

  // Drawn, not fetched — the same three-line SVGs the blog's shelves
  // use, inheriting their stroke from the cards' CSS.
  var ICONS = {
    // a speech bubble with a question mark in it
    ask: '<path d="M20.5 12.5c0 4-3.8 7.2-8.5 7.2a10 10 0 0 1-2.6-.34L4 21l1.3-3.4a6.7 6.7 0 0 1-2.3-5c0-4 3.8-7.2 8.5-7.2s9 3.2 9 7.2Z"/><path d="M9.8 10a2.2 2.2 0 1 1 2.8 2.1c-.5.2-.8.6-.8 1.1v.4"/><path d="M11.8 15.7h.01"/>',
    // two bubbles, one behind the other
    share: '<path d="M16.5 10.5c0 2.8-2.8 5-6.2 5a8 8 0 0 1-1.9-.23L5 16.5l.9-2.4a4.9 4.9 0 0 1-1.6-3.6c0-2.8 2.8-5 6.2-5s6 2.2 6 5Z"/><path d="M17.4 8.6c1.7.8 2.8 2.3 2.8 4 0 1.2-.5 2.3-1.4 3.1l.8 2.2-2.3-1a7.6 7.6 0 0 1-1.8.2 6.9 6.9 0 0 1-3.2-.76"/>',
    // two people
    meet: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M16.2 5.3a3.2 3.2 0 0 1 0 6"/><path d="M17.5 14.2a6 6 0 0 1 3.5 5.3"/>'
  };

  var byId = {};
  CATEGORIES.forEach(function (c) { byId[c.id] = c; });

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  function humanise(id) {
    return String(id || '').charAt(0).toUpperCase() + String(id || '').slice(1);
  }

  window.DURU_COMMUNITY = {
    CATEGORIES: CATEGORIES,
    ids: CATEGORIES.map(function (c) { return c.id; }),
    has: function (id) { return !!byId[id]; },
    icon: function (id) { return ICONS[id] || ICONS.share; },
    label: function (id) { return t('community.cat.' + id, humanise(id)); },
    describe: function (id) { return t('community.cat.' + id + '.desc', ''); },

    // Readable paths — /community/ask — turned back into the query
    // string this page reads by the rewrites in vercel.json. The page
    // is served from two depths, so <base href="/"> on it keeps every
    // relative link and fetch working from either.
    href: function (cat) {
      return langPrefix() + (cat ? '/community/' + encodeURIComponent(cat) : '/community');
    },

    // …and back again. A rewrite happens on the server, so the browser
    // is still sitting on /community/ask with nothing in its query
    // string — the path is where that value actually is. The query
    // string still answers for stories.html?cat=, which is how the page
    // is opened locally and from an older link.
    route: function (pathname, search) {
      // /vi/blog/post/x is /blog/post/x in Vietnamese: the language is
      // js/i18n.js's business, the route is what follows it.
      pathname = String(pathname || '').replace(/^\/(en|ko|vi|es|id|pt-BR|ja|zh)(?=\/|$)/, '') || '/';
      var m = /^\/community\/([^/]+)\/?$/.exec(pathname || '');
      if (m) return { cat: decodeURIComponent(m[1]) };
      return { cat: new URLSearchParams(search || '').get('cat') || '' };
    }
  };
})();
