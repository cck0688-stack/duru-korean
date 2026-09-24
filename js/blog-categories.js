// DURU KOREAN — what the blog is about
//
// Load before js/blog.js. Exposes window.DURU_BLOG.
//
// It builds no navigation of its own. The eight cards at the top of
// blog.html are the way into a topic; a second list of the same seven
// names hanging off the header was one list too many.
//
// The blog is written for people living in or visiting Korea from
// somewhere else: a tourist who lands on Friday, a student on a D-2, a
// family who has been here six years. Seven topics, and nothing under
// them — a reader picks one and sees one sentence saying what is on it.
// Sub-topics were tried and taken out again: a menu of twenty-four
// things is a wall, not a way in.
//
// Everything here is ids. The names and the one-line descriptions are
// translated (`blog.cat.<id>` and `blog.cat.<id>.desc`), because a
// reader browsing in Vietnamese should see Vietnamese topics. The ids
// never change: they are what the database stores, what a URL carries,
// and what a link someone shared last year still points at.

(function () {
  'use strict';

  // The language in the address this page was opened under (/vi/…), so
  // that the addresses built here stay in it.
  function langPrefix() {
    var m = /^\/(en|ko|vi|es|id|pt-BR|ja|zh)(?=\/|$)/.exec(window.location.pathname);
    return m ? '/' + m[1] : '';
  }

  var CATEGORIES = [
    {
      id: 'travel',
      // `about` is what the model files a post against when the editor
      // reads it (api/translate.js, mode "outline"). English on purpose:
      // it is an instruction, not something a reader sees.
      about: 'arriving and getting around Korea as a visitor: apps, transport, money, etiquette'
    },
    {
      id: 'dining',
      about: 'eating in Korea: how to order and eat, street food, convenience stores, dietary needs'
    },
    {
      id: 'style',
      about: 'Korean beauty and fashion: skincare, clinics, brands, shopping and tax refunds'
    },
    {
      id: 'explore',
      about: 'neighbourhoods, K-pop and drama locations, everyday Korean experiences, day trips'
    },
    {
      id: 'campus',
      about: 'living here long term: visas and paperwork, housing, healthcare, multicultural support'
    },
    {
      id: 'career',
      about: 'working in Korea: part-time work permits, job hunting, resumes, internships'
    },
    {
      id: 'language',
      about: 'the Korean language itself: useful expressions, common mistakes, what a word really means'
    },
    {
      id: 'etc',
      about: 'cultural nuances, news and policy for foreigners, and anything that fits nowhere else'
    }
  ];

  // Who a post is for, shown as a badge on its card. There is no filter
  // on it — it is a label that saves a reader opening something written
  // for somebody else, not another control to work.
  var AUDIENCES = ['tourists', 'students', 'expats'];

  // English, and for the model only, exactly like `about` above.
  var AUDIENCE_ABOUT = {
    tourists: 'short-term visitors, here for days or weeks, no Korean address',
    students: 'international students on a study visa, living on or near a campus',
    expats: 'people settled in Korea for years — work, family, a home of their own'
  };

  // A line icon per shelf, drawn rather than fetched: eight small SVGs
  // weigh less than one icon font, take the colour of the text around
  // them, and cannot fail to load. Each is a 24×24 viewBox and inherits
  // stroke from CSS, so the cards style them, not this file.
  var ICONS = {
    // an aeroplane
    travel: '<path d="M21 15.5 3.5 9.8a.6.6 0 0 1 0-1.13l2.1-.77a1 1 0 0 1 .73.02l3.2 1.4 3.6-1.3-2.5-3.2a.6.6 0 0 1 .27-.93l1.5-.55a1 1 0 0 1 .9.12L19 6.9l2.2-.8a1.6 1.6 0 1 1 1.1 3l-1.3.47"/><path d="M4 19h16"/>',
    // a bowl with steam
    dining: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z"/><path d="M5.5 19h13"/><path d="M9 7.5c0-1 1-1.4 1-2.4S9 3.2 9 3.2"/><path d="M13 7.5c0-1 1-1.4 1-2.4s-1-1.9-1-1.9"/>',
    // a cosmetics bottle with a sparkle
    style: '<rect x="8" y="8" width="8" height="13" rx="2"/><path d="M10.5 8V5.5h3V8"/><path d="M11 3h2"/><path d="M19 4l.6 1.7L21.3 6l-1.7.6L19 8.3l-.6-1.7L16.7 6l1.7-.6Z"/>',
    // a tiled roof over pillars
    explore: '<path d="M3 9h18L12 3 3 9Z"/><path d="M5 9v9"/><path d="M9.5 9v9"/><path d="M14.5 9v9"/><path d="M19 9v9"/><path d="M3 21h18"/>',
    // a graduation cap
    campus: '<path d="M12 4 2 9l10 5 10-5-10-5Z"/><path d="M6 11.5V17c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5.5"/><path d="M22 9v5"/>',
    // a briefcase
    career: '<rect x="2.5" y="7.5" width="19" height="12.5" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M2.5 13h19"/>',
    // an open book
    language: '<path d="M12 7.5C10.5 6 8.4 5.3 4 5.3v12c4.4 0 6.5.7 8 2.2 1.5-1.5 3.6-2.2 8-2.2v-12c-4.4 0-6.5.7-8 2.2Z"/><path d="M12 7.5v12"/>',
    // a speech bubble
    etc: '<path d="M20.5 12.5c0 4-3.8 7.2-8.5 7.2a10 10 0 0 1-2.6-.34L4 21l1.3-3.4a6.7 6.7 0 0 1-2.3-5c0-4 3.8-7.2 8.5-7.2s9 3.2 9 7.2Z"/>'
  };

  var byId = {};
  CATEGORIES.forEach(function (c) { byId[c.id] = c; });

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  // A label falls back to the id turned back into words, so a topic
  // added here before its translations are written still reads as
  // something rather than as "blog.cat.whatever".
  function humanise(id) {
    return String(id || '').split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  window.DURU_BLOG = {
    CATEGORIES: CATEGORIES,
    AUDIENCES: AUDIENCES,
    ids: CATEGORIES.map(function (c) { return c.id; }),
    get: function (id) { return byId[id] || null; },
    // The shelf's icon, ready to drop inside a <svg>. Unknown ids get
    // the speech bubble rather than an empty circle.
    icon: function (id) { return ICONS[id] || ICONS.etc; },
    label: function (id) { return t('blog.cat.' + id, humanise(id)); },
    // The short name the top navigation and the topic bar have room
    // for: "Campus & Life" rather than "Campus & Living Support".
    navLabel: function (id) { return t('blog.cat.' + id + '.nav', t('blog.cat.' + id, humanise(id))); },
    describe: function (id) { return t('blog.cat.' + id + '.desc', ''); },
    audienceLabel: function (id) { return t('blog.aud.' + id, humanise(id)); },
    // What the editor sends the outline endpoint to file a post against.
    // Ids and English descriptions only — the model is choosing a topic,
    // not writing anything a reader sees.
    forOutline: function () {
      return CATEGORIES.map(function (c) { return { id: c.id, about: c.about }; });
    },
    audiencesForOutline: function () {
      return AUDIENCES.map(function (id) { return { id: id, about: AUDIENCE_ABOUT[id] }; });
    },
    // Where a topic and a post live. Readable paths — /blog/travel —
    // turned back into the query string the page reads by the rewrites
    // in vercel.json. blog.html itself is served under /blog, so
    // <base href="/"> on that page keeps every relative link and fetch
    // working from any of these depths.
    href: function (cat) {
      return langPrefix() + (cat ? '/blog/' + encodeURIComponent(cat) : '/blog');
    },
    postHref: function (slug, lang) {
      return langPrefix() + '/blog/post/' + encodeURIComponent(slug) +
        (lang ? '?pl=' + encodeURIComponent(lang) : '');
    },
    // …and back again. A rewrite happens on the server, so the browser
    // is still sitting on /blog/travel with nothing in its query string
    // — the path is where that value actually is. The query string
    // still answers for blog.html?cat=…, which is how the page is
    // opened locally and from an older link.
    route: function (pathname, search) {
      // /vi/blog/post/x is /blog/post/x in Vietnamese: the language is
      // js/i18n.js's business, the route is what follows it.
      pathname = String(pathname || '').replace(/^\/(en|ko|vi|es|id|pt-BR|ja|zh)(?=\/|$)/, '') || '/';
      var out = { post: '', cat: '' };
      var m = /^\/blog\/post\/([^/]+)\/?$/.exec(pathname || '');
      if (m) { out.post = decodeURIComponent(m[1]); return out; }
      m = /^\/blog\/([^/]+)\/?$/.exec(pathname || '');
      if (m) { out.cat = decodeURIComponent(m[1]); return out; }
      var q = new URLSearchParams(search || '');
      out.post = q.get('post') || '';
      out.cat = q.get('cat') || '';
      return out;
    }
  };
})();
