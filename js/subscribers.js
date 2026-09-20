// DURU KOREAN — newsletter subscriber list (admin page)
//
// Lists newsletter_subscribers for an admin. RLS restricts SELECT to
// admin_users, so a signed-in non-admin simply gets an empty answer
// and the panel stays hidden.

(function () {
  'use strict';

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

  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.getElementById('subscriberPanel');
    var listEl = document.getElementById('subscriberList');
    var emptyEl = document.getElementById('subscriberEmpty');
    var countEl = document.getElementById('subscriberCount');
    if (!panel || !listEl) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    function render(rows) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = rows.length > 0;
      if (countEl) countEl.textContent = rows.length.toLocaleString();
      rows.forEach(function (row) {
        var item = document.createElement('div');
        item.className = 'admin-list-item';
        item.innerHTML =
          '<div class="admin-item-info">' +
            '<span class="admin-user-id">' + escapeHTML(row.email) + '</span>' +
            '<span class="admin-created-date">' +
              escapeHTML(t('admin.subscribedOn', 'Subscribed')) + ' · ' +
              escapeHTML(new Date(row.created_at).toLocaleDateString()) +
              (row.source ? ' · ' + escapeHTML(row.source) : '') +
            '</span>' +
          '</div>' +
          '<button type="button" class="admin-remove-btn" data-id="' + escapeHTML(row.id) + '">' +
            escapeHTML(t('admin.removeSubscriber', 'Remove')) + '</button>';
        listEl.appendChild(item);
      });
      listEl.querySelectorAll('.admin-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          client.from('newsletter_subscribers').delete().eq('id', btn.dataset.id)
            .then(function (res) {
              if (res.error) { alert(res.error.message); return; }
              load();
            });
        });
      });
    }

    function load() {
      client.from('newsletter_subscribers')
        .select('id, email, source, created_at')
        .order('created_at', { ascending: false })
        .then(function (res) {
          if (res.error) { panel.hidden = true; return; }
          panel.hidden = false;
          render(res.data || []);
        });
    }

    function onUser(user) {
      if (!user) { panel.hidden = true; return; }
      client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        .then(function (res) {
          if (res.data) load();
          else panel.hidden = true;
        });
    }

    client.auth.getSession().then(function (res) {
      onUser(res.data && res.data.session && res.data.session.user);
    });
    client.auth.onAuthStateChange(function (_e, session) {
      onUser(session && session.user);
    });
    document.addEventListener('duru:langchange', function () {
      if (!panel.hidden) load();
    });
  });
})();
