// DURU KOREAN — shared pieces of the downloads (resources) pages
//
// One resource is one piece of material; its files are the same PDF in
// each language it exists in. The list page (js/resources.js) and the
// resource page (js/resource-detail.js) both need the language table,
// the category and level labels, the storage helpers and the rule for
// picking a translated title, so those live here as window.DURU_RES.
// Load this after js/auth.js and before either of those two scripts.

(function () {
  'use strict';

  var BUCKET = 'resources';
  var COVERS = 'resource-covers';

  // Same codes and order as the site's language picker. `short` is the
  // two-letter chip shown on a card.
  var LANGS = [
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'vi', label: 'Tiếng Việt', short: 'VI' },
    { code: 'es', label: 'Español', short: 'ES' },
    { code: 'id', label: 'Bahasa Indonesia', short: 'ID' },
    { code: 'pt-BR', label: 'Português (BR)', short: 'PT' },
    { code: 'ko', label: '한국어', short: 'KO' },
    { code: 'ja', label: '日本語', short: 'JA' },
    { code: 'zh', label: '中文', short: 'ZH' }
  ];
  var CATEGORIES = ['hangul', 'pronunciation', 'vocab', 'grammar', 'reallife'];
  var CATEGORY_GLYPH = { hangul: '한', pronunciation: '음', vocab: '말', grammar: '법', reallife: '삶' };
  var LEVELS = ['Any level', 'Beginner', 'Intermediate', 'Advanced'];

  var MAX_SIZE = {
    pdf: 20 * 1024 * 1024, png: 20 * 1024 * 1024, jpg: 20 * 1024 * 1024, jpeg: 20 * 1024 * 1024,
    mp3: 50 * 1024 * 1024, m4a: 50 * 1024 * 1024
  };
  var MIME_BY_EXT = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4'
  };
  var COVER_MAX = 5 * 1024 * 1024;
  var SIGNED_URL_TTL = 300;

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

  function fileExt(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function formatSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  // "schema cache" in a PostgREST error means a column or table the page
  // expects is not in the database yet — the migration has not been run.
  function schemaHint(msg) {
    msg = String(msg || '');
    return /schema cache|does not exist/i.test(msg)
      ? msg + ' — ' + t('common.schemaHint', 'The database has not been updated yet. Run supabase/schema.sql in the Supabase SQL editor, then try again.')
      : msg;
  }

  function uploadErrorText(err) {
    var msg = (err && err.message) || '';
    if (/bucket not found/i.test(msg)) {
      return t('resources.errBucketMissing', 'The storage bucket isn’t set up yet. Create a private bucket named “resources” in Supabase, then run the policies in supabase/schema.sql.');
    }
    if (/row-level security|not authorized|unauthorized|permission denied/i.test(msg)) {
      return t('resources.errNotAllowed', 'Your account isn’t allowed to upload. Check that you’re still signed in as an admin.');
    }
    return t('resources.errUploadFailed', 'Upload failed: {msg}').replace('{msg}', msg);
  }

  function siteLang() {
    return (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
  }
  function langEntry(code) {
    return LANGS.filter(function (l) { return l.code === code; })[0] || { code: code, label: code, short: String(code || '').slice(0, 2).toUpperCase() };
  }
  function langLabel(code) { return langEntry(code).label; }
  function langShort(code) { return langEntry(code).short; }

  function categoryLabel(cat) { return t('resources.cat.' + cat, cat); }
  function levelLabel(level) {
    var map = {
      'Any level': t('resources.levelAny', 'Any level'),
      'Beginner': t('resources.levelBeginner', 'Beginner'),
      'Intermediate': t('resources.levelIntermediate', 'Intermediate'),
      'Advanced': t('resources.levelAdvanced', 'Advanced')
    };
    return map[level] || level || '';
  }

  // The text in the visitor's own language when the admin has written
  // one, otherwise the resource's default text.
  function localized(resource, field, lang) {
    lang = lang || siteLang();
    var tr = resource && resource.i18n && resource.i18n[lang];
    if (tr && typeof tr[field] === 'string' && tr[field].trim()) return tr[field];
    return (resource && resource[field]) || '';
  }

  // Files a visitor may choose from: published ones, in picker order.
  // An admin also sees unpublished ones, marked as such by the caller.
  function availableFiles(resource, includeHidden) {
    var files = (resource && resource.resource_files) || [];
    files = files.filter(function (f) { return includeHidden || f.published !== false; });
    var order = LANGS.map(function (l) { return l.code; });
    return files.slice().sort(function (a, b) {
      var ia = order.indexOf(a.lang), ib = order.indexOf(b.lang);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  function coverUrl(client, key) {
    if (!key) return null;
    var res = client.storage.from(COVERS).getPublicUrl(key);
    return res && res.data ? res.data.publicUrl : null;
  }

  function coverHTML(client, resource) {
    var url = coverUrl(client, resource.cover_key);
    if (url) {
      return '<img src="' + escapeHTML(url) + '" alt="" loading="lazy">';
    }
    return '<span class="res-cover-glyph kr" aria-hidden="true">' +
      escapeHTML(CATEGORY_GLYPH[resource.category] || '글') + '</span>';
  }

  // The bucket is private: a link is minted when the visitor asks, and
  // only a signed-in session can mint one — the storage policy decides.
  function signedUrl(client, storageKey, download) {
    var opts = download ? { download: true } : undefined;
    return client.storage.from(BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL, opts)
      .then(function (res) {
        if (res.error || !res.data) throw new Error(res.error ? res.error.message : 'no url');
        return res.data.signedUrl;
      });
  }

  // A page count read from the PDF itself, so the admin need not type
  // it. Counts the page objects in the first part of the file; a PDF
  // that hides its structure behind object streams yields nothing, and
  // the admin can fill the number in by hand.
  function pdfPageCount(file) {
    if (!file || typeof file.slice !== 'function') return Promise.resolve(null);
    return file.slice(0, 12 * 1024 * 1024).text().then(function (txt) {
      var m = txt.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
      return m && m.length ? m.length : null;
    }).catch(function () { return null; });
  }

  function isAdmin(client, user) {
    if (!user) return Promise.resolve(false);
    return client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
      .then(function (res) { return !!(res && res.data); })
      .catch(function () { return false; });
  }

  function openLogin() {
    var trigger = document.getElementById('authTrigger');
    if (trigger) trigger.click();
  }

  window.DURU_RES = {
    BUCKET: BUCKET, COVERS: COVERS, LANGS: LANGS, CATEGORIES: CATEGORIES, LEVELS: LEVELS,
    MAX_SIZE: MAX_SIZE, MIME_BY_EXT: MIME_BY_EXT, COVER_MAX: COVER_MAX,
    t: t, escapeHTML: escapeHTML, fileExt: fileExt, formatSize: formatSize,
    schemaHint: schemaHint, uploadErrorText: uploadErrorText,
    siteLang: siteLang, langLabel: langLabel, langShort: langShort, langEntry: langEntry,
    categoryLabel: categoryLabel, levelLabel: levelLabel,
    localized: localized, availableFiles: availableFiles,
    coverUrl: coverUrl, coverHTML: coverHTML, signedUrl: signedUrl,
    pdfPageCount: pdfPageCount, isAdmin: isAdmin, openLogin: openLogin
  };
})();
