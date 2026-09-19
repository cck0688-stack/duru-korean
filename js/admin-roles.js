// DURU KOREAN — admin role management
//
// Admin panel for managing user roles. Only accessible to existing admins.
// Allows admins to grant admin privileges to other users by email.

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
    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var notAuthorizedEl = document.getElementById('adminNotAuthorized');
    var adminContentEl = document.getElementById('adminContent');
    var adminListEl = document.getElementById('adminList');
    var adminEmptyEl = document.getElementById('adminEmpty');
    var userEmailInput = document.getElementById('userEmailInput');
    var addAdminBtn = document.getElementById('addAdminBtn');

    function showNotAuthorized() {
      if (notAuthorizedEl) notAuthorizedEl.hidden = false;
      if (adminContentEl) adminContentEl.hidden = true;
    }

    function showAdminPanel() {
      if (notAuthorizedEl) notAuthorizedEl.hidden = true;
      if (adminContentEl) adminContentEl.hidden = false;
    }

    function loadAdmins() {
      return client.from('admin_users').select('user_id, created_at')
        .then(function (res) {
          return res.data || [];
        });
    }

    function renderAdminList(admins) {
      if (!adminListEl) return;
      adminListEl.innerHTML = '';
      if (admins.length === 0) {
        if (adminEmptyEl) adminEmptyEl.hidden = false;
        return;
      }
      if (adminEmptyEl) adminEmptyEl.hidden = true;

      admins.forEach(function (admin) {
        var row = document.createElement('div');
        row.className = 'admin-list-item';
        row.innerHTML =
          '<div class="admin-item-info">' +
            '<span class="admin-user-id">' + escapeHTML(admin.user_id) + '</span>' +
            '<span class="admin-created-date">' + new Date(admin.created_at).toLocaleDateString() + '</span>' +
          '</div>' +
          '<button type="button" class="admin-remove-btn" data-id="' + escapeHTML(admin.user_id) + '" data-i18n="admin.removeAdmin">Remove</button>';
        adminListEl.appendChild(row);
      });

      adminListEl.querySelectorAll('.admin-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          removeAdmin(btn.dataset.id);
        });
      });
    }

    function removeAdmin(userId) {
      if (!confirm(t('admin.confirmRemove', 'Remove this admin user?'))) return;

      client.from('admin_users').delete().eq('user_id', userId).then(function (res) {
        if (res.error) {
          alert(t('admin.removeFailed', 'Could not remove admin: {msg}').replace('{msg}', res.error.message));
          return;
        }
        loadAdmins().then(renderAdminList);
      });
    }

    function addAdmin() {
      var email = userEmailInput.value.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        alert(t('admin.invalidEmail', 'Please enter a valid email address.'));
        return;
      }

      addAdminBtn.disabled = true;
      addAdminBtn.textContent = t('admin.adding', 'Adding…');

      client.auth.admin.listUsers()
        .then(function (res) {
          var user = (res.data && res.data.users || []).find(function (u) { return u.email === email; });
          if (!user) {
            alert(t('admin.userNotFound', 'User not found. They must sign up first.'));
            addAdminBtn.disabled = false;
            addAdminBtn.textContent = t('admin.addAdmin', 'Make Admin');
            return;
          }

          client.from('admin_users').insert({ user_id: user.id })
            .then(function (res) {
              addAdminBtn.disabled = false;
              addAdminBtn.textContent = t('admin.addAdmin', 'Make Admin');
              if (res.error) {
                if (res.error.code === '23505') {
                  alert(t('admin.alreadyAdmin', 'This user is already an admin.'));
                } else {
                  alert(t('admin.addFailed', 'Could not add admin: {msg}').replace('{msg}', res.error.message));
                }
                return;
              }
              userEmailInput.value = '';
              loadAdmins().then(renderAdminList);
            });
        });
    }

    if (addAdminBtn) {
      addAdminBtn.addEventListener('click', addAdmin);
    }

    if (userEmailInput) {
      userEmailInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addAdmin();
      });
    }

    function checkAdminAndLoad(user) {
      if (!user) {
        showNotAuthorized();
        return;
      }

      client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        .then(function (res) {
          if (res.data) {
            showAdminPanel();
            loadAdmins().then(renderAdminList);
          } else {
            showNotAuthorized();
          }
        });
    }

    client.auth.getSession().then(function (res) {
      var user = res.data && res.data.session && res.data.session.user;
      checkAdminAndLoad(user);
    });

    client.auth.onAuthStateChange(function (_event, session) {
      var user = session && session.user;
      checkAdminAndLoad(user);
    });

    document.addEventListener('duru:langchange', function () {
      loadAdmins().then(renderAdminList);
    });
  });
})();
