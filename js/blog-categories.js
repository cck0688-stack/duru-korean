// DURU KOREAN — what the blog is about, and who it is for
//
// Load before js/blog.js. Exposes window.DURU_BLOG.
//
// The blog is written for people living in or visiting Korea from
// somewhere else: a tourist who lands on Friday, a student on a D-2, a
// family who has been here six years. Seven shelves, each with a handful
// of subtopics, because "Travel" alone is too big to browse and
// "T-money vs WOWPASS" alone is too small to be a section.
//
// Everything here is ids. The names and the one-line descriptions are
// translated (`blog.cat.<id>`, `blog.cat.<id>.desc`, `blog.sub.<id>`),
// because a reader browsing in Vietnamese should see Vietnamese shelves.
// The ids never change: they are what the database stores, what a URL
// carries, and what a link someone shared last year still points at.

(function () {
  'use strict';

  // One Hangul glyph per category, in the same spirit as the rest of the
  // site — 두 루 한 글 on the home page, 한 음 말 법 삶 on the downloads.
  // Swap the `glyph` values for emoji here if that ever reads better;
  // nothing else depends on what they are.
  var CATEGORIES = [
    {
      id: 'travel', glyph: '길',
      // `about` is what the model files a post against when the editor
      // reads it (api/translate.js, mode "outline"). English on purpose:
      // it is an instruction, not something a reader sees.
      about: 'arriving and getting around Korea as a visitor: apps, transport, money, etiquette',
      subs: ['apps-and-tech', 'transport', 'money-basics', 'safety-etiquette']
    },
    {
      id: 'dining', glyph: '맛',
      about: 'eating in Korea: how to order and eat, street food, convenience stores, dietary needs',
      subs: ['how-to-eat', 'street-convenience', 'special-diets']
    },
    {
      id: 'style', glyph: '멋',
      about: 'Korean beauty and fashion: skincare, clinics, brands, shopping and tax refunds',
      subs: ['k-beauty', 'fashion-brands', 'shopping-hacks']
    },
    {
      id: 'explore', glyph: '삶',
      about: 'neighbourhoods, K-pop and drama locations, everyday Korean experiences, day trips',
      subs: ['neighbourhoods', 'k-lifestyle', 'kpop-drama', 'day-trips']
    },
    {
      id: 'campus', glyph: '집',
      about: 'living here long term: visas and paperwork, housing, healthcare, multicultural support',
      subs: ['visa-legal', 'housing-living', 'health-medical', 'multicultural']
    },
    {
      id: 'career', glyph: '일',
      about: 'working in Korea: part-time work permits, job hunting, resumes, internships',
      subs: ['part-time', 'employment', 'networking']
    },
    {
      id: 'community', glyph: '말',
      about: 'cultural nuances, news and policy for foreigners, reader questions and stories',
      subs: ['cultural-nuances', 'news-updates', 'qa-stories']
    }
  ];

  // Who a post is for. A reader picks one and the list narrows to what
  // applies to them — a tourist here for five days does not want to read
  // about extending a D-4.
  var AUDIENCES = ['tourists', 'students', 'expats'];

  // English, and for the model only, exactly like `about` above.
  var AUDIENCE_ABOUT = {
    tourists: 'short-term visitors, here for days or weeks, no Korean address',
    students: 'international students on a study visa, living on or near a campus',
    expats: 'people settled in Korea for years — work, family, a home of their own'
  };

  var byId = {};
  CATEGORIES.forEach(function (c) { byId[c.id] = c; });

  var subParent = {};
  CATEGORIES.forEach(function (c) {
    c.subs.forEach(function (s) { subParent[s] = c.id; });
  });

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  // A label falls back to the id turned back into words, so a category
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
    allSubs: CATEGORIES.reduce(function (acc, c) { return acc.concat(c.subs); }, []),
    get: function (id) { return byId[id] || null; },
    parentOf: function (sub) { return subParent[sub] || null; },
    glyph: function (id) { return (byId[id] && byId[id].glyph) || ''; },
    label: function (id) { return t('blog.cat.' + id, humanise(id)); },
    // The short name the top navigation has room for: "Campus & Life"
    // rather than "Campus & Living Support".
    navLabel: function (id) { return t('blog.cat.' + id + '.nav', t('blog.cat.' + id, humanise(id))); },
    describe: function (id) { return t('blog.cat.' + id + '.desc', ''); },
    subLabel: function (id) { return t('blog.sub.' + id, humanise(id)); },
    audienceLabel: function (id) { return t('blog.aud.' + id, humanise(id)); },
    // What the editor sends the outline endpoint to file a post against.
    // Ids and English descriptions only — the model is choosing a shelf,
    // not writing anything a reader sees.
    forOutline: function () {
      return CATEGORIES.map(function (c) {
        return { id: c.id, about: c.about, subs: c.subs.slice() };
      });
    },
    audiencesForOutline: function () {
      return AUDIENCES.map(function (id) { return { id: id, about: AUDIENCE_ABOUT[id] }; });
    },
    // Where a shelf, a sub-topic and a post live. Readable paths —
    // /blog/travel/transport — turned back into the query string the
    // page reads by the rewrites in vercel.json. blog.html itself is
    // served under /blog, so <base href="/"> on that page keeps every
    // relative link and fetch working from any of these depths.
    //
    // One function each, so the day these change nothing else does.
    href: function (cat, sub) {
      if (!cat) return '/blog';
      return '/blog/' + encodeURIComponent(cat) + (sub ? '/' + encodeURIComponent(sub) : '');
    },
    postHref: function (slug, lang) {
      return '/blog/post/' + encodeURIComponent(slug) +
        (lang ? '?pl=' + encodeURIComponent(lang) : '');
    },
    // …and back again. A rewrite happens on the server, so the browser
    // is still sitting on /blog/travel/transport with nothing in its
    // query string — the path is where those two values actually are.
    // The query string still answers for blog.html?cat=…, which is how
    // the page is opened locally and from an older link.
    route: function (pathname, search) {
      var out = { post: '', cat: '', sub: '' };
      var q = new URLSearchParams(search || '');
      var m = /^\/blog\/post\/([^/]+)\/?$/.exec(pathname || '');
      if (m) { out.post = decodeURIComponent(m[1]); return out; }
      m = /^\/blog\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname || '');
      if (m) {
        out.cat = decodeURIComponent(m[1]);
        out.sub = m[2] ? decodeURIComponent(m[2]) : '';
        return out;
      }
      out.post = q.get('post') || '';
      out.cat = q.get('cat') || '';
      out.sub = out.cat ? (q.get('sub') || '') : '';
      return out;
    }
  };

  // ── The seven shelves, under "Blog" in the site header ────────────
  //
  // Built here rather than written into eighteen HTML files, so the
  // list has one home. Every page that loads this script gets the menu;
  // the blog's own category bar is a separate, larger thing.

  function buildNavMenu() {
    var nav = document.querySelector('.nav-main');
    if (!nav || nav.querySelector('.nav-item--blog')) return;
    var link = nav.querySelector('a[href="blog.html"]');
    if (!link) return;

    var item = document.createElement('span');
    item.className = 'nav-item nav-item--blog';
    link.parentNode.insertBefore(item, link);
    item.appendChild(link);

    var caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'nav-caret';
    caret.setAttribute('aria-expanded', 'false');
    caret.innerHTML = '<span aria-hidden="true">\u25be</span>';
    item.appendChild(caret);

    var menu = document.createElement('div');
    menu.className = 'nav-menu';
    item.appendChild(menu);

    // The labels carry data-i18n as well as their text: this runs
    // before the dictionary has landed on first load, and js/i18n.js
    // translates what it finds a moment later. On a language change it
    // runs again, and t() answers for itself.
    function paint() {
      caret.setAttribute('data-i18n-aria-label', 'blog.browse');
      caret.setAttribute('aria-label', t('blog.browse', 'Browse by topic'));
      menu.innerHTML = CATEGORIES.map(function (c) {
        return '<a href="' + window.DURU_BLOG.href(c.id) + '">' +
          '<span class="nav-menu-glyph kr" aria-hidden="true">' + c.glyph + '</span>' +
          '<span class="nav-menu-text">' +
            '<span class="nav-menu-name" data-i18n="blog.cat.' + c.id + '.nav"></span>' +
            '<span class="nav-menu-desc" data-i18n="blog.cat.' + c.id + '.desc"></span>' +
          '</span></a>';
      }).join('');
      menu.querySelectorAll('a').forEach(function (a, i) {
        var id = CATEGORIES[i].id;
        a.querySelector('.nav-menu-name').textContent = window.DURU_BLOG.navLabel(id);
        a.querySelector('.nav-menu-desc').textContent = window.DURU_BLOG.describe(id);
      });
    }
    paint();

    caret.addEventListener('click', function (e) {
      e.preventDefault();
      var open = item.classList.toggle('is-open');
      caret.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!item.contains(e.target)) {
        item.classList.remove('is-open');
        caret.setAttribute('aria-expanded', 'false');
      }
    });
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        item.classList.remove('is-open');
        caret.setAttribute('aria-expanded', 'false');
        caret.focus();
      }
    });
    document.addEventListener('duru:langchange', paint);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildNavMenu);
  } else {
    buildNavMenu();
  }
})();
