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

  document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('resourceList');
    const emptyEl = document.getElementById('resourceListEmpty');
    const attachBtn = document.getElementById('attachResourceBtn');
    if (!listEl || !attachBtn) return;

    const client = window.DURU_SUPABASE_CLIENT;
    if (!client) return; // Not configured yet — leave the dynamic section empty/hidden.

    let isAdmin = false;
    let currentUserId = null;

    function publicUrl(storageKey) {
      const { data } = client.storage.from(BUCKET).getPublicUrl(storageKey);
      return data && data.publicUrl;
    }

    function renderList(resources) {
      listEl.innerHTML = '';
      emptyEl.hidden = resources.length > 0;
      resources.forEach((r) => {
        const url = publicUrl(r.storage_key);
        const card = document.createElement('div');
        card.className = 'resource-card resource-card--file';
        card.innerHTML = `
          <span class="resource-tag">${escapeHTML(r.file_type.toUpperCase())}${r.learning_level && r.learning_level !== 'Any level' ? ' · ' + escapeHTML(r.learning_level) : ''}</span>
          <h3>${escapeHTML(r.title)}</h3>
          ${r.description ? `<p>${escapeHTML(r.description)}</p>` : ''}
          <p class="resource-meta">${formatSize(r.file_size)} · description in ${escapeHTML((LANGS.find(l => l.code === r.description_language) || {}).label || r.description_language)}${r.linked_unit ? ' · ' + escapeHTML(r.linked_unit) : ''}</p>
          <div class="resource-card-actions">
            ${url ? `<a href="${url}" class="btn btn-ghost" target="_blank" rel="noopener">Download →</a>` : `<span class="resource-unavailable">No longer available</span>`}
            ${isAdmin ? `<button type="button" class="resource-delete-btn" data-id="${r.id}" data-title="${escapeHTML(r.title)}" data-key="${escapeHTML(r.storage_key)}" aria-label="Delete ${escapeHTML(r.title)}">Delete</button>` : ''}
          </div>
        `;
        listEl.appendChild(card);
      });
      listEl.querySelectorAll('.resource-delete-btn').forEach((btn) => {
        btn.addEventListener('click', () => confirmDelete(btn.dataset.id, btn.dataset.title, btn.dataset.key));
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
      renderList(data || []);
    }

    /* ---------------- Delete flow ---------------- */

    let confirmOverlay;
    function ensureConfirmModal() {
      if (confirmOverlay) return confirmOverlay;
      confirmOverlay = document.createElement('div');
      confirmOverlay.className = 'resource-confirm-overlay';
      confirmOverlay.hidden = true;
      confirmOverlay.innerHTML = `
        <div class="resource-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="resConfirmTitle">
          <h3 id="resConfirmTitle">Delete this resource?</h3>
          <p class="resource-confirm-body"></p>
          <div class="resource-confirm-actions">
            <button type="button" class="btn btn-outline" data-act="cancel">Cancel</button>
            <button type="button" class="btn btn-danger" data-act="delete">Delete</button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmOverlay);
      return confirmOverlay;
    }

    function confirmDelete(id, title, storageKey) {
      const overlay = ensureConfirmModal();
      overlay.querySelector('.resource-confirm-body').textContent =
        `"${title}" will be permanently removed for everyone, including its download link. This can't be undone.`;
      const deleteBtn = overlay.querySelector('[data-act="delete"]');
      const cancelBtn = overlay.querySelector('[data-act="cancel"]');
      overlay.hidden = false;

      const close = () => { overlay.hidden = true; };
      const onCancel = () => close();
      const onDelete = async () => {
        deleteBtn.disabled = true;
        cancelBtn.disabled = true;
        deleteBtn.textContent = 'Deleting…';
        const { error: dbErr } = await client.from('resources').delete().eq('id', id);
        if (dbErr) {
          deleteBtn.disabled = false;
          cancelBtn.disabled = false;
          deleteBtn.textContent = 'Delete';
          overlay.querySelector('.resource-confirm-body').textContent = 'Could not delete: ' + dbErr.message;
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
          <button type="button" class="auth-close" data-act="close" aria-label="Close">&times;</button>
          <h3 id="resUploadTitle">Attach a resource</h3>
          <div class="resource-upload-msg" hidden></div>
          <form id="resourceUploadForm" novalidate>
            <div class="auth-field">
              <label for="resTitle">Title</label>
              <input type="text" id="resTitle" required maxlength="120">
            </div>
            <div class="auth-field">
              <label for="resDesc">Description (optional)</label>
              <textarea id="resDesc" rows="3" maxlength="500"></textarea>
            </div>
            <div class="auth-field">
              <label for="resDescLang">Description written in</label>
              <select id="resDescLang">
                ${LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('')}
              </select>
            </div>
            <div class="auth-field">
              <label for="resLevel">Learning level</label>
              <select id="resLevel">
                ${LEVELS.map(l => `<option value="${l}">${l}</option>`).join('')}
              </select>
            </div>
            <div class="auth-field">
              <label for="resUnit">Linked book / unit (optional)</label>
              <input type="text" id="resUnit" maxlength="80" placeholder="e.g. Unit 3">
            </div>
            <div class="auth-field">
              <label for="resFile">File</label>
              <input type="file" id="resFile" required accept=".pdf,.png,.jpg,.jpeg,.mp3,.m4a">
              <p class="resource-hint">PDF, PNG, JPG, JPEG up to 20MB · MP3, M4A up to 50MB</p>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="resUploadSubmit">Upload</button>
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

      if (!title) { setUploadMsg('Please enter a title.', 'error'); return; }
      if (!file) { setUploadMsg('Please choose a file.', 'error'); return; }

      const ext = fileExt(file.name);
      if (!MAX_SIZE[ext]) {
        setUploadMsg('Unsupported file type. Allowed: PDF, PNG, JPG, JPEG, MP3, M4A.', 'error');
        return;
      }
      if (file.size > MAX_SIZE[ext]) {
        setUploadMsg(`File is too large. Max size for .${ext} is ${formatSize(MAX_SIZE[ext])}.`, 'error');
        return;
      }

      uploading = true;
      const submitBtn = document.getElementById('resUploadSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';

      const storageKey = `${LOCATION}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await client.storage.from(BUCKET).upload(storageKey, file, {
        contentType: MIME_BY_EXT[ext],
        upsert: false,
      });
      if (uploadErr) {
        uploading = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Upload';
        setUploadMsg('Upload failed: ' + uploadErr.message, 'error');
        return;
      }

      const { error: insertErr } = await client.from('resources').insert({
        title, description: description || null,
        publish_location: LOCATION,
        file_type: ext,
        description_language: descLang,
        learning_level: level,
        linked_unit: unit || null,
        storage_key: storageKey,
        file_size: file.size,
        mime_type: MIME_BY_EXT[ext],
        created_by: currentUserId,
      });

      uploading = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';

      if (insertErr) {
        // Roll back the uploaded file so we don't leave an orphaned object.
        await client.storage.from(BUCKET).remove([storageKey]);
        setUploadMsg('Could not save resource: ' + insertErr.message, 'error');
        return;
      }

      setUploadMsg('Uploaded successfully.', 'success');
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
      if (!user) { isAdmin = false; currentUserId = null; attachBtn.hidden = true; return; }
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
