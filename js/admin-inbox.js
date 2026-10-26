// DURU KOREAN — the admin window: everything waiting for the owner's approval in one place
// (owner, 2026-10-24: "내 허락받고 올려야 하는 자료는 관리자창에서 모아서 보면서 쉽게 읽고 publish").
//
// Two tabs: downloads (resources that are not public yet) and blog posts (drafts). Each card shows what it is,
// whether it can go out, and opens to read it (the read-online text, or the post itself) and to look at the PDF.
// Publishing uses the same doors as everywhere else: resource-common.js publishResource() for a download
// (the database's checks still decide each language) and the post's own approved_at/published_at for a post.
// Nothing here goes round the database; it only gathers the work and says plainly what happened.
(function () {
  'use strict';

  var DRAFTS = 'resource-drafts';
  var READ_BASE = 'https://raw.githubusercontent.com/cck0688-stack/duru-korean/rework-output/read/';
  var LANG_NAMES = { en: 'English', ko: '한국어', vi: 'Tiếng Việt', es: 'Español', id: 'Indonesia', 'pt-BR': 'Português', ja: '日本語', zh: '中文', fr: 'Français', de: 'Deutsch' };

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var out = window.DURU_I18N.t(key);
    return out === key ? fallback : out;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function day(iso) { try { return new Date(iso).toLocaleDateString(); } catch (e) { return ''; } }
  function $(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', function () {
    var lists = { post: $('inboxList-post'), res: $('inboxList-res') };   // blog posts on the left, downloads on the right
    var listEl = lists.res;
    if (!listEl || !lists.post) return;
    var client = window.DURU_SUPABASE_CLIENT;
    var R = window.DURU_RES;
    if (!client || !R) return;

    var filter = 'all';
    var tab = 'post';                        // blog posts first (left), free downloads second (right)
    try { if (localStorage.getItem('duru_inbox_tab') === 'res') tab = 'res'; } catch (e) { /* no storage */ }
    var resources = [], posts = [];
    var selected = Object.create(null);     // id -> true, for the tab showing
    var openId = Object.create(null);       // cards that are open
    var readLang = Object.create(null);     // chosen language per card
    var said = Object.create(null);         // the last message per card, kept across redraws
    var postPick = Object.create(null);     // chosen reading language per post
    // English is where a post waiting for approval always opens (owner, 2026-10-25); the picker changes it for that card.
    function postLang(p) { var c = readableLangs(p); return postPick[p.id] && c.indexOf(postPick[p.id]) !== -1 ? postPick[p.id] : (c.indexOf('en') !== -1 ? 'en' : (c.indexOf(p.lang) !== -1 ? p.lang : c[0])); }

    /* ---------------- loading ---------------- */

    function loadResources() {
      return client.from('resources')
        .select('*, resource_files(*), resource_sources(*)')
        .neq('status', 'published').neq('status', 'rejected')
        .order('created_at', { ascending: false }).limit(300)
        .then(function (res) {
          if (res.error) { lists.res.innerHTML = '<p class="review-error">' + esc(res.error.message) + '</p>'; return; }
          resources = res.data || [];
        });
    }
    // The live database may not have schema §38 (posts.rejected_at) yet — the blog page copes with that
    // too (js/blog.js noRejected). Without the column every unpublished post is waiting, and "Reject" is not offered.
    var noRejected = false;
    function loadPosts() {
      function ask() {
        var cols = 'id,slug,title,excerpt,body,category,post_date,created_at,image_url,image_alt,image_credit,image_credit_url,image_source,tags,published,lang,i18n,mt,study,audiences' + (noRejected ? '' : ',rejected_at');
        var q = client.from('posts').select(cols).eq('published', false);
        if (!noRejected) q = q.is('rejected_at', null);
        return q.order('post_date', { ascending: false }).limit(300);
      }
      return ask().then(function (res) {
        if (res.error && !noRejected && /rejected_at/.test(res.error.message || '')) { noRejected = true; return ask(); }
        return res;
      }).then(function (res) { posts = res.error ? [] : (res.data || []); if (res.error) lists.post.insertAdjacentHTML('beforebegin', '<p class="review-error">' + esc(res.error.message) + '</p>'); });
    }
    function loadAll() {
      return Promise.all([loadResources(), loadPosts()]).then(function () {
        $('inboxCountRes').textContent = resources.length;
        $('inboxCountPost').textContent = posts.length;
        render();
      });
    }

    /* ---------------- what a download is like ---------------- */

    function newestPerLang(row) {
      var by = {};
      (row.resource_files || []).forEach(function (f) {
        if (!by[f.lang] || (f.version || 1) > (by[f.lang].version || 1)) by[f.lang] = f;
      });
      var order = ['en', 'ko', 'vi', 'es', 'id', 'pt-BR', 'ja', 'zh', 'fr', 'de'];
      return order.filter(function (l) { return by[l]; }).map(function (l) { return by[l]; })
        .concat(Object.keys(by).filter(function (l) { return order.indexOf(l) < 0; }).map(function (l) { return by[l]; }));
    }
    function langState(row, f) {
      // live | ready | blocked
      if (f.published) return { s: 'live', why: t('adminInbox.live', 'Already public') };
      var why = [];
      if (!f.draft_key) why.push(t('review.block.noFile', 'The PDF is missing.'));
      var c = f.check_result || {};
      if (c.ok !== true) why.push((c.why && c.why[0]) || t('review.block.check', 'The automatic check on the PDF did not pass.'));
      if ((row.resource_sources || []).some(function (s) { return s.rights_status === 'forbidden'; })) why.push(t('review.block.forbidden', 'A source is marked as not usable.'));
      return why.length ? { s: 'blocked', why: why.join(' · ') } : { s: 'ready', why: t('adminInbox.ready', 'Ready') };
    }
    function summary(row) {
      var files = newestPerLang(row), n = { live: 0, ready: 0, blocked: 0 };
      files.forEach(function (f) { n[langState(row, f).s] += 1; });
      return { files: files, n: n };
    }


    /* ---------------- a post as readers see it (the same pieces js/blog.js uses) ---------------- */

    var MT = window.DURU_MT;
    var MD_HEAD = /^\s*#{1,4}\s+/;
    var MD_HEAD_NUMBERED = /^\s*\d{1,3}[.)]\s*#{1,4}\s+/;
    function postLangs(p) {
      var have = {}; have[p.lang || 'en'] = true;
      var tr = p.i18n || {};
      Object.keys(tr).forEach(function (c) { if (tr[c] && typeof tr[c].body === 'string' && tr[c].body.trim()) have[c] = true; });
      return R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return have[c]; });
    }
    function readableLangs(p) {
      var have = {}; postLangs(p).forEach(function (c) { have[c] = true; });
      if (MT) R.LANGS.forEach(function (l) { if (!have[l.code] && MT.paired(p, l.code)) have[l.code] = true; });
      return R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return have[c]; });
    }
    function readField(p, name, lang) {
      var own = (p.i18n && p.i18n[lang] && p.i18n[lang][name]) || '';
      if (own && String(own).trim()) return own;
      if (postLangs(p).indexOf(lang) !== -1) return R.localized(p, name, lang);
      var mt = MT && MT.head(p, lang, name);
      return mt || R.localized(p, name, lang);
    }
    function paragraphs(text) {
      return window.DURU_MARKDOWN ? window.DURU_MARKDOWN.render(text) : '<p>' + esc(text) + '</p>';
    }
    function bilingualHTML(pairs, srcLang, outLang) {
      return pairs.map(function (para) {
        return '<p class="mt-para">' + para.map(function (pair) {
          var head = MD_HEAD.test(pair.src);
          var src = head ? String(pair.src).replace(MD_HEAD, '') : pair.src;
          var out = pair.out;
          if (head) out = String(pair.out == null ? '' : pair.out).replace(MD_HEAD_NUMBERED, '').replace(MD_HEAD, '');
          return '<span class="mt-line' + (head ? ' mt-line--head' : '') + '">' +
            '<span class="mt-src" lang="' + esc(srcLang) + '">' + esc(src) + '</span>' +
            '<span class="mt-out" lang="' + esc(outLang) + '">' + esc(out) + '</span></span>';
        }).join('') + '</p>';
      }).join('');
    }
    function studyHTML(p, lang) {
      if (!MT || (p.lang || 'en') !== 'ko' || lang === 'ko') return '';
      var words = MT.studyFor(p, lang);
      if (!words) return '';
      return '<section class="study"><h2 class="study-title"><span class="dia" aria-hidden="true"></span><span class="study-label">' +
        esc(t('study.heading', 'Words & Phrases')) + '</span><span class="dia" aria-hidden="true"></span></h2>' +
        '<ol class="study-list">' + words.map(function (w) {
          var e = w.by[lang];
          return '<li class="study-word"><div class="study-head"><span class="study-term" lang="ko">' + esc(w.word) + '</span>' +
            (w.romanization ? '<span class="study-rom">' + esc(w.romanization) + '</span>' : '') +
            (w.pos ? '<span class="study-pos">' + esc(w.pos) + '</span>' : '') + '</div>' +
            '<p class="study-meaning" lang="' + esc(lang) + '">' + esc(e.meaning) + '</p>' +
            (e.explanation ? '<p class="study-note" lang="' + esc(lang) + '">' + esc(e.explanation) + '</p>' : '') +
            (w.sentence ? '<p class="study-source" lang="ko">' + esc(w.sentence) + '</p>' : '') + '</li>';
        }).join('') + '</ol></section>';
    }
    function postView(p, lang) {
      var written = postLangs(p);
      var pairs = written.indexOf(lang) === -1 && MT ? MT.paired(p, lang) : null;
      var body = pairs ? bilingualHTML(pairs, p.lang || 'en', lang) : paragraphs(R.localized(p, 'body', lang));
      var title = readField(p, 'title', lang);
      var srcTitle = R.localized(p, 'title', p.lang || 'en');
      var own = p.tags || [];
      var shown = (MT && MT.tagsFor(p, lang)) || own;
      return '<header class="post-head"><p class="post-head-cat"><span class="dia" aria-hidden="true"></span><span class="blog-meta">' +
          esc(R.categoryLabel ? p.category : p.category) + '</span><span class="dia" aria-hidden="true"></span></p>' +
        '<div class="post-head-box"><h1>' + esc(title) + '</h1>' +
          (pairs && srcTitle !== title ? '<p class="mt-title-src" lang="' + esc(p.lang || 'en') + '">' + esc(srcTitle) + '</p>' : '') + '</div>' +
        '<div class="post-head-meta"><span class="blog-date">' + esc(p.post_date || day(p.created_at)) + '</span></div></header>' +
        (p.image_url ? '<figure class="post-photo"><img src="' + esc(p.image_url) + '" alt="' + esc(p.image_alt || '') + '" loading="lazy">' +
          (p.image_credit ? '<p class="post-photo-credit">' + esc(p.image_credit) + '</p>' : '') + '</figure>' : '') +
        '<div class="post-body' + (pairs ? ' post-body--mt' : '') + '">' + body + '</div>' +
        (own.length ? '<div class="post-tags">' + own.map(function (tag, i) { return '<span class="post-tag">#' + esc(shown[i] || tag) + '</span>'; }).join('') + '</div>' : '') +
        studyHTML(p, lang);
    }

    /* ---------------- drawing ---------------- */

    function chips(row) {
      var level = row.learning_level || row.level || '';
      return '<span class="inbox-chip">' + esc(R.categoryLabel(row.category)) + '</span>' +
        (level ? '<span class="inbox-chip inbox-chip--soft">' + esc(level) + '</span>' : '') +
        (row.minutes ? '<span class="inbox-chip inbox-chip--soft">' + esc(row.minutes) + ' ' + esc(t('review.minutes', 'min')) + '</span>' : '');
    }

    // The same Publish at the foot of an opened card, so nobody scrolls back up after reading to the end.
    function bottomBar(id, can) {
      return '<div class="inbox-bottom"><button type="button" class="btn btn-primary btn-lg inbox-publish" data-id="' + esc(id) + '"' + (can ? '' : ' disabled') + '>' +
        esc(t('adminInbox.publish', 'Publish')) + '</button>' +
        '<button type="button" class="btn btn-outline inbox-toggle" data-id="' + esc(id) + '">' + esc(t('adminInbox.close', 'Close')) + '</button></div>';
    }

    function resCard(row) {
      var sm = summary(row), id = row.id, isOpen = !!openId[id];
      var can = sm.n.ready > 0 || (sm.n.live > 0 && sm.n.blocked === 0 && sm.n.ready === 0);
      var badge = sm.n.ready === 0 && sm.n.live === 0
        ? '<span class="inbox-state inbox-state--bad">' + esc(t('adminInbox.cannot', 'Cannot go out yet')) + '</span>'
        : sm.n.blocked
          ? '<span class="inbox-state inbox-state--warn">' + esc(t('adminInbox.partial', 'Some languages are blocked')) + '</span>'
          : '<span class="inbox-state inbox-state--ok">' + esc(t('adminInbox.allReady', 'Ready to publish')) + '</span>';
      var dots = sm.files.map(function (f) {
        var st = langState(row, f);
        return '<span class="inbox-lang inbox-lang--' + st.s + '" title="' + esc(LANG_NAMES[f.lang] + ' — ' + st.why) + '">' + esc(String(f.lang).toUpperCase()) + '</span>';
      }).join('');
      var lang = readLang[id] || (sm.files[0] && sm.files[0].lang) || 'en';
      return '<article class="inbox-card' + (isOpen ? ' is-open' : '') + '" data-id="' + esc(id) + '">' +
        '<div class="inbox-row">' +
          '<label class="inbox-pick"><input type="checkbox" class="inbox-check" data-id="' + esc(id) + '"' + (selected[id] ? ' checked' : '') + (sm.n.ready || sm.n.live ? '' : ' disabled') + '></label>' +
          '<div class="inbox-main">' +
            '<h3 class="inbox-title">' + esc(row.title) + '</h3>' +
            '<div class="inbox-meta">' + chips(row) + '<span class="inbox-date">' + esc(day(row.created_at)) + '</span>' + badge + '</div>' +
            '<div class="inbox-langs">' + dots + '</div>' +
          '</div>' +
          '<div class="inbox-actions">' +
            '<button type="button" class="btn btn-outline inbox-toggle" data-id="' + esc(id) + '">' + esc(isOpen ? t('adminInbox.close', 'Close') : t('adminInbox.read', 'Read')) + '</button>' +
            '<button type="button" class="btn btn-primary inbox-publish" data-id="' + esc(id) + '"' + (can ? '' : ' disabled') + '>' + esc(t('adminInbox.publish', 'Publish')) + '</button>' +
          '</div>' +
        '</div>' +
        '<p class="inbox-says" data-says="' + esc(id) + '"></p>' +
        (isOpen
          ? '<div class="inbox-open">' +
              '<div class="inbox-open-bar">' +
                '<label>' + esc(t('adminInbox.language', 'Language')) + ' <select class="inbox-lang-pick" data-id="' + esc(id) + '">' +
                  sm.files.map(function (f) { return '<option value="' + esc(f.lang) + '"' + (f.lang === lang ? ' selected' : '') + '>' + esc(LANG_NAMES[f.lang] || f.lang) + '</option>'; }).join('') +
                '</select></label>' +
                '<button type="button" class="btn btn-ghost inbox-changes" data-id="' + esc(id) + '">' + esc(t('review.changes', 'Needs changes')) + '</button>' +
                '<button type="button" class="btn btn-ghost inbox-reject" data-id="' + esc(id) + '">' + esc(t('review.reject', 'Reject')) + '</button>' +
              '</div>' +
              '<div class="inbox-why" data-why-for="' + esc(id) + '"></div>' +
              '<div class="inbox-split">' +
                '<div class="inbox-read" data-read-for="' + esc(id) + '"><p class="review-none">…</p></div>' +
                '<div class="inbox-pdf" data-pdf-for="' + esc(id) + '"><p class="review-none">…</p></div>' +
              '</div>' +
              bottomBar(id, can) +
            '</div>'
          : '') +
      '</article>';
    }

    function postCard(p) {
      var id = p.id, isOpen = !!openId[id];
      return '<article class="inbox-card' + (isOpen ? ' is-open' : '') + '" data-id="' + esc(id) + '">' +
        '<div class="inbox-row">' +
          '<label class="inbox-pick"><input type="checkbox" class="inbox-check" data-id="' + esc(id) + '"' + (selected[id] ? ' checked' : '') + '></label>' +
          '<div class="inbox-main">' +
            '<h3 class="inbox-title">' + esc(p.title) + '</h3>' +
            '<div class="inbox-meta"><span class="inbox-chip">' + esc(p.category || '') + '</span><span class="inbox-date">' + esc(p.post_date || day(p.created_at)) + '</span></div>' +
            (p.excerpt ? '<p class="inbox-excerpt">' + esc(p.excerpt) + '</p>' : '') +
          '</div>' +
          '<div class="inbox-actions">' +
            '<button type="button" class="btn btn-outline inbox-toggle" data-id="' + esc(id) + '">' + esc(isOpen ? t('adminInbox.close', 'Close') : t('adminInbox.read', 'Read')) + '</button>' +
            '<button type="button" class="btn btn-primary inbox-publish" data-id="' + esc(id) + '">' + esc(t('adminInbox.publish', 'Publish')) + '</button>' +
          '</div>' +
        '</div>' +
        '<p class="inbox-says" data-says="' + esc(id) + '"></p>' +
        (isOpen
          ? '<div class="inbox-open"><div class="inbox-open-bar">' +
              '<label>' + esc(t('blog.readIn', 'Read in')) + ' <select class="inbox-post-lang" data-id="' + esc(id) + '">' +
                readableLangs(p).map(function (c) { return '<option value="' + esc(c) + '"' + (c === postLang(p) ? ' selected' : '') + '>' + esc(R.langLabel(c)) + '</option>'; }).join('') +
              '</select></label>' +
              (noRejected ? '' : '<button type="button" class="btn btn-ghost inbox-reject" data-id="' + esc(id) + '">' + esc(t('review.reject', 'Reject')) + '</button>') + '</div>' +
              '<div class="inbox-post-view blog-single">' + postView(p, postLang(p)) + '</div>' +
              bottomBar(id, true) + '</div>'
          : '') +
      '</article>';
    }

    function shownResources() {
      return resources.filter(function (r) { return filter === 'all' || r.category === filter; });
    }

    function render() {
      var fl = $('inboxFilters');
      var cats = {}; resources.forEach(function (r) { cats[r.category] = (cats[r.category] || 0) + 1; });
      fl.innerHTML = ['all'].concat(Object.keys(cats).sort()).map(function (c) {
        var n = c === 'all' ? resources.length : cats[c];
        return '<button type="button" class="inbox-filter' + (filter === c ? ' is-on' : '') + '" data-cat="' + esc(c) + '">' +
          esc(c === 'all' ? t('adminInbox.all', 'All') : R.categoryLabel(c)) + ' <b>' + n + '</b></button>';
      }).join('');
      var rows = shownResources();
      $('inboxEmpty-res').hidden = rows.length > 0;
      lists.res.innerHTML = rows.map(resCard).join('');
      $('inboxEmpty-post').hidden = posts.length > 0;
      lists.post.innerHTML = posts.map(postCard).join('');
      Object.keys(said).forEach(paintSays);
      updateBar('res'); updateBar('post');
      Object.keys(openId).forEach(function (id) { if (openId[id] && resources.some(function (r) { return r.id === id; })) fillOpen(id); });
    }

    function shownIds(kind) {
      return (kind === 'res' ? shownResources() : posts).map(function (r) { return r.id; });
    }
    function updateBar(kind) {
      var mine = shownIds(kind);
      var n = Object.keys(selected).filter(function (k) { return selected[k] && mine.indexOf(k) !== -1; }).length;
      $('inboxSelN-' + kind).textContent = n ? '(' + n + ')' : '';
      $('inboxPublishSel-' + kind).disabled = !n;
      $('inboxAll-' + kind).checked = n > 0 && mine.every(function (id) { return selected[id] || !canSelect(id); });
    }
    function canSelect(id) {
      var el = document.querySelector('.inbox-check[data-id="' + id + '"]');
      return !!el && !el.disabled;
    }
    function paintSays(id) {
      var el = document.querySelector('[data-says="' + id + '"]');
      var m = said[id];
      if (!el) return;
      el.textContent = m ? m.text : '';
      el.className = 'inbox-says' + (m ? ' inbox-says--' + (m.kind || 'info') : '');
    }
    function say(id, text, kind) { said[id] = text ? { text: text, kind: kind } : null; paintSays(id); }

    /* ---------------- opening one download: its text and its PDF ---------------- */

    function flat(x) {
      if (x == null) return '';
      if (typeof x === 'string' || typeof x === 'number') return String(x);
      if (Array.isArray(x)) return x.map(flat).filter(Boolean).join(' / ');
      return Object.keys(x).filter(function (k) { return ['plain', 'tone', 'icon', 'pill', 'style', 'level', 'lines', 'write'].indexOf(k) < 0; })
        .map(function (k) { return flat(x[k]); }).filter(Boolean).join(' ');
    }
    function readHTML(d) {
      function sec(title, inner) { return '<h5>' + esc(title) + '</h5>' + inner; }
      function ul(items) { return '<ul>' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'; }
      var h = '<p class="inbox-read-title"><b>' + esc(d.title) + '</b></p>' + (d.objective ? '<p>' + esc(d.objective) + '</p>' : '');
      if (d.letters) h += sec('Letters', ul(d.letters.map(function (l) { return '<b>' + esc(l.letter) + '</b> — ' + esc(l.sound) + (l.as ? ' · ' + esc(l.as) : ''); })));
      if (d.words) h += sec('Words', ul(d.words.map(function (w) { return '<b>' + esc(w.korean) + '</b> ' + esc(w.meaning || '') + (w.example ? ' — ' + esc(w.example) : ''); })));
      if (d.forms) h += sec('Forms', ul(d.forms.map(function (f) { return esc(flat(f)); })));
      if (d.dialogue) h += sec('Dialogue', ul(d.dialogue.map(function (f) { return esc(flat(f)); })));
      if (d.passage) h += sec('Passage', ul((Array.isArray(d.passage) ? d.passage : [d.passage]).map(function (f) { return esc(flat(f)); })));
      if (d.sections) h += sec('Sections', ul(d.sections.map(function (f) { return esc(flat(f)); })));
      if (d.exercises) h += sec('Exercises', '<ol>' + d.exercises.map(function (q) { return '<li>' + esc(flat(q)) + '</li>'; }).join('') + '</ol>');
      if (d.answers) h += sec('Answers', '<ol>' + d.answers.map(function (q) { return '<li>' + esc(flat(q)) + '</li>'; }).join('') + '</ol>');
      return h;
    }
    function fillOpen(id) {
      var row = resources.filter(function (r) { return r.id === id; })[0];
      if (!row) return;
      var files = newestPerLang(row);
      var lang = readLang[id] || (files[0] && files[0].lang) || 'en';
      var file = files.filter(function (f) { return f.lang === lang; })[0];
      var why = document.querySelector('[data-why-for="' + id + '"]');
      if (why && file) {
        var st = langState(row, file);
        why.innerHTML = st.s === 'blocked' ? '<p class="inbox-block">' + esc(st.why) + '</p>' : '';
      }
      var readEl = document.querySelector('[data-read-for="' + id + '"]');
      if (readEl) {
        fetch(READ_BASE + id + '/' + lang + '.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
          .then(function (d) { readEl.innerHTML = d ? readHTML(d) : '<p class="review-none">' + esc(t('review.noRead', 'No read-online file yet for this language.')) + '</p>'; });
      }
      var pdfEl = document.querySelector('[data-pdf-for="' + id + '"]');
      if (pdfEl) {
        if (!file || !file.draft_key) { pdfEl.innerHTML = '<p class="review-none">' + esc(t('review.noPdf', 'There is no PDF on this one.')) + '</p>'; return; }
        client.storage.from(DRAFTS).createSignedUrl(file.draft_key.replace(/^resource-drafts\//, ''), 600).then(function (res) {
          if (res.error || !res.data) { pdfEl.innerHTML = '<p class="review-none">' + esc(res.error ? res.error.message : '') + '</p>'; return; }
          pdfEl.innerHTML = '<iframe class="inbox-frame" src="' + esc(res.data.signedUrl) + '" title="PDF" loading="lazy"></iframe>' +
            '<a class="review-open" href="' + esc(res.data.signedUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(t('review.openPdf', 'Open it full size')) + '</a>';
        });
      }
    }

    /* ---------------- publishing ---------------- */

    var CHECKED = function () { return t('admin.checkedNote', 'Checked and published from the list by an admin.'); };

    function publishResource(id) {
      var row = resources.filter(function (r) { return r.id === id; })[0];
      if (!row) return Promise.resolve();
      say(id, t('admin.publishing', 'Publishing…'), 'info');
      return R.publishResource(client, id, CHECKED()).then(function (refused) {
        if (refused.length && refused.partial) say(id, t('admin.publishedExcept', 'Published. Not included: {why}').replace('{why}', refused.join(' · ')), 'ok');
        else if (refused.length) say(id, t('admin.refused', 'Not published: {why}').replace('{why}', refused.join(' · ')), 'bad');
        else say(id, t('admin.published', 'Published.'), 'ok');
        return !refused.length || refused.partial;
      }).catch(function (err) { say(id, (err && err.message) || String(err), 'bad'); return false; });
    }
    function publishPost(id) {
      var now = new Date().toISOString();
      say(id, t('admin.publishing', 'Publishing…'), 'info');
      return client.from('posts').update({ published: true, approved_at: now, published_at: now, updated_at: now }).eq('id', id)
        .then(function (res) {
          if (res.error) { say(id, res.error.message, 'bad'); return false; }
          say(id, t('admin.published', 'Published.'), 'ok');
          return true;
        });
    }
    function kindOfId(id) { return posts.some(function (p) { return p.id === id; }) ? 'post' : 'res'; }
    function publishOne(id) { return (kindOfId(id) === 'res' ? publishResource : publishPost)(id); }

    function afterPublish() { setTimeout(function () { selected = Object.create(null); loadAll(); }, 900); }

    /* ---------------- wiring ---------------- */

    function showTab() {
      document.querySelectorAll('.inbox-tab').forEach(function (b) { b.classList.toggle('is-on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'); });
      document.querySelectorAll('.inbox-col').forEach(function (c) { c.hidden = c.dataset.kind !== tab; });
    }
    document.querySelectorAll('.inbox-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        tab = b.dataset.tab; showTab();
        try { localStorage.setItem('duru_inbox_tab', tab); } catch (e) { /* no storage */ }
      });
    });
    showTab();
    $('inboxRefresh').addEventListener('click', loadAll);
    $('inboxFilters').addEventListener('click', function (e) {
      var b = e.target.closest('.inbox-filter'); if (!b) return;
      filter = b.dataset.cat; selected = Object.create(null); render();
    });
    ['post', 'res'].forEach(function (kind) {
      $('inboxAll-' + kind).addEventListener('change', function () {
        var on = this.checked;
        shownIds(kind).forEach(function (id) { if (canSelect(id)) selected[id] = on; });
        render();
      });
      $('inboxPublishSel-' + kind).addEventListener('click', function () {
        var mine = shownIds(kind);
        var ids = Object.keys(selected).filter(function (k) { return selected[k] && mine.indexOf(k) !== -1; });
        if (!ids.length) return;
        if (!window.confirm(t('adminInbox.confirmMany', 'Publish {n} items? Publishing records that you have checked them.').replace('{n}', ids.length))) return;
        var msg = $('inboxBarMsg-' + kind), done = 0, ok = 0;
        this.disabled = true;
        var chain = Promise.resolve();
        ids.forEach(function (id) {
          chain = chain.then(function () {
            msg.textContent = (done + 1) + ' / ' + ids.length + '…';
            return publishOne(id).then(function (good) { done += 1; if (good) ok += 1; });
          });
        });
        chain.then(function () {
          msg.textContent = t('adminInbox.doneMany', '{ok} of {n} published.').replace('{ok}', ok).replace('{n}', ids.length);
          afterPublish();
        });
      });

      lists[kind].addEventListener('click', function (e) {
        var tg = e.target.closest('button'); if (!tg || !tg.dataset.id) return;
        var id = tg.dataset.id;
        if (tg.classList.contains('inbox-toggle')) { openId[id] = !openId[id]; render(); return; }
        if (tg.classList.contains('inbox-publish')) {
          var title = (kind === 'res' ? resources : posts).filter(function (r) { return r.id === id; })[0];
          if (!window.confirm(t('admin.confirmPublish', 'Publish “{title}”? Publishing records that you have checked what it says.').replace('{title}', title ? title.title : ''))) return;
          document.querySelectorAll('.inbox-publish[data-id="' + id + '"]').forEach(function (x) { x.disabled = true; });
          publishOne(id).then(function (good) {
            if (good) afterPublish();
            else document.querySelectorAll('.inbox-publish[data-id="' + id + '"]').forEach(function (x) { x.disabled = false; });
          });
          return;
        }
        if (tg.classList.contains('inbox-reject')) {
          if (!window.confirm(t('review.confirmReject', 'Reject this draft?'))) return;
          var op = kind === 'res'
            ? R.rejectResource(client, id, null)
            : client.from('posts').update({ rejected_at: new Date().toISOString() }).eq('id', id).then(function (r) { if (r.error) throw r.error; });
          op.then(loadAll).catch(function (err) { say(id, (err && err.message) || String(err), 'bad'); });
          return;
        }
        if (tg.classList.contains('inbox-changes')) {
          var why = window.prompt(t('review.whatChanges', 'What needs changing?'));
          if (why === null) return;
          client.from('resources').update({ status: 'changes', updated_at: new Date().toISOString() }).eq('id', id)
            .then(function () { return client.from('resource_reviews').insert([{ resource_id: id, action: 'changes', note: why || null }]); })
            .then(loadAll);
        }
      });
      lists[kind].addEventListener('change', function (e) {
        var c = e.target;
        if (c.classList.contains('inbox-check')) { selected[c.dataset.id] = c.checked; updateBar(kind); }
        if (c.classList.contains('inbox-lang-pick')) { readLang[c.dataset.id] = c.value; fillOpen(c.dataset.id); }
        if (c.classList.contains('inbox-post-lang')) { postPick[c.dataset.id] = c.value; render(); }
      });
    });
    document.addEventListener('duru:langchange', function () { render(); });

    /* ---------------- who is asking ---------------- */

    client.auth.getSession().then(function (res) {
      var me = res.data && res.data.session && res.data.session.user;
      if (!me) { $('adminNotAuthorized').hidden = false; return; }
      return client.from('admin_users').select('user_id').eq('user_id', me.id).maybeSingle().then(function (row) {
        if (!(row && row.data)) { $('adminNotAuthorized').hidden = false; return; }
        $('adminNotAuthorized').hidden = true;
        $('adminContent').hidden = false;
        return loadAll();
      });
    });
  });
})();
