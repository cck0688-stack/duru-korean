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

  var PAGE_SIZE = 100;

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
    var langFilterLabel = document.getElementById('storyLangFilterLabel');
    var activeLang = 'all';           // which language people wrote in

    // What the reader currently has in front of them, per row. None of
    // this is stored anywhere: it is a reading choice, not a setting,
    // and it lasts as long as the page does.
    // Whether the database has had supabase/schema.sql §33 run against
    // it yet. Until it has, the page is exactly the community it was
    // before: no badges, no filter, no offer to translate anything.
    // Everything here can be deployed before the migration, which is
    // the only order that does not take the page down in between.
    var mtReady = true;

    var trans = Object.create(null);        // id -> { lang, body, from }
    var showOriginal = Object.create(null); // id -> the reader asked for the author's words back
    var busy = Object.create(null);         // id -> a request is out
    var failed = Object.create(null);       // id -> the last attempt did not come back

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
          renderList();
        });
      });
      if (allBtn) {
        allBtn.addEventListener('click', function () {
          activeFilter = 'all';
          syncURL();
          renderList();
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
      if (row.lang === want) return '';
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
    // not quietly clear the other.
    function shown() {
      return stories.filter(function (s2) {
        if (activeFilter !== 'all' && catOf(s2) !== activeFilter) return false;
        if (activeLang !== 'all' && (s2.lang || 'unknown') !== activeLang) return false;
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
      if (countEl) countEl.textContent = postCount(list.length);
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
      list.forEach(function (s) {
        var card = document.createElement('article');
        card.className = 'story-card';
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
    var MT_BATCH = 25;

    function translateItems(ids) {
      var want = siteLang();
      var need = [];

      ids.forEach(function (id) {
        var row = find(id);
        if (!row) return;
        delete showOriginal[id];
        delete failed[id];
        if (row.lang === want) return;                     // already readable
        var held = trans[id];
        if (held && held.lang === want) return;            // asked for before
        var hit = cachedFor(row, want);                    // translated for someone else
        if (hit) { trans[id] = hit; return; }
        need.push(id);
      });

      if (!need.length) { renderList(); return; }
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
      stories.forEach(function (r) {
        if (r.lang) present[r.lang] = true; else anyUnknown = true;
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

    function loadStories() {
      return client.from('stories').select('*')
        .order('created_at', { ascending: false }).limit(PAGE_SIZE)
        .then(function (res) {
          if (res.error) { console.error('Failed to load stories:', res.error.message); return; }
          rows = res.data || [];
          if (rows.length) mtReady = Object.prototype.hasOwnProperty.call(rows[0], 'lang');
          // One query, split here: entries newest first, replies under
          // whatever they answer, oldest first. A row with no parent_id —
          // which is every row from before the column existed — is an
          // entry, so the page keeps working until the migration has run.
          stories = rows.filter(function (r) { return !r.parent_id; });
          childrenOf = Object.create(null);
          rows.filter(function (r) { return r.parent_id; })
            .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
            .forEach(function (r) {
              (childrenOf[r.parent_id] = childrenOf[r.parent_id] || []).push(r);
            });
          renderList();
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

    // Remember the display name locally so a returning writer doesn't have
    // to retype it. It is a convenience on this device only — the name that
    // counts is the one saved on each story.
    function lastUsedName() {
      var remembered = '';
      try { remembered = localStorage.getItem('duru_story_name') || ''; } catch (e) { remembered = ''; }
      if (remembered) return remembered;
      // First time on this device: start from the account's nickname, so
      // a reply does not stall on an empty name field.
      var meta = (currentUser && currentUser.user_metadata) || {};
      return (meta.nickname || '').trim();
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
      if (validLang && mtReady) row.lang = lang;
      if (replyTo) row.parent_id = replyTo.id;
      // A reply carries whatever thread it is in; an entry carries what
      // was picked. Either is left off entirely when the column is not
      // there yet, so the page keeps working before the migration.
      var cat = replyTo ? catOf(replyTo) : picked;
      if (cat) row.category = cat;

      var patch = { display_name: name, body: body, updated_at: new Date().toISOString() };
      if (validLang && mtReady) patch.lang = lang;
      // Rewriting the text makes every translation of it wrong. The
      // stored fingerprint would catch that on its own; throwing the
      // entries away as well means there is never a moment where an
      // out-of-date translation is a bug away from being shown.
      if (mtReady && editing && editing.body !== body) patch.mt = {};
      if (!editing || !editing.parent_id) { if (picked) patch.category = picked; }
      var op = editing
        ? client.from('stories').update(patch).eq('id', editing.id)
        : client.from('stories').insert(row);

      op.then(function (res) {
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
        return loadStories();
      }
      return client.from('admin_users').select('user_id').eq('user_id', currentUser.id).maybeSingle()
        .then(function (res) {
          isAdmin = !!(res && res.data);
          return loadStories();
        });
    }

    if (langFilterEl) {
      langFilterEl.addEventListener('change', function () {
        activeLang = langFilterEl.value || 'all';
        renderList();
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
      var again = Object.keys(trans).filter(function (id) { return !showOriginal[id]; });
      trans = Object.create(null);
      failed = Object.create(null);
      busy = Object.create(null);
      renderList();
      if (again.length) translateItems(again);
      if (overlay && !overlay.hidden) labelEditor();
    });
  });
})();
