// DURU KOREAN — user profile page
//
// Include after js/auth.js on profile.html. Shows user's profile info,
// stories, and posts (if admin). Users can edit their nickname and
// birth date. Data is stored in user_profiles, stories, and posts tables.

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

  function formatDate(iso) {
    try {
      var lang = (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
      return new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return String(iso || '').slice(0, 10);
    }
  }

  function formatBirthDate(dateStr) {
    if (!dateStr) return '';
    try {
      var lang = (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
      return new Date(dateStr + 'T00:00:00').toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var notLoggedInEl = document.getElementById('profileNotLoggedIn');
    var profileContentEl = document.getElementById('profileContent');
    var profileLoginBtn = document.getElementById('profileLoginBtn');

    if (profileLoginBtn) {
      profileLoginBtn.addEventListener('click', function () {
        document.getElementById('authTrigger').click();
      });
    }

    function showNotLoggedIn() {
      if (notLoggedInEl) notLoggedInEl.hidden = false;
      if (profileContentEl) profileContentEl.hidden = true;
    }

    function showProfile() {
      if (notLoggedInEl) notLoggedInEl.hidden = true;
      if (profileContentEl) profileContentEl.hidden = false;
    }

    function loadUserProfile(userId) {
      return client.from('user_profiles').select('*').eq('user_id', userId).maybeSingle()
        .then(function (res) {
          return res.data || null;
        });
    }

    function loadUserStories(userId) {
      return client.from('stories').select('*').eq('user_id', userId).order('created_at', { ascending: false })
        .then(function (res) {
          return res.data || [];
        });
    }

    function loadUserPosts(userId) {
      return client.from('posts').select('*').eq('created_by', userId).order('created_at', { ascending: false })
        .then(function (res) {
          return res.data || [];
        });
    }

    function isAdmin(userId) {
      return client.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle()
        .then(function (res) {
          return !!(res && res.data);
        });
    }

    function renderProfile(user, profile) {
      showProfile();
      var nicknameEl = document.getElementById('profileNickname');
      var emailEl = document.getElementById('profileEmail');
      var birthDateEl = document.getElementById('profileBirthDate');
      var memberSinceEl = document.getElementById('memberSince');

      if (nicknameEl) nicknameEl.textContent = profile && profile.nickname ? escapeHTML(profile.nickname) : escapeHTML(user.email);
      if (emailEl) emailEl.textContent = escapeHTML(user.email);
      if (birthDateEl) {
        if (profile && profile.birth_date) {
          birthDateEl.textContent = t('profile.birthDate', 'Born:') + ' ' + formatBirthDate(profile.birth_date);
          birthDateEl.hidden = false;
        } else {
          birthDateEl.hidden = true;
        }
      }
      if (memberSinceEl) {
        var year = new Date(user.created_at).getFullYear();
        memberSinceEl.textContent = String(year);
      }
    }

    function renderStories(stories) {
      var listEl = document.getElementById('profileStoriesList');
      var emptyEl = document.getElementById('profileStoriesEmpty');
      var sectionEl = document.getElementById('profileUserStories');
      if (!listEl) return;

      listEl.innerHTML = '';
      if (stories.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        if (sectionEl) sectionEl.hidden = true;
        return;
      }

      if (emptyEl) emptyEl.hidden = true;
      if (sectionEl) sectionEl.hidden = false;

      stories.forEach(function (story) {
        var card = document.createElement('article');
        card.className = 'story-card';
        var preview = escapeHTML(story.body).slice(0, 100);
        card.innerHTML =
          '<p class="story-preview">' + preview + (story.body.length > 100 ? '…' : '') + '</p>' +
          '<p class="story-date">' + escapeHTML(formatDate(story.created_at)) + '</p>';
        listEl.appendChild(card);
      });
    }

    function renderPosts(posts) {
      var listEl = document.getElementById('profilePostsList');
      var emptyEl = document.getElementById('profilePostsEmpty');
      var sectionEl = document.getElementById('profileUserPosts');
      if (!listEl) return;

      listEl.innerHTML = '';
      if (posts.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        if (sectionEl) sectionEl.hidden = true;
        return;
      }

      if (emptyEl) emptyEl.hidden = true;
      if (sectionEl) sectionEl.hidden = false;

      posts.forEach(function (post) {
        var card = document.createElement('article');
        card.className = 'blog-card';
        card.innerHTML =
          '<div class="blog-body">' +
            '<h3><a href="blog.html?post=' + encodeURIComponent(post.slug) + '">' + escapeHTML(post.title) + '</a></h3>' +
            (post.excerpt ? '<p>' + escapeHTML(post.excerpt) + '</p>' : '') +
            '<p class="blog-date">' + escapeHTML(formatDate(post.created_at)) + ' · ' +
              (post.published ? escapeHTML(t('profile.published', 'Published')) : escapeHTML(t('profile.draft', 'Draft'))) + '</p>' +
          '</div>';
        listEl.appendChild(card);
      });
    }

    function buildEditModal() {
      var overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.id = 'profileEditModal';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="editProfileTitle">' +
          '<button type="button" class="auth-close" id="profileEditClose" aria-label="Close">&times;</button>' +
          '<h2 id="editProfileTitle" data-i18n="profile.editTitle">Edit Profile</h2>' +
          '<div class="auth-message" data-msg="profile" hidden></div>' +
          '<form id="profileEditForm" novalidate>' +
            '<div class="auth-field">' +
              '<label for="editNickname" data-i18n="profile.nicknameLabel">Nickname</label>' +
              '<input type="text" id="editNickname" maxlength="40">' +
            '</div>' +
            '<div class="auth-field">' +
              '<label for="editBirthDate" data-i18n="profile.birthDateLabel">Birth Date (Optional)</label>' +
              '<input type="date" id="editBirthDate">' +
            '</div>' +
            '<button type="submit" class="btn btn-primary" data-i18n="profile.saveBtn">Save Changes</button>' +
          '</form>' +
        '</div>';
      document.body.appendChild(overlay);

      overlay.querySelector('#profileEditClose').addEventListener('click', function () {
        overlay.hidden = true;
      });

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.hidden = true;
      });

      return overlay;
    }

    var editModal = null;

    function openEditModal(user, profile) {
      if (!editModal) editModal = buildEditModal();
      editModal.querySelector('#editNickname').value = profile && profile.nickname ? profile.nickname : '';
      editModal.querySelector('#editBirthDate').value = profile && profile.birth_date ? profile.birth_date : '';
      editModal.querySelector('[data-msg="profile"]').hidden = true;
      editModal.hidden = false;
      editModal.querySelector('#editNickname').focus();

      var form = editModal.querySelector('#profileEditForm');
      form.onsubmit = function (e) {
        e.preventDefault();
        saveProfile(user, profile);
      };
    }

    function setMsg(type, text) {
      if (!editModal) return;
      var el = editModal.querySelector('[data-msg="profile"]');
      el.className = 'auth-message ' + type;
      el.textContent = text;
      el.hidden = false;
    }

    function saveProfile(user, oldProfile) {
      var nickname = editModal.querySelector('#editNickname').value.trim();
      var birthDate = editModal.querySelector('#editBirthDate').value;

      if (!nickname) {
        setMsg('error', t('profile.errNoNickname', 'Please enter a nickname.'));
        return;
      }

      var updates = {
        user_id: user.id,
        nickname: nickname,
        birth_date: birthDate || null,
        updated_at: new Date().toISOString()
      };

      client.from('user_profiles').upsert(updates, { onConflict: 'user_id' })
        .then(function (res) {
          if (res.error) {
            setMsg('error', t('profile.errSaveFailed', 'Could not save: {msg}').replace('{msg}', res.error.message));
            return;
          }
          editModal.hidden = true;
          loadAndRender(user);
        });
    }

    function loadAndRender(user) {
      Promise.all([
        loadUserProfile(user.id),
        loadUserStories(user.id),
        loadUserPosts(user.id),
        isAdmin(user.id)
      ]).then(function (results) {
        var profile = results[0];
        var stories = results[1];
        var posts = results[2];
        var adminStatus = results[3];

        renderProfile(user, profile);
        renderStories(stories);
        if (adminStatus) renderPosts(posts);

        var storyCountEl = document.getElementById('storyCount');
        var postCountEl = document.getElementById('postCount');
        if (storyCountEl) storyCountEl.textContent = String(stories.length);
        if (postCountEl) postCountEl.textContent = String(posts.length);

        var editBtn = document.getElementById('editProfileBtn');
        if (editBtn) {
          editBtn.onclick = function () { openEditModal(user, profile); };
        }
      });
    }

    client.auth.getSession().then(function (res) {
      var user = res.data && res.data.session && res.data.session.user;
      if (!user) {
        showNotLoggedIn();
        return;
      }
      loadAndRender(user);
    });

    client.auth.onAuthStateChange(function (_event, session) {
      var user = session && session.user;
      if (!user) {
        showNotLoggedIn();
      } else {
        loadAndRender(user);
      }
    });

    document.addEventListener('duru:langchange', function () {
      var user = null;
      client.auth.getUser().then(function (res) {
        user = res.data && res.data.user;
        if (user) {
          loadAndRender(user);
        }
      });
    });
  });
})();
