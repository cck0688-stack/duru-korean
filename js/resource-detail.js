// DURU KOREAN — one download's page (resource.html?id=…)
//
// Shows the resource in the visitor's language where a translation
// exists, lets them pick which language of PDF they want, and previews
// or downloads that file through a signed link. Signed links need a
// signed-in session, which the storage policy enforces; this page only
// says so. The list page may pass ?pl=<lang> to preselect a language;
// otherwise the site language is tried first.
//
// An admin gets an editor underneath: the resource's own fields, its
// title and text in each language, its cover, and one file per
// language to add, replace or remove. ?edit=1 opens it at once, which
// is how a freshly created resource arrives here.

(function () {
  'use strict';

  var R = window.DURU_RES;
  if (!R) return;
  var t = R.t, esc = R.escapeHTML;

  document.addEventListener('DOMContentLoaded', function () {
    var client = window.DURU_SUPABASE_CLIENT;
    var $ = function (id) { return document.getElementById(id); };
    var detail = $('resDetail'), notFound = $('resNotFound');
    if (!detail) return;
    if (!client) { notFound.hidden = false; return; }

    var params = new URLSearchParams(window.location.search);
    var id = params.get('id');
    var wantLang = params.get('pl');
    if (!id) { notFound.hidden = false; return; }

    var resource = null;
    var currentUser = null;
    var isAdmin = false;
    var chosen = null;      // the file currently selected
    var editorOpen = false;

    /* ---------------- Loading ---------------- */

    function load() {
      return client.from('resources')
        .select('*, resource_files(*)')
        .eq('id', id)
        .maybeSingle()
        .then(function (res) {
          if (res.error || !res.data) {
            if (res.error) console.error('Failed to load resource:', res.error.message);
            notFound.hidden = false; detail.hidden = true;
            return;
          }
          resource = res.data;
          notFound.hidden = true; detail.hidden = false;
          render();
          if (isAdmin && editorOpen) renderEditor();
        });
    }

    /* ---------------- Reading view ---------------- */

    function backHref() {
      return resource && resource.publish_location === 'book-resources' ? 'book-resources.html' : 'free-resources.html';
    }

    function render() {
      var lang = R.siteLang();
      var title = R.localized(resource, 'title', lang);
      document.title = title + ' — Duru Korean';
      $('resTitle').textContent = title;
      var summary = R.localized(resource, 'description', lang);
      $('resCategory').textContent = R.categoryLabel(resource.category);
      $('resBack').href = backHref();
      $('resCover').innerHTML = R.coverHTML(client, resource);

      var files = R.availableFiles(resource, isAdmin);
      var formats = {};
      files.forEach(function (f) { formats[String(f.file_type || '').toUpperCase()] = true; });
      $('resFactType').textContent = R.categoryLabel(resource.category);
      $('resFactLevel').textContent = R.levelLabel(resource.learning_level || 'Any level');
      $('resFactFormat').textContent = Object.keys(formats).join(' / ') || '—';
      $('resFactLangs').textContent = files.length
        ? files.map(function (f) { return R.langLabel(f.lang); }).join(', ')
        : t('resource.noFilesYet', 'No file yet');

      // The short description reads in the column people actually read,
      // with the longer text under it; the banner keeps the title alone.
      // Both are optional, so the section goes away when neither is set
      // rather than announcing that nobody has written it.
      var body = R.localized(resource, 'body', lang);
      document.querySelector('.res-body').hidden = !(summary || body);
      $('resBody').innerHTML =
        (summary ? '<p class="res-lead">' + esc(summary) + '</p>' : '') +
        (body ? body.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; }).join('') : '');

      renderLanguagePicker(files);
      $('resAdmin').hidden = !isAdmin;
      if (isAdmin) renderStatus();
    }

    // The one control an admin looks for after uploading: is this live?
    function renderStatus() {
      var box = $('resStatus');
      var live = resource.published !== false;
      box.className = 'res-status ' + (live ? 'res-status--live' : 'res-status--draft');
      box.innerHTML =
        '<span>' + esc(live
          ? t('resource.statusLive', 'Published — everyone can see this download.')
          : t('resource.statusDraft', 'Not published yet — only admins can see this download.')) + '</span>' +
        '<button type="button" class="btn ' + (live ? 'btn-outline-dark' : 'btn-primary') + '" id="resPublishBtn">' +
          esc(live ? t('resource.unpublishBtn', 'Unpublish') : t('resource.publishBtn', 'Publish now')) + '</button>';
      box.hidden = false;
      box.querySelector('#resPublishBtn').addEventListener('click', function () {
        var btn = this;
        if (!live && !R.availableFiles(resource, true).length) {
          window.alert(t('resource.publishNoFiles', 'Add at least one file before publishing.'));
          return;
        }
        btn.disabled = true;
        client.from('resources').update({ published: !live, updated_at: new Date().toISOString() }).eq('id', resource.id)
          .then(function (res) {
            btn.disabled = false;
            if (res.error) { window.alert(R.schemaHint(res.error.message)); return; }
            load();
          });
      });
    }

    // The order tried: the language the list was filtered to, then the
    // site language, then the first file there is. When the one asked
    // for is missing, say so and let the visitor pick.
    function renderLanguagePicker(files) {
      var sel = $('resPdfLang');
      var notice = $('resLangNotice');
      var preferred = wantLang || R.siteLang();
      sel.innerHTML = files.map(function (f) {
        return '<option value="' + esc(f.id) + '">' + esc(R.langLabel(f.lang)) +
          (f.published === false ? ' — ' + esc(t('resource.hiddenFile', 'hidden')) : '') + '</option>';
      }).join('');
      var match = files.filter(function (f) { return f.lang === preferred; })[0];
      chosen = match || (chosen && files.filter(function (f) { return f.id === chosen.id; })[0]) || files[0] || null;
      if (chosen) sel.value = chosen.id;
      sel.disabled = !files.length;
      if (!files.length) {
        notice.hidden = false;
        notice.textContent = t('resource.noFilesYet', 'No file yet');
      } else if (!match) {
        notice.hidden = false;
        notice.textContent = t('resource.notInLang', 'This download isn’t available in {lang} yet — pick one of the languages below.')
          .replace('{lang}', R.langLabel(preferred));
      } else {
        notice.hidden = true;
      }
      renderFileMeta();
      renderButtons();
    }

    function renderFileMeta() {
      var el = $('resFileMeta');
      if (!chosen) { el.textContent = ''; return; }
      var parts = [];
      if (chosen.page_count) parts.push(t('resource.pages', '{n} pages').replace('{n}', chosen.page_count));
      parts.push(R.formatSize(chosen.file_size));
      parts.push(String(chosen.file_type || '').toUpperCase());
      el.textContent = parts.join(' · ');
    }

    function renderButtons() {
      var prev = $('resPreviewBtn'), dl = $('resDownloadBtn'), note = $('resLoginNote');
      var have = !!chosen;
      var fmt = have ? String(chosen.file_type || '').toUpperCase() : 'PDF';
      prev.disabled = !have; dl.disabled = !have;
      if (!currentUser) {
        dl.textContent = t('resources.loginToDownload', 'Log in to download');
        prev.hidden = true;
        note.hidden = false;
      } else {
        dl.textContent = t('resource.downloadFile', 'Download {fmt}').replace('{fmt}', fmt);
        prev.textContent = t('resource.previewFile', 'Preview {fmt}').replace('{fmt}', fmt);
        prev.hidden = !(have && R.PREVIEWABLE[chosen.file_type]);
        note.hidden = true;
      }
    }

    $('resPdfLang').addEventListener('change', function () {
      var fid = this.value;
      chosen = R.availableFiles(resource, isAdmin).filter(function (f) { return f.id === fid; })[0] || null;
      $('resLangNotice').hidden = true;
      renderFileMeta(); renderButtons();
    });

    function fetchLink(download) {
      if (!currentUser) { R.openLogin(); return Promise.reject(new Error('login')); }
      if (!chosen) return Promise.reject(new Error('no file'));
      return R.signedUrl(client, chosen.storage_key, download);
    }
    $('resPreviewBtn').addEventListener('click', function () {
      var btn = this; btn.disabled = true;
      fetchLink(false).then(function (url) { window.open(url, '_blank', 'noopener'); })
        .catch(function (err) {
          if (err.message !== 'login' && window.DURU_NOTIFY) window.DURU_NOTIFY.error(t('resources.downloadFailed', 'That download link could not be created. Please try again.'));
        })
        .then(function () { btn.disabled = false; });
    });
    $('resDownloadBtn').addEventListener('click', function () {
      var btn = this; btn.disabled = true;
      fetchLink(true).then(function (url) { window.location.href = url; })
        .catch(function (err) {
          if (err.message !== 'login' && window.DURU_NOTIFY) window.DURU_NOTIFY.error(t('resources.downloadFailed', 'That download link could not be created. Please try again.'));
        })
        .then(function () { btn.disabled = false; });
    });

    /* ---------------- Editor (admin) ---------------- */

    var editor = $('resEditor');
    var toggle = $('resEditToggle');
    toggle.addEventListener('click', function () {
      editorOpen = !editorOpen;
      editor.hidden = !editorOpen;
      if (editorOpen) renderEditor();
      toggle.textContent = editorOpen ? t('resource.closeEditor', 'Close editor') : t('resource.edit', 'Edit this download');
    });

    function field(label, inner) {
      return '<div class="auth-field"><label>' + esc(label) + '</label>' + inner + '</div>';
    }

    function renderEditor() {
      var r = resource;
      var i18n = r.i18n || {};
      var files = R.availableFiles(r, true);
      var taken = {};
      files.forEach(function (f) { taken[f.lang] = true; });
      var free = R.LANGS.filter(function (l) { return !taken[l.code]; });

      editor.innerHTML =
        '<div class="res-editor">' +
          '<div class="resource-upload-msg" id="resEdMsg" hidden></div>' +

          // The files are what an admin comes here for, so they are first.
          '<h3>' + esc(t('resource.files', 'Files by language')) + '</h3>' +
          (files.length ? '<table class="res-files"><tbody>' +
            files.map(function (f) {
              return '<tr>' +
                '<th>' + esc(R.langLabel(f.lang)) + '</th>' +
                '<td>' +
                  '<div>' + esc(String(f.file_type || '').toUpperCase()) + ' · ' + esc(R.formatSize(f.file_size)) + '</div>' +
                  (f.file_type === 'pdf'
                    ? '<div><label>' + esc(t('resource.fieldPages', 'Pages')) + ' <input type="number" min="1" class="res-pages" data-fid="' + esc(f.id) + '" value="' + (f.page_count || '') + '"></label></div>'
                    : '') +
                  '<div><label><input type="checkbox" class="res-fpub" data-fid="' + esc(f.id) + '"' + (f.published !== false ? ' checked' : '') + '> ' + esc(t('resource.filePublished', 'Published')) + '</label></div>' +
                '</td>' +
                '<td class="res-files-act">' +
                  '<label class="res-linkbtn">' + esc(t('resource.replaceFile', 'Replace')) + '<input type="file" class="res-replace" data-fid="' + esc(f.id) + '" data-key="' + esc(f.storage_key) + '" accept="' + R.ACCEPT + '" hidden></label> ' +
                  '<button type="button" class="res-linkbtn res-linkbtn--danger res-remove" data-fid="' + esc(f.id) + '" data-key="' + esc(f.storage_key) + '">' + esc(t('resource.removeFile', 'Remove')) + '</button>' +
                '</td>' +
              '</tr>';
            }).join('') + '</tbody></table>' : '<p class="resource-hint">' + esc(t('resource.noFilesYet', 'No file yet')) + '</p>') +

          (free.length ? '<form id="resAddFile" class="res-addfile" novalidate>' +
            '<div class="res-editor-row">' +
              field(t('resource.fieldLang', 'Language'), '<select id="afLang">' + free.map(function (l) { return '<option value="' + l.code + '">' + esc(l.label) + '</option>'; }).join('') + '</select>') +
              field(t('resources.fieldFile', 'File'), '<input type="file" id="afFile" accept="' + R.ACCEPT + '">') +
              field(t('resource.fieldPages', 'Pages'), '<input type="number" id="afPages" min="1" placeholder="auto">') +
            '</div>' +
            '<button type="submit" class="btn btn-ghost" id="afSubmit">' + esc(t('resource.addFile', 'Add file')) + '</button>' +
          '</form>' : '') +

          '<h3>' + esc(t('resource.basics', 'Title, category and cover')) + '</h3>' +
          '<form id="resEdForm" novalidate>' +
            field(t('resources.fieldTitle', 'Title'), '<input type="text" id="edTitle" maxlength="120" value="' + esc(r.title) + '">') +
            field(t('resource.fieldSummary', 'Short description'), '<textarea id="edDesc" rows="2" maxlength="300">' + esc(r.description || '') + '</textarea>') +
            '<div class="res-editor-row">' +
              field(t('resources.fieldCategory', 'Category'), '<select id="edCategory">' + R.CATEGORIES.map(function (c) { return '<option value="' + c + '"' + (c === r.category ? ' selected' : '') + '>' + esc(R.categoryLabel(c)) + '</option>'; }).join('') + '</select>') +
              field(t('resources.fieldLevel', 'Learning level'), '<select id="edLevel">' + R.LEVELS.map(function (l) { return '<option value="' + l + '"' + (l === (r.learning_level || 'Any level') ? ' selected' : '') + '>' + esc(R.levelLabel(l)) + '</option>'; }).join('') + '</select>') +
            '</div>' +
            field(t('resource.fieldCover', 'Cover image (JPG or PNG, up to 5 MB)'), '<input type="file" id="edCover" accept=".png,.jpg,.jpeg">' +
              (r.cover_key ? '<p class="resource-hint">' + esc(t('resource.coverSet', 'A cover is set. Choose a new image to replace it.')) + ' <button type="button" class="res-linkbtn" id="edCoverRemove">' + esc(t('resource.removeCover', 'Remove cover')) + '</button></p>' : '')) +

            '<details class="res-more"' + (r.body ? ' open' : '') + '>' +
              '<summary>' + esc(t('resource.moreBody', 'Add a longer description (optional)')) + '</summary>' +
              '<p class="resource-hint">' + esc(t('resource.bodyHint', 'Shown under the download buttons — what the file contains and how to work through it. Leave it blank and the section does not appear.')) + '</p>' +
              '<textarea id="edBody" rows="6">' + esc(r.body || '') + '</textarea>' +
            '</details>' +

            '<button type="submit" class="btn btn-primary" id="edSave">' + esc(t('resource.saveBtn', 'Save')) + '</button>' +
          '</form>' +

          '<details class="res-more">' +
            '<summary>' + esc(t('resource.translations', 'Translate the title and description (optional)')) + '</summary>' +
            '<p class="resource-hint">' + esc(t('resource.translationHint', 'Leave a language blank to show the default text above.')) + '</p>' +
            '<div class="res-translations">' +
              R.LANGS.map(function (l) {
                var tr = i18n[l.code] || {};
                return '<details class="res-tr"' + (tr.title || tr.description || tr.body ? ' open' : '') + '><summary>' + esc(l.label) + (tr.title ? ' ✓' : '') + '</summary>' +
                  field(t('resources.fieldTitle', 'Title'), '<input type="text" data-tr="' + l.code + '" data-f="title" maxlength="120" value="' + esc(tr.title || '') + '">') +
                  field(t('resource.fieldSummary', 'Short description'), '<textarea data-tr="' + l.code + '" data-f="description" rows="2" maxlength="300">' + esc(tr.description || '') + '</textarea>') +
                  field(t('resource.moreBody', 'Longer description'), '<textarea data-tr="' + l.code + '" data-f="body" rows="4">' + esc(tr.body || '') + '</textarea>') +
                '</details>';
              }).join('') +
            '</div>' +
            '<button type="button" class="btn btn-primary" id="edSaveTr">' + esc(t('resource.saveTranslations', 'Save translations')) + '</button>' +
          '</details>' +

          '<div class="res-danger">' +
            '<button type="button" class="btn-danger" id="edDelete">' + esc(t('resource.deleteResource', 'Delete this download')) + '</button>' +
          '</div>' +
        '</div>';

      editor.querySelector('#resEdForm').addEventListener('submit', saveFields);
      editor.querySelector('#edSaveTr').addEventListener('click', saveTranslations);
      var rm = editor.querySelector('#edCoverRemove');
      if (rm) rm.addEventListener('click', removeCover);
      editor.querySelectorAll('.res-pages').forEach(function (inp) {
        inp.addEventListener('change', function () { updateFile(inp.dataset.fid, { page_count: inp.value ? Number(inp.value) : null }); });
      });
      editor.querySelectorAll('.res-fpub').forEach(function (inp) {
        inp.addEventListener('change', function () { updateFile(inp.dataset.fid, { published: inp.checked }); });
      });
      editor.querySelectorAll('.res-replace').forEach(function (inp) {
        inp.addEventListener('change', function () { if (inp.files[0]) replaceFile(inp.dataset.fid, inp.dataset.key, inp.files[0]); });
      });
      editor.querySelectorAll('.res-remove').forEach(function (b) {
        b.addEventListener('click', function () { removeFile(b.dataset.fid, b.dataset.key); });
      });
      var af = editor.querySelector('#resAddFile');
      if (af) {
        af.addEventListener('submit', addFile);
        af.querySelector('#afFile').addEventListener('change', function () {
          var f = this.files[0];
          if (!f) return;
          var guess = R.guessLang(f.name);
          if (guess && af.querySelector('#afLang').querySelector('option[value="' + guess + '"]')) af.querySelector('#afLang').value = guess;
          if (R.fileExt(f.name) === 'pdf') R.pdfPageCount(f).then(function (n) { if (n) af.querySelector('#afPages').value = n; });
        });
      }
      editor.querySelector('#edDelete').addEventListener('click', deleteResource);
    }

    function msg(text, type) {
      var el = editor.querySelector('#resEdMsg');
      if (!el) return;
      el.textContent = text; el.className = 'resource-upload-msg ' + (type || ''); el.hidden = !text;
      if (text) el.scrollIntoView({ block: 'nearest' });
    }

    function saveFields(e) {
      e.preventDefault();
      var btn = editor.querySelector('#edSave'); btn.disabled = true;
      var patch = {
        title: editor.querySelector('#edTitle').value.trim() || resource.title,
        description: editor.querySelector('#edDesc').value.trim() || null,
        body: editor.querySelector('#edBody').value.trim() || null,
        category: editor.querySelector('#edCategory').value,
        learning_level: editor.querySelector('#edLevel').value,
        updated_at: new Date().toISOString()
      };
      var cover = editor.querySelector('#edCover').files[0];
      var step = Promise.resolve();
      if (cover) {
        var ext = R.fileExt(cover.name);
        if (['png', 'jpg', 'jpeg'].indexOf(ext) === -1 || cover.size > R.COVER_MAX) {
          btn.disabled = false;
          msg(t('resource.errCover', 'The cover must be a JPG or PNG up to 5 MB.'), 'error');
          return;
        }
        var key = 'covers/' + resource.id + '-' + Date.now() + '.' + ext;
        step = client.storage.from(R.COVERS).upload(key, cover, { contentType: R.MIME_BY_EXT[ext], upsert: false })
          .then(function (res) {
            if (res.error) throw new Error(R.uploadErrorText(res.error));
            var old = resource.cover_key;
            patch.cover_key = key;
            if (old) return client.storage.from(R.COVERS).remove([old]).then(function () {});
          });
      }
      step.then(function () {
        return client.from('resources').update(patch).eq('id', resource.id);
      }).then(function (res) {
        if (res && res.error) throw new Error(R.schemaHint(res.error.message));
        msg(t('resource.saved', 'Saved.'), 'success');
        return load();
      }).catch(function (err) {
        msg(t('resources.errSaveFailed', 'Could not save resource: {msg}').replace('{msg}', err.message), 'error');
      }).then(function () { btn.disabled = false; });
    }

    function removeCover() {
      var old = resource.cover_key;
      client.from('resources').update({ cover_key: null }).eq('id', resource.id).then(function (res) {
        if (res.error) { msg(res.error.message, 'error'); return; }
        if (old) client.storage.from(R.COVERS).remove([old]);
        load();
      });
    }

    function saveTranslations() {
      var btn = editor.querySelector('#edSaveTr'); btn.disabled = true;
      var out = {};
      editor.querySelectorAll('[data-tr]').forEach(function (inp) {
        var code = inp.dataset.tr, f = inp.dataset.f, v = inp.value.trim();
        if (!v) return;
        (out[code] = out[code] || {})[f] = v;
      });
      client.from('resources').update({ i18n: out, updated_at: new Date().toISOString() }).eq('id', resource.id)
        .then(function (res) {
          btn.disabled = false;
          if (res.error) { msg(R.schemaHint(res.error.message), 'error'); return; }
          msg(t('resource.saved', 'Saved.'), 'success');
          load();
        });
    }

    function checkFile(file) {
      var ext = R.fileExt(file.name);
      if (!R.MAX_SIZE[ext]) return t('resources.errUnsupportedType', 'Unsupported file type. Allowed: PDF, PNG, JPG, JPEG, MP3, M4A.');
      if (file.size > R.MAX_SIZE[ext]) return t('resources.errTooLarge', 'File is too large. Max size for .{ext} is {size}.').replace('{ext}', ext).replace('{size}', R.formatSize(R.MAX_SIZE[ext]));
      return null;
    }

    function uploadTo(file) {
      var ext = R.fileExt(file.name);
      var key = resource.publish_location + '/' + resource.id + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now()) + '.' + ext;
      return client.storage.from(R.BUCKET).upload(key, file, { contentType: R.MIME_BY_EXT[ext], upsert: false })
        .then(function (res) {
          if (res.error) throw new Error(R.uploadErrorText(res.error));
          return { key: key, ext: ext };
        });
    }

    function addFile(e) {
      e.preventDefault();
      var form = editor.querySelector('#resAddFile');
      var file = form.querySelector('#afFile').files[0];
      var lang = form.querySelector('#afLang').value;
      var pages = form.querySelector('#afPages').value;
      if (!file) { msg(t('resources.errFileRequired', 'Please choose a file.'), 'error'); return; }
      var bad = checkFile(file);
      if (bad) { msg(bad, 'error'); return; }
      var btn = form.querySelector('#afSubmit'); btn.disabled = true;
      btn.textContent = t('resources.uploading', 'Uploading…');
      uploadTo(file).then(function (up) {
        return client.from('resource_files').insert({
          resource_id: resource.id, lang: lang, storage_key: up.key, file_type: up.ext,
          file_size: file.size, mime_type: R.MIME_BY_EXT[up.ext],
          page_count: pages ? Number(pages) : null, published: true,
          created_by: currentUser ? currentUser.id : null
        }).then(function (res) {
          if (res.error) {
            return client.storage.from(R.BUCKET).remove([up.key]).then(function () { throw new Error(R.schemaHint(res.error.message)); });
          }
        });
      }).then(function () {
        msg(t('resources.uploadSuccess', 'Uploaded successfully.'), 'success');
        return load();
      }).catch(function (err) {
        msg(t('resources.errSaveFailed', 'Could not save resource: {msg}').replace('{msg}', err.message), 'error');
      }).then(function () { btn.disabled = false; btn.textContent = t('resource.addFile', 'Add file'); });
    }

    function replaceFile(fid, oldKey, file) {
      var bad = checkFile(file);
      if (bad) { msg(bad, 'error'); return; }
      msg(t('resources.uploading', 'Uploading…'), '');
      R.pdfPageCount(R.fileExt(file.name) === 'pdf' ? file : null).then(function (pages) {
        return uploadTo(file).then(function (up) {
          var patch = { storage_key: up.key, file_type: up.ext, file_size: file.size, mime_type: R.MIME_BY_EXT[up.ext] };
          if (pages) patch.page_count = pages;
          return client.from('resource_files').update(patch).eq('id', fid).then(function (res) {
            if (res.error) {
              return client.storage.from(R.BUCKET).remove([up.key]).then(function () { throw new Error(R.schemaHint(res.error.message)); });
            }
            return client.storage.from(R.BUCKET).remove([oldKey]);
          });
        });
      }).then(function () {
        msg(t('resources.uploadSuccess', 'Uploaded successfully.'), 'success');
        return load();
      }).catch(function (err) {
        msg(t('resources.errSaveFailed', 'Could not save resource: {msg}').replace('{msg}', err.message), 'error');
      });
    }

    function updateFile(fid, patch) {
      client.from('resource_files').update(patch).eq('id', fid).then(function (res) {
        if (res.error) { msg(R.schemaHint(res.error.message), 'error'); return; }
        load();
      });
    }

    function removeFile(fid, key) {
      if (!window.confirm(t('resource.confirmRemoveFile', 'Remove this language’s file? Learners will no longer be able to download it.'))) return;
      client.from('resource_files').delete().eq('id', fid).then(function (res) {
        if (res.error) { msg(res.error.message, 'error'); return; }
        return client.storage.from(R.BUCKET).remove([key]).then(function () { load(); });
      });
    }

    function deleteResource() {
      var ok = window.confirm(t('resource.confirmDeleteResource', '“{title}” and all of its files will be permanently removed. This can’t be undone.').replace('{title}', resource.title));
      if (!ok) return;
      var keys = (resource.resource_files || []).map(function (f) { return f.storage_key; });
      var covers = resource.cover_key ? [resource.cover_key] : [];
      client.from('resources').delete().eq('id', resource.id).then(function (res) {
        if (res.error) { msg(res.error.message, 'error'); return; }
        var steps = [];
        if (keys.length) steps.push(client.storage.from(R.BUCKET).remove(keys));
        if (covers.length) steps.push(client.storage.from(R.COVERS).remove(covers));
        return Promise.all(steps).then(function () { window.location.href = backHref(); });
      });
    }

    /* ---------------- Session ---------------- */

    function applyUser(user) {
      currentUser = user || null;
      R.isAdmin(client, currentUser).then(function (admin) {
        isAdmin = admin;
        if (isAdmin && params.get('edit') === '1' && !editorOpen) {
          editorOpen = true; editor.hidden = false;
          toggle.textContent = t('resource.closeEditor', 'Close editor');
        }
        load();
      });
    }
    client.auth.getSession().then(function (res) { applyUser(res.data && res.data.session && res.data.session.user); });
    client.auth.onAuthStateChange(function (_e, session) { applyUser(session && session.user); });
    document.addEventListener('duru:langchange', function () {
      if (!resource) return;
      render();
      // The editor is built from translated labels too, and it may have
      // been opened before the dictionary arrived.
      if (isAdmin && editorOpen) renderEditor();
    });
  });
})();
