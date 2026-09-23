// DURU KOREAN — learner stories
//
// Include after js/auth.js on stories.html. Anyone can read; you have to
// be signed in to write. A learner may edit or delete their own story and
// nobody else's, and an admin may delete any of them. All of that is
// enforced by Row Level Security in supabase/schema.sql — the buttons
// this file shows are a convenience, not the protection. Every entry
// and reply carries Reply / Edit / Delete; the ones a visitor may not
// use are dimmed and say why when pressed.
//
// Bodies are stored and rendered as plain text. Allowing HTML would let
// one visitor run code in another visitor's browser, so it is escaped on
// the way out and never interpreted. A translation is escaped by exactly
// the same function as the original, because it comes from outside the
// site and is no more trustworthy for having been asked for.
//
// ── Many languages, one community ─────────────────────────────────
//
// People write here in whatever language they are comfortable in, and
// read in whatever language they picked in the header. Those are two
// different settings and both are respected: the post is stored once,
// in the words its author typed, and a reader who cannot read them
// presses a button and gets a translation of that same post — same id,
// same thread, same replies, with the author's language still named on
// the card.
//
// Nothing is ever translated silently. A translated body always says
// so, always names the language it came from, and always has the
// original one press away, because a machine's guess at what somebody
// said is not the same thing as what they said — and on a page where
// people are learning Korean, the difference matters more than usual.

(function () {
  'use strict';

  // Posts per page. Replies are fetched separately and do not count
  // against it, so this is twenty conversations, not twenty rows.
  var PAGE_SIZE = 20;
  // Only for a database too old to page against — see loadEverything().
  var LEGACY_LIMIT = 100;

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  // "schema cache" in a PostgREST error means a column the page expects
  // is not in the database yet — the migration has not been run.
  function schemaHint(msg) {
    msg = String(msg || '');
    return /schema cache/i.test(msg)
      ? msg + ' — ' + t('common.schemaHint', 'The database has not been updated yet. Run supabase/schema.sql in the Supabase SQL editor, then try again.')
      : msg;
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(function (block) {
      return '<p>' + escapeHTML(block.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function formatDate(iso) {
    try {
      var lang = (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
      return new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return String(iso || '').slice(0, 10);
    }
  }

  function initial(name) {
    return (String(name || '?').trim().charAt(0) || '?').toUpperCase();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('storyList');
    var emptyEl = document.getElementById('storyEmpty');
    var writeBtn = document.getElementById('writeStoryBtn');
    var signedOutNote = document.getElementById('storySignedOutNote');
    var loginBtn = document.getElementById('storyLoginBtn');
    if (!listEl) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var currentUser = null;
    var isAdmin = false;
    var myNickname = '';
    var stories = [];

    // The three shelves, and where on them the reader is. Like the
    // blog, the address bar is the truth: /community/ask is a link
    // someone can send and a back button that means something.
    var C = window.DURU_COMMUNITY;
    var filtersEl = document.getElementById('storyFilters');
    var allBtn = document.getElementById('storyAllBtn');
    var titleEl = document.getElementById('storyAllTitle');
    var countEl = document.getElementById('storyCount');
    var emptyTitleEl = document.getElementById('storyEmptyTitle');
    var activeFilter = (C && C.route(location.pathname, location.search).cat) || 'all';
    if (C && activeFilter !== 'all' && !C.has(activeFilter)) activeFilter = 'all';

    /* ---------------- Language ---------------- */

    var L = window.DURU_LANGDETECT;
    var langFilterEl = document.getElementById('storyLangFilter');
    var mtNoteEl = document.getElementById('storyMtNote');
    var moreEl = document.getElementById('storyMore');
    var moreBtn = document.getElementById('storyMoreBtn');
    var langFilterLabel = document.getElementById('storyLangFilterLabel');
    var activeLang = 'all';           // which language people wrote in
    var languagesPresent = [];        // every language written in, community-wide

    // What the reader currently has in front of them, per row. None of
    // this is stored anywhere: it is a reading choice, not a setting,
    // and it lasts as long as the page does.
    // Whether the database has had supabase/schema.sql §33 run against
    // it yet. Until it has, the page is exactly the community it was
    // before: no badges, no filter, no offer to translate anything.
    // Everything here can be deployed before the migration, which is
    // the only order that does not take the page down in between.
    var mtReady = true;

    // Columns this database has told us it does not have. See send().
    var absent = Object.create(null);

    var trans = Object.create(null);        // id -> { lang, body, from }
    var showOriginal = Object.create(null); // id -> the reader asked for the author's words back
    var busy = Object.create(null);         // id -> a request is out
    var failed = Object.create(null);       // id -> the last attempt did not come back

    // A database that has not had supabase/schema.sql §33 run cannot
    // store a language or a translation, so the whole feature goes
    // quiet — correctly, but silently, which is its own problem: the
    // one person who can fix it has no way of knowing that is what
    // happened. A visitor should not be shown a migration notice, so
    // this goes in the console for whoever is looking, and on screen
    // only for a signed-in admin.
    var saidIt = false;

    function sayIfNotMigrated(rows) {
      var ready = !rows.length ||
        Object.prototype.hasOwnProperty.call(rows[0], 'lang');
      if (!ready && !saidIt) {
        saidIt = true;
        if (window.console && console.warn) {
          console.warn('DURU: the stories table has no "lang" column, so posts ' +
            'cannot be translated. Run section 33 of supabase/schema.sql in the ' +
            'Supabase SQL editor.');
        }
      }
      paintMtNote(ready);
    }

    function paintMtNote(ready) {
      if (!mtNoteEl) return;
      var show = isAdmin && ready === false;
      mtNoteEl.hidden = !show;
      if (show) {
        mtNoteEl.textContent = t('community.mt.needsMigration',
          'Translation is off: the database has not been updated yet. Run section 33 of ' +
          'supabase/schema.sql in the Supabase SQL editor. Only admins see this line.');
      }
    }

    function siteLang() {
      return (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
    }

    function langLabel(code) {
      var list = (window.DURU_I18N && window.DURU_I18N.LANGS) || [];
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].code === code) return list[i].label;
      }
      return code;
    }

    // "VI · Tiếng Việt" — the code for someone scanning a list of them,
    // the name in its own language for someone looking for their own.
    function langChip(code) {
      return String(code).split('-')[0].toUpperCase() + ' · ' + langLabel(code);
    }

    // A translation stored on the row itself, from the last time
    // somebody asked for this language. It is used only while it still
    // belongs to the body on screen: an edited post has a different
    // fingerprint, and the old translation is dropped rather than shown
    // under words it no longer matches.
    // What language a row is in. The stored value when there is one;
    // otherwise the text read locally by js/lang-detect.js.
    //
    // The guess is used to decide things — is there anything to
    // translate here? — but it is never shown. A badge saying
    // "Tiếng Việt" is a claim about what somebody wrote, and a claim
    // needs better evidence than a look at the letters. Deciding not to
    // send a Korean post to be translated into Korean needs no evidence
    // at all: being wrong costs one round trip.
    function srcOf(row) {
      if (row && row.lang) return row.lang;
      if (!L || !row) return null;
      return L.detect(row.body || '');
    }

    function cachedFor(row, code) {
      var kept = row && row.mt && row.mt[code];
      if (!kept || !kept.body || !L) return null;
      if (kept.hash !== L.hashText(row.body || '')) return null;
      return { lang: code, body: String(kept.body), from: row.lang || null };
    }

    /* ---------------- The four cards ---------------- */

    function buildFilterBar() {
      if (!filtersEl || !C) return;
      filtersEl.innerHTML = C.CATEGORIES.map(function (c) {
        return '<a class="cat-card" href="' + C.href(c.id) +
          '" data-filter="' + escapeHTML(c.id) + '" aria-pressed="false">' +
          '<span class="cat-card-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24">' + C.icon(c.id) + '</svg>' +
          '</span><h3></h3><p></p></a>';
      }).join('');
      // A card is a link, so it still works without JavaScript and can
      // be opened in a new tab — but within the page it filters rather
      // than reloading.
      filtersEl.querySelectorAll('.cat-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
          e.preventDefault();
          // Pressing the topic already open steps back out of it.
          activeFilter = card.dataset.filter === activeFilter ? 'all' : card.dataset.filter;
          syncURL();
          var go = function () { if (window.DURU_SCROLL_TO_LIST) window.DURU_SCROLL_TO_LIST('storyList'); };
          var p = loadStories();
          if (p && p.then) p.then(go, go); else go();
        });
      });
      if (allBtn) {
        allBtn.addEventListener('click', function () {
          activeFilter = 'all';
          syncURL();
          loadStories();
        });
      }
      paintFilterBar();
    }

    // Names and descriptions on a language change; which one is open
    // whenever the list is rebuilt. aria-pressed is both what the CSS
    // styles and what a screen reader is told, so they cannot disagree.
    function paintFilterBar() {
      if (!filtersEl || !C) return;
      filtersEl.querySelectorAll('.cat-card').forEach(function (card) {
        var id = card.dataset.filter;
        var on = id === activeFilter;
        card.classList.toggle('active', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) card.setAttribute('aria-current', 'true');
        else card.removeAttribute('aria-current');
        card.querySelector('h3').textContent = C.label(id);
        card.querySelector('p').textContent = C.describe(id);
      });
      if (allBtn) allBtn.setAttribute('aria-pressed', activeFilter === 'all' ? 'true' : 'false');
    }

    // A row written before the shelves existed has no category; it is
    // somebody telling a story, so it counts as one. The database says
    // the same thing with its default — this is only for a page holding
    // rows it read before the migration ran.
    function catOf(row) {
      var id = (row && row.category) || 'share';
      return (C && C.has(id)) ? id : 'share';
    }

    function countIn(id) {
      return stories.filter(function (s2) { return catOf(s2) === id; }).length;
    }

    // In the paged world the database counted; in the fallback, where
    // everything is in hand and narrowed here, the list itself is the
    // count.
    function shownTotal(list) {
      return (legacy || absent.category || absent.lang) ? list.length : total;
    }

    function paintMore(list) {
      if (!moreEl || !moreBtn) return;
      var left = shownTotal(list) - list.length;
      var show = !legacy && left > 0;
      moreEl.hidden = !show;
      if (!show) return;
      moreBtn.disabled = loading;
      moreBtn.textContent = loading
        ? t('community.more.loading', 'Loading…')
        : t('community.more', 'Show more ({n} left)').replace('{n}', left);
    }

    function postCount(n) {
      if (!n) return t('community.postCount.none', 'Nothing yet');
      if (n === 1) return t('community.postCount.one', '1 post');
      return t('community.postCount', '{n} posts').replace('{n}', n);
    }

    // Keep the address bar level with what is on screen, without adding
    // a history entry per click: a filter is where you are, not a page
    // you visited.
    function syncURL() {
      if (!C || !window.history || !history.replaceState) return;
      var q = new URLSearchParams(location.search);
      q.delete('cat');
      // Readable paths only where the host serves them. Opened as
      // stories.html — a local preview, a static host without the
      // rewrites — the query string stays, so a reload still works.
      var clean = !/\.html$/.test(location.pathname);
      if (!clean && activeFilter !== 'all') q.set('cat', activeFilter);
      var qs = q.toString();
      var path = clean ? C.href(activeFilter === 'all' ? '' : activeFilter) : location.pathname;
      history.replaceState(null, '', path + (qs ? '?' + qs : ''));
    }

    /* ---------------- Rendering ---------------- */

    var rows = [];
    // Children grouped by the row they answer, oldest first. A reply can
    // itself be answered, so this is walked recursively.
    var childrenOf = Object.create(null);

    function actionsHTML(row) {
      var mine = !!(currentUser && row.user_id === currentUser.id);
      var canDelete = mine || isAdmin;
      return '<div class="story-actions">' +
        '<button type="button" class="story-reply-btn" data-id="' + row.id + '">' +
          escapeHTML(t('stories.reply', 'Reply')) + '</button>' +
        '<button type="button" class="story-edit-btn' + (mine ? '' : ' is-muted') + '" data-id="' + row.id + '">' +
          escapeHTML(t('stories.edit', 'Edit')) + '</button>' +
        '<button type="button" class="story-delete-btn' + (canDelete ? '' : ' is-muted') + '" data-id="' + row.id + '">' +
          escapeHTML(t('stories.delete', 'Delete')) + '</button>' +
      '</div>';
    }

    // The author's words, or a translation of them, and a line saying
    // which of the two this is. There is no state in which the page
    // shows a translation without saying so.
    function bodyHTML(row) {
      var want = siteLang();
      var held = trans[row.id];
      var live = !!(held && held.lang === want && !showOriginal[row.id]);
      var text = live ? held.body : row.body;
      var code = live ? want : row.lang;
      return '<div class="story-body"' + (code ? ' lang="' + escapeHTML(code) + '"' : '') + '>' +
        paragraphs(text) + '</div>' + mtNoteHTML(row, live, held);
    }

    function mtNoteHTML(row, live, held) {
      var want = siteLang();
      if (!mtReady) return '';
      if (live) {
        var fromCode = held.from || row.lang;
        var origin = fromCode
          ? t('community.mt.from', 'from {lang}').replace('{lang}', langLabel(fromCode))
          : t('community.mt.fromUnknown', 'from the original');
        return '<p class="story-mt is-on">' +
          '<span class="story-mt-tag">' + escapeHTML(t('community.mt.tag', 'Auto-translated')) + '</span>' +
          '<span class="story-mt-src">' + escapeHTML(origin) + '</span>' +
          '<button type="button" class="story-mt-orig" data-id="' + escapeHTML(row.id) + '">' +
            escapeHTML(t('community.mt.original', 'Show original')) + '</button>' +
        '</p>';
      }
      if (busy[row.id]) {
        return '<p class="story-mt is-busy">' +
          escapeHTML(t('community.mt.busy', 'Translating…')) + '</p>';
      }
      if (failed[row.id]) {
        return '<p class="story-mt is-error">' +
          '<span>' + escapeHTML(t('community.mt.failed', 'Couldn’t translate this right now.')) + '</span>' +
          '<button type="button" class="story-mt-go" data-id="' + escapeHTML(row.id) + '">' +
            escapeHTML(t('community.mt.retry', 'Try again')) + '</button>' +
        '</p>';
      }
      // Nothing to offer when it is already in the reader's language.
      // A post from before the language column existed says nothing
      // about itself, so it is offered — the translator works out what
      // it is, and if it turns out to be the same language the reader
      // gets told so rather than getting a pointless round trip.
      if (srcOf(row) === want) return '';
      return '<p class="story-mt">' +
        '<button type="button" class="story-mt-go" data-id="' + escapeHTML(row.id) + '">' +
          escapeHTML(t('community.mt.read', 'Read in {lang}').replace('{lang}', langLabel(want))) +
        '</button></p>';
    }

    // The language the author wrote in stays on the card whether or not
    // a translation is showing, because who wrote what, in what, does
    // not change when a reader presses a button.
    function langChipHTML(row) {
      if (!mtReady || !row.lang) return '';
      return '<span class="story-lang" lang="' + escapeHTML(row.lang) + '">' +
        escapeHTML(langChip(row.lang)) + '</span>';
    }

    // A post and everything written underneath it, however deep. One
    // press translates the conversation, not one line of it.
    function threadIds(row) {
      var out = [];
      (function walk(id) {
        out.push(id);
        (childrenOf[id] || []).forEach(function (child) { walk(child.id); });
      })(row.id);
      return out;
    }

    function repliesHTML(parent) {
      var list = childrenOf[parent.id] || [];
      if (!list.length) return '';
      var label = list.length === 1
        ? t('stories.oneReply', '1 reply')
        : t('stories.replies', '{n} replies').replace('{n}', list.length);
      return '<div class="story-replies">' +
        '<span class="story-replies-label">' + escapeHTML(label) + '</span>' +
        list.map(function (r) {
          return '<div class="story-reply">' +
            '<span class="story-avatar" aria-hidden="true">' + escapeHTML(initial(r.display_name)) + '</span>' +
            '<div>' +
              '<div class="story-reply-head"><strong>' + escapeHTML(r.display_name) + '</strong>' +
                '<p class="story-meta">' + langChipHTML(r) +
                  escapeHTML(formatDate(r.created_at)) + '</p></div>' +
              bodyHTML(r) +
              actionsHTML(r) +
              repliesHTML(r) +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    // The two filters are read together: Ask & Help written in
    // Vietnamese is a reasonable thing to want, and picking one should
    // not quietly clear the other. The database applies them both — see
    // scoped() — so this only has work to do where it could not: a
    // column that is not there yet, or the unpaged fallback.
    function shown() {
      return stories.filter(function (s2) {
        if (activeFilter !== 'all' && (absent.category || legacy) &&
            catOf(s2) !== activeFilter) return false;
        if (activeLang !== 'all' && (absent.lang || legacy) &&
            (s2.lang || 'unknown') !== activeLang) return false;
        return true;
      });
    }

    // Every action here redraws the list, which would otherwise drop
    // keyboard focus on the floor. Pressing "Read in English" and being
    // returned to the top of the page is a small thing with a mouse and
    // the end of the road without one, so the button that was pressed
    // hands its place to whatever replaces it.
    var refocus = null;

    function keepFocus(cls, id) {
      refocus = { cls: cls, id: id };
    }

    function restoreFocus() {
      if (!refocus) return;
      var want = refocus;
      var el = listEl.querySelector('.' + want.cls + '[data-id="' + want.id + '"]') ||
               listEl.querySelector('.story-mt-go[data-id="' + want.id + '"]') ||
               listEl.querySelector('.story-mt-orig[data-id="' + want.id + '"]');
      if (el) { refocus = null; el.focus(); return; }
      // While the translation is out there is no button to land on —
      // the place says "Translating…". The claim is held until the
      // answer arrives and puts one back.
      if (!busy[want.id]) refocus = null;
    }

    function renderList() {
      listEl.innerHTML = '';
      var list = shown();
      if (titleEl) {
        titleEl.textContent = activeFilter === 'all'
          ? t('community.latest', 'Latest discussions')
          : (C ? C.label(activeFilter) : activeFilter);
      }
      // What the database says matches, not what happens to be loaded:
      // "3 posts" under a list of twenty out of three hundred would be
      // a lie about the community, and "20 posts" a lie about the shelf.
      if (countEl) countEl.textContent = postCount(shownTotal(list));
      if (emptyEl) {
        emptyEl.hidden = list.length > 0;
        // "Nothing here yet" should say where here is: an empty shelf
        // and an empty community are not the same thing, and a reader
        // who picked Meet & Connect has not seen the rest of the page.
        if (emptyTitleEl) {
          emptyTitleEl.textContent = activeFilter === 'all'
            ? t('community.emptyTitle', 'No discussions yet.')
            : t('community.emptyHere', 'No discussions in this topic yet.');
        }
      }
      paintFilterBar();
      paintLangFilter();
      paintMtNote(mtReady);
      paintMore(list);
      list.forEach(function (s) {
        var card = document.createElement('article');
        card.className = 'story-card';
        card.dataset.story = s.id;
        card.innerHTML =
          '<div class="story-head">' +
            '<span class="story-avatar" aria-hidden="true">' + escapeHTML(initial(s.display_name)) + '</span>' +
            '<div><h3>' + escapeHTML(s.display_name) + '</h3>' +
            '<p class="story-meta">' +
              '<span class="story-cat story-cat--' + escapeHTML(catOf(s)) + '">' +
              escapeHTML(C ? C.label(catOf(s)) : catOf(s)) + '</span>' +
              langChipHTML(s) +
              escapeHTML(formatDate(s.created_at)) + '</p></div>' +
          '</div>' +
          bodyHTML(s) +
          actionsHTML(s) +
          repliesHTML(s);
        listEl.appendChild(card);
      });
      listEl.querySelectorAll('.story-reply-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!currentUser) { openLogin(); return; }
          openReply(find(b.dataset.id));
        });
      });
      listEl.querySelectorAll('.story-edit-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!currentUser) { openLogin(); return; }
          var row = find(b.dataset.id);
          if (!row) return;
          if (row.user_id !== currentUser.id) {
            window.alert(t('stories.onlyAuthorEdit', 'Only the person who wrote this can edit it.'));
            return;
          }
          openEditor(row);
        });
      });
      listEl.querySelectorAll('.story-mt-go').forEach(function (b) {
        b.addEventListener('click', function () {
          var row = find(b.dataset.id);
          if (!row) return;
          keepFocus('story-mt-orig', b.dataset.id);
          translateItems(threadIds(row));
        });
      });
      listEl.querySelectorAll('.story-mt-orig').forEach(function (b) {
        b.addEventListener('click', function () {
          showOriginal[b.dataset.id] = true;
          keepFocus('story-mt-go', b.dataset.id);
          renderList();
        });
      });
      restoreFocus();
      watchCards();
      listEl.querySelectorAll('.story-delete-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!currentUser) { openLogin(); return; }
          var row = find(b.dataset.id);
          if (!row) return;
          if (row.user_id !== currentUser.id && !isAdmin) {
            window.alert(t('stories.onlyAuthorDelete', 'Only the person who wrote this or a site admin can delete it.'));
            return;
          }
          confirmDelete(row);
        });
      });
    }

    function find(id) {
      return rows.filter(function (s) { return String(s.id) === String(id); })[0];
    }

    /* ---------------- Translation ---------------- */

    // The endpoint is given ids, never text: it reads the posts itself,
    // so nobody can hand the site somebody else's paragraphs to
    // translate at its expense. See api/community-translate.js.
    var MT_ENDPOINT = '/api/community-translate';
    // Small on purpose. The server translates the posts in a batch in
    // parallel, so the batch is only as quick as its slowest post —
    // with everything in one request a long thread at the bottom keeps
    // the first post on screen waiting for it. In small groups the page
    // fills in from the top as the answers land, which is both faster
    // to something readable and easier to watch.
    var MT_BATCH = 6;

    // `auto` says the page noticed a card coming into view rather than
    // the reader pressing something. The difference matters twice over:
    // an automatic pass must not undo a reader's deliberate "show me
    // the original", must not keep retrying something that already
    // failed, and must stay inside the page view's budget — while a
    // press is the reader asking outright, and is always honoured.
    function translateItems(ids, auto) {
      var want = siteLang();
      var need = [];
      var changed = false;

      ids.forEach(function (id) {
        var row = find(id);
        if (!row) return;
        if (auto) {
          if (showOriginal[id] || failed[id] || busy[id]) return;
        } else {
          if (showOriginal[id] || failed[id]) changed = true;
          delete showOriginal[id];
          delete failed[id];
        }
        if (srcOf(row) === want) return;                   // already readable
        var held = trans[id];
        if (held && held.lang === want) return;            // done already
        var hit = cachedFor(row, want);                    // somebody else paid
        if (hit) { trans[id] = hit; changed = true; return; }
        need.push(id);
      });

      if (auto) {
        var room = Math.max(0, budget - spent);
        if (need.length > room) need = need.slice(0, room);
        spent += need.length;
      }

      // Nothing to do and nothing moved: do not redraw. A redraw here
      // would re-arm the observer, which would call back in, which
      // would redraw — round and round for as long as the page is open.
      if (!need.length) { if (changed) renderList(); return; }
      need.forEach(function (id) { busy[id] = true; });
      renderList();

      for (var i = 0; i < need.length; i += MT_BATCH) {
        request(need.slice(i, i + MT_BATCH), want);
      }
    }

    function request(ids, want) {
      function giveUp() {
        ids.forEach(function (id) { delete busy[id]; failed[id] = true; });
        renderList();
      }

      fetch(MT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids, to: want })
      }).then(function (res) {
        if (!res.ok) { giveUp(); return null; }
        return res.json();
      }).then(function (data) {
        if (!data) return;
        // The reader may have changed the site language while this was
        // in the air. An answer in a language nobody is reading any
        // more is dropped rather than shown.
        if (data.to !== siteLang()) {
          // Whatever is showing now is owned by the request that went
          // out with the new language; clearing flags here would clear
          // that one's.
          return;
        }
        var items = data.items || {};
        ids.forEach(function (id) {
          delete busy[id];
          var got = items[id];
          if (got && got.body) {
            trans[id] = { lang: data.to, body: String(got.body), from: got.from || null };
          } else if (got && got.same) {
            // It was already in this language after all. Nothing to
            // show and nothing to apologise for.
          } else {
            failed[id] = true;
          }
        });
        renderList();
      }).catch(giveUp);
    }

    // Reading the community in your own language should not be a button
    // you have to find on every post. Picking a language in the header
    // is the whole request: from then on, what is not in that language
    // gets translated into it.
    //
    // ── What gets translated, and what that costs ──────────────────
    //
    // Only what somebody actually looks at. A reader who opens the
    // community, reads three posts and leaves pays for three posts —
    // not for the three hundred on the shelf behind them. That matters
    // more the bigger this place gets: translating the whole page on
    // arrival would mean a community of three hundred posts charges
    // every passing visitor for three hundred posts in a language they
    // may not even scroll to.
    //
    // A card is translated when it comes near the viewport, with enough
    // room ahead (RUNWAY) that by the time it is actually on screen the
    // words are already there. The reader sees no button and no wait;
    // the bill follows what was read.
    //
    // Behind that, two more limits. Anything translated before comes
    // down with the row and costs nothing at all — a busy thread is
    // paid for once, by whoever got there first. And one page view
    // translates at most AUTO_MAX entries however far it is scrolled,
    // so no single visit can run away. Past that the button comes back.
    var AUTO_MAX = 60;
    var RUNWAY = '800px 0px';

    var spent = 0;                       // entries translated this page view
    // The allowance. Sixty to start with, which covers any amount of
    // scrolling through what is already on the page. Pressing Show more
    // raises it, because that press is the reader asking for another
    // twenty conversations outright — refusing to translate what they
    // just asked to see would be answering the wrong question. The
    // ceiling stays a ceiling: it only moves when somebody moves it.
    var budget = AUTO_MAX;
    var watcher = null;
    var queued = Object.create(null);
    var queueTimer = null;

    // Is there anything to do for this row, in the language on screen?
    function needsWork(row) {
      if (!row || !mtReady) return false;
      if (showOriginal[row.id] || failed[row.id] || busy[row.id]) return false;
      var want = siteLang();
      var held = trans[row.id];
      if (held && held.lang === want) return false;
      return srcOf(row) !== want;
    }

    function threadNeedsWork(row) {
      return threadIds(row).some(function (id) { return needsWork(find(id)); });
    }

    // Scrolling past ten cards in a second should be one request, not
    // ten. They are collected for a moment and sent together.
    function queueThread(id) {
      var row = find(id);
      if (!row) return;
      threadIds(row).forEach(function (each) { queued[each] = true; });
      if (queueTimer) clearTimeout(queueTimer);
      queueTimer = setTimeout(flushQueue, 120);
    }

    function flushQueue() {
      queueTimer = null;
      var ids = Object.keys(queued);
      queued = Object.create(null);
      if (ids.length) translateItems(ids, true);
    }

    function watchCards() {
      if (!mtReady) return;
      // Until the first dictionary lands, DURU_I18N.lang is a
      // placeholder. Working against it would translate the page into
      // the wrong language and then, a moment later, do it all again
      // into the right one — twice the wait and twice the bill, on
      // every single page load. The langchange the engine fires when it
      // is ready brings us straight back here.
      if (window.DURU_I18N && !window.DURU_I18N.ready) return;

      var cards = listEl.querySelectorAll('.story-card');
      if (!window.IntersectionObserver) {
        // An old browser with no way to ask what is on screen. It gets
        // the top of the page, which is what it would have read first.
        var top = [];
        for (var i = 0; i < cards.length && top.length < 12; i += 1) {
          var row = find(cards[i].dataset.story);
          if (row && threadNeedsWork(row)) top.push(row.id);
        }
        top.forEach(queueThread);
        return;
      }

      if (!watcher) {
        watcher = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            watcher.unobserve(entry.target);
            queueThread(entry.target.dataset.story);
          });
        }, { rootMargin: RUNWAY });
      }

      cards.forEach(function (card) {
        // Anything already done, already the reader's language, or put
        // back to the original on purpose is not watched at all — so a
        // redraw after a translation lands cannot start another round.
        var row = find(card.dataset.story);
        if (row && threadNeedsWork(row)) watcher.observe(card);
      });
    }

    /* ---------------- Which language it was written in ---------------- */

    // Only the languages people have actually written in, so the list
    // is short and every entry in it finds something. Kept in the order
    // of the site's own picker rather than of whoever posted first.
    function paintLangFilter() {
      if (!langFilterEl) return;
      if (!mtReady) { langFilterEl.parentNode.hidden = true; return; }
      var order = ((window.DURU_I18N && window.DURU_I18N.LANGS) || []).map(function (l) { return l.code; });
      var present = Object.create(null);
      var anyUnknown = false;
      // Community-wide when that has been read; the page in hand while
      // it is still on its way, or on a database that cannot answer it.
      var from = languagesPresent.length
        ? languagesPresent
        : stories.map(function (r) { return r.lang; });
      from.forEach(function (lang) {
        if (lang) present[lang] = true; else anyUnknown = true;
      });
      var codes = order.filter(function (c) { return present[c]; });
      if (anyUnknown) codes.push('unknown');
      if (activeLang !== 'all' && codes.indexOf(activeLang) === -1) activeLang = 'all';

      if (langFilterLabel) langFilterLabel.textContent = t('community.lang.filter', 'Language');
      langFilterEl.innerHTML =
        '<option value="all">' + escapeHTML(t('community.lang.all', 'All languages')) + '</option>' +
        codes.map(function (c) {
          var label = c === 'unknown' ? t('community.lang.unknown', 'Not marked') : langChip(c);
          return '<option value="' + escapeHTML(c) + '">' + escapeHTML(label) + '</option>';
        }).join('');
      langFilterEl.value = activeLang;
      // One language on the shelf is not a choice; the control would
      // only be one more thing to read past.
      langFilterEl.parentNode.hidden = codes.length < 2;
    }

    /* ---------------- Reading the list ---------------- */
    //
    // Two queries rather than one, and this is not only about paging.
    //
    // A reply is a row in this same table, so one query for everything
    // meant the page limit counted posts and replies together: sixty
    // posts with forty replies filled it, and the sixty-first post
    // simply was not there. The number of replies a conversation
    // attracts should not decide how many conversations are listed.
    //
    // So: one query for the posts, which is what is paged and counted,
    // and one for the replies to the posts actually on screen. A reply
    // can itself be answered, so that second query walks down until it
    // stops finding anything.
    //
    // The filters moved to the database at the same time, for the same
    // reason. Narrowing a page of twenty to the ones that happen to be
    // Ask & Help is not filtering the community, it is filtering
    // whatever arrived first — the answer has to come from the whole
    // shelf, and so does the count under the heading.

    var REPLY_DEPTH = 5;

    var loadedPages = 0;        // how many pages of posts are on screen
    var total = 0;              // how many posts match, in the database
    var loading = false;
    var legacy = false;         // a database too old to page against

    // Every read of the list starts here, so that the list, the count
    // and "show more" can never disagree about what is being looked at.
    var DEFAULT_CAT = 'share';

    function scoped(select, opts) {
      var q = client.from('stories').select(select, opts).is('parent_id', null);
      if (activeFilter !== 'all' && !absent.category) {
        // The shelf a post with no shelf belongs on. The column arrived
        // with a default, so a migrated database has no such rows — but
        // this page has always promised that an entry written before
        // the shelves existed counts as Share & Talk, and a promise
        // that quietly stops holding when the filtering moves to the
        // database is worse than one never made. A post cannot be
        // allowed to disappear from every shelf while still being in
        // All posts.
        q = activeFilter === DEFAULT_CAT
          ? q.or('category.eq.' + DEFAULT_CAT + ',category.is.null')
          : q.eq('category', activeFilter);
      }
      if (activeLang !== 'all' && !absent.lang) {
        q = activeLang === 'unknown' ? q.is('lang', null) : q.eq('lang', activeLang);
      }
      return q;
    }

    function noteColumns(sample) {
      if (!sample) return;
      mtReady = Object.prototype.hasOwnProperty.call(sample, 'lang');
      ['category', 'lang', 'mt'].forEach(function (col) {
        if (!Object.prototype.hasOwnProperty.call(sample, col)) absent[col] = true;
      });
    }

    // The replies to a set of posts, and the replies to those, and so
    // on. Bounded, because a cycle in the data would otherwise be an
    // endless loop rather than a wrong answer.
    function loadReplies(parents, found, depth) {
      found = found || [];
      depth = depth || 0;
      var ids = parents.map(function (r) { return r.id; });
      if (!ids.length || depth >= REPLY_DEPTH) return Promise.resolve(found);
      return client.from('stories').select('*').in('parent_id', ids)
        .then(function (res) {
          if (res.error || !res.data || !res.data.length) return found;
          found = found.concat(res.data);
          return loadReplies(res.data, found, depth + 1);
        });
    }

    function fileReplies(replies) {
      childrenOf = Object.create(null);
      replies.slice()
        .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
        .forEach(function (r) {
          (childrenOf[r.parent_id] = childrenOf[r.parent_id] || []).push(r);
        });
    }

    function loadStories(more) {
      if (legacy) return loadEverything();
      if (loading) return Promise.resolve();
      loading = true;
      if (!more) { loadedPages = 0; spent = 0; budget = AUTO_MAX; }
      else { budget += PAGE_SIZE * 2; }     // the page asked for, and its replies
      var from = more ? loadedPages * PAGE_SIZE : 0;

      return scoped('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)
        .then(function (res) {
          loading = false;
          if (res.error) {
            // A database without parent_id — or without the columns the
            // filters name — cannot answer this. Fall back to reading
            // the lot, which is what this page did before it paged.
            console.warn('DURU: paging the community failed, reading it whole instead:',
              res.error.message);
            legacy = true;
            return loadEverything();
          }
          var page = res.data || [];
          noteColumns(page[0]);
          sayIfNotMigrated(page);
          total = typeof res.count === 'number' ? res.count : (from + page.length);
          stories = more ? stories.concat(page) : page;
          loadedPages = more ? loadedPages + 1 : 1;

          return loadReplies(stories).then(function (replies) {
            fileReplies(replies);
            rows = stories.concat(replies);
            renderList();
          });
        });
    }

    // The old single query, kept for a database that cannot do the new
    // one. Everything in one go, split here.
    function loadEverything() {
      loading = true;
      return client.from('stories').select('*')
        .order('created_at', { ascending: false }).limit(LEGACY_LIMIT)
        .then(function (res) {
          loading = false;
          if (res.error) { console.error('Failed to load stories:', res.error.message); return; }
          rows = res.data || [];
          noteColumns(rows[0]);
          sayIfNotMigrated(rows);
          stories = rows.filter(function (r) { return !r.parent_id; });
          fileReplies(rows.filter(function (r) { return r.parent_id; }));
          total = stories.length;
          loadedPages = 1;
          renderList();
        });
    }

    // Which languages people have written in, across the whole
    // community rather than across the page being looked at — a filter
    // that only offers what happens to be on screen is not a filter.
    // One short column, read once.
    function loadLanguages() {
      if (absent.lang || legacy) return Promise.resolve();
      return client.from('stories').select('lang').is('parent_id', null)
        .then(function (res) {
          if (res.error) return;
          languagesPresent = (res.data || []).map(function (r) { return r.lang; });
          paintLangFilter();
        });
    }

    /* ---------------- Editor ---------------- */

    var overlay = null;
    var editing = null;
    var replyTo = null;
    var saving = false;

    function buildEditor() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="storyEditorTitle">' +
          '<button type="button" class="auth-close" id="storyCloseBtn" aria-label="Close">&times;</button>' +
          '<h2 id="storyEditorTitle"></h2>' +
          '<p class="auth-sub" id="storyEditorSub"></p>' +
          '<div class="auth-message" data-msg="story" hidden></div>' +
          '<form id="storyForm" novalidate>' +
            '<div class="auth-field"><label for="storyName"></label>' +
              '<input type="text" id="storyName" required maxlength="40"></div>' +
            // Filled in from what is being typed, and left alone the
            // moment the writer touches it. Getting it right matters:
            // it is what tells a reader in another language that there
            // is something here worth translating.
            '<div class="auth-field" id="storyLangField"><label for="storyLang"></label>' +
              '<select id="storyLang"></select>' +
              '<p class="field-hint" id="storyLangHint"></p></div>' +
            // A reply belongs to the thread it answers, so it has no
            // shelf of its own to pick — the field is hidden for one
            // and the parent's value is sent instead.
            '<div class="auth-field" id="storyCatField"><label for="storyCat"></label>' +
              '<select id="storyCat"></select>' +
              '<p class="field-hint" id="storyCatHint"></p></div>' +
            '<div class="auth-field"><label for="storyBody"></label>' +
              '<textarea id="storyBody" rows="10" required maxlength="4000"></textarea>' +
              '<p class="field-hint" id="storyCount"></p></div>' +
            '<button type="submit" class="btn btn-primary auth-submit" id="storySubmit"></button>' +
          '</form>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeEditor(); });
      overlay.querySelector('#storyCloseBtn').addEventListener('click', closeEditor);
      overlay.querySelector('#storyForm').addEventListener('submit', save);
      overlay.querySelector('#storyBody').addEventListener('input', function () {
        updateCount();
        guessLang();
      });
      overlay.querySelector('#storyLang').addEventListener('change', function () {
        langTouched = true;
      });
      return overlay;
    }

    function updateCount() {
      var body = overlay.querySelector('#storyBody');
      overlay.querySelector('#storyCount').textContent =
        t('stories.charCount', '{n} / 4000 characters').replace('{n}', body.value.length);
    }

    // The writer's language, guessed while they type and abandoned as a
    // guess the instant they correct it. A guess that keeps overriding
    // a correction is worse than no guess at all.
    var langTouched = false;

    function guessLang() {
      if (langTouched || !overlay || !L) return;
      var sel = overlay.querySelector('#storyLang');
      if (!sel) return;
      var guess = L.detect(overlay.querySelector('#storyBody').value);
      // Nothing recognisable yet — "ok", a URL, three words. The
      // language being read is the better guess than any of those.
      sel.value = guess || siteLang();
    }

    function labelEditor() {
      var o = buildEditor();
      o.querySelector('#storyEditorTitle').textContent = editing
        ? t('stories.editorEditTitle', 'Edit your story')
        : replyTo
          ? t('stories.editorReplyTitle', 'Write a reply')
          : t('stories.editorNewTitle', 'Share your story');
      o.querySelector('#storyEditorSub').textContent =
        t('stories.editorSub', 'Your email address is never shown — only the name you choose here.');
      o.querySelector('label[for="storyName"]').textContent = t('stories.fieldName', 'Name to show');

      o.querySelector('#storyLangField').hidden = !mtReady;

      var catField = o.querySelector('#storyCatField');
      var catSel = o.querySelector('#storyCat');
      catField.hidden = !!replyTo || !C;
      if (C) {
        var keep = catSel.value;
        o.querySelector('label[for="storyCat"]').textContent = t('community.fieldCat', 'Where does this go?');
        catSel.innerHTML = C.CATEGORIES.map(function (c) {
          return '<option value="' + escapeHTML(c.id) + '">' + escapeHTML(C.label(c.id)) + '</option>';
        }).join('');
        catSel.value = keep && C.has(keep) ? keep : defaultCat();
        o.querySelector('#storyCatHint').textContent = C.describe(catSel.value);
        catSel.onchange = function () {
          o.querySelector('#storyCatHint').textContent = C.describe(catSel.value);
        };
      }
      var langSel = o.querySelector('#storyLang');
      o.querySelector('label[for="storyLang"]').textContent =
        t('community.lang.field', 'Language you are writing in');
      o.querySelector('#storyLangHint').textContent =
        t('community.lang.hint', 'Readers can have this translated into their own language. Change it if the guess is wrong.');
      var keepLang = langSel.value;
      langSel.innerHTML = ((window.DURU_I18N && window.DURU_I18N.LANGS) || [{ code: 'en', label: 'English' }])
        .map(function (l) {
          return '<option value="' + escapeHTML(l.code) + '">' + escapeHTML(langChip(l.code)) + '</option>';
        }).join('');
      langSel.value = keepLang || siteLang();

      o.querySelector('label[for="storyBody"]').textContent = replyTo
        ? t('stories.fieldReply', 'Your reply')
        : t('stories.fieldBody', 'Your story');
      o.querySelector('#storySubmit').textContent = t('stories.post', 'Post');
      updateCount();
    }

    // Editing keeps the shelf the post is already on. Writing something
    // new starts on the shelf being browsed, because a reader who opened
    // Ask & Help and then pressed Write almost certainly has a question.
    function defaultCat() {
      if (editing) return catOf(editing);
      if (C && C.has(activeFilter)) return activeFilter;
      return 'share';
    }

    function setMsg(type, text) {
      var el = overlay.querySelector('[data-msg="story"]');
      el.className = 'auth-message ' + type;
      el.textContent = text;
      el.hidden = false;
    }

    function openEditor(story) {
      if (!currentUser) { openLogin(); return; }
      editing = story || null;
      replyTo = editing && editing.parent_id ? { id: editing.parent_id } : null;
      var o = buildEditor();
      labelEditor();
      o.querySelector('[data-msg="story"]').hidden = true;
      o.querySelector('#storyName').value = editing ? editing.display_name : lastUsedName();
      // Always the words the author typed, never a translation of them.
      o.querySelector('#storyBody').value = editing ? editing.body : '';
      // An entry written before the language column existed has none
      // stored; reading it off the text is better than assuming.
      o.querySelector('#storyLang').value = editing
        ? (editing.lang || (L && L.detect(editing.body)) || siteLang())
        : siteLang();
      // An existing entry already has an answer, so it is not re-guessed
      // under the author while they edit a typo.
      langTouched = !!editing;
      if (!editing) guessLang();
      updateCount();
      o.hidden = false;
      o.querySelector(editing ? '#storyBody' : '#storyName').focus();
    }

    function closeEditor() {
      if (overlay) overlay.hidden = true;
      editing = null;
      replyTo = null;
    }

    function openReply(parent) {
      if (!parent) return;
      openEditor(null);
      if (!currentUser) return;
      replyTo = parent;
      labelEditor();
      overlay.querySelector('#storyEditorSub').textContent =
        t('stories.replyTo', 'Reply to {name}').replace('{name}', parent.display_name);
      overlay.querySelector('#storyBody').focus();
    }

    // The name to show. The nickname the writer chose when they signed
    // up comes first, because that is the name they have already decided
    // to be known by here — and it follows them to a new phone, which
    // anything kept on one device does not.
    //
    // Behind it, in order: the nickname their account was created with,
    // and then whatever they last typed on this device. Either of those
    // is better than an empty box, and the box is still a box: whatever
    // is in it when they press Post is what gets saved.
    function lastUsedName() {
      if (myNickname) return myNickname;
      var meta = (currentUser && currentUser.user_metadata) || {};
      var signup = (meta.nickname || meta.full_name || meta.name || '').trim();
      if (signup) return signup;
      try { return localStorage.getItem('duru_story_name') || ''; } catch (e) { return ''; }
    }
    function rememberName(name) {
      try { localStorage.setItem('duru_story_name', name); } catch (e) {}
    }

    function save(e) {
      e.preventDefault();
      if (saving) return;
      if (!currentUser) { openLogin(); return; }
      var name = overlay.querySelector('#storyName').value.trim();
      var body = overlay.querySelector('#storyBody').value.trim();
      if (!name) { setMsg('error', t('stories.errNoName', 'Please enter a name to show.')); return; }
      if (!body) {
        setMsg('error', replyTo
          ? t('stories.errReplyNoBody', 'Please write your reply first.')
          : t('stories.errNoBody', 'Please write your story first.'));
        return;
      }

      saving = true;
      var btn = overlay.querySelector('#storySubmit');
      btn.disabled = true;
      btn.textContent = t('stories.saving', 'Posting…');

      // parent_id is sent only for a reply, so a plain entry still saves
      // on a database that has not been migrated yet.
      var catSel = overlay.querySelector('#storyCat');
      var picked = (C && catSel && C.has(catSel.value)) ? catSel.value : null;

      var langSel = overlay.querySelector('#storyLang');
      var lang = langSel && langSel.value;
      var validLang = ((window.DURU_I18N && window.DURU_I18N.LANGS) || [])
        .some(function (l) { return l.code === lang; });

      var row = { user_id: currentUser.id, display_name: name, body: body };
      if (validLang && mtReady && !absent.lang) row.lang = lang;
      if (replyTo) row.parent_id = replyTo.id;
      // A reply carries whatever thread it is in; an entry carries what
      // was picked. Either is left off entirely when the column is not
      // there yet, so the page keeps working before the migration.
      var cat = replyTo ? catOf(replyTo) : picked;
      if (cat && !absent.category) row.category = cat;

      var patch = { display_name: name, body: body, updated_at: new Date().toISOString() };
      if (validLang && mtReady && !absent.lang) patch.lang = lang;
      // Rewriting the text makes every translation of it wrong. The
      // stored fingerprint would catch that on its own; throwing the
      // entries away as well means there is never a moment where an
      // out-of-date translation is a bug away from being shown.
      if (mtReady && !absent.mt && editing && editing.body !== body) patch.mt = {};
      if (!editing || !editing.parent_id) {
        if (picked && !absent.category) patch.category = picked;
      }
      send(editing ? patch : row, editing && editing.id).then(function (res) {
        saving = false;
        btn.disabled = false;
        btn.textContent = t('stories.post', 'Post');
        if (res.error) {
          setMsg('error', t('stories.errSaveFailed', 'Couldn’t post: {msg}').replace('{msg}', schemaHint(res.error.message)));
          return;
        }
        rememberName(name);
        if (editing) {
          delete trans[editing.id];
          delete showOriginal[editing.id];
          delete failed[editing.id];
        }
        closeEditor();
        loadStories();
      });
    }

    // Everything a post really needs — who wrote it, under what name,
    // and what it says. The rest are improvements that arrived with a
    // migration, and any of them may be missing from a database that
    // has not had that migration run yet.
    var CORE = ['user_id', 'display_name', 'body', 'updated_at'];

    // A column the database has never heard of comes back from PostgREST
    // as "Could not find the 'category' column of 'stories' in the schema
    // cache". That is a fixable thing to be told: the writer's words are
    // all still there, and what is missing is a shelf label or a language
    // badge. So it is dropped and the post goes in without it, rather
    // than the writer losing what they typed to a database migration
    // they have never heard of and cannot run.
    //
    // Only the extras are ever dropped. If the database says it has
    // never heard of `body`, something is wrong that hiding would not
    // fix, and the error is shown.
    function send(fields, id, tries) {
      var attempt = tries || 0;
      var op = id
        ? client.from('stories').update(fields).eq('id', id)
        : client.from('stories').insert(fields);

      return op.then(function (res) {
        var msg = res.error && res.error.message;
        if (!msg || attempt >= 4) return res;
        var missing = /Could not find the '([^']+)' column/.exec(msg);
        if (!missing || !/schema cache/i.test(msg)) return res;
        var column = missing[1];
        if (CORE.indexOf(column) !== -1 ||
            !Object.prototype.hasOwnProperty.call(fields, column)) return res;

        var without = {};
        Object.keys(fields).forEach(function (k) {
          if (k !== column) without[k] = fields[k];
        });
        // Remember it for the rest of the page's life, so the next post
        // does not pay for the same round trip.
        absent[column] = true;
        if (column === 'lang' || column === 'mt') mtReady = false;
        return send(without, id, attempt + 1);
      });
    }

    function confirmDelete(story) {
      if (!story) return;
      var ok = window.confirm(t('stories.confirmDelete',
        'This story will be permanently removed. This can’t be undone.'));
      if (!ok) return;
      client.from('stories').delete().eq('id', story.id).then(function (res) {
        if (res.error) { window.alert(res.error.message); return; }
        loadStories();
      });
    }

    function openLogin() {
      var trigger = document.getElementById('authTrigger');
      if (trigger) trigger.click();
    }

    if (writeBtn) writeBtn.addEventListener('click', function () { openEditor(null); });
    if (loginBtn) loginBtn.addEventListener('click', openLogin);

    /* ---------------- Session ---------------- */

    function applyUser(user) {
      currentUser = user || null;
      if (writeBtn) writeBtn.hidden = !currentUser;
      if (signedOutNote) signedOutNote.hidden = !!currentUser;
      if (!currentUser) {
        isAdmin = false;
        return loadStories().then(loadLanguages);
      }
      return Promise.all([
        client.from('admin_users').select('user_id').eq('user_id', currentUser.id).maybeSingle(),
        // Only this person's own row is readable — that is what the
        // "user_profiles: self read" policy says — so this asks for
        // their nickname and gets nothing else.
        client.from('user_profiles').select('nickname').eq('user_id', currentUser.id).maybeSingle()
      ]).then(function (both) {
        isAdmin = !!(both[0] && both[0].data);
        var profile = both[1] && both[1].data;
        myNickname = (profile && profile.nickname && profile.nickname.trim()) || '';
        return loadStories().then(loadLanguages);
      });
    }

    if (langFilterEl) {
      langFilterEl.addEventListener('change', function () {
        activeLang = langFilterEl.value || 'all';
        loadStories();
      });
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        if (loading) return;
        paintMore(shown());
        loadStories(true);
      });
    }

    buildFilterBar();
    syncURL();

    client.auth.getSession().then(function (res) {
      applyUser(res.data && res.data.session && res.data.session.user);
    });
    client.auth.onAuthStateChange(function (_event, session) {
      applyUser(session && session.user);
    });

    // Switching the site language switches what the reader is reading,
    // including anything they had already had translated: they asked
    // to read this thread in a language, and now that language is a
    // different one. What is not touched is a post they deliberately
    // put back into the original — that was a choice about this post,
    // not about the site.
    document.addEventListener('duru:langchange', function () {
      trans = Object.create(null);
      failed = Object.create(null);
      busy = Object.create(null);
      // A new language is a new page view as far as the allowance goes:
      // what was spent reading this place in English says nothing about
      // what it costs to read it in Vietnamese. The pages already asked
      // for are still on screen, so the allowance keeps their share.
      spent = 0;
      budget = AUTO_MAX + Math.max(0, loadedPages - 1) * PAGE_SIZE * 2;
      if (watcher) { watcher.disconnect(); watcher = null; }
      renderList();
      if (overlay && !overlay.hidden) labelEditor();
    });
  });
})();
