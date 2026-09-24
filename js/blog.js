// DURU KOREAN — blog posts (Supabase-backed)
//
// Include after js/auth.js and js/resource-common.js on blog.html. The
// language table, the label helpers and the i18n lookup are shared with
// the downloads pages so there is one list of languages on the site.
//
// A post is one piece of writing, however many languages it is written
// in: `lang` names the language its own columns are in and `i18n` holds
// a translation per language. The list filters by language the way the
// downloads do, and the post's own view lets a reader switch without
// changing the language of the site around it.
//
// Everyone sees published posts;
// only a user listed in admin_users can write, edit, or delete one — and
// that is enforced by Row Level Security in supabase/schema.sql, not by
// this file hiding a button. A draft is invisible to visitors because the
// public select policy filters on `published`, so an unfinished post is
// never one stray link away from being read.
//
// A single post lives at /blog/post/<slug>, a shelf at /blog/travel and
// a sub-topic at /blog/travel/transport. vercel.json turns each of those
// back into the query string this file reads, so nothing here has to
// know about routing — see js/blog-categories.js for the one place the
// paths are built.

(function () {
  'use strict';

  var R = window.DURU_RES;
  if (!R) return;
  var MT = window.DURU_MT;

  // The seven topics, from js/blog-categories.js. That file is the one
  // place the ids and the descriptions live; nothing here should hold a
  // list of topics of its own.
  var B = window.DURU_BLOG;
  if (!B) return;
  var CATEGORIES = B.ids;

  var STATE_KEY = 'duru_blog_state';
  var RETURN_KEY = 'duru_blog_return';

  // The languages a post can actually be read in: its own, plus every
  // translation that has a body. A translation with only a title filled
  // in is not offered, so nobody lands on an empty page.
  function postLangs(post) {
    var have = {};
    have[post.lang || 'en'] = true;
    var tr = post.i18n || {};
    Object.keys(tr).forEach(function (code) {
      if (tr[code] && typeof tr[code].body === 'string' && tr[code].body.trim()) have[code] = true;
    });
    return R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return have[c]; });
  }

  // Title, excerpt and body in one language, falling back to the post's
  // own columns — the same rule the downloads use for their titles.
  function field(post, name, lang) {
    return R.localized(post, name, lang);
  }

  // What a reader sees for the title or the summary: a human
  // translation if the admin wrote one, else the machine one, else the
  // post's own words.
  function readField(post, name, lang) {
    var own = (post.i18n && post.i18n[lang] && post.i18n[lang][name]) || '';
    if (own && String(own).trim()) return own;
    if (postLangs(post).indexOf(lang) !== -1) return field(post, name, lang);
    var mt = MT && MT.head(post, lang, name);
    return mt || field(post, name, lang);
  }

  // Languages a post can be *read* in at all: the ones it is written in,
  // plus the ones a stored translation covers. The card's chips and the
  // list filter use this, so a Korean post with translations shows up
  // for a reader browsing in Spanish.
  function readableLangs(post) {
    // A row from the list carries its languages already: the list asks
    // the database for card fields only, not every translation's body.
    if (post && post._langs) return post._langs;
    var have = {};
    postLangs(post).forEach(function (c) { have[c] = true; });
    if (MT) {
      R.LANGS.forEach(function (l) {
        if (!have[l.code] && MT.paired(post, l.code)) have[l.code] = true;
      });
    }
    return R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return have[c]; });
  }

  // The self-study corner under a Korean post: the words a learner
  // would stumble on, each with the meaning this post uses. Only shown
  // to a reader who is not reading the post in its own language —
  // someone reading the Korean has the words already.
  function studyHTML(post, lang) {
    if (!MT || (post.lang || 'en') !== 'ko' || lang === 'ko') return '';
    var words = MT.studyFor(post, lang);
    if (!words) return '';
    return '<section class="study">' +
      '<h2 class="study-title">' + escapeHTML(t('study.heading', 'Words to know')) + '</h2>' +
      '<p class="study-lead">' + escapeHTML(t('study.lead',
        'Five words from this post, in the sense it uses them.')) + '</p>' +
      '<ol class="study-list">' + words.map(function (w) {
        var e = w.by[lang];
        return '<li class="study-word">' +
          '<div class="study-head">' +
            '<span class="study-term" lang="ko">' + escapeHTML(w.word) + '</span>' +
            (w.romanization ? '<span class="study-rom">' + escapeHTML(w.romanization) + '</span>' : '') +
            (w.pos ? '<span class="study-pos">' + escapeHTML(w.pos) + '</span>' : '') +
          '</div>' +
          '<p class="study-meaning" lang="' + escapeHTML(lang) + '">' + escapeHTML(e.meaning) + '</p>' +
          (e.explanation ? '<p class="study-note" lang="' + escapeHTML(lang) + '">' +
            escapeHTML(e.explanation) + '</p>' : '') +
          (w.sentence ? '<p class="study-source" lang="ko">' + escapeHTML(w.sentence) + '</p>' : '') +
        '</li>';
      }).join('') + '</ol>' +
    '</section>';
  }

  // The reader's view of a translated post: every source sentence with
  // its translation directly underneath. Escaped on both sides — a post
  // body is plain text and a translation is text that came back over
  // the network, so neither is ever treated as markup.
  // A body is Markdown, and a sub-heading in it reaches this function
  // as a sentence reading "## 먼저 볼 것". Escaped and printed whole it
  // showed the reader the hashes — the one thing those marks exist not
  // to be. They are stripped here and the line is marked as a heading
  // so it gets the same highlighter stroke the rendered body gives one.
  // The translation carries them too, because the model is asked to
  // keep Markdown marks where it found them.
  var MD_HEAD = /^\s*#{1,4}\s+/;
  // Some stored translations carry the numbering the model was handed —
  // "4. ## Use your eyes and photos" — because they were made before
  // api/_providers.js started taking it off. The source is the writer's
  // own text and is never touched; this only reaches into a translation
  // of a line the source has already proved to be a heading.
  var MD_HEAD_NUMBERED = /^\s*\d{1,3}[.)]\s*#{1,4}\s+/;

  function bilingualHTML(pairs, srcLang, outLang) {
    return pairs.map(function (para) {
      return '<p class="mt-para">' + para.map(function (pair) {
        var head = MD_HEAD.test(pair.src);
        var src = head ? String(pair.src).replace(MD_HEAD, '') : pair.src;
        var out = pair.out;
        if (head) {
          out = String(pair.out == null ? '' : pair.out)
            .replace(MD_HEAD_NUMBERED, '')
            .replace(MD_HEAD, '');
        }
        return '<span class="mt-line' + (head ? ' mt-line--head' : '') + '">' +
          '<span class="mt-src" lang="' + escapeHTML(srcLang) + '">' + escapeHTML(src) + '</span>' +
          '<span class="mt-out" lang="' + escapeHTML(outLang) + '">' + escapeHTML(out) + '</span>' +
          '</span>';
      }).join('') + '</p>';
    }).join('');
  }

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // "schema cache" in a PostgREST error means a column the page expects
  // does not exist in the database yet — the migration has not been run.
  // Saying so beats leaving the admin to decode the raw message.
  function schemaHint(msg) {
    msg = String(msg || '');
    return /schema cache/i.test(msg)
      ? msg + ' — ' + t('common.schemaHint', 'The database has not been updated yet. Run supabase/schema.sql in the Supabase SQL editor, then try again.')
      : msg;
  }

  // Tags are typed as one comma-separated field and stored as an array.
  function parseTags(input) {
    var seen = Object.create(null);
    return String(input || '').split(',').map(function (s) {
      return s.trim().replace(/^#/, '');
    }).filter(function (s) {
      if (!s || s.length > 32 || seen[s.toLowerCase()]) return false;
      seen[s.toLowerCase()] = true;
      return true;
    }).slice(0, 8);
  }

  // A tag is shown in the language being read but links by the one it
  // was written in: the filter runs on posts.tags, and a translated
  // label that filtered on itself would find nothing.
  function renderTags(post, lang) {
    var own = (post && post.tags) || [];
    if (!own.length) return '';
    var shown = (MT && MT.tagsFor(post, lang)) || own;
    return '<div class="post-tags">' + own.map(function (tag, i) {
      return '<a class="post-tag" href="/blog?tag=' + encodeURIComponent(tag) + '">#' +
        escapeHTML(shown[i] || tag) + '</a>';
    }).join('') + '</div>';
  }

  // Post bodies are Markdown. The renderer escapes before it marks up, so
  // this stays safe; if markdown.js is missing, the fallback still escapes
  // everything itself and simply shows the source syntax.
  function paragraphs(text) {
    if (window.DURU_MARKDOWN) return window.DURU_MARKDOWN.render(text);
    return String(text || '').split(/\n{2,}/).map(function (block) {
      return '<p>' + escapeHTML(block.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  // The photograph on a post, and who took it. Hotlinked from the
  // service's CDN — see section 29 of supabase/schema.sql. The credit
  // is shown even where the licence does not demand it: it costs one
  // line and both services' API terms ask for it.
  // "unsplash" is an id; "Unsplash" is what goes under a photograph.
  function photoSource(id) {
    if (id === 'unsplash') return 'Unsplash';
    if (id === 'pexels') return 'Pexels';
    return '';
  }

  function photoHTML(post, big) {
    var url = post && post.image_url;
    if (!url) return '';
    var alt = post.image_alt || '';
    var credit = post.image_credit || '';
    var creditUrl = post.image_credit_url || '';
    var sourceName = photoSource(post.image_source);

    var line = '';
    if (big && credit) {
      line = '<p class="post-photo-credit">' +
        escapeHTML(t('blog.photoBy', 'Photo by {name}').replace('{name}', '')) +
        (creditUrl
          ? '<a href="' + escapeHTML(creditUrl) + '" target="_blank" rel="noopener noreferrer nofollow">' +
            escapeHTML(credit) + '</a>'
          : escapeHTML(credit)) +
        (sourceName ? ' · ' + escapeHTML(sourceName) : '') +
      '</p>';
    }

    return '<figure class="post-photo' + (big ? '' : ' post-photo--card') + '">' +
      // The post's own picture is the first thing under the title, so
      // it is not deferred; the ones on cards further down the list are.
      '<img src="' + escapeHTML(url) + '" alt="' + escapeHTML(alt) + '"' +
        (big ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">' +
      line +
    '</figure>';
  }

  function categoryLabel(cat) {
    return B.label(cat);
  }

  // Who a post is for, as the coloured badges the cards carry. An
  // audience the model or the database does not know about is dropped
  // rather than rendered as a bare id.
  function audienceBadges(post) {
    var list = (post.audiences || []).filter(function (a) { return B.AUDIENCES.indexOf(a) !== -1; });
    if (!list.length) return '';
    return '<span class="aud-badges">' + list.map(function (a) {
      return '<span class="aud-badge aud-badge--' + escapeHTML(a) + '">' +
        escapeHTML(B.audienceLabel(a)) + '</span>';
    }).join('') + '</span>';
  }

  // The date on a post is posts.post_date: a plain day, "2026-09-22",
  // and a day in Seoul at that. `new Date("2026-09-22")` would read it
  // as midnight UTC, which is the day before for a reader west of
  // Greenwich, so the parts are taken apart and handed to a local Date.
  // A full timestamp still works, for the places that pass one.
  function formatDate(iso) {
    var text = String(iso == null ? '' : iso);
    try {
      var lang = (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
      var day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      var when = day
        ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
        : new Date(text);
      return when.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return text.slice(0, 10);
    }
  }

  // What a reader sees, with a fallback for rows written before
  // posts.post_date existed.
  function postDay(post) {
    return (post && (post.post_date || post.created_at)) || '';
  }

  // A slug has to be unique and URL-safe. Latin titles keep their words;
  // a Korean or Japanese title reduces to nothing usable, so fall back to
  // the random suffix alone rather than percent-encoding the whole title.
  function makeSlug(title) {
    var base = String(title || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    var suffix = Math.random().toString(36).slice(2, 8);
    return base ? base + '-' + suffix : suffix;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('blogList');
    var emptyEl = document.getElementById('blogEmpty');
    var emptyText = document.getElementById('blogEmptyText');
    var suggestEl = document.getElementById('blogLangSuggest');
    var singleEl = document.getElementById('blogSingle');
    var toolbarEl = document.getElementById('blogToolbar');
    var leadInEl = document.querySelector('.section-lead-in');
    var filtersEl = document.getElementById('blogFilters');
    var allTitleEl = document.getElementById('blogAllTitle');
    var countEl = document.getElementById('blogCount');
    var allBtn = document.getElementById('blogAllBtn');
    var langSel = document.getElementById('blogLang');
    var writeBtn = document.getElementById('writePostBtn');
    var pendingBtn = document.getElementById('blogPendingBtn');
    var pendingN = document.getElementById('blogPendingN');
    // An admin looking at what is not published yet.
    var pendingOnly = false;
    if (!listEl) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var isAdmin = false;
    // The address bar is the truth for where in the blog a reader is:
    // ?cat= a shelf, ?sub= one of its sub-topics, ?aud= who they are.
    // That makes every view a link someone can send, and a back button
    // that means something.
    // Where this page was opened on: /blog/travel/transport and
    // /blog/post/<slug> as readily as blog.html?cat=&sub= and ?post=.
    var route = B.route(location.pathname, location.search);
    var activeFilter = 'all';
    var listLang = R.preferredLang();
    // The site language this list is tuned to — see js/resources.js for
    // the same rule: a choice made in the dropdown is remembered, but
    // only against the site language it was made under.
    var tunedTo = null;
    // The language the post being read is shown in. `readPick` is set
    // only when the reader chooses one from the post's own picker; it
    // never touches the site language, so reading one post in Korean
    // does not translate the site around it.
    var readLang = null;
    var readPick = null;
    // The ?pl= the list sent, and the site language the post view is
    // tuned to. Both give way when the reader changes the language at
    // the top of the page: that is a statement about what they want to
    // read, and it should move the post with it.
    var plOverride = new URLSearchParams(location.search).get('pl');
    var postTunedTo = null;

    function followPostLang() {
      var code = R.preferredLang();
      if (postTunedTo === code) return false;
      var first = postTunedTo === null;
      postTunedTo = code;
      if (!first) { plOverride = null; readPick = null; }
      return true;
    }
    followPostLang();
    // Set from ?tag= and never changed after load: a tag filter is a
    // distinct URL, so it stays shareable and survives a reload.
    var activeTag = new URLSearchParams(location.search).get('tag') || '';
    // The cards on screen: one page of them, then the next on "Show
    // more". Never every post — the blog grows every day, and each post
    // carries its body in eight languages.
    var posts = [];
    var PAGE_SIZE = 20;
    var total = 0;           // how many match, in the database
    var loading = false;
    var listToken = 0;       // a newer request makes an older answer moot
    var noRejected = false;  // a database without §38's rejected_at yet
    var current = null;      // the post open on its own page, in full
    var moreEl = document.getElementById('blogMore');
    var moreBtn = document.getElementById('blogMoreBtn');

    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch (e) {}
    // Where in the blog the reader is comes from the address bar and
    // nowhere else. This used to be remembered per tab as well, which
    // meant a link naming no shelf — a tag link, say — silently
    // inherited whichever shelf had been open a moment ago and showed
    // nothing. The shelf is in the URL now, so Back restores it by
    // itself; sessionStorage is left holding the language and the
    // scroll position, which no URL carries.
    if (route.cat) activeFilter = route.cat;
    normaliseFilters();

    // An id that no longer exists — an old bookmark, a hand-typed URL —
    // falls back rather than showing an empty page with no explanation.
    // Which post the address bar is asking for, whichever shape it is
    // written in. Read fresh: syncURL rewrites the path as filters move.
    function currentSlug() {
      return B.route(location.pathname, location.search).post;
    }

    function normaliseFilters() {
      if (CATEGORIES.indexOf(activeFilter) === -1) activeFilter = 'all';
    }

    function saveState(extra) {
      try {
        var st = { lang: listLang, site: tunedTo };
        if (extra) Object.keys(extra).forEach(function (k) { st[k] = extra[k]; });
        sessionStorage.setItem(STATE_KEY, JSON.stringify(st));
      } catch (e) {}
    }

    // Keep the address bar level with what is on screen, without adding
    // a history entry per click: a filter is where you are, not a page
    // you visited.
    function syncURL() {
      if (!window.history || !history.replaceState) return;
      var q = new URLSearchParams(location.search);
      ['cat', 'sub', 'aud'].forEach(function (k) { q.delete(k); });
      // Readable paths only where the host serves them. Opened as
      // blog.html — a local preview, a static host without the
      // rewrites — the query string stays, so a reload still works.
      var clean = !/\.html$/.test(location.pathname);
      if (!clean && activeFilter !== 'all') q.set('cat', activeFilter);
      var qs = q.toString();
      var path = clean ? B.href(activeFilter === 'all' ? '' : activeFilter) : location.pathname;
      history.replaceState(null, '', path + (qs ? '?' + qs : ''));
    }

    function followSiteLang() {
      var code = R.preferredLang();
      if (tunedTo === code) return false;
      var first = tunedTo === null;
      tunedTo = code;
      if (first && saved && saved.lang && saved.site === code) listLang = saved.lang;
      else listLang = code;
      saveState();
      return true;
    }
    followSiteLang();

    // Every language the site speaks, in the picker's order, whether or
    // not a post exists in it yet; English is the default. Same as the
    // downloads list, so the two pages behave alike.
    function buildLangSelect() {
      if (!langSel) return;
      langSel.innerHTML = R.LANGS.map(function (l) {
        return '<option value="' + escapeHTML(l.code) + '">' + escapeHTML(l.label) + '</option>';
      }).join('');
      if (!R.LANGS.some(function (l) { return l.code === listLang; })) listLang = 'en';
      langSel.value = listLang;
    }

    // Which languages the posts passing the category and tag filters are
    // written in — used to point somewhere useful when the chosen one
    // has nothing.
    // Asked of the database — one count per language, only when the
    // chosen language turned out empty.
    function langsPresent() {
      var codes = R.LANGS.map(function (l) { return l.code; });
      return Promise.all(codes.map(function (c) {
        return filtered(client.from('posts').select('id', { count: 'exact', head: true }), c)
          .then(function (res) { return !res.error && res.count > 0; }, function () { return false; });
      })).then(function (has) { return codes.filter(function (c, i) { return has[i]; }); });
    }

    // The filters the reader has set, applied by the database. `lang`
    // names the language to list; a post is in it when it is written in
    // it, has a human translation with a body in it, or a stored
    // machine translation of its body in it.
    function langOr(lang) {
      return 'lang.eq.' + lang + (lang === 'en' ? ',lang.is.null' : '') +
        ',i18n->' + lang + '->>body.neq.,mt->' + lang + '->sentences.not.is.null';
    }

    function filtered(q, lang) {
      // A draft that was turned down is kept for the record — so the
      // morning run does not write the same piece again — and shown
      // nowhere. Visitors never get drafts at all: the read policy.
      if (!noRejected) q = q.is('rejected_at', null);
      // Everything waiting, whatever language it is in.
      if (pendingOnly) q = q.eq('published', false);
      else q = q.or(langOr(lang || listLang));
      if (activeFilter !== 'all') q = q.eq('category', activeFilter);
      if (activeTag) q = q.contains('tags', [activeTag]);
      return q;
    }

    // What a card needs, and only in the language being read: the
    // title and summary in it, and one short field per language to know
    // which languages the post can be read in. No bodies.
    var LIGHT = 'id,slug,category,post_date,created_at,published,lang,title,excerpt,tags,audiences,' +
      'image_url,image_alt,image_credit,image_credit_url,image_source';
    function lightSelect(lang) {
      var own = ',tr_t:i18n->' + lang + '->>title,tr_e:i18n->' + lang + '->>excerpt' +
        ',mt_t:mt->' + lang + '->>title,mt_e:mt->' + lang + '->>excerpt,mt_g:mt->' + lang + '->tags' +
        ',mt_f:mt->' + lang + '->>from,mt_h:mt->' + lang + '->>headHash';
      var each = R.LANGS.map(function (l, i) {
        return ',hi' + i + ':i18n->' + l.code + '->>title,hm' + i + ':mt->' + l.code + '->>hash';
      }).join('');
      return LIGHT + (noRejected ? '' : ',rejected_at') + own + each;
    }

    // Back into the shape the rest of this file reads: i18n and mt for
    // the one language, and the languages the post is readable in.
    function hydrate(row, lang) {
      var p = {};
      Object.keys(row).forEach(function (k) {
        if (!/^(tr_|mt_|hi\d|hm\d)/.test(k)) p[k] = row[k];
      });
      p.i18n = {};
      p.mt = {};
      if (row.tr_t || row.tr_e) p.i18n[lang] = { title: row.tr_t || '', excerpt: row.tr_e || '' };
      if (row.mt_f) {
        p.mt[lang] = { title: row.mt_t || '', excerpt: row.mt_e || '', tags: row.mt_g || [],
                       from: row.mt_f, headHash: row.mt_h };
      }
      var have = {};
      have[row.lang || 'en'] = true;
      R.LANGS.forEach(function (l, i) { if (row['hi' + i] || row['hm' + i]) have[l.code] = true; });
      p._langs = R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return have[c]; });
      p._light = true;
      return p;
    }

    // One page of cards, or the next page on "Show more". `upTo` asks
    // for that many at once — the way back from a post, to the place
    // the reader left.
    function loadList(more, upTo) {
      var token = ++listToken;
      var lang = listLang;
      var from = more ? posts.length : 0;
      var size = Math.max(PAGE_SIZE, upTo || 0);
      loading = true;
      paintMore();
      return filtered(client.from('posts').select(lightSelect(lang), { count: 'exact' }), lang)
        .order('post_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + size - 1)
        .then(function (res) {
          if (token !== listToken) return;
          loading = false;
          if (res.error) {
            // §38 not run yet: no rejected_at to leave out.
            if (!noRejected && /rejected_at/.test(res.error.message)) {
              noRejected = true;
              return loadList(more, upTo);
            }
            console.error('Failed to load posts:', res.error.message);
            renderCards();
            return;
          }
          var rows = (res.data || []).map(function (r) { return hydrate(r, lang); });
          posts = more ? posts.concat(rows) : rows;
          total = typeof res.count === 'number' ? res.count : posts.length;
          renderCards();
          paintPendingCount();
        });
    }

    // Not live, and not turned down: what "Not published" lists.
    function isPending(p) {
      return !p.published && !p.rejected_at;
    }

    /* ---------------- The eight topics ---------------- */

    // Eight cards, each an icon, a name and the one sentence saying
    // what is on it. No count: a shelf with nothing on it yet should
    // read as a place to go, not as a zero.
    //
    // They are links, so middle-click and "open in new tab" do what
    // they should; a plain click filters in place. `aria-pressed` is
    // what a screen reader is told, and what the CSS styles, so the two
    // can never disagree about which topic is open.
    function buildCategoryBar() {
      if (!filtersEl) return;
      filtersEl.innerHTML = B.CATEGORIES.map(function (c) {
        return '<a class="cat-card" href="' + B.href(c.id) +
          '" data-filter="' + escapeHTML(c.id) + '" aria-pressed="false">' +
          '<span class="cat-card-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24">' + B.icon(c.id) + '</svg>' +
          '</span><h3></h3><p></p></a>';
      }).join('');
      paintCategoryBar();
    }

    // Names and descriptions, on load and on a language change.
    function paintCategoryBar() {
      if (!filtersEl) return;
      filtersEl.querySelectorAll('.cat-card').forEach(function (card) {
        var id = card.dataset.filter;
        card.querySelector('h3').textContent = B.label(id);
        card.querySelector('p').textContent = B.describe(id);
      });
      markActiveFilter();
    }

    /* ---------------- Rendering ---------------- */

    // The heading over the list says where the reader is — "Latest
    // posts", or the topic they picked — and the line under it says how
    // many are actually there, in the language being read. The count is
    // the list's own, not a guess: an empty topic says so rather than
    // showing a heading over nothing.
    // `showing` is the list's own length, passed in rather than counted
    // again here: a heading that says four over a list of seven is
    // worse than no heading, and two predicates kept in step by hand is
    // how that happens.
    function renderLanding(showing) {
      if (allTitleEl) {
        allTitleEl.textContent = pendingOnly ? t('admin.pendingTitle', 'Waiting to be published')
          : activeFilter === 'all' ? t('blog.latestPosts', 'Latest posts') : categoryLabel(activeFilter);
        allTitleEl.hidden = !!activeTag;
      }
      if (countEl) {
        countEl.textContent = activeTag ? '' : postCount(showing);
        countEl.hidden = !!activeTag;
      }
      if (allBtn) allBtn.setAttribute('aria-pressed', activeFilter === 'all' ? 'true' : 'false');
      if (pendingBtn) {
        pendingBtn.hidden = !isAdmin;
        pendingBtn.setAttribute('aria-pressed', pendingOnly ? 'true' : 'false');
      }
    }

    // How many are waiting: a count from the database, not from the
    // page of cards that happens to be loaded.
    function paintPendingCount() {
      if (!pendingBtn || !isAdmin) return;
      var q = client.from('posts').select('id', { count: 'exact', head: true }).eq('published', false);
      if (!noRejected) q = q.is('rejected_at', null);
      q.then(function (res) {
        if (res.error) return;
        if (pendingN) pendingN.textContent = res.count ? String(res.count) : '';
      });
    }

    // "3 posts", "1 post", "Nothing yet" — one is not three, and a
    // shelf with nothing on it should say so rather than count to zero.
    function postCount(n) {
      if (!n) return t('blog.postCount.none', 'Nothing yet');
      if (n === 1) return t('blog.postCount.one', '1 post');
      return t('blog.postCount', '{n} posts').replace('{n}', n);
    }

    function renderTagBanner() {
      if (!listEl.parentElement) return;
      var banner = listEl.parentElement.querySelector('.blog-tag-banner');
      if (!activeTag) { if (banner) banner.remove(); return; }
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'blog-tag-banner';
        listEl.parentElement.insertBefore(banner, listEl);
      }
      // The tag in the address bar is the one it was written in; show
      // the reader whichever label they would have clicked.
      var shownTag = activeTag;
      posts.some(function (p) {
        var own = p.tags || [];
        var i = own.map(function (x) { return String(x).toLowerCase(); }).indexOf(activeTag.toLowerCase());
        if (i === -1) return false;
        var tr = MT && MT.tagsFor(p, listLang);
        if (tr && tr[i]) { shownTag = tr[i]; return true; }
        return false;
      });
      banner.innerHTML =
        '<span>' + escapeHTML(t('blog.taggedWith', 'Tagged')) + ' <strong>#' +
          escapeHTML(shownTag) + '</strong></span>' +
        '<a href="/blog">' + escapeHTML(t('blog.clearTag', 'Clear')) + '</a>';
    }

    function renderCards() {
      // The database did the filtering (listQuery); what is here is
      // what matches, one page at a time.
      var shown = posts;
      renderTagBanner();
      renderLanding(total);
      listEl.innerHTML = shown.map(cardHTML).join('');
      paintMore();

      if (shown.length) {
        emptyEl.hidden = true;
      } else if (loading) {
        emptyEl.hidden = true;
      } else {
        emptyEl.hidden = false;
        emptyText.textContent = activeFilter === 'all'
          ? t('blog.emptyNote', 'No posts yet — the first one is on its way.')
          : t('blog.emptyTopic', 'No posts in this topic yet.');
        suggestEl.innerHTML = '';
        suggestEl.hidden = true;
        // Nothing in this language: name the ones that do have a post,
        // as buttons, rather than leaving a dead end.
        if (!pendingOnly) langsPresent().then(function (found) {
          if (posts.length) return;
          var others = found.filter(function (c) { return c !== listLang; });
          if (!others.length) return;
          emptyText.textContent = t('blog.noneInLang', 'Nothing here in {lang} yet.')
            .replace('{lang}', R.langLabel(listLang));
          suggestEl.innerHTML = '<span class="res-lang-suggest-label">' +
            escapeHTML(t('resources.availableIn', 'Available in')) + '</span>' +
            others.map(function (c) {
              return '<button type="button" class="btn btn-ghost" data-lang="' + escapeHTML(c) + '">' +
                escapeHTML(R.langLabel(c)) + '</button>';
            }).join('');
          suggestEl.hidden = false;
        });
      }

      wireCardLinks(listEl);
    }

    function paintMore() {
      if (!moreEl || !moreBtn) return;
      var left = total - posts.length;
      moreEl.hidden = !(left > 0);
      if (moreEl.hidden) return;
      moreBtn.disabled = loading;
      moreBtn.textContent = loading
        ? t('community.more.loading', 'Loading…')
        : t('community.more', 'Show more ({n} left)').replace('{n}', left);
    }
    if (moreBtn) moreBtn.addEventListener('click', function () { loadList(true); });

    // Leaving the list remembers where it was, so coming back lands on
    // the same post rather than at the top.
    function wireCardLinks(root) {
      if (!root) return;
      root.querySelectorAll('a[href*="/blog/post/"]').forEach(function (a) {
        a.addEventListener('click', function () {
          saveState({ scrollY: window.scrollY, shown: posts.length });
          try { sessionStorage.setItem(RETURN_KEY, '1'); } catch (e) {}
        });
      });
    }

    // One compact card per post: who it is for, the title, the summary,
    // topic · date, and the languages it is written in. The title's link
    // is stretched over the card in CSS, so the whole card opens the
    // post with one tab stop.
    function cardHTML(p) {
      var href = B.postHref(p.slug, listLang);
      var codes = readableLangs(p);
      var shown = codes.slice(0, 3);
      var more = codes.length - shown.length;
      var excerpt = readField(p, 'excerpt', listLang);
      // No glyph square: a Hangul character on the corner of an English
      // post means nothing to the person reading it. The downloads keep
      // theirs, where the glyph stands for a kind of material.
      return '<article class="res-card res-card--plain' +
          (p.image_url ? ' res-card--photo' : '') +
          (p.published ? '' : ' res-card--draft') + '">' +
        photoHTML(p, false) +
        '<div class="res-card-body">' +
          (p.published ? '' : '<span class="res-draft">' + escapeHTML(t('blog.draft', 'Draft')) + '</span>') +
          audienceBadges(p) +
          '<h3><a href="' + href + '">' + escapeHTML(readField(p, 'title', listLang)) + '</a></h3>' +
          (excerpt ? '<p class="res-card-desc">' + escapeHTML(excerpt) + '</p>' : '') +
          '<p class="res-meta">' + escapeHTML(categoryLabel(p.category) + ' · ' + formatDate(postDay(p))) + '</p>' +
          '<div class="res-card-foot">' +
            '<span class="res-langs" aria-label="' + escapeHTML(t('blog.writtenIn', 'Written in')) + '">' +
              shown.map(function (c) { return '<span class="res-chip">' + escapeHTML(R.langShort(c)) + '</span>'; }).join('') +
              (more > 0 ? '<span class="res-chip res-chip--more">+' + more + '</span>' : '') +
            '</span>' +
            '<span class="res-view">' + escapeHTML(t('blog.readMore', 'Read more')) + ' →</span>' +
          '</div>' +
          (isAdmin && isPending(p)
            ? '<div class="res-decide">' +
                '<button type="button" class="btn btn-primary res-decide-go" data-act="publish" data-id="' + escapeHTML(p.id) + '">' +
                  escapeHTML(t('admin.publish', 'Publish')) + '</button>' +
                '<button type="button" class="btn btn-ghost res-decide-no" data-act="reject" data-id="' + escapeHTML(p.id) + '">' +
                  escapeHTML(t('admin.reject', 'Reject')) + '</button>' +
                '<span class="res-decide-msg" role="status"></span>' +
              '</div>'
            : '') +
        '</div>' +
      '</article>';
    }

    function restoreScroll() {
      var back = false;
      try { back = sessionStorage.getItem(RETURN_KEY) === '1'; sessionStorage.removeItem(RETURN_KEY); } catch (e) {}
      if (!back) return;
      try {
        var st = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
        if (st && typeof st.scrollY === 'number') window.scrollTo(0, st.scrollY);
      } catch (e) {}
    }

    function findPost(id) {
      if (current && String(current.id) === String(id)) return current;
      return posts.filter(function (p) { return String(p.id) === String(id); })[0];
    }

    function renderSingle(post) {
      if (!singleEl) return;
      singleEl.hidden = false;
      listEl.hidden = true;
      if (toolbarEl) toolbarEl.hidden = true;
      if (leadInEl) leadInEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      if (allTitleEl) allTitleEl.hidden = true;
      if (countEl) countEl.hidden = true;
      var postUrl = location.origin + B.postHref(post.slug);

      // Which language to read it in: the one asked for in ?pl=, else
      // the language of the site, else the one it was written in. When
      // the wanted language is missing the page says so instead of
      // silently showing something else.
      var codes = readableLangs(post);
      var written = postLangs(post);
      // Resolved from scratch on every render: were the reader's own
      // choice allowed to stand in for what they asked for, the notice
      // below would vanish the first time anything re-rendered.
      var wanted = readPick || plOverride || postTunedTo ||
        (window.DURU_I18N && window.DURU_I18N.lang) || 'en';
      var missing = codes.indexOf(wanted) === -1;
      readLang = missing ? (codes.indexOf(post.lang) !== -1 ? post.lang : codes[0]) : wanted;

      // Written in this language, or shown as a translation beneath the
      // original? The second is the point of the feature: a reader in
      // Chinese meets the Korean sentence and its Chinese underneath.
      var pairs = written.indexOf(readLang) === -1 && MT ? MT.paired(post, readLang) : null;
      var bodyHTML = pairs
        ? bilingualHTML(pairs, post.lang || 'en', readLang)
        : paragraphs(field(post, 'body', readLang));
      // No note above the text: the pairing itself says what it is, and
      // a line of small print between the reader and the first sentence
      // was in the way.

      var langHTML = '';
      if (codes.length > 1 || missing) {
        langHTML = '<div class="blog-lang-row">' +
          '<label class="dl-lang" for="blogReadLang"><span>' +
            escapeHTML(t('blog.readIn', 'Read in')) + '</span>' +
            '<select id="blogReadLang">' + codes.map(function (c) {
              return '<option value="' + escapeHTML(c) + '"' + (c === readLang ? ' selected' : '') + '>' +
                escapeHTML(R.langLabel(c)) + '</option>';
            }).join('') + '</select></label>' +
          (missing ? '<p class="blog-lang-note">' +
            escapeHTML(t('blog.langMissing', 'Not written in {lang} yet — showing {shown}.')
              .replace('{lang}', R.langLabel(wanted)).replace('{shown}', R.langLabel(readLang))) +
            '</p>' : '') +
          '</div>';
      }

      var adminHTML = '';
      if (isAdmin) {
        adminHTML = '<div class="res-status ' + (post.published ? 'res-status--live' : 'res-status--draft') + '">' +
          '<span>' + escapeHTML(post.published
            ? t('blog.statusLive', 'Published — everyone can read this post.')
            : t('blog.statusDraft', 'Not published yet — only admins can read this post.')) + '</span>' +
          '<span class="res-status-actions">' +
            '<button type="button" class="btn ' + (post.published ? 'btn-outline-dark' : 'btn-primary') + '" id="blogPublishBtn">' +
              escapeHTML(post.published ? t('blog.unpublish', 'Unpublish') : t('blog.publishNow', 'Publish now')) +
            '</button>' +
            '<button type="button" class="btn btn-ghost" id="blogEditBtn">' + escapeHTML(t('blog.edit', 'Edit')) + '</button>' +
            '<button type="button" class="btn btn-ghost blog-delete-btn" id="blogDeleteBtn">' + escapeHTML(t('blog.delete', 'Delete')) + '</button>' +
          '</span>' +
        '</div>' + translationStatusHTML(post);
      }

      var navHTML = '<div class="blog-nav-slot">' + navHTMLFor(post, readLang) + '</div>';

      singleEl.innerHTML =
        '<a class="blog-back" href="/blog">' + escapeHTML(t('blog.backToAll', '← All posts')) + '</a>' +
        '<span class="blog-meta">' + escapeHTML(categoryLabel(post.category)) +
          (post.published ? '' : ' · <span class="blog-draft-tag">' + escapeHTML(t('blog.draft', 'Draft')) + '</span>') +
        '</span>' +
        audienceBadges(post) +
        '<h1>' + escapeHTML(readField(post, 'title', readLang)) + '</h1>' +
        (pairs && field(post, 'title', post.lang || 'en') !== readField(post, 'title', readLang)
          ? '<p class="mt-title-src" lang="' + escapeHTML(post.lang || 'en') + '">' +
            escapeHTML(field(post, 'title', post.lang || 'en')) + '</p>'
          : '') +
        '<p class="blog-date">' + escapeHTML(formatDate(postDay(post))) + '</p>' +
        photoHTML(post, true) +
        langHTML +
        adminHTML +
        '<div class="blog-post-actions">' +
          '<button type="button" class="like-btn" id="likePostBtn" data-id="' + post.id + '" data-liked="false">' +
            '<span class="like-icon">♡</span>' +
            '<span class="like-count" id="likeCount">0</span>' +
          '</button>' +
        '</div>' +
        '<div class="post-body' + (pairs ? ' post-body--mt' : '') + '">' + bodyHTML + '</div>' +
        renderTags(post, readLang) +
        // Straight under the writing, while the sentences are still in
        // mind. Sharing is what a reader does after, so it comes after.
        studyHTML(post, readLang) +
        '<div class="blog-share">' +
          '<span class="blog-share-label">' + escapeHTML(t('blog.share', 'Share this post')) + '</span>' +
          '<div class="blog-share-buttons">' +
            '<a href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(readField(post, 'title', readLang) + ' — Duru Korean') + '&url=' + encodeURIComponent(postUrl) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn twitter" title="Twitter" aria-label="Share on Twitter">𝕏</a>' +
            '<a href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(postUrl) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn facebook" title="Facebook" aria-label="Share on Facebook">f</a>' +
            '<a href="https://share.naver.com/web/shareView?url=' + encodeURIComponent(postUrl) + '&title=' + encodeURIComponent(readField(post, 'title', readLang)) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn naver" title="Naver" aria-label="Share on Naver">N</a>' +
            (kakaoKey()
              ? '<button type="button" class="blog-share-btn kakao" title="KakaoTalk" aria-label="Share on KakaoTalk" data-title="' + escapeHTML(readField(post, 'title', readLang)) + '" data-url="' + escapeHTML(postUrl) + '">K</button>'
              : '') +
            '<button type="button" class="blog-share-btn copy" title="Copy link" aria-label="Copy link" data-url="' + escapeHTML(postUrl) + '">🔗</button>' +
          '</div>' +
        '</div>' +
        navHTML +
        '<div id="postComments"></div>';
      document.title = readField(post, 'title', readLang) + ' — Duru Korean';
      setupShareButtons();
      setupLikeButton(post.id);
      if (window.DURU_COMMENTS) {
        window.DURU_COMMENTS.mount(singleEl.querySelector('#postComments'), post.id);
      }

      var readSel = singleEl.querySelector('#blogReadLang');
      if (readSel) {
        readSel.addEventListener('change', function () {
          readPick = readSel.value;
          renderSingle(post);
        });
      }
      var pubBtn = singleEl.querySelector('#blogPublishBtn');
      if (pubBtn) pubBtn.addEventListener('click', function () { togglePublished(post); });
      var editBtn = singleEl.querySelector('#blogEditBtn');
      if (editBtn) editBtn.addEventListener('click', function () { openEditor(post); });
      var delBtn = singleEl.querySelector('#blogDeleteBtn');
      if (delBtn) delBtn.addEventListener('click', function () { confirmDelete(post); });
      var trBtn = singleEl.querySelector('#blogTranslateBtn');
      if (trBtn) {
        trBtn.addEventListener('click', function () {
          trBtn.disabled = true;
          var box = singleEl.querySelector('.mt-status span');
          runTranslation(post, function (text) { if (box) box.textContent = text; })
            .then(function () { renderSingle(post); })
            .catch(function (err) {
              trBtn.disabled = false;
              if (box) box.textContent = t('blog.translateFailed', 'Saved, but the translation failed: {msg}')
                .replace('{msg}', err.message);
            });
        });
      }
    }

    // KakaoTalk sharing needs a per-site JavaScript key from the Kakao
    // developer console. Without one the button is not rendered at all,
    // rather than shown and failing on click. The SDK is fetched on first
    // use so sites without a key pay nothing for it.
    function kakaoKey() {
      return (window.DURU_KAKAO_CONFIG && window.DURU_KAKAO_CONFIG.jsKey) || '';
    }

    var kakaoSDK = null;
    function loadKakao() {
      if (kakaoSDK) return kakaoSDK;
      kakaoSDK = new Promise(function (resolve, reject) {
        if (window.Kakao) return resolve(window.Kakao);
        var s = document.createElement('script');
        s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
        s.onload = function () { resolve(window.Kakao); };
        s.onerror = function () { reject(new Error('Kakao SDK failed to load')); };
        document.head.appendChild(s);
      }).then(function (Kakao) {
        if (Kakao && !Kakao.isInitialized()) Kakao.init(kakaoKey());
        return Kakao;
      });
      return kakaoSDK;
    }

    function setupShareButtons() {
      var kakaoBtn = singleEl.querySelector('.blog-share-btn.kakao');
      if (kakaoBtn) {
        kakaoBtn.addEventListener('click', function () {
          loadKakao().then(function (Kakao) {
            Kakao.Share.sendDefault({
              objectType: 'text',
              text: kakaoBtn.dataset.title,
              link: { mobileWebUrl: kakaoBtn.dataset.url, webUrl: kakaoBtn.dataset.url }
            });
          }).catch(function () {
            if (window.DURU_NOTIFY) {
              window.DURU_NOTIFY.error(t('blog.shareFailed', 'Sharing is unavailable right now.'));
            }
          });
        });
      }

      var copyBtn = singleEl.querySelector('.blog-share-btn.copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          var url = copyBtn.dataset.url;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(function () {
              var orig = copyBtn.textContent;
              copyBtn.textContent = '✓';
              setTimeout(function () { copyBtn.textContent = orig; }, 2000);
            });
          } else {
            window.prompt('Copy this link:', url);
          }
        });
      }
    }

    function setupLikeButton(postId) {
      if (!window.DURU_LIKE) return;
      var likeBtn = singleEl.querySelector('#likePostBtn');
      if (!likeBtn) return;
      var likeCount = singleEl.querySelector('#likeCount');

      // A signed-out reader may add a heart but not take it back, so
      // once theirs is in, the button stops offering. Saying why beats
      // a click that quietly does nothing.
      function paint(state) {
        var spent = state.liked && !state.canUndo;
        likeBtn.classList.toggle('liked', state.liked);
        likeBtn.classList.toggle('is-spent', spent);
        likeBtn.setAttribute('aria-pressed', state.liked ? 'true' : 'false');
        likeBtn.disabled = spent;
        likeBtn.title = spent ? t('like.signInToUndo', 'Sign in to take a like back.') : '';
        likeBtn.querySelector('.like-icon').textContent = state.liked ? '♥' : '♡';
        if (likeCount) likeCount.textContent = String(state.total);
      }

      window.DURU_LIKE.getState('post', postId).then(paint);

      likeBtn.addEventListener('click', function () {
        likeBtn.disabled = true;
        window.DURU_LIKE.toggleLike('post', postId)
          .then(paint)
          .catch(function (err) {
            likeBtn.disabled = false;
            window.alert(R.schemaHint ? R.schemaHint(err.message) : err.message);
          });
      });
    }

    // The posts either side of this one. They are asked for on their
    // own (loadNeighbours), not found in a list of every post, and drawn
    // into their slot when they arrive.
    function navHTMLFor(post, lang) {
      var nav = post._nav || {};
      var prevPost = nav.prev || null;
      var nextPost = nav.next || null;
      if (!prevPost && !nextPost) return '';
      var html = '<div class="blog-nav">';
      if (prevPost) {
        html += '<a href="' + B.postHref(prevPost.slug) + '" class="blog-nav-prev">' +
          '<span class="blog-nav-label">' + escapeHTML(t('blog.prevPost', '← Previous')) + '</span>' +
          '<span class="blog-nav-title">' + escapeHTML(readField(prevPost, 'title', lang)) + '</span>' +
          '</a>';
      }
      if (nextPost) {
        html += '<a href="' + B.postHref(nextPost.slug) + '" class="blog-nav-next">' +
          '<span class="blog-nav-label">' + escapeHTML(t('blog.nextPost', 'Next →')) + '</span>' +
          '<span class="blog-nav-title">' + escapeHTML(readField(nextPost, 'title', lang)) + '</span>' +
          '</a>';
      }
      return html + '</div>';
    }

    // Previous is the newer post, next the older one — the order of the
    // list. Drafts are neighbours only to an admin (the read policy);
    // a post turned down is nobody's neighbour.
    function loadNeighbours(post) {
      if (!post.post_date) return Promise.resolve();
      var lang = readLang || listLang;
      var d = post.post_date, c = post.created_at;
      function side(newer) {
        var q = client.from('posts').select(lightSelect(lang));
        if (!noRejected) q = q.is('rejected_at', null);
        q = q.or(newer
          ? 'post_date.gt.' + d + ',and(post_date.eq.' + d + ',created_at.gt.' + c + ')'
          : 'post_date.lt.' + d + ',and(post_date.eq.' + d + ',created_at.lt.' + c + ')');
        return q.order('post_date', { ascending: newer }).order('created_at', { ascending: newer }).limit(1)
          .then(function (res) {
            var row = !res.error && res.data && res.data[0];
            return row ? hydrate(row, lang) : null;
          });
      }
      return Promise.all([side(true), side(false)]).then(function (both) {
        post._nav = { prev: both[0], next: both[1] };
        var slot = current === post && singleEl && singleEl.querySelector('.blog-nav-slot');
        if (slot) slot.innerHTML = navHTMLFor(post, readLang || lang);
      }).catch(function () {});
    }

    // The one post the address names, in full — body, every
    // translation, the study words — and nothing else.
    function loadSingle(slug) {
      return client.from('posts').select('*').eq('slug', slug).maybeSingle().then(function (res) {
        if (res.error) console.error('Failed to load the post:', res.error.message);
        var post = !res.error && res.data;
        if (!post || (post.rejected_at && !isAdmin)) { current = null; renderNotFound(); return; }
        current = post;
        renderSingle(post);
        loadNeighbours(post);
        return post;
      });
    }

    function renderNotFound() {
      if (!singleEl) return;
      singleEl.hidden = false;
      listEl.hidden = true;
      if (toolbarEl) toolbarEl.hidden = true;
      if (leadInEl) leadInEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      if (allTitleEl) allTitleEl.hidden = true;
      if (countEl) countEl.hidden = true;
      singleEl.innerHTML =
        '<a class="blog-back" href="/blog">' + escapeHTML(t('blog.backToAll', '← All posts')) + '</a>' +
        '<h1>' + escapeHTML(t('blog.notFoundTitle', 'Post not found')) + '</h1>' +
        '<p>' + escapeHTML(t('blog.notFoundBody', 'That post may have been removed, or the link is wrong.')) + '</p>';
    }

    /* ---------------- Loading ---------------- */

    function loadPosts() {
      var slug = currentSlug();
      buildLangSelect();
      if (slug) {
        return loadSingle(slug).then(function () {
          // Opened from a card or a link: start at the title, not at the
          // banner and the topic cards above it. Once more when the page
          // has finished loading, in case fonts or pictures above the
          // article moved it — unless the reader has scrolled by then.
          var title = singleEl && singleEl.querySelector('h1');
          if (title && window.DURU_SCROLL_TO) {
            window.DURU_SCROLL_TO(title);
            var placed = window.pageYOffset;
            window.addEventListener('load', function () {
              if (Math.abs(window.pageYOffset - placed) < 4) window.DURU_SCROLL_TO(title);
            }, { once: true });
          }
        });
      }
      current = null;
      markActiveFilter();
      // Coming back from a post: as many cards as were showing, so the
      // saved scroll position lands on the same card.
      var upTo = 0;
      var back = false;
      try {
        back = sessionStorage.getItem(RETURN_KEY) === '1';
        var st = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
        if (back && st && st.shown) upTo = Math.min(200, st.shown);
      } catch (e) {}
      return loadList(false, upTo).then(restoreScroll);
    }

    /* ---------------- Editor ---------------- */

    var overlay = null;
    var editing = null;
    // True once the author picks a language themselves; until then the
    // select follows what they type. Writing Korean while browsing the
    // site in English used to file the post as English — and a post
    // filed as English gets no self-study corner, which is a confusing
    // way to find out.
    var langTouched = false;
    // Tags are suggested from the body once it settles, and only while
    // the author has not written their own: an automatic label should
    // never overwrite a deliberate one.
    // What the author has written for themselves. An automatic answer
    // fills a field only while its own flag is false — a suggestion
    // should never overwrite a decision.
    var tagsTouched = false;
    var summaryTouched = false;
    var categoryTouched = false;
    var audienceTouched = false;
    // What the date field held when the editor opened. Only a real
    // change counts as the admin setting the date by hand.
    var postDateWas = '';
    // The photo currently on the post being edited: either what it came
    // with, or one picked from a search. null means no picture.
    var photoNow = null;
    var photoBusy = false;
    var outlineBusy = false;
    var outlineTimer = null;
    var outlineFrom = '';

    var saving = false;
    var autoSaveTimer = null;
    var lastSaveTime = null;

    function buildEditor() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="auth-modal post-modal post-modal-wide" role="dialog" aria-modal="true" aria-labelledby="postEditorTitle">' +
          '<button type="button" class="auth-close" id="postCloseBtn" aria-label="Close">&times;</button>' +
          '<h2 id="postEditorTitle"></h2>' +
          '<div class="auto-save-status"></div>' +
          '<div class="auth-message" data-msg="post" hidden></div>' +
          '<div class="post-editor-container">' +
            '<form id="postForm" novalidate class="post-editor-form">' +
              '<div class="auth-field"><label for="postTitle"></label>' +
                '<input type="text" id="postTitle" required maxlength="160">' +
                // What the generator considered before it picked one.
                // Clicking any of them swaps the title; the one in the
                // field is marked so it is clear which is in use.
                '<div class="post-alts" id="postAlts" hidden></div>' +
                '<p class="resource-hint" id="postTopic" hidden></p></div>' +
              '<div class="auth-field"><label for="postCategory"></label>' +
                '<select id="postCategory">' + CATEGORIES.map(function (c) {
                  return '<option value="' + c + '"></option>';
                }).join('') + '</select></div>' +
              '<div class="auth-field"><span class="auth-field-label" id="postAudienceLabel"></span>' +
                '<div class="post-aud-row">' + B.AUDIENCES.map(function (a) {
                  return '<label class="post-aud"><input type="checkbox" data-aud="' +
                    escapeHTML(a) + '"> <span class="aud-badge aud-badge--' + escapeHTML(a) +
                    '"></span></label>';
                }).join('') + '</div></div>' +
              '<div class="auth-field"><label for="postExcerpt"></label>' +
                '<textarea id="postExcerpt" rows="2" maxlength="400"></textarea></div>' +
              '<div class="auth-field"><label for="postBody"></label>' +
                '<textarea id="postBody" rows="12" required maxlength="40000"></textarea></div>' +
              // Tags come after the body because they are read off it:
              // there is nothing to suggest until something is written.
              '<div class="auth-field"><label for="postTags"></label>' +
                '<div class="post-tags-row">' +
                  '<input type="text" id="postTags" maxlength="280" placeholder="hangul, beginner">' +
                  '<button type="button" class="res-linkbtn" id="postTagsBtn"></button>' +
                '</div>' +
                '<p class="resource-hint" id="postTagsHint"></p></div>' +
              // The photograph. The generator finds one each morning;
              // this is for when it found the wrong one. The service's
              // key never reaches the browser — api/photo.js does the
              // searching, admin-gated like api/translate.js.
              '<div class="auth-field"><span class="auth-field-label" id="postPhotoLabel"></span>' +
                '<div class="post-photo-box" id="postPhotoBox"></div>' +
                '<div class="post-photo-find">' +
                  '<input type="text" id="postPhotoQuery" maxlength="120">' +
                  '<button type="button" class="res-linkbtn" id="postPhotoBtn"></button>' +
                '</div>' +
                '<div class="post-photo-results" id="postPhotoResults" hidden></div>' +
                '<p class="resource-hint" id="postPhotoHint"></p></div>' +
              // The day readers see. Left alone it is the day the draft
              // was written; changed here it is whatever the admin
              // says, and post_date_source records which.
              '<div class="auth-field"><label for="postDate"></label>' +
                '<input type="date" id="postDate">' +
                '<p class="resource-hint" id="postDateHint"></p></div>' +
              '<div class="auth-field"><label for="postLang"></label>' +
                '<select id="postLang">' + R.LANGS.map(function (l) {
                  return '<option value="' + escapeHTML(l.code) + '">' + escapeHTML(l.label) + '</option>';
                }).join('') + '</select></div>' +
              // The same post in other languages. Collapsed, because most
              // of the time only one language is being written.
              '<details class="res-more" id="postTranslations"><summary></summary>' +
                '<p class="resource-hint" id="postTranslationsHint"></p>' +
                R.LANGS.map(function (l) {
                  return '<details class="res-more res-more--nested" data-tr="' + escapeHTML(l.code) + '">' +
                    '<summary>' + escapeHTML(l.label) + ' <span class="post-tr-state"></span></summary>' +
                    '<div class="auth-field"><input type="text" data-tr-title="' + escapeHTML(l.code) + '" maxlength="160"></div>' +
                    '<div class="auth-field"><textarea data-tr-excerpt="' + escapeHTML(l.code) + '" rows="2" maxlength="400"></textarea></div>' +
                    '<div class="auth-field"><textarea data-tr-body="' + escapeHTML(l.code) + '" rows="8" maxlength="40000"></textarea></div>' +
                  '</details>';
                }).join('') +
              '</details>' +
              '<label class="post-publish-row"><input type="checkbox" id="postAutoTranslate" checked> <span id="postAutoTranslateLabel"></span></label>' +
              '<label class="post-publish-row"><input type="checkbox" id="postPublished"> <span id="postPublishedLabel"></span></label>' +
              '<button type="submit" class="btn btn-primary auth-submit" id="postSubmit"></button>' +
            '</form>' +
            '<div class="post-preview-pane">' +
              '<div class="post-preview-title" data-i18n="blog.preview">Preview</div>' +
              '<div id="postPreview" class="post-preview"></div>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeEditor(); });
      overlay.querySelector('#postCloseBtn').addEventListener('click', closeEditor);
      overlay.querySelector('#postForm').addEventListener('submit', savePost);
      var bodyTextarea = overlay.querySelector('#postBody');
      if (bodyTextarea) {
        bodyTextarea.addEventListener('input', updatePreview);
        bodyTextarea.addEventListener('change', updatePreview);
      }
      overlay.querySelector('#postLang').addEventListener('change', function () {
        langTouched = true;
        markTranslationState();
      });
      ['#postBody', '#postTitle'].forEach(function (sel) {
        overlay.querySelector(sel).addEventListener('input', followTypedLanguage);
      });
      overlay.querySelector('#postBody').addEventListener('input', scheduleOutline);
      overlay.querySelector('#postBody').addEventListener('blur', function () { fillOutline(false); });
      overlay.querySelector('#postAlts').addEventListener('click', function (e) {
        var btn = e.target.closest('.post-alt');
        if (!btn) return;
        overlay.querySelector('#postTitle').value = btn.textContent;
        renderAlts();
      });
      overlay.querySelector('#postTitle').addEventListener('input', renderAlts);
      overlay.querySelector('#postPhotoBtn').addEventListener('click', runPhotoSearch);
      overlay.querySelector('#postPhotoQuery').addEventListener('keydown', function (e) {
        // Enter in a text input inside a form submits it; here it
        // should search, not save a half-written post.
        if (e.key === 'Enter') { e.preventDefault(); runPhotoSearch(); }
      });
      overlay.querySelector('#postPhotoBox').addEventListener('click', function (e) {
        if (!e.target.closest('#postPhotoClear')) return;
        photoNow = null;
        renderPhotoBox();
        setPhotoHint(t('blog.photoCleared', 'Taken off. Save to keep it that way.'));
      });
      overlay.querySelector('#postPhotoResults').addEventListener('click', function (e) {
        var btn = e.target.closest('.post-photo-pick');
        if (!btn) return;
        var all = [];
        try { all = JSON.parse(overlay.querySelector('#postPhotoResults').dataset.photos || '[]'); } catch (err) {}
        var picked = all[Number(btn.dataset.i)];
        if (!picked) return;
        photoNow = picked;
        renderPhotoBox();
        setPhotoHint(t('blog.photoChosen', 'Chosen. Save to keep it.'));
        // Unsplash asks to be told when a photo is actually used, so a
        // photographer's count means something. Best effort only.
        if (picked.downloadLocation) {
          client.auth.getSession().then(function (r) {
            var token = r && r.data && r.data.session && r.data.session.access_token;
            if (!token) return;
            fetch('/api/photo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ used: picked.downloadLocation })
            }).catch(function () {});
          });
        }
      });
      overlay.querySelector('#postTags').addEventListener('input', function () { tagsTouched = true; });
      overlay.querySelector('#postExcerpt').addEventListener('input', function () { summaryTouched = true; });
      overlay.querySelector('#postCategory').addEventListener('change', function () {
        categoryTouched = true;
      });
      overlay.querySelectorAll('[data-aud]').forEach(function (box) {
        box.addEventListener('change', function () { audienceTouched = true; });
      });
      overlay.querySelector('#postTagsBtn').addEventListener('click', function () {
        tagsTouched = summaryTouched = categoryTouched = audienceTouched = false;
        fillOutline(true);
      });
      overlay.querySelectorAll('[data-tr-body]').forEach(function (el) {
        el.addEventListener('input', markTranslationState);
      });
      return overlay;
    }

    // Today in Seoul, as YYYY-MM-DD, whatever the browser's clock is
    // set to — the same day the database's default would pick.
    function todayInSeoul() {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
      } catch (e) {
        return new Date().toISOString().slice(0, 10);
      }
    }

    // The date to save, and whether the admin chose it. Left untouched,
    // neither field is written: a new post takes the database's default
    // and an existing one keeps what it had.
    // What the photo fields should be on save. Written every time, so
    // taking a picture off is a save like any other.
    function photoPatch() {
      return {
        image_url: photoNow ? photoNow.url : null,
        image_alt: photoNow ? (photoNow.alt || null) : null,
        image_credit: photoNow ? (photoNow.credit || null) : null,
        image_credit_url: photoNow ? (photoNow.creditUrl || null) : null,
        image_source: photoNow ? (photoNow.source || null) : null,
        image_status: photoNow ? 'READY' : null
      };
    }

    function datePatch() {
      if (!overlay) return {};
      var picked = overlay.querySelector('#postDate').value;
      if (!picked || picked === postDateWas) return {};
      return { post_date: picked, post_date_source: 'ADMIN' };
    }

    // The alternatives a generated draft carries, and the topic it was
    // written to answer. Neither appears on a post an admin typed.
    function renderAlts() {
      if (!overlay) return;
      var box = overlay.querySelector('#postAlts');
      var topicEl = overlay.querySelector('#postTopic');
      var alts = (editing && editing.title_candidates) || [];
      var current = overlay.querySelector('#postTitle').value.trim();

      box.hidden = alts.length < 2;
      box.innerHTML = box.hidden ? '' :
        '<span class="post-alts-label">' + escapeHTML(t('blog.titleAlts', 'Other titles it considered')) + '</span>' +
        alts.map(function (title) {
          return '<button type="button" class="post-alt' + (title === current ? ' is-current' : '') +
            '">' + escapeHTML(title) + '</button>';
        }).join('');

      var topic = (editing && editing.topic) || '';
      topicEl.hidden = !topic;
      topicEl.textContent = topic
        ? t('blog.writtenFor', 'Written to answer: {topic}').replace('{topic}', topic)
        : '';
    }

    function setPhotoHint(text, isError) {
      if (!overlay) return;
      var el = overlay.querySelector('#postPhotoHint');
      el.textContent = text || '';
      el.classList.toggle('is-error', !!isError);
    }

    // What is on the post right now, with its credit and a way to take
    // it off. Rendered rather than templated because it changes every
    // time a search result is clicked.
    function renderPhotoBox() {
      if (!overlay) return;
      var box = overlay.querySelector('#postPhotoBox');
      if (!photoNow || !photoNow.url) {
        box.innerHTML = '<p class="post-photo-none">' +
          escapeHTML(t('blog.photoNone', 'No photo on this post.')) + '</p>';
        return;
      }
      box.innerHTML =
        '<img src="' + escapeHTML(photoNow.url) + '" alt="">' +
        '<div class="post-photo-meta">' +
          '<p class="post-photo-alt">' + escapeHTML(photoNow.alt || '') + '</p>' +
          (photoNow.credit
            ? '<p class="post-photo-credit">' +
                escapeHTML(t('blog.photoBy', 'Photo by {name}').replace('{name}', photoNow.credit)) +
                (photoSource(photoNow.source) ? ' · ' + escapeHTML(photoSource(photoNow.source)) : '') +
              '</p>'
            : '') +
          '<button type="button" class="res-linkbtn is-danger" id="postPhotoClear">' +
            escapeHTML(t('blog.photoRemove', 'Remove')) + '</button>' +
        '</div>';
    }

    // Asks api/photo.js, which holds the key. The caller's own token
    // goes with it, the same way the translation calls work.
    function searchPhotos(query) {
      return client.auth.getSession().then(function (res) {
        var token = res && res.data && res.data.session && res.data.session.access_token;
        if (!token) throw new Error(t('blog.photoSignIn', 'Sign in again to search for photos.'));
        return fetch('/api/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ query: query, count: 8 })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (data) {
            if (!r.ok) throw new Error(data.error || ('사진 검색 실패 (' + r.status + ')'));
            return data.photos || [];
          });
        });
      });
    }

    function runPhotoSearch() {
      if (!overlay || photoBusy) return;
      var query = overlay.querySelector('#postPhotoQuery').value.trim();
      if (!query) { setPhotoHint(t('blog.photoAsk', 'Type what to look for, in English.')); return; }
      photoBusy = true;
      setPhotoHint(t('blog.photoSearching', 'Looking…'));
      searchPhotos(query).then(function (photos) {
        photoBusy = false;
        var results = overlay.querySelector('#postPhotoResults');
        results.hidden = !photos.length;
        results.innerHTML = photos.map(function (ph, i) {
          return '<button type="button" class="post-photo-pick" data-i="' + i + '">' +
            '<img src="' + escapeHTML(ph.thumb || ph.url) + '" alt="' + escapeHTML(ph.alt || '') + '">' +
            '<span>' + escapeHTML(ph.credit || '') + '</span></button>';
        }).join('');
        results.dataset.photos = JSON.stringify(photos);
        setPhotoHint(photos.length
          ? t('blog.photoPick', 'Click one to put it on the post.')
          : t('blog.photoNothing', 'Nothing came back for that. Try other words.'));
      }).catch(function (err) {
        photoBusy = false;
        setPhotoHint(err.message, true);
      });
    }

    function readAudiences() {
      var out = [];
      overlay.querySelectorAll('[data-aud]').forEach(function (box) {
        if (box.checked) out.push(box.dataset.aud);
      });
      return out;
    }

    function writeAudiences(list) {
      var have = {};
      (list || []).forEach(function (a) { have[a] = true; });
      overlay.querySelectorAll('[data-aud]').forEach(function (box) {
        box.checked = !!have[box.dataset.aud];
      });
    }

    function setTagsHint(text, isError) {
      if (!overlay) return;
      var el = overlay.querySelector('#postTagsHint');
      el.textContent = text || '';
      el.classList.toggle('is-error', !!isError);
    }

    // Reads the post once and fills in the summary, the category and
    // the tags. Runs by itself a moment after the body stops changing,
    // and on the button at any time — the button is how to ask again
    // after an edit, and it refills every field including the ones
    // already written.
    function fillOutline(force) {
      if (!overlay || !MT || outlineBusy) return;
      var body = overlay.querySelector('#postBody').value.trim();
      var title = overlay.querySelector('#postTitle').value.trim();
      if (body.length < 80) return;

      var wantTags = force || (!tagsTouched && !overlay.querySelector('#postTags').value.trim());
      var wantSummary = force || (!summaryTouched && !overlay.querySelector('#postExcerpt').value.trim());
      var wantCategory = force || !categoryTouched;
      var wantAudience = force || (!audienceTouched && !readAudiences().length);
      if (!wantTags && !wantSummary && !wantCategory && !wantAudience) return;
      if (!force && outlineFrom === body) return;

      outlineBusy = true;
      outlineFrom = body;
      setTagsHint(t('blog.tagsWorking', 'Reading the post…'));
      MT.suggestOutline(client, {
        from: overlay.querySelector('#postLang').value,
        title: title,
        body: body,
        categories: B.forOutline(),
        audiences: B.audiencesForOutline()
      }).then(function (out) {
        outlineBusy = false;
        if (!out) { setTagsHint(''); return; }
        var filled = [];
        if (wantSummary && out.summary && (force || !summaryTouched)) {
          overlay.querySelector('#postExcerpt').value = out.summary;
          filled.push(t('blog.fieldExcerpt', 'Summary (shown on the card)'));
        }
        if (wantCategory && out.category && (force || !categoryTouched)) {
          overlay.querySelector('#postCategory').value = out.category;
          filled.push(t('blog.fieldCategory', 'Category'));
        }
        if (wantAudience && out.audiences && out.audiences.length && (force || !audienceTouched)) {
          writeAudiences(out.audiences);
          filled.push(t('blog.fieldAudience', "Who it's for"));
        }
        if (wantTags && out.tags && out.tags.length && (force || !tagsTouched)) {
          overlay.querySelector('#postTags').value = out.tags.join(', ');
          filled.push(t('blog.fieldTags', 'Tags (comma separated)'));
        }
        setTagsHint(filled.length
          ? t('blog.outlineDone', 'Filled in from the body: {fields}. Change anything you like.')
              .replace('{fields}', filled.join(', '))
          : t('blog.tagsNone', 'Nothing obvious to fill in — write your own.'));
      }).catch(function (err) {
        outlineBusy = false;
        outlineFrom = '';
        setTagsHint(err.message, true);
      });
    }

    function scheduleOutline() {
      if (outlineTimer) clearTimeout(outlineTimer);
      outlineTimer = setTimeout(function () { fillOutline(false); }, 1500);
    }

    // Set "Written in" from the script of what has been typed, unless
    // the author has already chosen. The select is visible and changes
    // in front of them, so this suggests rather than decides.
    function followTypedLanguage() {
      if (!overlay || langTouched || !MT || !MT.detectLang) return;
      var sel = overlay.querySelector('#postLang');
      var guess = MT.detectLang(
        overlay.querySelector('#postTitle').value + '\n' + overlay.querySelector('#postBody').value);
      if (!guess || guess === sel.value) return;
      sel.value = guess;
      markTranslationState();
    }

    // "Written" / "—" beside each language, and the language the post
    // itself is in hidden from the list so it cannot be filled twice.
    function markTranslationState() {
      if (!overlay) return;
      var base = overlay.querySelector('#postLang').value;
      overlay.querySelectorAll('[data-tr]').forEach(function (box) {
        var code = box.dataset.tr;
        box.hidden = code === base;
        var body = overlay.querySelector('[data-tr-body="' + code + '"]');
        var state = box.querySelector('.post-tr-state');
        if (state) {
          state.textContent = body && body.value.trim()
            ? t('blog.trWritten', 'written') : t('blog.trEmpty', 'empty');
          state.className = 'post-tr-state' + (body && body.value.trim() ? ' is-written' : '');
        }
      });
    }

    function readTranslations() {
      var base = overlay.querySelector('#postLang').value;
      var out = {};
      R.LANGS.forEach(function (l) {
        if (l.code === base) return;
        var title = overlay.querySelector('[data-tr-title="' + l.code + '"]').value.trim();
        var excerpt = overlay.querySelector('[data-tr-excerpt="' + l.code + '"]').value.trim();
        var body = overlay.querySelector('[data-tr-body="' + l.code + '"]').value.trim();
        if (!title && !excerpt && !body) return;
        var entry = {};
        if (title) entry.title = title;
        if (excerpt) entry.excerpt = excerpt;
        if (body) entry.body = body;
        out[l.code] = entry;
      });
      return out;
    }

    function updatePreview() {
      if (!overlay) return;
      var preview = overlay.querySelector('#postPreview');
      if (!preview) return;
      var body = overlay.querySelector('#postBody').value;
      preview.innerHTML = '<div class="post-body">' + paragraphs(body) + '</div>';
    }

    function updateAutoSaveStatus() {
      if (!overlay) return;
      var statusEl = overlay.querySelector('.auto-save-status');
      if (!statusEl) return;
      if (lastSaveTime) {
        statusEl.textContent = t('blog.lastSaved', 'Saving…').replace('Saving…', 'Saved ' + formatDate(lastSaveTime));
        statusEl.style.color = 'var(--ink-dim)';
      } else {
        statusEl.textContent = '';
      }
    }

    function startAutoSave() {
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      autoSaveTimer = setInterval(function () {
        if (overlay && !overlay.hidden && editing && !saving) {
          var title = overlay.querySelector('#postTitle').value.trim();
          var body = overlay.querySelector('#postBody').value.trim();
          if (title && body) {
            var row = {
              title: title,
              category: overlay.querySelector('#postCategory').value,
              audiences: readAudiences(),
              excerpt: overlay.querySelector('#postExcerpt').value.trim() || null,
              tags: parseTags(overlay.querySelector('#postTags').value),
              body: body,
              lang: overlay.querySelector('#postLang').value,
              i18n: readTranslations(),
              published: overlay.querySelector('#postPublished').checked,
              updated_at: new Date().toISOString()
            };
            Object.assign(row, datePatch(), photoPatch());
            client.from('posts').update(row).eq('id', editing.id).then(function (res) {
              if (!res.error) {
                lastSaveTime = new Date().toISOString();
                updateAutoSaveStatus();
              }
            });
          }
        }
      }, 30000);
    }

    function labelEditor() {
      var o = buildEditor();
      o.querySelector('#postEditorTitle').textContent = editing
        ? t('blog.editorEditTitle', 'Edit post') : t('blog.editorNewTitle', 'Write a post');
      o.querySelector('label[for="postTitle"]').textContent = t('blog.fieldTitle', 'Title');
      o.querySelector('label[for="postDate"]').textContent = t('blog.fieldPostDate', 'Shown as posted on');
      renderAlts();
      o.querySelector('#postDateHint').textContent = t('blog.postDateHint',
        'The day the draft was written. Approving later does not move it — change it here if you want a different day.');
      o.querySelector('label[for="postCategory"]').textContent = t('blog.fieldCategory', 'Category');
      o.querySelector('#postAudienceLabel').textContent = t('blog.fieldAudience', "Who it's for");
      o.querySelector('#postPhotoLabel').textContent = t('blog.fieldPhoto', 'Photo');
      o.querySelector('#postPhotoBtn').textContent = t('blog.photoSearch', 'Search');
      o.querySelector('#postPhotoQuery').placeholder = t('blog.photoPlaceholder', 'Seoul subway station');
      renderPhotoBox();
      o.querySelectorAll('[data-aud]').forEach(function (box) {
        box.nextElementSibling.textContent = B.audienceLabel(box.dataset.aud);
      });
      o.querySelector('label[for="postExcerpt"]').textContent = t('blog.fieldExcerpt', 'Summary (shown on the card)');
      o.querySelector('label[for="postTags"]').textContent = t('blog.fieldTags', 'Tags (comma separated)');
      o.querySelector('#postTagsBtn').textContent = t('blog.suggestTags', 'Read the post again');
      if (!outlineBusy) setTagsHint(t('blog.tagsHint',
        'The summary, the category and these tags fill themselves in from the body when you stop typing. Edit any of them freely.'));
      o.querySelector('label[for="postBody"]').textContent = t('blog.fieldBody', 'Body');
      o.querySelector('label[for="postLang"]').textContent = t('blog.fieldLang', 'Written in');
      o.querySelector('#postTranslations > summary').textContent = t('blog.translations', 'Other languages');
      o.querySelector('#postTranslationsHint').textContent =
        t('blog.translationsHint', 'Fill in a language to offer the post in it. A language needs a body to count as written.');
      o.querySelectorAll('[data-tr-title]').forEach(function (el) {
        el.placeholder = t('blog.fieldTitle', 'Title');
      });
      o.querySelectorAll('[data-tr-excerpt]').forEach(function (el) {
        el.placeholder = t('blog.fieldExcerpt', 'Summary (shown on the card)');
      });
      o.querySelectorAll('[data-tr-body]').forEach(function (el) {
        el.placeholder = t('blog.fieldBody', 'Body');
      });
      markTranslationState();
      o.querySelector('#postAutoTranslateLabel').textContent =
        t('blog.autoTranslateLabel', 'Translate into the other languages when I save');
      o.querySelector('#postPublishedLabel').textContent = t('blog.fieldPublished', 'Publish now (leave off to save as a draft)');
      o.querySelector('#postSubmit').textContent = t('blog.save', 'Save');
      CATEGORIES.forEach(function (c, i) {
        o.querySelectorAll('#postCategory option')[i].textContent = categoryLabel(c);
      });
      updateAutoSaveStatus();
    }

    function setMsg(type, text) {
      var el = overlay.querySelector('[data-msg="post"]');
      el.className = 'auth-message ' + type;
      el.textContent = text;
      el.hidden = false;
    }

    function openEditor(post) {
      editing = post || null;
      var o = buildEditor();
      labelEditor();
      lastSaveTime = null;
      o.querySelector('[data-msg="post"]').hidden = true;
      o.querySelector('#postTitle').value = editing ? editing.title : '';
      renderAlts();
      photoNow = editing && editing.image_url ? {
        url: editing.image_url, alt: editing.image_alt || '',
        credit: editing.image_credit || '', creditUrl: editing.image_credit_url || '',
        source: editing.image_source || ''
      } : null;
      photoBusy = false;
      o.querySelector('#postPhotoQuery').value = '';
      o.querySelector('#postPhotoResults').hidden = true;
      o.querySelector('#postPhotoResults').innerHTML = '';
      renderPhotoBox();
      setPhotoHint(t('blog.photoHint',
        'Free photos from Unsplash and Pexels, searched in English. The credit is saved with the picture.'));
      // A new post has no day yet: the database fills it in, in Seoul.
      o.querySelector('#postDate').value = (editing && postDay(editing)) || todayInSeoul();
      postDateWas = o.querySelector('#postDate').value;
      o.querySelector('#postCategory').value = editing ? editing.category : CATEGORIES[0];
      writeAudiences(editing ? editing.audiences : []);
      o.querySelector('#postExcerpt').value = editing && editing.excerpt ? editing.excerpt : '';
      o.querySelector('#postTags').value = editing && editing.tags ? editing.tags.join(', ') : '';
      // A post that already carries tags keeps them; a new one is open
      // to a suggestion until the author types.
      tagsTouched = !!(editing && editing.tags && editing.tags.length);
      summaryTouched = !!(editing && editing.excerpt);
      categoryTouched = !!editing;
      audienceTouched = !!(editing && editing.audiences && editing.audiences.length);
      outlineBusy = false;
      outlineFrom = '';
      if (outlineTimer) { clearTimeout(outlineTimer); outlineTimer = null; }
      o.querySelector('#postBody').value = editing ? editing.body : '';
      o.querySelector('#postLang').value = (editing && editing.lang) ||
        (window.DURU_I18N && window.DURU_I18N.lang) || 'en';
      var tr = (editing && editing.i18n) || {};
      R.LANGS.forEach(function (l) {
        var entry = tr[l.code] || {};
        o.querySelector('[data-tr-title="' + l.code + '"]').value = entry.title || '';
        o.querySelector('[data-tr-excerpt="' + l.code + '"]').value = entry.excerpt || '';
        o.querySelector('[data-tr-body="' + l.code + '"]').value = entry.body || '';
      });
      o.querySelector('#postTranslations').open = false;
      // An existing post keeps the language it was filed under; a new
      // one follows what gets typed.
      langTouched = !!editing;
      markTranslationState();
      updatePreview();
      o.hidden = false;
      o.querySelector('#postTitle').focus();
      if (editing) startAutoSave();
    }

    function closeEditor() {
      if (outlineTimer) { clearTimeout(outlineTimer); outlineTimer = null; }
      if (overlay) overlay.hidden = true;
      editing = null;
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      autoSaveTimer = null;
      lastSaveTime = null;
    }

    function savePost(e) {
      e.preventDefault();
      if (saving) return;
      var title = overlay.querySelector('#postTitle').value.trim();
      var body = overlay.querySelector('#postBody').value.trim();
      if (!title) { setMsg('error', t('blog.errNoTitle', 'Please give the post a title.')); return; }
      if (!body) { setMsg('error', t('blog.errNoBody', 'Please write something in the body.')); return; }

      var row = {
        title: title,
        category: overlay.querySelector('#postCategory').value,
        audiences: readAudiences(),
        excerpt: overlay.querySelector('#postExcerpt').value.trim() || null,
        tags: parseTags(overlay.querySelector('#postTags').value),
        body: body,
        lang: overlay.querySelector('#postLang').value,
        i18n: readTranslations(),
        published: overlay.querySelector('#postPublished').checked,
      };
      Object.assign(row, datePatch(), photoPatch());
      // Saving a post straight to published is an approval like any
      // other, and it records the same two moments — without touching
      // the day the post carries.
      if (row.published && !(editing && editing.published)) {
        row.approved_at = new Date().toISOString();
        row.published_at = row.approved_at;
      }

      saving = true;
      var btn = overlay.querySelector('#postSubmit');
      btn.disabled = true;
      btn.textContent = t('blog.saving', 'Saving…');

      var wantTranslation = overlay.querySelector('#postAutoTranslate').checked;

      var op;
      if (editing) {
        row.updated_at = new Date().toISOString();
        op = client.from('posts').update(row).eq('id', editing.id).select().single();
      } else {
        row.slug = makeSlug(title);
        op = client.auth.getUser().then(function (res) {
          row.created_by = res.data && res.data.user ? res.data.user.id : null;
          return client.from('posts').insert(row).select().single();
        });
      }

      function done() {
        saving = false;
        btn.disabled = false;
        btn.textContent = t('blog.save', 'Save');
        closeEditor();
        loadPosts();
      }

      op.then(function (res) {
        if (res && res.error) {
          saving = false;
          btn.disabled = false;
          btn.textContent = t('blog.save', 'Save');
          setMsg('error', t('blog.errSaveFailed', 'Couldn’t save: {msg}').replace('{msg}', schemaHint(res.error.message)));
          return;
        }
        var saved = (res && res.data) || null;
        if (!wantTranslation || !saved) { done(); return; }

        // The post is saved at this point. Translating is a second,
        // slower step, so it reports progress and its failure is said
        // out loud rather than swallowed — the writing is safe either way.
        btn.textContent = t('blog.translatingShort', 'Translating…');
        runTranslation(saved, function (text) { setMsg('info', text); })
          .then(function () { done(); })
          .catch(function (err) {
            saving = false;
            btn.disabled = false;
            btn.textContent = t('blog.save', 'Save');
            setMsg('error', t('blog.translateFailed', 'Saved, but the translation failed: {msg}')
              .replace('{msg}', err.message));
            loadPosts();
          });
      });
    }

    // What an admin needs to know at a glance: which languages this
    // post can be read in, and whether the translation still matches
    // what is written now.
    function translationStatusHTML(post) {
      if (!MT) return '';
      var targets = mtTargets(post);
      var fresh = targets.filter(function (c) { return !!MT.paired(post, c); });
      var stale = targets.filter(function (c) { return MT.isStale(post, c); });
      var label;
      if (!fresh.length) {
        label = t('blog.mtNone', 'Not translated into the other languages yet.');
      } else if (stale.length) {
        label = t('blog.mtStale', 'Translated into {n} languages, but the post has changed since.')
          .replace('{n}', fresh.length);
      } else {
        label = t('blog.mtFresh', 'Translated into {n} languages.').replace('{n}', fresh.length);
      }
      var filed = post.lang || 'en';
      if (filed === 'ko') {
        var ready = MT.studyFor(post, fresh[0] || 'en');
        label += ' ' + (ready
          ? t('study.statusReady', 'The word list is ready.')
          : t('study.statusMissing', 'No word list yet.'));
      } else if (MT.detectLang && MT.detectLang(post.body) === 'ko') {
        // The one mismatch worth naming: a Korean post filed as
        // something else gets no self-study corner, and nothing else on
        // the page would say why.
        label += ' ' + t('study.wrongLang',
          'This post is filed as {lang} but reads as Korean — change "Written in" to 한국어 and translate again to get the word list.')
          .replace('{lang}', R.langLabel(filed));
      }
      return '<div class="mt-status' + (stale.length || !fresh.length ? ' is-stale' : '') + '">' +
        '<span>' + escapeHTML(label) + '</span>' +
        '<span class="mt-status-langs">' + fresh.map(function (c) {
          return '<span class="res-chip">' + escapeHTML(R.langShort(c)) + '</span>';
        }).join('') + '</span>' +
        '<button type="button" class="btn btn-ghost" id="blogTranslateBtn">' +
          escapeHTML(fresh.length ? t('blog.retranslate', 'Translate again') : t('blog.translateNow', 'Translate now')) +
        '</button>' +
      '</div>';
    }

    /* ---------------- Machine translation ---------------- */

    // Which languages this post still needs a machine translation for:
    // not the one it is written in, and not one the admin has already
    // translated by hand — a person's version always wins.
    function mtTargets(post) {
      var human = {};
      var tr = post.i18n || {};
      Object.keys(tr).forEach(function (c) {
        if (tr[c] && String(tr[c].body || '').trim()) human[c] = true;
      });
      return R.LANGS.map(function (l) { return l.code; }).filter(function (c) {
        return c !== (post.lang || 'en') && !human[c];
      });
    }

    function mergeMT(post, fresh) {
      var out = {};
      var old = post.mt || {};
      Object.keys(old).forEach(function (c) { out[c] = old[c]; });
      Object.keys(fresh).forEach(function (c) { out[c] = fresh[c]; });
      return out;
    }

    // Runs the batches, then writes the result back in one update. The
    // post is already saved by the time this starts, so a failure here
    // loses a translation, never the writing.
    function runTranslation(post, report) {
      if (!MT) return Promise.reject(new Error('Translation is not loaded on this page.'));
      var targets = mtTargets(post);
      if (!targets.length || !String(post.body || '').trim()) return Promise.resolve(0);
      return MT.translate(client, {
        from: post.lang || 'en',
        to: targets,
        title: post.title,
        excerpt: post.excerpt,
        tags: post.tags || [],
        body: post.body
      }, function (done, total) {
        if (report) {
          report(t('blog.translating', 'Translating… {done} of {total}')
            .replace('{done}', done).replace('{total}', total));
        }
      }).then(function (fresh) {
        var merged = mergeMT(post, fresh);
        // The study list only makes sense under a Korean post, and it
        // is one more call after the sentences rather than part of
        // them: the five words have to be picked from the whole post.
        if ((post.lang || 'en') !== 'ko') {
          return { mt: merged, study: post.study || {}, n: Object.keys(fresh).length };
        }
        return MT.study(client, {
          from: post.lang, to: targets, body: post.body
        }, function () {
          if (report) report(t('study.building', 'Picking the words…'));
        }).then(function (st) {
          return { mt: merged, study: st || post.study || {}, n: Object.keys(fresh).length };
        }).catch(function (err) {
          // A failed word list should not throw away a good translation.
          console.warn('study list failed:', err.message);
          return { mt: merged, study: post.study || {}, n: Object.keys(fresh).length };
        });
      }).then(function (out) {
        return client.from('posts')
          .update({ mt: out.mt, study: out.study, updated_at: new Date().toISOString() })
          .eq('id', post.id)
          .then(function (res) {
            if (res.error) throw new Error(schemaHint(res.error.message));
            post.mt = out.mt;
            post.study = out.study;
            return out.n;
          });
      });
    }

    /* ---------------- Publish ---------------- */

    // Publishing lives on the post itself, next to what is being
    // published, rather than as a checkbox inside the editor.
    // Approving records when it happened and when it went out. It does
    // not touch post_date — a piece written on Tuesday and approved on
    // Friday is still Tuesday's piece. Unpublishing clears the two
    // moments again, and still leaves the day alone.
    function togglePublished(post) {
      var next = !post.published;
      var now = new Date().toISOString();
      var patch = { published: next, updated_at: now };
      if (next) {
        patch.approved_at = now;
        patch.published_at = now;
      } else {
        patch.approved_at = null;
        patch.published_at = null;
      }
      client.from('posts')
        .update(patch)
        .eq('id', post.id)
        .then(function (res) {
          if (res.error) {
            if (window.DURU_NOTIFY) window.DURU_NOTIFY.error(schemaHint(res.error.message));
            return;
          }
          post.published = next;
          post.approved_at = patch.approved_at;
          post.published_at = patch.published_at;
          renderSingle(post);
        });
    }

    /* ---------------- Delete ---------------- */

    function confirmDelete(post) {
      if (!post) return;
      var ok = window.confirm(
        t('blog.confirmDelete', '“{title}” will be permanently removed. This can’t be undone.')
          .replace('{title}', post.title));
      if (!ok) return;
      client.from('posts').delete().eq('id', post.id).then(function (res) {
        if (res.error) { window.alert(res.error.message); return; }
        if (currentSlug() === post.slug) {
          location.href = '/blog';
        } else {
          loadPosts();
        }
      });
    }

    /* ---------------- Filters, admin state ---------------- */

    // One topic is open at a time, and three things have to agree on
    // which: the styling, what a screen reader announces, and the
    // address bar. aria-pressed carries the first two.
    function markActiveFilter() {
      if (!filtersEl) return;
      filtersEl.querySelectorAll('.cat-card').forEach(function (card) {
        var on = card.dataset.filter === activeFilter;
        card.classList.toggle('active', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) card.setAttribute('aria-current', 'true');
        else card.removeAttribute('aria-current');
      });
      if (allBtn) allBtn.setAttribute('aria-pressed', activeFilter === 'all' ? 'true' : 'false');
    }

    // One re-render for every way of changing which topic is open.
    function applyFilters() {
      normaliseFilters();
      markActiveFilter();
      saveState();
      syncURL();
      return loadList(false);
    }

    if (filtersEl) {
      filtersEl.addEventListener('click', function (e) {
        var card = e.target.closest('.cat-card');
        if (!card || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault();
        // Picking the topic already open is how a reader steps back out
        // of it, which is what they expect from something that looks
        // pressed.
        activeFilter = card.dataset.filter === activeFilter ? 'all' : card.dataset.filter;
        // Scrolled once the cards for the topic are there, so it lands
        // on the newest of them rather than on an empty list.
        applyFilters().then(function () {
          if (window.DURU_SCROLL_TO_LIST) window.DURU_SCROLL_TO_LIST('blogList');
        });
      });
    }

    // "All posts" is not a ninth card; it is the way back to everything.
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        activeFilter = 'all';
        applyFilters();
      });
    }

    // One language on this page, not two. The picker above the list
    // used to change only which posts were listed, which left a reader
    // looking at Korean articles under English headings, English topic
    // cards and an English menu — the page half-translated and no way
    // to tell it that was not what was meant. It says "pick a language"
    // and a reader means the page, so it sets the site's language,
    // exactly as the globe in the header does. The langchange handler
    // below does the rendering; there is nothing to repaint here.
    function pickLang(code) {
      if (!code) return;
      listLang = code;
      if (langSel) langSel.value = code;
      saveState();
      if (window.DURU_I18N && window.DURU_I18N.setLang) window.DURU_I18N.setLang(code);
      else loadList(false);        // no dictionary engine: list only
    }

    if (langSel) {
      langSel.addEventListener('change', function () { pickLang(langSel.value); });
    }

    if (suggestEl) {
      suggestEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-lang]');
        if (btn) pickLang(btn.dataset.lang);
      });
    }

    if (writeBtn) writeBtn.addEventListener('click', function () { openEditor(null); });

    buildCategoryBar();
    markActiveFilter();

    /* ---------------- Not published yet ---------------- */

    if (pendingBtn) {
      pendingBtn.addEventListener('click', function () {
        pendingOnly = !pendingOnly;
        loadList(false).then(function () {
          if (window.DURU_SCROLL_TO_LIST) window.DURU_SCROLL_TO_LIST('blogList');
        });
      });
    }

    // Publish is what the button on the post itself does; Reject sets
    // the draft aside (posts.rejected_at, schema §38) rather than
    // deleting it, so the record stays and the morning run does not
    // write the same piece again.
    listEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || !isAdmin) return;
      e.preventDefault();
      e.stopPropagation();
      var post = findPost(b.dataset.id);
      if (!post) return;
      var title = readField(post, 'title', listLang);
      var box = b.closest('.res-decide');
      var msg = box && box.querySelector('.res-decide-msg');
      var say = function (text, kind) { if (msg) { msg.textContent = text; msg.className = 'res-decide-msg ' + (kind || ''); } };
      var buttons = box ? box.querySelectorAll('button') : [];
      var busy = function (on) { buttons.forEach(function (x) { x.disabled = on; }); };
      var now = new Date().toISOString();
      var publish = b.dataset.act === 'publish';
      var question = publish
        ? t('admin.confirmPublishPost', 'Publish “{title}”? Everyone will be able to read it.')
        : t('admin.confirmReject', 'Reject “{title}”? It leaves this list and is not published.');
      if (!window.confirm(question.replace('{title}', title))) return;
      var patch = publish
        ? { published: true, approved_at: now, published_at: now, updated_at: now }
        : { rejected_at: now, updated_at: now };
      busy(true);
      if (publish) say(t('admin.publishing', 'Publishing…'));
      client.from('posts').update(patch).eq('id', post.id).then(function (res) {
        if (res.error) {
          busy(false);
          say(/rejected_at/.test(res.error.message)
            ? t('admin.needs38', 'Run section 38 of supabase/schema.sql first.')
            : schemaHint(res.error.message), 'bad');
          return;
        }
        Object.keys(patch).forEach(function (k) { post[k] = patch[k]; });
        say(publish ? t('admin.published', 'Published.') : t('admin.rejected', 'Rejected.'), 'ok');
        setTimeout(function () { loadList(false); markActiveFilter(); }, 600);
      });
    });

    function applyAdmin(user) {
      if (!user) {
        isAdmin = false;
        pendingOnly = false;
        if (writeBtn) writeBtn.hidden = true;
        return loadPosts();
      }
      return client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        .then(function (res) {
          isAdmin = !!(res && res.data);
          if (!isAdmin) pendingOnly = false;
          if (writeBtn) writeBtn.hidden = !isAdmin;
          return loadPosts();
        });
    }

    client.auth.getSession().then(function (res) {
      applyAdmin(res.data && res.data.session && res.data.session.user);
    });
    client.auth.onAuthStateChange(function (_event, session) {
      applyAdmin(session && session.user);
    });

    // Labels inside rendered cards are translated at render time, so a
    // language switch has to re-render rather than rely on the DOM scan.
    document.addEventListener('duru:langchange', function () {
      followSiteLang();
      followPostLang();
      buildLangSelect();
      paintCategoryBar();
      var slug = currentSlug();
      if (slug) {
        // Switching the site's language re-picks the reading language
        // too, but only on the way in — a reader who chose one on this
        // page keeps it until they leave. The neighbours' titles are
        // asked for again, in the new language.
        if (current) { renderSingle(current); loadNeighbours(current); }
      } else {
        // The cards carry one language's titles: ask again.
        loadList(false);
      }
      if (overlay && !overlay.hidden) labelEditor();
    });
  });
})();
