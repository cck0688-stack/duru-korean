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

    // auth.admin.listUsers() needs the service_role key, which must never
    // reach a browser, so the lookup goes through an RPC that checks the
    // caller is an admin and returns only the id.
    function lookupUserId(email) {
      return client.rpc('find_user_id_by_email', { p_email: email })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return res.data || null;
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

      function reset() {
        addAdminBtn.disabled = false;
        addAdminBtn.textContent = t('admin.addAdmin', 'Make Admin');
      }

      lookupUserId(email)
        .then(function (userId) {
          if (!userId) {
            alert(t('admin.userNotFound', 'User not found. They must sign up first.'));
            reset();
            return;
          }
          return client.from('admin_users').insert({ user_id: userId })
            .then(function (res) {
              reset();
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
        })
        .catch(function (err) {
          reset();
          alert(t('admin.addFailed', 'Could not add admin: {msg}').replace('{msg}', err.message));
        });
    }

    /* ---------------- Role tiers ---------------- */

    var roleEmailInput = document.getElementById('roleEmailInput');
    var roleSelect = document.getElementById('roleSelect');
    var setRoleBtn = document.getElementById('setRoleBtn');
    var roleListEl = document.getElementById('roleList');
    var roleEmptyEl = document.getElementById('roleEmpty');

    function loadRoles() {
      return client.from('user_roles').select('user_id, role, updated_at')
        .then(function (res) { return res.data || []; });
    }

    function renderRoleList(rows) {
      if (!roleListEl) return;
      roleListEl.innerHTML = '';
      if (!rows.length) {
        if (roleEmptyEl) roleEmptyEl.hidden = false;
        return;
      }
      if (roleEmptyEl) roleEmptyEl.hidden = true;

      rows.forEach(function (row) {
        var item = document.createElement('div');
        item.className = 'admin-list-item';
        item.innerHTML =
          '<div class="admin-item-info">' +
            '<span class="admin-user-id">' + escapeHTML(row.user_id) + '</span>' +
            '<span class="admin-created-date">' + escapeHTML(t('admin.role.' + row.role, row.role)) + '</span>' +
          '</div>' +
          '<button type="button" class="admin-remove-btn" data-id="' + escapeHTML(row.user_id) + '">' +
            escapeHTML(t('admin.clearRole', 'Reset to learner')) + '</button>';
        roleListEl.appendChild(item);
      });

      roleListEl.querySelectorAll('.admin-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          client.from('user_roles').delete().eq('user_id', btn.dataset.id)
            .then(function (res) {
              if (res.error) { alert(res.error.message); return; }
              loadRoles().then(renderRoleList);
            });
        });
      });
    }

    function setRole() {
      var email = roleEmailInput.value.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        alert(t('admin.invalidEmail', 'Please enter a valid email address.'));
        return;
      }
      setRoleBtn.disabled = true;

      lookupUserId(email)
        .then(function (userId) {
          if (!userId) {
            alert(t('admin.userNotFound', 'User not found. They must sign up first.'));
            return;
          }
          return client.from('user_roles')
            .upsert({ user_id: userId, role: roleSelect.value, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id' })
            .then(function (res) {
              if (res.error) { alert(res.error.message); return; }
              roleEmailInput.value = '';
              return loadRoles().then(renderRoleList);
            });
        })
        .catch(function (err) { alert(err.message); })
        .then(function () { setRoleBtn.disabled = false; });
    }

    if (setRoleBtn) setRoleBtn.addEventListener('click', setRole);
    if (roleEmailInput) {
      roleEmailInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') setRole();
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
            loadRoles().then(renderRoleList);
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
