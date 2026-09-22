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

  var CATEGORIES = [
    { id: 'ask' },
    { id: 'share' },
    { id: 'meet' }
  ];

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
    label: function (id) { return t('community.cat.' + id, humanise(id)); },
    describe: function (id) { return t('community.cat.' + id + '.desc', ''); },

    // Readable paths — /community/ask — turned back into the query
    // string this page reads by the rewrites in vercel.json. The page
    // is served from two depths, so <base href="/"> on it keeps every
    // relative link and fetch working from either.
    href: function (cat) {
      return cat ? '/community/' + encodeURIComponent(cat) : '/community';
    },

    // …and back again. A rewrite happens on the server, so the browser
    // is still sitting on /community/ask with nothing in its query
    // string — the path is where that value actually is. The query
    // string still answers for stories.html?cat=, which is how the page
    // is opened locally and from an older link.
    route: function (pathname, search) {
      var m = /^\/community\/([^/]+)\/?$/.exec(pathname || '');
      if (m) return { cat: decodeURIComponent(m[1]) };
      return { cat: new URLSearchParams(search || '').get('cat') || '' };
    }
  };
})();
