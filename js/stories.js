// DURU KOREAN — learner stories
//
// Include after js/auth.js on stories.html. Anyone can read; you have to
// be signed in to write. A learner may edit or delete their own story and
// nobody else's, and an admin may delete any of them. All of that is
// enforced by Row Level Security in supabase/schema.sql — the buttons
// this file shows or hides are a convenience, not the protection.
//
// Bodies are stored and rendered as plain text. Allowing HTML would let
// one visitor run code in another visitor's browser, so it is escaped on
// the way out and never interpreted.

(function () {
  'use strict';

  var PAGE_SIZE = 30;

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

    /* ---------------- Rendering ---------------- */

    function renderList() {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = stories.length > 0;
      stories.forEach(function (s) {
        var mine = currentUser && s.user_id === currentUser.id;
        var card = document.createElement('article');
        card.className = 'story-card';
        card.innerHTML =
          '<div class="story-head">' +
            '<span class="story-avatar" aria-hidden="true">' + escapeHTML(initial(s.display_name)) + '</span>' +
            '<div><h3>' + escapeHTML(s.display_name) + '</h3>' +
            '<p class="story-meta">' + escapeHTML(formatDate(s.created_at)) + '</p></div>' +
          '</div>' +
          '<div class="story-body">' + paragraphs(s.body) + '</div>' +
          ((mine || isAdmin) ? '<div class="story-actions">' +
            (mine ? '<button type="button" class="story-edit-btn" data-id="' + s.id + '">' + escapeHTML(t('stories.edit', 'Edit')) + '</button>' : '') +
            '<button type="button" class="story-delete-btn" data-id="' + s.id + '">' + escapeHTML(t('stories.delete', 'Delete')) + '</button>' +
            '</div>' : '');
        listEl.appendChild(card);
      });
      listEl.querySelectorAll('.story-edit-btn').forEach(function (b) {
        b.addEventListener('click', function () { openEditor(find(b.dataset.id)); });
      });
      listEl.querySelectorAll('.story-delete-btn').forEach(function (b) {
        b.addEventListener('click', function () { confirmDelete(find(b.dataset.id)); });
      });
    }

    function find(id) {
      return stories.filter(function (s) { return String(s.id) === String(id); })[0];
    }

    function loadStories() {
      return client.from('stories').select('*')
        .order('created_at', { ascending: false }).limit(PAGE_SIZE)
        .then(function (res) {
          if (res.error) { console.error('Failed to load stories:', res.error.message); return; }
          stories = res.data || [];
          renderList();
        });
    }

    /* ---------------- Editor ---------------- */

    var overlay = null;
    var editing = null;
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
      overlay.querySelector('#storyBody').addEventListener('input', updateCount);
      return overlay;
    }

    function updateCount() {
      var body = overlay.querySelector('#storyBody');
      overlay.querySelector('#storyCount').textContent =
        t('stories.charCount', '{n} / 4000 characters').replace('{n}', body.value.length);
    }

    function labelEditor() {
      var o = buildEditor();
      o.querySelector('#storyEditorTitle').textContent = editing
        ? t('stories.editorEditTitle', 'Edit your story') : t('stories.editorNewTitle', 'Share your story');
      o.querySelector('#storyEditorSub').textContent =
        t('stories.editorSub', 'Your email address is never shown — only the name you choose here.');
      o.querySelector('label[for="storyName"]').textContent = t('stories.fieldName', 'Name to show');
      o.querySelector('label[for="storyBody"]').textContent = t('stories.fieldBody', 'Your story');
      o.querySelector('#storySubmit').textContent = t('stories.post', 'Post');
      updateCount();
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
      var o = buildEditor();
      labelEditor();
      o.querySelector('[data-msg="story"]').hidden = true;
      o.querySelector('#storyName').value = editing ? editing.display_name : lastUsedName();
      o.querySelector('#storyBody').value = editing ? editing.body : '';
      updateCount();
      o.hidden = false;
      o.querySelector(editing ? '#storyBody' : '#storyName').focus();
    }

    function closeEditor() {
      if (overlay) overlay.hidden = true;
      editing = null;
    }

    // Remember the display name locally so a returning writer doesn't have
    // to retype it. It is a convenience on this device only — the name that
    // counts is the one saved on each story.
    function lastUsedName() {
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
      if (!body) { setMsg('error', t('stories.errNoBody', 'Please write your story first.')); return; }

      saving = true;
      var btn = overlay.querySelector('#storySubmit');
      btn.disabled = true;
      btn.textContent = t('stories.saving', 'Posting…');

      var op = editing
        ? client.from('stories').update({ display_name: name, body: body, updated_at: new Date().toISOString() }).eq('id', editing.id)
        : client.from('stories').insert({ user_id: currentUser.id, display_name: name, body: body });

      op.then(function (res) {
        saving = false;
        btn.disabled = false;
        btn.textContent = t('stories.post', 'Post');
        if (res.error) {
          setMsg('error', t('stories.errSaveFailed', 'Couldn’t post: {msg}').replace('{msg}', res.error.message));
          return;
        }
        rememberName(name);
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

    client.auth.getSession().then(function (res) {
      applyUser(res.data && res.data.session && res.data.session.user);
    });
    client.auth.onAuthStateChange(function (_event, session) {
      applyUser(session && session.user);
    });

    document.addEventListener('duru:langchange', function () {
      renderList();
      if (overlay && !overlay.hidden) labelEditor();
    });
  });
})();
