// DURU KOREAN — the downloads list (Free Downloads and Book Resources)
//
// Include after js/auth.js and js/resource-common.js on a page that sets
// window.DURU_RESOURCE_LOCATION to 'free-resources' or 'book-resources'.
// One card per resource, whatever languages it comes in; the language
// is chosen on the resource's own page. The type chips and the language
// dropdown filter together, and both — with the scroll position — are
// remembered for the trip back from a resource page.
//
// Anyone may look. Only a user in admin_users may create a resource,
// and Row Level Security enforces that on the server; the button this
// file shows is a convenience, not the protection.

(function () {
  'use strict';

  var LOCATION = window.DURU_RESOURCE_LOCATION;
  if (!LOCATION) return;
  var R = window.DURU_RES;
  if (!R) return;
  var t = R.t, esc = R.escapeHTML;

  var STATE_KEY = 'duru_dl_state:' + LOCATION;
  var RETURN_KEY = 'duru_dl_return:' + LOCATION;

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('resourceList');
    var emptyEl = document.getElementById('resourceListEmpty');
    var emptyText = document.getElementById('resourceEmptyText');
    var suggestEl = document.getElementById('resourceLangSuggest');
    var filtersEl = document.getElementById('resourceFilters');
    var allBtn = document.getElementById('resourceAllBtn');
    var titleEl = document.getElementById('resourceAllTitle');
    var countEl = document.getElementById('resourceCount');
    var langSel = document.getElementById('resourceLang');
    var newBtn = document.getElementById('newResourceBtn');
    if (!listEl) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var isAdmin = false;
    var currentUser = null;
    var all = [];
    var state = { type: 'all', lang: R.preferredLang() };
    // The site language this list is currently tuned to. A choice the
    // reader made in the dropdown is remembered, but only against the
    // site language it was made under: picking 中文 at the top of the
    // page is a statement about what they want to read, and the list
    // should follow it rather than sit on a choice from before.
    var tunedTo = null;

    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); } catch (e) {}
    if (saved && typeof saved === 'object' && saved.type) state.type = saved.type;

    function saveState(extra) {
      try {
        var s = { type: state.type, lang: state.lang, site: tunedTo };
        if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
        sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
      } catch (e) {}
    }

    // Returns true when the list language moved and the page needs a
    // repaint. On the first call a remembered choice made under this
    // same site language wins; after that the site language always does.
    function followSiteLang() {
      var code = R.preferredLang();
      if (tunedTo === code) return false;
      var first = tunedTo === null;
      tunedTo = code;
      if (first && saved && saved.lang && saved.site === code) state.lang = saved.lang;
      else state.lang = code;
      saveState();
      return true;
    }
    followSiteLang();

    /* ---------------- Language dropdown ---------------- */

    // Which languages the resources on this page are actually written
    // in, used to point somewhere useful when the chosen one has none.
    function langsPresent(inType) {
      var seen = {};
      all.forEach(function (r) {
        if (inType && state.type !== 'all' && r.category !== state.type) return;
        R.availableFiles(r, isAdmin).forEach(function (f) { seen[f.lang] = true; });
      });
      return R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return seen[c]; });
    }

    // Every language the site speaks is listed, in the picker's order,
    // whether or not a download exists in it yet: a reader looking for
    // their own language should see it named rather than wonder where
    // it went. English is the default, and the empty state below says
    // what to do when the chosen language has nothing.
    function buildLangSelect() {
      if (!langSel) return;
      langSel.innerHTML = R.LANGS.map(function (l) {
        return '<option value="' + esc(l.code) + '">' + esc(l.label) + '</option>';
      }).join('');
      if (!R.LANGS.some(function (l) { return l.code === state.lang; })) state.lang = 'en';
      langSel.value = state.lang;
    }

    /* ---------------- Cards ---------------- */

    function cardHTML(r) {
      var lang = R.siteLang();
      var files = R.availableFiles(r, isAdmin);
      var formats = {};
      files.forEach(function (f) { formats[String(f.file_type || '').toUpperCase()] = true; });
      var chips = files.map(function (f) { return f.lang; });
      var shown = chips.slice(0, 3);
      var more = chips.length - shown.length;
      var href = 'resource.html?id=' + encodeURIComponent(r.id) + '&pl=' + encodeURIComponent(state.lang);
      var level = r.learning_level && r.learning_level !== 'Any level' ? R.levelLabel(r.learning_level) : '';
      var meta = [R.categoryLabel(r.category), level, Object.keys(formats).join('/') || 'PDF'].filter(Boolean).join(' · ');
      var desc = R.localized(r, 'description', lang);
      // Only an admin is shown a row that is not live — the read policy
      // keeps it from everyone else — and the badge says which kind of
      // not-live: still in the review queue, or taken down.
      var inReview = !!(r.status && r.status !== 'published');
      var draft = inReview || r.published === false;
      return '<article class="res-card' + (draft ? ' res-card--draft' : '') + '">' +
        '<span class="res-thumb">' + R.coverHTML(client, r) + '</span>' +
        '<div class="res-card-body">' +
          (draft ? '<span class="res-draft">' + esc(inReview
            ? t('resource.inReview', 'Waiting for review')
            : t('resource.draft', 'Not published')) + '</span>' : '') +
          '<h3><a href="' + esc(href) + '">' + esc(R.localized(r, 'title', lang)) + '</a></h3>' +
          (desc ? '<p class="res-card-desc">' + esc(desc) + '</p>' : '') +
          '<p class="res-meta">' + esc(meta) + '</p>' +
          '<div class="res-card-foot">' +
            '<span class="res-langs" aria-label="' + esc(t('resource.factLanguages', 'Languages')) + '">' +
              shown.map(function (c) { return '<span class="res-chip">' + esc(R.langShort(c)) + '</span>'; }).join('') +
              (more > 0 ? '<span class="res-chip res-chip--more">+' + more + '</span>' : '') +
              (!chips.length ? '<span class="res-chip res-chip--none">' + esc(t('resource.noFilesYet', 'No file yet')) + '</span>' : '') +
            '</span>' +
            '<span class="res-view">' + esc(t('resources.viewDownload', 'View & Download')) + ' →</span>' +
          '</div>' +
        '</div>' +
      '</article>';
    }

    // The shelf a resource is on. A category the page has never heard of
    // — one filed before a shelf was renamed, or between this deploying
    // and the migration running — counts as the catch-all rather than
    // as nothing at all. Without this such a file sits in All downloads
    // and on no shelf, which is the worst of both: still listed, but
    // unreachable by anyone browsing.
    function shelfOf(r) {
      var id = r && r.category;
      return R.CATEGORIES.indexOf(id) === -1 ? 'etc' : id;
    }

    function visible() {
      return all.filter(function (r) {
        if (state.type !== 'all' && shelfOf(r) !== state.type) return false;
        // An admin also finds a resource by a file that is still hidden.
        return R.availableFiles(r, isAdmin).some(function (f) { return f.lang === state.lang; });
      });
    }

    function render() {
      var rows = visible();
      paintShelves();
      if (countEl) countEl.textContent = fileCount(rows.length);
      listEl.innerHTML = rows.map(cardHTML).join('');
      if (rows.length) {
        emptyEl.hidden = true;
      } else {
        emptyEl.hidden = false;
        // Nothing in this language: name the ones that do have something,
        // as buttons, so the reader is one click from a file instead of
        // working through the dropdown.
        var others = langsPresent(true).filter(function (c) { return c !== state.lang; });
        if (others.length) {
          emptyText.textContent = t('resources.noneInLang', 'Nothing here in {lang} yet.').replace('{lang}', R.langLabel(state.lang));
          suggestEl.innerHTML = '<span class="res-lang-suggest-label">' + esc(t('resources.availableIn', 'Available in')) + '</span>' +
            others.map(function (c) {
              return '<button type="button" class="btn btn-ghost" data-lang="' + esc(c) + '">' + esc(R.langLabel(c)) + '</button>';
            }).join('');
          suggestEl.hidden = false;
        } else {
          emptyText.textContent = t('resources.emptyNote', 'No files have been attached yet.');
          suggestEl.innerHTML = '';
          suggestEl.hidden = true;
        }
      }
      listEl.querySelectorAll('a[href^="resource.html"]').forEach(function (a) {
        a.addEventListener('click', function () {
          saveState({ scrollY: window.scrollY });
          try { sessionStorage.setItem(RETURN_KEY, '1'); } catch (e) {}
        });
      });
    }

    function restoreScroll() {
      var back = false;
      try { back = sessionStorage.getItem(RETURN_KEY) === '1'; sessionStorage.removeItem(RETURN_KEY); } catch (e) {}
      if (!back) return;
      try {
        var s = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
        if (s && typeof s.scrollY === 'number') window.scrollTo(0, s.scrollY);
      } catch (e) {}
    }

    function load() {
      return client.from('resources')
        .select('*, resource_files(id, lang, file_type, file_size, page_count, published)')
        .eq('publish_location', LOCATION)
        .order('created_at', { ascending: false })
        .then(function (res) {
          if (res.error) {
            console.error('Failed to load resources:', res.error.message);
            if (isAdmin && window.DURU_NOTIFY) window.DURU_NOTIFY.error(R.schemaHint(res.error.message));
            return;
          }
          all = res.data || [];
          buildLangSelect();
          render();
          restoreScroll();
        });
    }

    /* ---------------- The shelves ---------------- */
    //
    // Six cards in two rows of three, the same furniture the blog and
    // the community have: one All button on its own above the rule,
    // then the shelves under a heading that says what they are. They
    // are built from window.DURU_RES.CATEGORIES rather than written
    // into the page, so a shelf added there appears here, in the admin
    // editor and on a resource page all at once.

    // Book Resources is the same script over the same data with a
    // different publish_location, and it keeps the plain row of buttons
    // it has always had. Only the page whose markup asks for cards gets
    // cards; both get every shelf, so a file filed under `etc` is
    // reachable from either.
    var asCards = !!(filtersEl && filtersEl.classList.contains('cat-grid'));

    function buildShelves() {
      if (!filtersEl) return;
      if (!asCards) return buildButtons();
      filtersEl.innerHTML = R.CATEGORIES.map(function (id) {
        return '<button type="button" class="cat-card" data-filter="' + esc(id) +
          '" aria-pressed="false">' +
          '<span class="cat-card-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24">' + R.categoryIcon(id) + '</svg>' +
          '</span><h3></h3><p></p></button>';
      }).join('');
      filtersEl.addEventListener('click', function (e) {
        var card = e.target.closest('.cat-card');
        if (!card) return;
        // Pressing the shelf already open steps back out of it.
        state.type = card.dataset.filter === state.type ? 'all' : card.dataset.filter;
        saveState();
        render();
      });
      if (allBtn) {
        allBtn.addEventListener('click', function () {
          state.type = 'all';
          saveState();
          render();
        });
      }
      paintShelves();
    }

    // Names and descriptions on a language change; which one is open
    // whenever the list is redrawn. aria-pressed is both what the CSS
    // styles and what a screen reader is told, so they cannot disagree.
    // The row of buttons, for the page that still has one. Built from
    // the same list, so neither page can quietly fall a shelf behind.
    function buildButtons() {
      filtersEl.innerHTML =
        '<button class="filter-btn" data-filter="all">' + esc(t('resources.filter.all', 'All')) + '</button>' +
        R.CATEGORIES.map(function (id) {
          return '<button class="filter-btn" data-filter="' + esc(id) + '">' +
            esc(R.categoryLabel(id)) + '</button>';
        }).join('');
      filtersEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.filter-btn');
        if (!btn) return;
        state.type = btn.dataset.filter;
        saveState();
        render();
      });
      paintShelves();
    }

    function paintShelves() {
      if (!filtersEl) return;
      if (!asCards) {
        filtersEl.querySelectorAll('.filter-btn').forEach(function (b) {
          var id = b.dataset.filter;
          b.classList.toggle('active', id === state.type);
          b.textContent = id === 'all' ? t('resources.filter.all', 'All') : R.categoryLabel(id);
        });
        return;
      }
      filtersEl.querySelectorAll('.cat-card').forEach(function (card) {
        var id = card.dataset.filter;
        var on = id === state.type;
        card.classList.toggle('active', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) card.setAttribute('aria-current', 'true');
        else card.removeAttribute('aria-current');
        card.querySelector('h3').textContent = R.categoryLabel(id);
        card.querySelector('p').textContent = R.categoryDescribe(id);
      });
      if (allBtn) allBtn.setAttribute('aria-pressed', state.type === 'all' ? 'true' : 'false');
      if (titleEl) {
        titleEl.textContent = state.type === 'all'
          ? t('resources.latest', 'Latest downloads')
          : R.categoryLabel(state.type);
      }
    }

    function fileCount(n) {
      if (!n) return t('resources.count.none', 'Nothing yet');
      if (n === 1) return t('resources.count.one', '1 download');
      return t('resources.count', '{n} downloads').replace('{n}', n);
    }

    buildShelves();
    if (langSel) {
      langSel.addEventListener('change', function () {
        state.lang = langSel.value;
        saveState(); render();
      });

    }
    if (suggestEl) {
      suggestEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-lang]');
        if (!btn) return;
        state.lang = btn.dataset.lang;
        if (langSel) langSel.value = state.lang;
        saveState(); render();
      });
    }
    document.addEventListener('duru:langchange', function () {
      followSiteLang();
      buildLangSelect();
      render();
    });

    /* ---------------- Admin: add a download ---------------- */

    // One screen does the whole job: name it, file it, drop the files
    // in, publish. The language of each file is guessed from its name
    // (hangul-vi.pdf) and can be corrected before uploading.

    var overlay = null;
    var picked = [];

    function ensureNewModal() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.className = 'resource-confirm-overlay';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="resource-confirm-modal resource-upload-modal" role="dialog" aria-modal="true" aria-labelledby="resNewTitle">' +
          '<button type="button" class="auth-close" data-act="close" aria-label="' + esc(t('resources.closeAria', 'Close')) + '">&times;</button>' +
          '<h3 id="resNewTitle">' + esc(t('resources.newTitle', 'Add a download')) + '</h3>' +
          '<div class="resource-upload-msg" hidden></div>' +
          '<form id="resNewForm" novalidate>' +
            '<div class="auth-field"><label for="resNewTitleInput">' + esc(t('resources.fieldTitle', 'Title')) + '</label>' +
              '<input type="text" id="resNewTitleInput" required maxlength="120" placeholder="' + esc(t('resources.titlePlaceholder', 'e.g. Hangul writing practice')) + '"></div>' +
            '<div class="auth-field"><label for="resNewDesc">' + esc(t('resource.fieldSummary', 'Short description')) + '</label>' +
              '<textarea id="resNewDesc" rows="2" maxlength="300" placeholder="' + esc(t('resources.descPlaceholder', 'One line, shown on the card.')) + '"></textarea></div>' +
            '<div class="res-editor-row">' +
              '<div class="auth-field"><label for="resNewCategory">' + esc(t('resources.fieldCategory', 'Category')) + '</label>' +
                '<select id="resNewCategory">' + R.CATEGORIES.map(function (c) { return '<option value="' + c + '">' + esc(R.categoryLabel(c)) + '</option>'; }).join('') + '</select></div>' +
              '<div class="auth-field"><label for="resNewLevel">' + esc(t('resources.fieldLevel', 'Learning level')) + '</label>' +
                '<select id="resNewLevel">' + R.LEVELS.map(function (l) { return '<option value="' + l + '">' + esc(R.levelLabel(l)) + '</option>'; }).join('') + '</select></div>' +
            '</div>' +
            '<div class="auth-field">' +
              '<label for="resNewFiles">' + esc(t('resources.fieldFiles', 'Files')) + '</label>' +
              '<input type="file" id="resNewFiles" multiple accept="' + R.ACCEPT + '">' +
              '<p class="resource-hint">' + esc(t('resources.filesHint', 'Pick one file per language — all at once is fine. PDF, DOC, DOCX, images and audio up to 50 MB each.')) + '</p>' +
              '<div class="res-picked" id="resPicked"></div>' +
            '</div>' +
            '<label class="res-check"><input type="checkbox" id="resNewPublish" checked> ' + esc(t('resources.publishNow', 'Publish as soon as it is uploaded')) + '</label>' +
            '<button type="submit" class="btn btn-primary auth-submit" id="resNewSubmit">' + esc(t('resources.createBtn', 'Upload')) + '</button>' +
          '</form>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.querySelector('[data-act="close"]').addEventListener('click', function () { overlay.hidden = true; });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.hidden = true; });
      overlay.querySelector('#resNewForm').addEventListener('submit', onCreate);
      overlay.querySelector('#resNewFiles').addEventListener('change', function () {
        Array.prototype.forEach.call(this.files, function (f) {
          picked.push({ file: f, lang: R.guessLang(f.name) || R.siteLang() });
        });
        this.value = '';
        renderPicked();
      });
      return overlay;
    }

    function renderPicked() {
      var box = overlay.querySelector('#resPicked');
      box.innerHTML = picked.map(function (p, i) {
        return '<div class="res-picked-row">' +
          '<span class="res-picked-name" title="' + esc(p.file.name) + '">' + esc(p.file.name) + '</span>' +
          '<span class="res-picked-size">' + esc(R.formatSize(p.file.size)) + '</span>' +
          '<select data-i="' + i + '">' + R.LANGS.map(function (l) {
            return '<option value="' + l.code + '"' + (l.code === p.lang ? ' selected' : '') + '>' + esc(l.label) + '</option>';
          }).join('') + '</select>' +
          '<button type="button" class="res-linkbtn res-linkbtn--danger" data-drop="' + i + '">' + esc(t('resource.removeFile', 'Remove')) + '</button>' +
        '</div>';
      }).join('');
      box.querySelectorAll('select').forEach(function (sel) {
        sel.addEventListener('change', function () { picked[Number(sel.dataset.i)].lang = sel.value; });
      });
      box.querySelectorAll('[data-drop]').forEach(function (b) {
        b.addEventListener('click', function () { picked.splice(Number(b.dataset.drop), 1); renderPicked(); });
      });
    }

    function setMsg(text, type) {
      var el = overlay.querySelector('.resource-upload-msg');
      el.textContent = text; el.className = 'resource-upload-msg ' + (type || ''); el.hidden = !text;
    }

    function onCreate(e) {
      e.preventDefault();
      var title = overlay.querySelector('#resNewTitleInput').value.trim();
      if (!title) { setMsg(t('resources.errTitleRequired', 'Please enter a title.'), 'error'); return; }

      var langs = {};
      for (var i = 0; i < picked.length; i++) {
        var p = picked[i], ext = R.fileExt(p.file.name);
        if (!R.MAX_SIZE[ext]) { setMsg(t('resources.errUnsupportedType', 'Unsupported file type. Allowed: PDF, DOC, DOCX, PNG, JPG, JPEG, MP3, M4A.'), 'error'); return; }
        if (p.file.size > R.MAX_SIZE[ext]) {
          setMsg(t('resources.errTooLarge', 'File is too large. Max size for .{ext} is {size}.').replace('{ext}', ext).replace('{size}', R.formatSize(R.MAX_SIZE[ext])), 'error');
          return;
        }
        if (langs[p.lang]) { setMsg(t('resources.errSameLang', 'Two files are set to {lang}. A download takes one file per language.').replace('{lang}', R.langLabel(p.lang)), 'error'); return; }
        langs[p.lang] = true;
      }
      var publish = overlay.querySelector('#resNewPublish').checked && picked.length > 0;

      var btn = overlay.querySelector('#resNewSubmit');
      btn.disabled = true;
      setMsg(picked.length ? t('resources.uploading', 'Uploading…') : '', '');

      client.from('resources').insert({
        title: title,
        description: overlay.querySelector('#resNewDesc').value.trim() || null,
        publish_location: LOCATION,
        category: overlay.querySelector('#resNewCategory').value,
        learning_level: overlay.querySelector('#resNewLevel').value,
        published: publish,
        created_by: currentUser ? currentUser.id : null
      }).select('id').single().then(function (res) {
        if (res.error) throw new Error(R.schemaHint(res.error.message));
        var rid = res.data.id;
        return picked.reduce(function (chain, p) {
          return chain.then(function () { return uploadOne(rid, p); });
        }, Promise.resolve()).then(function () { return rid; });
      }).then(function (rid) {
        picked = [];
        window.location.href = 'resource.html?id=' + encodeURIComponent(rid);
      }).catch(function (err) {
        btn.disabled = false;
        setMsg(t('resources.errSaveFailed', 'Could not save resource: {msg}').replace('{msg}', err.message), 'error');
      });
    }

    function uploadOne(rid, p) {
      var ext = R.fileExt(p.file.name);
      var key = LOCATION + '/' + rid + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)) + '.' + ext;
      var pages = ext === 'pdf' ? R.pdfPageCount(p.file) : Promise.resolve(null);
      return pages.then(function (n) {
        return client.storage.from(R.BUCKET).upload(key, p.file, { contentType: R.MIME_BY_EXT[ext], upsert: false })
          .then(function (up) {
            if (up.error) throw new Error(R.uploadErrorText(up.error));
            return client.from('resource_files').insert({
              resource_id: rid, lang: p.lang, storage_key: key, file_type: ext,
              file_size: p.file.size, mime_type: R.MIME_BY_EXT[ext],
              page_count: n, published: true,
              created_by: currentUser ? currentUser.id : null
            }).then(function (ins) {
              if (ins.error) {
                return client.storage.from(R.BUCKET).remove([key]).then(function () { throw new Error(R.schemaHint(ins.error.message)); });
              }
            });
          });
      });
    }

    if (newBtn) {
      newBtn.addEventListener('click', function () {
        var o = ensureNewModal();
        picked = []; renderPicked();
        setMsg('', ''); o.hidden = false;
        o.querySelector('#resNewTitleInput').focus();
      });
    }

    /* ---------------- Session ---------------- */

    function applyUser(user) {
      currentUser = user || null;
      R.isAdmin(client, currentUser).then(function (admin) {
        isAdmin = admin;
        if (newBtn) newBtn.hidden = !isAdmin;
        load();
      });
    }
    client.auth.getSession().then(function (res) { applyUser(res.data && res.data.session && res.data.session.user); });
    client.auth.onAuthStateChange(function (_e, session) { applyUser(session && session.user); });
  });
})();
