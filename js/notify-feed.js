// DURU KOREAN — notification feed
//
// A bell in the header showing unread notifications. Rows are written
// only by the database triggers that fire when someone you follow
// publishes a post or a story; nothing here inserts.
//
// The bell is injected rather than written into every page's header, so
// the markup stays in one place.

(function () {
  'use strict';

  var PAGE_SIZE = 12;

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

  // Links come from the triggers, which build them from a post slug, but
  // they are still rendered into an href — keep them same-origin only.
  function safeLink(link) {
    var s = String(link || '');
    return /^[a-z0-9._~\-]+\.html(\?[^"'<>\s]*)?$/i.test(s) ? s : 'index.html';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var actions = document.querySelector('.header-actions');
    if (!actions) return;

    var wrap = document.createElement('div');
    wrap.className = 'notify-wrap';
    wrap.hidden = true;
    wrap.innerHTML =
      '<button type="button" class="notify-bell" id="notifyBell" aria-haspopup="true" aria-expanded="false">' +
        '<span aria-hidden="true">🔔</span>' +
        '<span class="notify-badge" id="notifyBadge" hidden>0</span>' +
      '</button>' +
      '<div class="notify-panel" id="notifyPanel" hidden>' +
        '<div class="notify-head">' +
          '<strong id="notifyTitle">Notifications</strong>' +
          '<button type="button" class="notify-readall" id="notifyReadAll">Mark all read</button>' +
        '</div>' +
        '<div class="notify-list" id="notifyList"></div>' +
        '<p class="notify-empty" id="notifyEmpty" hidden>Nothing new.</p>' +
      '</div>';

    // Anchor on the menu toggle, which is always last and always present.
    // #authTrigger is not usable here: auth.js swaps it for a user chip
    // once a session resolves, and the bell would then land after the
    // toggle instead of beside the account control.
    var toggle = actions.querySelector('.nav-toggle');
    if (toggle) actions.insertBefore(wrap, toggle);
    else actions.appendChild(wrap);

    var bell = wrap.querySelector('#notifyBell');
    var panel = wrap.querySelector('#notifyPanel');
    var listEl = wrap.querySelector('#notifyList');
    var emptyEl = wrap.querySelector('#notifyEmpty');
    var badge = wrap.querySelector('#notifyBadge');
    var currentUser = null;

    function applyLabels() {
      wrap.querySelector('#notifyTitle').textContent = t('notify.title', 'Notifications');
      wrap.querySelector('#notifyReadAll').textContent = t('notify.markAllRead', 'Mark all read');
      emptyEl.textContent = t('notify.empty', 'Nothing new.');
      bell.setAttribute('aria-label', t('notify.title', 'Notifications'));
    }
    applyLabels();

    function setBadge(n) {
      if (n > 0) {
        badge.hidden = false;
        badge.textContent = n > 99 ? '99+' : String(n);
      } else {
        badge.hidden = true;
      }
    }

    function render(rows) {
      listEl.innerHTML = '';
      emptyEl.hidden = rows.length > 0;
      rows.forEach(function (row) {
        var a = document.createElement('a');
        a.className = 'notify-item' + (row.is_read ? '' : ' unread');
        a.href = safeLink(row.link);
        a.dataset.id = row.id;
        a.innerHTML =
          '<span class="notify-kind">' +
            escapeHTML(row.kind === 'reply'
              ? t('notify.newReply', 'New reply')
              : row.kind === 'story'
                ? t('notify.newStory', 'New story')
                : t('notify.newPost', 'New post')) +
          '</span>' +
          '<span class="notify-text">' + escapeHTML(row.title) + '</span>';
        a.addEventListener('click', function () {
          if (!row.is_read) markRead([row.id]);
        });
        listEl.appendChild(a);
      });
    }

    function load() {
      if (!currentUser) return;
      client.from('notifications')
        .select('id, kind, title, link, is_read, created_at')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
        .then(function (res) {
          if (res.error) return;
          var rows = res.data || [];
          render(rows);
          setBadge(rows.filter(function (r) { return !r.is_read; }).length);
        });
    }

    function markRead(ids) {
      if (!ids.length) return;
      client.from('notifications').update({ is_read: true }).in('id', ids)
        .then(function (res) { if (!res.error) load(); });
    }

    bell.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      bell.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) load();
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target) && !panel.hidden) {
        panel.hidden = true;
        bell.setAttribute('aria-expanded', 'false');
      }
    });

    wrap.querySelector('#notifyReadAll').addEventListener('click', function () {
      var unread = Array.prototype.slice
        .call(listEl.querySelectorAll('.notify-item.unread'))
        .map(function (el) { return el.dataset.id; });
      markRead(unread);
    });

    function onUser(user) {
      currentUser = user || null;
      wrap.hidden = !currentUser;
      if (currentUser) load();
      else { setBadge(0); panel.hidden = true; }
    }

    client.auth.getSession().then(function (res) {
      onUser(res.data && res.data.session && res.data.session.user);
    });
    client.auth.onAuthStateChange(function (_e, session) {
      onUser(session && session.user);
    });

    document.addEventListener('duru:langchange', function () {
      applyLabels();
      if (currentUser) load();
    });
  });
})();
