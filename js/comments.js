// DURU KOREAN — comments under a blog post
//
// Load after js/auth.js and before js/blog.js. Exposes window.DURU_COMMENTS
// with one entry point: mount(container, postId).
//
// Anyone who has read the article can leave a comment, signed in or not.
// Asking a reader to make an account before they can say "this helped"
// loses almost all of them, so the form asks for a name and the text and
// nothing else. A signed-in reader's name is filled in for them and
// their comment is tied to their account; a signed-out one is tied to
// the random id the browser keeps (window.DURU_ANON), which identifies
// nobody but is enough to let them delete what they just wrote.
//
// A reply is a comment with a parent, and a reply may itself be replied
// to, so a thread nests as deep as the talk goes — the same shape the
// guestbook uses. Deleting takes the replies with it, which is what
// moderation wants: removing the comment that started a bad thread
// should not leave the thread behind.
//
// Who may delete what is decided by Row Level Security in
// supabase/schema.sql, not by this file hiding a button: an admin may
// delete any comment, a signed-in author their own, and a signed-out
// author their own through a function that checks the browser id.

(function () {
  'use strict';

  var MAX_BODY = 2000;
  var MAX_NAME = 40;
  // Deeper than this and the indent eats the text on a phone; further
  // replies join the thread at the same level rather than stepping in.
  var MAX_DEPTH = 4;

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // A comment is plain text. Blank lines become paragraphs and
  // everything else is escaped — accepting HTML from one visitor would
  // let them run code in another visitor's browser.
  function bodyHTML(text) {
    return String(text || '').split(/\n{2,}/).map(function (block) {
      return '<p>' + esc(block.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function when(iso) {
    try {
      var lang = (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
      return new Date(iso).toLocaleDateString(lang, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return String(iso || '').slice(0, 16).replace('T', ' ');
    }
  }

  function anonId() {
    return (window.DURU_ANON && window.DURU_ANON.id()) || null;
  }

  function mount(container, postId) {
    var client = window.DURU_SUPABASE_CLIENT;
    if (!container || !client || !postId) return;

    var comments = [];
    var user = null;
    var isAdmin = false;
    var replyingTo = null;
    var busy = false;

    container.className = 'comments';
    container.innerHTML =
      '<h2 class="comments-title"></h2>' +
      '<div class="comment-form-wrap" data-root="1"></div>' +
      '<div class="comment-list"></div>';

    var titleEl = container.querySelector('.comments-title');
    var rootFormEl = container.querySelector('.comment-form-wrap[data-root]');
    var listEl = container.querySelector('.comment-list');

    /* ---------------- The form ---------------- */

    function formHTML(parentId) {
      var named = user && (user.user_metadata && user.user_metadata.display_name);
      var name = named || (user && user.email ? user.email.split('@')[0] : '');
      return '<form class="comment-form" data-parent="' + esc(parentId || '') + '" novalidate>' +
        '<div class="comment-form-row">' +
          '<input type="text" class="comment-name" maxlength="' + MAX_NAME + '"' +
            ' value="' + esc(name) + '"' + (user ? ' readonly' : '') +
            ' placeholder="' + esc(t('comments.namePlaceholder', 'Your name')) + '"' +
            ' aria-label="' + esc(t('comments.namePlaceholder', 'Your name')) + '">' +
        '</div>' +
        '<textarea class="comment-body" rows="3" maxlength="' + MAX_BODY + '"' +
          ' placeholder="' + esc(parentId
            ? t('comments.replyPlaceholder', 'Write a reply…')
            : t('comments.bodyPlaceholder', 'What did you think of this post?')) + '"' +
          ' aria-label="' + esc(t('comments.bodyPlaceholder', 'What did you think of this post?')) + '"></textarea>' +
        '<div class="comment-form-actions">' +
          (parentId ? '<button type="button" class="res-linkbtn" data-cancel="1">' +
            esc(t('comments.cancel', 'Cancel')) + '</button>' : '') +
          '<button type="submit" class="btn btn-primary comment-send">' +
            esc(parentId ? t('comments.reply', 'Reply') : t('comments.send', 'Post comment')) +
          '</button>' +
        '</div>' +
        '<p class="comment-form-msg" hidden></p>' +
      '</form>';
    }

    function wireForm(form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submit(form);
      });
      var cancel = form.querySelector('[data-cancel]');
      if (cancel) {
        cancel.addEventListener('click', function () {
          replyingTo = null;
          render();
        });
      }
    }

    function formMessage(form, text) {
      var el = form.querySelector('.comment-form-msg');
      el.textContent = text;
      el.hidden = !text;
    }

    function submit(form) {
      if (busy) return;
      var name = form.querySelector('.comment-name').value.trim();
      var body = form.querySelector('.comment-body').value.trim();
      if (!name) { formMessage(form, t('comments.errNoName', 'Please add a name.')); return; }
      if (!body) { formMessage(form, t('comments.errNoBody', 'Please write something first.')); return; }
      formMessage(form, '');

      var parentId = form.dataset.parent || null;
      var row = {
        post_id: postId,
        parent_id: parentId || null,
        display_name: name.slice(0, MAX_NAME),
        body: body.slice(0, MAX_BODY),
        user_id: user ? user.id : null,
        anon_id: user ? null : anonId()
      };

      busy = true;
      var send = form.querySelector('.comment-send');
      send.disabled = true;
      send.textContent = t('comments.sending', 'Posting…');

      client.from('post_comments').insert(row).select().single().then(function (res) {
        busy = false;
        if (res.error) {
          send.disabled = false;
          send.textContent = parentId ? t('comments.reply', 'Reply') : t('comments.send', 'Post comment');
          formMessage(form, hint(res.error.message));
          return;
        }
        // Add it locally rather than reloading, so the reader sees their
        // comment land where they wrote it.
        comments.push(res.data);
        replyingTo = null;
        render();
      });
    }

    // "schema cache" from PostgREST means the migration has not been run
    // yet. Saying so beats leaving the reader to decode the raw message.
    function hint(msg) {
      msg = String(msg || '');
      return /schema cache|post_comments/i.test(msg)
        ? t('comments.errSchema', 'Comments are not set up on the server yet.')
        : msg;
    }

    /* ---------------- The thread ---------------- */

    function childrenOf(parentId) {
      return comments
        .filter(function (c) { return (c.parent_id || null) === (parentId || null); })
        .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    }

    function mayDelete(c) {
      if (isAdmin) return true;
      if (user && c.user_id && c.user_id === user.id) return true;
      return !c.user_id && !!c.anon_id && c.anon_id === anonId();
    }

    function threadHTML(parentId, depth) {
      var rows = childrenOf(parentId);
      if (!rows.length) return '';
      return '<ul class="comment-thread' + (depth ? ' comment-thread--nested' : '') + '">' +
        rows.map(function (c) {
          return '<li class="comment" data-id="' + esc(c.id) + '">' +
            '<div class="comment-head">' +
              '<span class="comment-author">' + esc(c.display_name) + '</span>' +
              '<span class="comment-when">' + esc(when(c.created_at)) + '</span>' +
            '</div>' +
            '<div class="comment-body-text">' + bodyHTML(c.body) + '</div>' +
            '<div class="comment-actions">' +
              '<button type="button" class="res-linkbtn" data-reply="' + esc(c.id) + '">' +
                esc(t('comments.reply', 'Reply')) + '</button>' +
              (mayDelete(c)
                ? '<button type="button" class="res-linkbtn res-linkbtn--danger" data-delete="' + esc(c.id) + '">' +
                  esc(t('comments.delete', 'Delete')) + '</button>'
                : '') +
            '</div>' +
            (replyingTo === c.id ? '<div class="comment-form-wrap">' + formHTML(c.id) + '</div>' : '') +
            threadHTML(c.id, Math.min(depth + 1, MAX_DEPTH)) +
          '</li>';
        }).join('') +
      '</ul>';
    }

    function render() {
      titleEl.textContent = comments.length
        ? t('comments.headingN', 'Comments ({n})').replace('{n}', comments.length)
        : t('comments.heading', 'Comments');

      rootFormEl.innerHTML = formHTML(null);
      wireForm(rootFormEl.querySelector('.comment-form'));

      listEl.innerHTML = comments.length
        ? threadHTML(null, 0)
        : '<p class="comment-empty">' + esc(t('comments.empty', 'No comments yet — be the first.')) + '</p>';

      listEl.querySelectorAll('.comment-form').forEach(wireForm);
      listEl.querySelectorAll('[data-reply]').forEach(function (b) {
        b.addEventListener('click', function () {
          replyingTo = replyingTo === b.dataset.reply ? null : b.dataset.reply;
          render();
          if (replyingTo) {
            var open = listEl.querySelector('.comment[data-id="' + replyingTo + '"] .comment-body');
            if (open) open.focus();
          }
        });
      });
      listEl.querySelectorAll('[data-delete]').forEach(function (b) {
        b.addEventListener('click', function () { remove(b.dataset.delete); });
      });
    }

    function remove(id) {
      var c = comments.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      var replies = comments.filter(function (x) { return x.parent_id === id; }).length;
      var question = replies
        ? t('comments.confirmDeleteThread', 'Delete this comment and the {n} replies under it?').replace('{n}', replies)
        : t('comments.confirmDelete', 'Delete this comment?');
      if (!window.confirm(question)) return;

      // A signed-out author goes through the function that can check the
      // browser id; everyone else deletes straight through the policy.
      var op = (!c.user_id && !isAdmin)
        ? client.rpc('delete_anon_comment', { p_id: id, p_anon: anonId() })
            .then(function (res) {
              if (res.error) return { error: res.error };
              return res.data ? {} : { error: { message: t('comments.errNotYours', 'That comment is not yours to delete.') } };
            })
        : client.from('post_comments').delete().eq('id', id);

      op.then(function (res) {
        if (res && res.error) { window.alert(hint(res.error.message)); return; }
        // The database cascades the replies; mirror that here so the
        // thread does not briefly show orphans.
        var gone = {};
        (function collect(pid) {
          gone[pid] = true;
          comments.filter(function (x) { return x.parent_id === pid; })
            .forEach(function (x) { collect(x.id); });
        })(id);
        comments = comments.filter(function (x) { return !gone[x.id]; });
        render();
      });
    }

    /* ---------------- Loading ---------------- */

    function load() {
      return client.from('post_comments')
        .select('id, parent_id, user_id, anon_id, display_name, body, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .then(function (res) {
          if (res.error) {
            comments = [];
            render();
            listEl.innerHTML = '<p class="comment-empty">' + esc(hint(res.error.message)) + '</p>';
            return;
          }
          comments = res.data || [];
          render();
        });
    }

    function applyUser(u) {
      user = u || null;
      if (!user) { isAdmin = false; return load(); }
      return client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        .then(function (res) {
          isAdmin = !!(res && res.data);
          return load();
        })
        .catch(function () { isAdmin = false; return load(); });
    }

    client.auth.getSession().then(function (res) {
      applyUser(res.data && res.data.session && res.data.session.user);
    });
    client.auth.onAuthStateChange(function (_event, session) {
      applyUser(session && session.user);
    });
    document.addEventListener('duru:langchange', function () {
      if (comments.length || listEl.innerHTML) render();
    });
  }

  window.DURU_COMMENTS = { mount: mount };
})();
