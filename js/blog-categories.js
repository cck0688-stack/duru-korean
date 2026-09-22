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
      return cat ? '/blog/' + encodeURIComponent(cat) : '/blog';
    },
    postHref: function (slug, lang) {
      return '/blog/post/' + encodeURIComponent(slug) +
        (lang ? '?pl=' + encodeURIComponent(lang) : '');
    },
    // …and back again. A rewrite happens on the server, so the browser
    // is still sitting on /blog/travel with nothing in its query string
    // — the path is where that value actually is. The query string
    // still answers for blog.html?cat=…, which is how the page is
    // opened locally and from an older link.
    route: function (pathname, search) {
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
