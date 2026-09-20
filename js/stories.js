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
// the way out and never interpreted.

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
                '<p class="story-meta">' + escapeHTML(formatDate(r.created_at)) + '</p></div>' +
              '<div class="story-body">' + paragraphs(r.body) + '</div>' +
              actionsHTML(r) +
              repliesHTML(r) +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    function renderList() {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = stories.length > 0;
      stories.forEach(function (s) {
        var card = document.createElement('article');
        card.className = 'story-card';
        card.innerHTML =
          '<div class="story-head">' +
            '<span class="story-avatar" aria-hidden="true">' + escapeHTML(initial(s.display_name)) + '</span>' +
            '<div><h3>' + escapeHTML(s.display_name) + '</h3>' +
            '<p class="story-meta">' + escapeHTML(formatDate(s.created_at)) + '</p></div>' +
          '</div>' +
          '<div class="story-body">' + paragraphs(s.body) + '</div>' +
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

    function loadStories() {
      return client.from('stories').select('*')
        .order('created_at', { ascending: false }).limit(PAGE_SIZE)
        .then(function (res) {
          if (res.error) { console.error('Failed to load stories:', res.error.message); return; }
          rows = res.data || [];
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
        ? t('stories.editorEditTitle', 'Edit your story')
        : replyTo
          ? t('stories.editorReplyTitle', 'Write a reply')
          : t('stories.editorNewTitle', 'Share your story');
      o.querySelector('#storyEditorSub').textContent =
        t('stories.editorSub', 'Your email address is never shown — only the name you choose here.');
      o.querySelector('label[for="storyName"]').textContent = t('stories.fieldName', 'Name to show');
      o.querySelector('label[for="storyBody"]').textContent = replyTo
        ? t('stories.fieldReply', 'Your reply')
        : t('stories.fieldBody', 'Your story');
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
      replyTo = editing && editing.parent_id ? { id: editing.parent_id } : null;
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
      var row = { user_id: currentUser.id, display_name: name, body: body };
      if (replyTo) row.parent_id = replyTo.id;
      var op = editing
        ? client.from('stories').update({ display_name: name, body: body, updated_at: new Date().toISOString() }).eq('id', editing.id)
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
