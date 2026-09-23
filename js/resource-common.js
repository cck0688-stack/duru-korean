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
  // The shelves, in the order they are shown. This is the one list:
  // the cards on the downloads page, the picker in the admin editor and
  // the label on a resource page all read it, so adding a shelf is
  // adding it here, adding its `resources.cat.*` keys to the eight
  // dictionaries, and widening resources_category_check in
  // supabase/schema.sql. The ids never change — they are what the
  // database stores.
  //
  // `etc` is the catch-all, last on purpose. Without one, a calendar or
  // a song sheet gets filed under a shelf that does not describe it,
  // and the five honest shelves quietly stop meaning what they say.
  var CATEGORIES = ['hangul', 'reading', 'vocab', 'grammar', 'reallife', 'etc'];
  var CATEGORY_GLYPH = {
    hangul: '한', reading: '읽', vocab: '말',
    grammar: '법', reallife: '삶', etc: '글'
  };

  // Drawn, not fetched — the same three-line SVGs the blog and the
  // community use, inheriting their stroke from the cards' CSS.
  var CATEGORY_ICON = {
    // a sheet with the Hangul letter shapes on it
    hangul: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h3M9.5 8v3.5"/><path d="M14 8v4M13 16h6M16 13.5v5"/><path d="M8 13.5h3.5"/>',
    // an open book — the one shelf that is connected text rather than
    // words, rules or phrases
    reading: '<path d="M12 6.6S10 4.6 4 4.6v12.8c6 0 8 2 8 2s2-2 8-2V4.6c-6 0-8 2-8 2Z"/><path d="M12 6.6v12.8"/>',
    // a stack of word cards
    vocab: '<rect x="3" y="7" width="13" height="10" rx="1.8"/><path d="M7 11h5M7 13.5h3"/><path d="M18.5 8.5v9a1.8 1.8 0 0 1-1.8 1.8H8"/>',
    // a ruled sheet with a check on it
    grammar: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 11.5h8"/><path d="M8.5 15.8l2 2 4.5-4.5"/>',
    // a shopfront — Korean as it is actually used
    reallife: '<path d="M3.5 9.5 5 4.5h14l1.5 5"/><path d="M4.5 9.5v10h15v-10"/><path d="M3.5 9.5a2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0"/><path d="M9.5 19.5v-5h5v5"/>',
    // a folder, for the things that are none of the above
    etc: '<path d="M3.5 7.2a1.7 1.7 0 0 1 1.7-1.7h3.4l2 2.4h7.7a1.7 1.7 0 0 1 1.7 1.7v8.9a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7Z"/>'
  };
  var LEVELS = ['Any level', 'Beginner', 'Intermediate', 'Advanced'];

  // 50 MB is what a Supabase project allows per upload by default, and
  // the ceiling on the free plan. Raising it further means raising it in
  // the project first (Storage → Settings → Upload file size limit);
  // the server rejects anything over that whatever this file says.
  var MAX_BYTES = 50 * 1024 * 1024;
  var MAX_SIZE = {
    pdf: MAX_BYTES, doc: MAX_BYTES, docx: MAX_BYTES,
    png: MAX_BYTES, jpg: MAX_BYTES, jpeg: MAX_BYTES,
    mp3: MAX_BYTES, m4a: MAX_BYTES
  };
  var MIME_BY_EXT = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4'
  };
  var ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.mp3,.m4a';
  // A browser shows these on its own; a Word file only downloads.
  var PREVIEWABLE = { pdf: true, png: true, jpg: true, jpeg: true, mp3: true, m4a: true };
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
    // The project has its own ceiling, which it enforces whatever this
    // page allows; say where to raise it rather than leaving the raw text.
    if (/exceeded the maximum allowed size|payload too large|413/i.test(msg)) {
      return t('resources.errServerTooLarge', 'The project rejected this file for its size. Raise it in Supabase under Storage → Settings → Upload file size limit, then try again.');
    }
    return t('resources.errUploadFailed', 'Upload failed: {msg}').replace('{msg}', msg);
  }

  // A file named hangul-vi.pdf or hangul_ko.docx is almost certainly
  // that language; guessing saves picking it by hand for every file.
  function guessLang(name) {
    var base = String(name || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    for (var i = 0; i < LANGS.length; i++) {
      var code = LANGS[i].code.toLowerCase();
      var tail = new RegExp('[-_. ]' + code.replace('-', '[-_]?') + '$');
      if (tail.test(base)) return LANGS[i].code;
    }
    return null;
  }

  function siteLang() {
    return (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
  }

  // The language the visitor has chosen at the top of the page, resolved
  // without waiting for js/i18n.js to finish loading its dictionary —
  // same chain that engine uses, so a list can be built in the right
  // language on the first render instead of flipping to it a moment
  // later. Always one of the eight.
  function preferredLang() {
    var code = '';
    // Once js/i18n.js has applied a language, that is the answer — the
    // visitor may have changed it since the page opened, and a ?lang=
    // still sitting in the address bar is only how they arrived, not
    // what they want now.
    if (window.DURU_I18N && window.DURU_I18N.ready) {
      code = window.DURU_I18N.lang || '';
    } else {
      try {
        code = new URLSearchParams(location.search).get('lang') || '';
        if (!code) code = localStorage.getItem('duru_lang') || '';
      } catch (e) {}
    }
    if (!code) code = siteLang();
    return LANGS.some(function (l) { return l.code === code; }) ? code : 'en';
  }
  function langEntry(code) {
    return LANGS.filter(function (l) { return l.code === code; })[0] || { code: code, label: code, short: String(code || '').slice(0, 2).toUpperCase() };
  }
  function langLabel(code) { return langEntry(code).label; }
  function langShort(code) { return langEntry(code).short; }

  function categoryLabel(cat) { return t('resources.cat.' + cat, cat); }
  function categoryDescribe(cat) { return t('resources.cat.' + cat + '.desc', ''); }
  function categoryIcon(cat) { return CATEGORY_ICON[cat] || CATEGORY_ICON.etc; }
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
    MAX_SIZE: MAX_SIZE, MIME_BY_EXT: MIME_BY_EXT, COVER_MAX: COVER_MAX, ACCEPT: ACCEPT, PREVIEWABLE: PREVIEWABLE,
    t: t, escapeHTML: escapeHTML, fileExt: fileExt, formatSize: formatSize,
    schemaHint: schemaHint, uploadErrorText: uploadErrorText,
    siteLang: siteLang, preferredLang: preferredLang, langLabel: langLabel, langShort: langShort, langEntry: langEntry,
    categoryLabel: categoryLabel, categoryDescribe: categoryDescribe,
    categoryIcon: categoryIcon, levelLabel: levelLabel,
    localized: localized, availableFiles: availableFiles, guessLang: guessLang,
    coverUrl: coverUrl, coverHTML: coverHTML, signedUrl: signedUrl,
    pdfPageCount: pdfPageCount, isAdmin: isAdmin, openLogin: openLogin
  };
})();
