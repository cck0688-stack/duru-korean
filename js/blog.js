// DURU KOREAN — blog posts (Supabase-backed)
//
// Include after js/auth.js on blog.html. Everyone sees published posts;
// only a user listed in admin_users can write, edit, or delete one — and
// that is enforced by Row Level Security in supabase/schema.sql, not by
// this file hiding a button. A draft is invisible to visitors because the
// public select policy filters on `published`, so an unfinished post is
// never one stray link away from being read.
//
// Single posts are addressed as blog.html?post=<slug>; a static host has
// no routing, so the query string is the only thing available.

(function () {
  'use strict';

  var CATEGORIES = ['study', 'grammar', 'culture', 'travel'];
  // Each category's Hangul glyph, matching the static design.
  var GLYPH = { study: '앎', grammar: '말', culture: '삶', travel: '길' };

  function getCategoryCount(cat) {
    return posts.filter(function (p) { return p.category === cat; }).length;
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

  // Post bodies are stored and rendered as plain text. Blank lines become
  // paragraphs; nothing else is interpreted, so a stray < in a sentence
  // stays a < instead of becoming markup.
  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(function (block) {
      return '<p>' + escapeHTML(block.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function categoryLabel(cat) {
    return t('blog.cat.' + cat, cat);
  }

  function formatDate(iso) {
    try {
      var lang = (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
      return new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return String(iso || '').slice(0, 10);
    }
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
    var singleEl = document.getElementById('blogSingle');
    var filtersEl = document.getElementById('blogFilters');
    var writeBtn = document.getElementById('writePostBtn');
    if (!listEl) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var isAdmin = false;
    var activeFilter = 'all';
    var posts = [];

    /* ---------------- Rendering ---------------- */

    function renderCategoryHero() {
      if (activeFilter === 'all' || !listEl.parentElement) return;
      var heroDiv = listEl.parentElement.querySelector('.blog-category-hero');
      if (!heroDiv) {
        heroDiv = document.createElement('div');
        heroDiv.className = 'blog-category-hero';
        listEl.parentElement.insertBefore(heroDiv, listEl);
      }
      var desc = t('blog.cat.' + activeFilter + '.desc', '');
      heroDiv.innerHTML = desc ? '<p>' + escapeHTML(desc) + '</p>' : '';
      heroDiv.hidden = !desc;
    }

    function renderCards() {
      var shown = posts.filter(function (p) {
        return activeFilter === 'all' || p.category === activeFilter;
      });
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = shown.length > 0;
      renderCategoryHero();
      shown.forEach(function (p) {
        var card = document.createElement('article');
        card.className = 'blog-card';
        card.setAttribute('data-cat', p.category);
        var href = 'blog.html?post=' + encodeURIComponent(p.slug);
        // Same markup the static cards used, so the existing card styles
        // apply without a parallel set of rules to keep in step.
        card.innerHTML =
          '<div class="blog-thumb kr" aria-hidden="true">' + escapeHTML(GLYPH[p.category] || '') + '</div>' +
          '<div class="blog-body">' +
            '<span class="blog-meta">' + escapeHTML(categoryLabel(p.category)) +
              (p.published ? '' : ' · <span class="blog-draft-tag">' + escapeHTML(t('blog.draft', 'Draft')) + '</span>') +
            '</span>' +
            '<h3><a href="' + href + '">' + escapeHTML(p.title) + '</a></h3>' +
            (p.excerpt ? '<p>' + escapeHTML(p.excerpt) + '</p>' : '') +
            '<p class="blog-date">' + escapeHTML(formatDate(p.created_at)) + '</p>' +
            '<a class="read-more" href="' + href + '">' + escapeHTML(t('blog.readMore', 'Read more')) + ' →' + '</a>' +
            (isAdmin ? '<div class="blog-card-admin">' +
              '<button type="button" class="blog-edit-btn" data-id="' + p.id + '">' + escapeHTML(t('blog.edit', 'Edit')) + '</button>' +
              '<button type="button" class="blog-delete-btn" data-id="' + p.id + '">' + escapeHTML(t('blog.delete', 'Delete')) + '</button>' +
              '</div>' : '') +
          '</div>';
        listEl.appendChild(card);
      });
      listEl.querySelectorAll('.blog-edit-btn').forEach(function (b) {
        b.addEventListener('click', function () { openEditor(findPost(b.dataset.id)); });
      });
      listEl.querySelectorAll('.blog-delete-btn').forEach(function (b) {
        b.addEventListener('click', function () { confirmDelete(findPost(b.dataset.id)); });
      });
    }

    function findPost(id) {
      return posts.filter(function (p) { return String(p.id) === String(id); })[0];
    }

    function renderSingle(post) {
      if (!singleEl) return;
      singleEl.hidden = false;
      listEl.hidden = true;
      if (filtersEl) filtersEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      singleEl.innerHTML =
        '<a class="blog-back" href="blog.html">' + escapeHTML(t('blog.backToAll', '← All posts')) + '</a>' +
        '<span class="blog-meta">' + escapeHTML(categoryLabel(post.category)) +
          (post.published ? '' : ' · <span class="blog-draft-tag">' + escapeHTML(t('blog.draft', 'Draft')) + '</span>') +
        '</span>' +
        '<h1>' + escapeHTML(post.title) + '</h1>' +
        '<p class="blog-date">' + escapeHTML(formatDate(post.created_at)) + '</p>' +
        '<div class="post-body">' + paragraphs(post.body) + '</div>';
      document.title = post.title + ' — Duru Korean';
    }

    function renderNotFound() {
      if (!singleEl) return;
      singleEl.hidden = false;
      listEl.hidden = true;
      if (filtersEl) filtersEl.hidden = true;
      singleEl.innerHTML =
        '<a class="blog-back" href="blog.html">' + escapeHTML(t('blog.backToAll', '← All posts')) + '</a>' +
        '<h1>' + escapeHTML(t('blog.notFoundTitle', 'Post not found')) + '</h1>' +
        '<p>' + escapeHTML(t('blog.notFoundBody', 'That post may have been removed, or the link is wrong.')) + '</p>';
    }

    /* ---------------- Loading ---------------- */

    function loadPosts() {
      // Admins additionally receive drafts, because the RLS policy lets
      // them; nothing here asks for them explicitly.
      return client.from('posts').select('*').order('created_at', { ascending: false })
        .then(function (res) {
          if (res.error) { console.error('Failed to load posts:', res.error.message); return; }
          posts = res.data || [];
          updateFilterCounts();
          var slug = new URLSearchParams(location.search).get('post');
          if (slug) {
            var match = posts.filter(function (p) { return p.slug === slug; })[0];
            if (match) renderSingle(match); else renderNotFound();
          } else {
            renderCards();
          }
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
        '<div class="auth-modal post-modal" role="dialog" aria-modal="true" aria-labelledby="postEditorTitle">' +
          '<button type="button" class="auth-close" id="postCloseBtn" aria-label="Close">&times;</button>' +
          '<h2 id="postEditorTitle"></h2>' +
          '<div class="auth-message" data-msg="post" hidden></div>' +
          '<form id="postForm" novalidate>' +
            '<div class="auth-field"><label for="postTitle"></label>' +
              '<input type="text" id="postTitle" required maxlength="160"></div>' +
            '<div class="auth-field"><label for="postCategory"></label>' +
              '<select id="postCategory">' + CATEGORIES.map(function (c) {
                return '<option value="' + c + '"></option>';
              }).join('') + '</select></div>' +
            '<div class="auth-field"><label for="postExcerpt"></label>' +
              '<textarea id="postExcerpt" rows="2" maxlength="400"></textarea></div>' +
            '<div class="auth-field"><label for="postBody"></label>' +
              '<textarea id="postBody" rows="12" required maxlength="40000"></textarea></div>' +
            '<label class="post-publish-row"><input type="checkbox" id="postPublished"> <span id="postPublishedLabel"></span></label>' +
            '<button type="submit" class="btn btn-primary auth-submit" id="postSubmit"></button>' +
          '</form>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeEditor(); });
      overlay.querySelector('#postCloseBtn').addEventListener('click', closeEditor);
      overlay.querySelector('#postForm').addEventListener('submit', savePost);
      return overlay;
    }

    function labelEditor() {
      var o = buildEditor();
      o.querySelector('#postEditorTitle').textContent = editing
        ? t('blog.editorEditTitle', 'Edit post') : t('blog.editorNewTitle', 'Write a post');
      o.querySelector('label[for="postTitle"]').textContent = t('blog.fieldTitle', 'Title');
      o.querySelector('label[for="postCategory"]').textContent = t('blog.fieldCategory', 'Category');
      o.querySelector('label[for="postExcerpt"]').textContent = t('blog.fieldExcerpt', 'Summary (shown on the card)');
      o.querySelector('label[for="postBody"]').textContent = t('blog.fieldBody', 'Body');
      o.querySelector('#postPublishedLabel').textContent = t('blog.fieldPublished', 'Publish now (leave off to save as a draft)');
      o.querySelector('#postSubmit').textContent = t('blog.save', 'Save');
      CATEGORIES.forEach(function (c, i) {
        o.querySelectorAll('#postCategory option')[i].textContent = categoryLabel(c);
      });
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
      o.querySelector('[data-msg="post"]').hidden = true;
      o.querySelector('#postTitle').value = editing ? editing.title : '';
      o.querySelector('#postCategory').value = editing ? editing.category : 'study';
      o.querySelector('#postExcerpt').value = editing && editing.excerpt ? editing.excerpt : '';
      o.querySelector('#postBody').value = editing ? editing.body : '';
      o.querySelector('#postPublished').checked = editing ? !!editing.published : false;
      o.hidden = false;
      o.querySelector('#postTitle').focus();
    }

    function closeEditor() {
      if (overlay) overlay.hidden = true;
      editing = null;
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
        excerpt: overlay.querySelector('#postExcerpt').value.trim() || null,
        body: body,
        published: overlay.querySelector('#postPublished').checked,
      };

      saving = true;
      var btn = overlay.querySelector('#postSubmit');
      btn.disabled = true;
      btn.textContent = t('blog.saving', 'Saving…');

      var op;
      if (editing) {
        row.updated_at = new Date().toISOString();
        op = client.from('posts').update(row).eq('id', editing.id);
      } else {
        row.slug = makeSlug(title);
        op = client.auth.getUser().then(function (res) {
          row.created_by = res.data && res.data.user ? res.data.user.id : null;
          return client.from('posts').insert(row);
        });
      }

      op.then(function (res) {
        saving = false;
        btn.disabled = false;
        btn.textContent = t('blog.save', 'Save');
        if (res && res.error) {
          setMsg('error', t('blog.errSaveFailed', 'Couldn’t save: {msg}').replace('{msg}', res.error.message));
          return;
        }
        closeEditor();
        loadPosts();
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
        if (new URLSearchParams(location.search).get('post') === post.slug) {
          location.href = 'blog.html';
        } else {
          loadPosts();
        }
      });
    }

    function updateFilterCounts() {
      if (!filtersEl) return;
      filtersEl.querySelectorAll('.filter-btn[data-filter]').forEach(function (btn) {
        var filter = btn.dataset.filter;
        var count = filter === 'all' ? posts.length : getCategoryCount(filter);
        var countEl = btn.querySelector('.filter-count');
        if (!countEl && count > 0) {
          countEl = document.createElement('span');
          countEl.className = 'filter-count';
          btn.appendChild(countEl);
        }
        if (countEl) countEl.textContent = '(' + count + ')';
      });
    }

    /* ---------------- Filters, admin state ---------------- */

    if (filtersEl) {
      filtersEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.filter-btn');
        if (!btn) return;
        activeFilter = btn.dataset.filter;
        filtersEl.querySelectorAll('.filter-btn').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        renderCards();
      });
    }

    if (writeBtn) writeBtn.addEventListener('click', function () { openEditor(null); });

    function applyAdmin(user) {
      if (!user) {
        isAdmin = false;
        if (writeBtn) writeBtn.hidden = true;
        return loadPosts();
      }
      return client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        .then(function (res) {
          isAdmin = !!(res && res.data);
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
      updateFilterCounts();
      var slug = new URLSearchParams(location.search).get('post');
      if (slug) {
        var match = posts.filter(function (p) { return p.slug === slug; })[0];
        if (match) renderSingle(match);
      } else {
        renderCards();
      }
      if (overlay && !overlay.hidden) labelEditor();
    });
  });
})();
