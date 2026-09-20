// DURU KOREAN — admin-managed downloadable resources (Supabase Storage + DB)
//
// Include this after js/auth.js on any page that sets
// window.DURU_RESOURCE_LOCATION to 'free-resources' or 'book-audio'
// before this script tag. Every visitor (including anonymous ones) can
// see and download files here; only a user present in the admin_users
// table (see supabase/schema.sql) can attach or delete one — and that
// check happens server-side via Row Level Security, not by trusting
// anything this file decides on the client.

(function () {
  'use strict';

  const LOCATION = window.DURU_RESOURCE_LOCATION;
  if (!LOCATION) return;

  const BUCKET = 'resources';
  const MAX_SIZE = {
    pdf: 20 * 1024 * 1024, png: 20 * 1024 * 1024, jpg: 20 * 1024 * 1024, jpeg: 20 * 1024 * 1024,
    mp3: 50 * 1024 * 1024, m4a: 50 * 1024 * 1024,
  };
  const MIME_BY_EXT = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4',
  };
  const LEVELS = ['Any level', 'Beginner', 'Intermediate', 'Advanced'];
  const CATEGORIES = ['audio', 'printables', 'worksheets', 'cheatsheets', 'vocab'];

  function categoryLabel(cat) {
    return t('resources.cat.' + cat, cat);
  }
  const LANGS = [
    { code: 'en', label: 'English' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'ko', label: '한국어' },
  ];

  function fileExt(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function t(key, fallback) {
    // DURU_I18N.t returns the key itself when the dictionary hasn't
    // arrived yet (it loads over the network) or the key is missing.
    // Passing that through puts a raw "some.key" string on screen, so
    // treat it as "no translation" and use the English fallback.
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  function levelLabel(level) {
    const map = {
      'Any level': t('resources.levelAny', 'Any level'),
      'Beginner': t('resources.levelBeginner', 'Beginner'),
      'Intermediate': t('resources.levelIntermediate', 'Intermediate'),
      'Advanced': t('resources.levelAdvanced', 'Advanced'),
    };
    return map[level] || level;
  }


  // The storage API answers a missing bucket and a rejected upload with
  // developer-facing strings. An admin staring at "Bucket not found" has no
  // way to know that means "go create the bucket", so name the fix instead.
  function uploadErrorText(err) {
    const msg = (err && err.message) || '';
    if (/bucket not found/i.test(msg)) {
      return t('resources.errBucketMissing',
        'The storage bucket isn\u2019t set up yet. Create a public bucket named \u201cresources\u201d in the Supabase dashboard under Storage, then try again.');
    }
    if (/row-level security|not authorized|unauthorized|permission denied/i.test(msg)) {
      return t('resources.errNotAllowed',
        'Your account isn\u2019t allowed to upload. Check that you\u2019re still signed in as an admin.');
    }
    return t('resources.errUploadFailed', 'Upload failed: {msg}').replace('{msg}', msg);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('resourceList');
    const emptyEl = document.getElementById('resourceListEmpty');
    const attachBtn = document.getElementById('attachResourceBtn');
    if (!listEl || !attachBtn) return;

    const client = window.DURU_SUPABASE_CLIENT;
    if (!client) return; // Not configured yet — leave the dynamic section empty/hidden.

    let isAdmin = false;
    let currentUserId = null;
    // The fetched rows are kept so switching filters redraws from memory
    // instead of going back to the database on every click.
    let allResources = [];
    let activeFilter = 'all';

    // The bucket is private, so there is no permanent link to render.
    // A signed URL is minted when the visitor actually clicks, and only
    // a signed-in session can mint one — the storage policy decides, not
    // this file hiding a button.
    const SIGNED_URL_TTL = 300; // seconds

    function signedUrl(storageKey) {
      return client.storage.from(BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL)
        .then(({ data, error }) => {
          if (error || !data) throw new Error(error ? error.message : 'no url');
          return data.signedUrl;
        });
    }

    function renderList() {
      const resources = activeFilter === 'all'
        ? allResources
        : allResources.filter((r) => r.category === activeFilter);
      listEl.innerHTML = '';
      emptyEl.hidden = resources.length > 0;
      resources.forEach((r) => {
        const card = document.createElement('div');
        card.className = 'resource-card resource-card--file';
        const descLangLabel = (LANGS.find(l => l.code === r.description_language) || {}).label || r.description_language;
        const metaText = t('resources.descIn', '{size} · description in {lang}')
          .replace('{size}', formatSize(r.file_size)).replace('{lang}', descLangLabel) +
          (r.linked_unit ? ' · ' + escapeHTML(r.linked_unit) : '');
        card.innerHTML = `
          <span class="resource-tag">${escapeHTML(r.file_type.toUpperCase())}${r.category ? ' · ' + escapeHTML(categoryLabel(r.category)) : ''}${r.learning_level && r.learning_level !== 'Any level' ? ' · ' + escapeHTML(levelLabel(r.learning_level)) : ''}</span>
          <h3>${escapeHTML(r.title)}</h3>
          ${r.description ? `<p>${escapeHTML(r.description)}</p>` : ''}
          <p class="resource-meta">${metaText}</p>
          <div class="resource-card-actions">
            ${currentUserId
              ? `<button type="button" class="btn btn-ghost resource-dl-btn" data-key="${escapeHTML(r.storage_key)}">${escapeHTML(t('resources.download', 'Download →'))}</button>`
              : `<button type="button" class="btn btn-ghost resource-locked-btn">${escapeHTML(t('resources.loginToDownload', 'Log in to download'))}</button>`}
            ${isAdmin ? `<button type="button" class="resource-delete-btn" data-id="${r.id}" data-title="${escapeHTML(r.title)}" data-key="${escapeHTML(r.storage_key)}" aria-label="${escapeHTML(t('resources.deleteAriaLabel', 'Delete {title}').replace('{title}', r.title))}">${escapeHTML(t('resources.deleteBtn', 'Delete'))}</button>` : ''}
          </div>
        `;
        listEl.appendChild(card);
      });
      listEl.querySelectorAll('.resource-delete-btn').forEach((btn) => {
        btn.addEventListener('click', () => confirmDelete(btn.dataset.id, btn.dataset.title, btn.dataset.key));
      });

      listEl.querySelectorAll('.resource-locked-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const trigger = document.getElementById('authTrigger');
          if (trigger) trigger.click();
        });
      });

      listEl.querySelectorAll('.resource-dl-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const label = btn.textContent;
          btn.disabled = true;
          signedUrl(btn.dataset.key)
            .then((url) => { window.open(url, '_blank', 'noopener'); })
            .catch(() => {
              if (window.DURU_NOTIFY) {
                window.DURU_NOTIFY.error(t('resources.downloadFailed', 'That download link could not be created. Please try again.'));
              }
            })
            .then(() => { btn.disabled = false; btn.textContent = label; });
        });
      });
    }

    async function loadList() {
      const { data, error } = await client
        .from('resources')
        .select('*')
        .eq('publish_location', LOCATION)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Failed to load resources:', error.message);
        return;
      }
      allResources = data || [];
      renderList();
    }

    const filtersEl = document.getElementById('resourceFilters');
    if (filtersEl) {
      filtersEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        activeFilter = btn.dataset.filter;
        filtersEl.querySelectorAll('.filter-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderList();
      });
    }

    document.addEventListener('duru:langchange', renderList);

    /* ---------------- Delete flow ---------------- */

    let confirmOverlay;
    function ensureConfirmModal() {
      if (confirmOverlay) return confirmOverlay;
      confirmOverlay = document.createElement('div');
      confirmOverlay.className = 'resource-confirm-overlay';
      confirmOverlay.hidden = true;
      confirmOverlay.innerHTML = `
        <div class="resource-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="resConfirmTitle">
          <h3 id="resConfirmTitle" data-i18n="resources.confirmTitle">${escapeHTML(t('resources.confirmTitle', 'Delete this resource?'))}</h3>
          <p class="resource-confirm-body"></p>
          <div class="resource-confirm-actions">
            <button type="button" class="btn btn-outline" data-act="cancel" data-i18n="resources.cancel">${escapeHTML(t('resources.cancel', 'Cancel'))}</button>
            <button type="button" class="btn btn-danger" data-act="delete" data-i18n="resources.deleteBtn">${escapeHTML(t('resources.deleteBtn', 'Delete'))}</button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmOverlay);
      return confirmOverlay;
    }

    function confirmDelete(id, title, storageKey) {
      const overlay = ensureConfirmModal();
      overlay.querySelector('.resource-confirm-body').textContent =
        t('resources.confirmBody', '"{title}" will be permanently removed for everyone, including its download link. This can’t be undone.').replace('{title}', title);
      const deleteBtn = overlay.querySelector('[data-act="delete"]');
      const cancelBtn = overlay.querySelector('[data-act="cancel"]');
      overlay.hidden = false;

      const close = () => { overlay.hidden = true; };
      const onCancel = () => close();
      const onDelete = async () => {
        deleteBtn.disabled = true;
        cancelBtn.disabled = true;
        deleteBtn.textContent = t('resources.deleting', 'Deleting…');
        const { error: dbErr } = await client.from('resources').delete().eq('id', id);
        if (dbErr) {
          deleteBtn.disabled = false;
          cancelBtn.disabled = false;
          deleteBtn.textContent = t('resources.deleteBtn', 'Delete');
          overlay.querySelector('.resource-confirm-body').textContent = t('resources.deleteError', 'Could not delete: {msg}').replace('{msg}', dbErr.message);
          return;
        }
        await client.storage.from(BUCKET).remove([storageKey]);
        close();
        loadList();
      };
      deleteBtn.addEventListener('click', onDelete, { once: true });
      cancelBtn.addEventListener('click', onCancel, { once: true });
    }

    /* ---------------- Upload flow ---------------- */

    let uploadOverlay;
    function ensureUploadModal() {
      if (uploadOverlay) return uploadOverlay;
      uploadOverlay = document.createElement('div');
      uploadOverlay.className = 'resource-confirm-overlay';
      uploadOverlay.hidden = true;
      uploadOverlay.innerHTML = `
        <div class="resource-confirm-modal resource-upload-modal" role="dialog" aria-modal="true" aria-labelledby="resUploadTitle">
          <button type="button" class="auth-close" data-act="close" data-i18n-aria-label="resources.closeAria" aria-label="${escapeHTML(t('resources.closeAria', 'Close'))}">&times;</button>
          <h3 id="resUploadTitle" data-i18n="resources.uploadTitle">${escapeHTML(t('resources.uploadTitle', 'Attach a resource'))}</h3>
          <div class="resource-upload-msg" hidden></div>
          <form id="resourceUploadForm" novalidate>
            <div class="auth-field">
              <label for="resTitle" data-i18n="resources.fieldTitle">${escapeHTML(t('resources.fieldTitle', 'Title'))}</label>
              <input type="text" id="resTitle" required maxlength="120">
            </div>
            <div class="auth-field">
              <label for="resDesc" data-i18n="resources.fieldDesc">${escapeHTML(t('resources.fieldDesc', 'Description (optional)'))}</label>
              <textarea id="resDesc" rows="3" maxlength="500"></textarea>
            </div>
            <div class="auth-field">
              <label for="resDescLang" data-i18n="resources.fieldDescLang">${escapeHTML(t('resources.fieldDescLang', 'Description written in'))}</label>
              <select id="resDescLang">
                ${LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('')}
              </select>
            </div>
            <div class="auth-field">
              <label for="resCategory" data-i18n="resources.fieldCategory">${escapeHTML(t('resources.fieldCategory', 'Category'))}</label>
              <select id="resCategory">
                ${CATEGORIES.map(c => `<option value="${c}">${escapeHTML(categoryLabel(c))}</option>`).join('')}
              </select>
            </div>
            <div class="auth-field">
              <label for="resLevel" data-i18n="resources.fieldLevel">${escapeHTML(t('resources.fieldLevel', 'Learning level'))}</label>
              <select id="resLevel">
                ${LEVELS.map(l => `<option value="${l}">${escapeHTML(levelLabel(l))}</option>`).join('')}
              </select>
            </div>
            <div class="auth-field">
              <label for="resUnit" data-i18n="resources.fieldUnit">${escapeHTML(t('resources.fieldUnit', 'Linked book / unit (optional)'))}</label>
              <input type="text" id="resUnit" maxlength="80" data-i18n-placeholder="resources.fieldUnitPlaceholder" placeholder="${escapeHTML(t('resources.fieldUnitPlaceholder', 'e.g. Unit 3'))}">
            </div>
            <div class="auth-field">
              <label for="resFile" data-i18n="resources.fieldFile">${escapeHTML(t('resources.fieldFile', 'File'))}</label>
              <input type="file" id="resFile" required accept=".pdf,.png,.jpg,.jpeg,.mp3,.m4a">
              <p class="resource-hint" data-i18n="resources.fileHint">${escapeHTML(t('resources.fileHint', 'PDF, PNG, JPG, JPEG up to 20MB · MP3, M4A up to 50MB'))}</p>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="resUploadSubmit" data-i18n="resources.uploadSubmit">${escapeHTML(t('resources.uploadSubmit', 'Upload'))}</button>
          </form>
        </div>
      `;
      document.body.appendChild(uploadOverlay);

      uploadOverlay.querySelector('[data-act="close"]').addEventListener('click', () => { uploadOverlay.hidden = true; });
      uploadOverlay.addEventListener('click', (e) => { if (e.target === uploadOverlay) uploadOverlay.hidden = true; });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !uploadOverlay.hidden) uploadOverlay.hidden = true;
      });

      uploadOverlay.querySelector('#resourceUploadForm').addEventListener('submit', onUploadSubmit);
      return uploadOverlay;
    }

    function setUploadMsg(text, type) {
      const el = uploadOverlay.querySelector('.resource-upload-msg');
      el.textContent = text;
      el.className = 'resource-upload-msg ' + (type || '');
      el.hidden = !text;
    }

    let uploading = false;
    async function onUploadSubmit(e) {
      e.preventDefault();
      if (uploading) return;
      setUploadMsg('', '');

      const title = document.getElementById('resTitle').value.trim();
      const description = document.getElementById('resDesc').value.trim();
      const descLang = document.getElementById('resDescLang').value;
      const level = document.getElementById('resLevel').value;
      const unit = document.getElementById('resUnit').value.trim();
      const fileInput = document.getElementById('resFile');
      const file = fileInput.files[0];

      if (!title) { setUploadMsg(t('resources.errTitleRequired', 'Please enter a title.'), 'error'); return; }
      if (!file) { setUploadMsg(t('resources.errFileRequired', 'Please choose a file.'), 'error'); return; }

      const ext = fileExt(file.name);
      if (!MAX_SIZE[ext]) {
        setUploadMsg(t('resources.errUnsupportedType', 'Unsupported file type. Allowed: PDF, PNG, JPG, JPEG, MP3, M4A.'), 'error');
        return;
      }
      if (file.size > MAX_SIZE[ext]) {
        setUploadMsg(t('resources.errTooLarge', 'File is too large. Max size for .{ext} is {size}.').replace('{ext}', ext).replace('{size}', formatSize(MAX_SIZE[ext])), 'error');
        return;
      }

      uploading = true;
      const submitBtn = document.getElementById('resUploadSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = t('resources.uploading', 'Uploading…');

      const storageKey = `${LOCATION}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await client.storage.from(BUCKET).upload(storageKey, file, {
        contentType: MIME_BY_EXT[ext],
        upsert: false,
      });
      if (uploadErr) {
        uploading = false;
        submitBtn.disabled = false;
        submitBtn.textContent = t('resources.uploadSubmit', 'Upload');
        setUploadMsg(uploadErrorText(uploadErr), 'error');
        return;
      }

      const { error: insertErr } = await client.from('resources').insert({
        title, description: description || null,
        publish_location: LOCATION,
        file_type: ext,
        description_language: descLang,
        learning_level: level,
        category: overlay.querySelector('#resCategory').value,
        linked_unit: unit || null,
        storage_key: storageKey,
        file_size: file.size,
        mime_type: MIME_BY_EXT[ext],
        created_by: currentUserId,
      });

      uploading = false;
      submitBtn.disabled = false;
      submitBtn.textContent = t('resources.uploadSubmit', 'Upload');

      if (insertErr) {
        // Roll back the uploaded file so we don't leave an orphaned object.
        await client.storage.from(BUCKET).remove([storageKey]);
        setUploadMsg(t('resources.errSaveFailed', 'Could not save resource: {msg}').replace('{msg}', insertErr.message), 'error');
        return;
      }

      setUploadMsg(t('resources.uploadSuccess', 'Uploaded successfully.'), 'success');
      document.getElementById('resourceUploadForm').reset();
      loadList();
      setTimeout(() => { if (uploadOverlay) uploadOverlay.hidden = true; }, 900);
    }

    attachBtn.addEventListener('click', () => {
      const overlay = ensureUploadModal();
      setUploadMsg('', '');
      overlay.hidden = false;
      overlay.querySelector('#resTitle').focus();
    });

    /* ---------------- Admin check + init ---------------- */

    async function checkAdmin(user) {
      if (!user) {
        isAdmin = false;
        currentUserId = null;
        attachBtn.hidden = true;
        loadList();
        return;
      }
      currentUserId = user.id;
      const { data } = await client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
      isAdmin = !!data;
      attachBtn.hidden = !isAdmin;
      loadList();
    }

    client.auth.getSession().then(({ data }) => {
      checkAdmin(data && data.session && data.session.user);
    });
    client.auth.onAuthStateChange((_event, session) => {
      checkAdmin(session && session.user);
    });

    loadList();
  });
})();
