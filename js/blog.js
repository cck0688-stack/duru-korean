// DURU KOREAN — blog posts (Supabase-backed)
//
// Include after js/auth.js and js/resource-common.js on blog.html. The
// language table, the label helpers and the i18n lookup are shared with
// the downloads pages so there is one list of languages on the site.
//
// A post is one piece of writing, however many languages it is written
// in: `lang` names the language its own columns are in and `i18n` holds
// a translation per language. The list filters by language the way the
// downloads do, and the post's own view lets a reader switch without
// changing the language of the site around it.
//
// Everyone sees published posts;
// only a user listed in admin_users can write, edit, or delete one — and
// that is enforced by Row Level Security in supabase/schema.sql, not by
// this file hiding a button. A draft is invisible to visitors because the
// public select policy filters on `published`, so an unfinished post is
// never one stray link away from being read.
//
// Single posts are addressed as blog.html?post=<slug>; a static host has
// no routing, so the query string is the only thing available.

(function () {
  'use strict';

  var R = window.DURU_RES;
  if (!R) return;

  var CATEGORIES = ['culture', 'travel', 'food', 'trends', 'language', 'etc'];
  // Each category's Hangul glyph, matching the static design.
  var GLYPH = { culture: '삶', travel: '길', food: '맛', trends: '멋', language: '말', etc: '기' };

  var STATE_KEY = 'duru_blog_state';
  var RETURN_KEY = 'duru_blog_return';

  // The languages a post can actually be read in: its own, plus every
  // translation that has a body. A translation with only a title filled
  // in is not offered, so nobody lands on an empty page.
  function postLangs(post) {
    var have = {};
    have[post.lang || 'en'] = true;
    var tr = post.i18n || {};
    Object.keys(tr).forEach(function (code) {
      if (tr[code] && typeof tr[code].body === 'string' && tr[code].body.trim()) have[code] = true;
    });
    return R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return have[c]; });
  }

  // Title, excerpt and body in one language, falling back to the post's
  // own columns — the same rule the downloads use for their titles.
  function field(post, name, lang) {
    return R.localized(post, name, lang);
  }

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

  // "schema cache" in a PostgREST error means a column the page expects
  // does not exist in the database yet — the migration has not been run.
  // Saying so beats leaving the admin to decode the raw message.
  function schemaHint(msg) {
    msg = String(msg || '');
    return /schema cache/i.test(msg)
      ? msg + ' — ' + t('common.schemaHint', 'The database has not been updated yet. Run supabase/schema.sql in the Supabase SQL editor, then try again.')
      : msg;
  }

  function countByCategory(list, cat) {
    return list.filter(function (p) { return p.category === cat; }).length;
  }

  // Tags are typed as one comma-separated field and stored as an array.
  function parseTags(input) {
    var seen = Object.create(null);
    return String(input || '').split(',').map(function (s) {
      return s.trim().replace(/^#/, '');
    }).filter(function (s) {
      if (!s || s.length > 32 || seen[s.toLowerCase()]) return false;
      seen[s.toLowerCase()] = true;
      return true;
    }).slice(0, 8);
  }

  function renderTags(tags) {
    if (!tags || !tags.length) return '';
    return '<div class="post-tags">' + tags.map(function (tag) {
      return '<a class="post-tag" href="blog.html?tag=' + encodeURIComponent(tag) + '">#' +
        escapeHTML(tag) + '</a>';
    }).join('') + '</div>';
  }

  // Post bodies are Markdown. The renderer escapes before it marks up, so
  // this stays safe; if markdown.js is missing, the fallback still escapes
  // everything itself and simply shows the source syntax.
  function paragraphs(text) {
    if (window.DURU_MARKDOWN) return window.DURU_MARKDOWN.render(text);
    return String(text || '').split(/\n{2,}/).map(function (block) {
      return '<p>' + escapeHTML(block.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function categoryLabel(cat) {
    return t('blog.cat.' + cat, cat);
  }

  function formatDate(iso) {
    try {
      var lang = (window.DURU_I18N && window.DURU_I18N.lang) || document.documentElement.lang || 'en';
      return new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return String(iso || '').slice(0, 10);
    }
  }

  // A slug has to be unique and URL-safe. Latin titles keep their words;
  // a Korean or Japanese title reduces to nothing usable, so fall back to
  // the random suffix alone rather than percent-encoding the whole title.
  function makeSlug(title) {
    var base = String(title || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    var suffix = Math.random().toString(36).slice(2, 8);
    return base ? base + '-' + suffix : suffix;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listEl = document.getElementById('blogList');
    var emptyEl = document.getElementById('blogEmpty');
    var emptyText = document.getElementById('blogEmptyText');
    var suggestEl = document.getElementById('blogLangSuggest');
    var singleEl = document.getElementById('blogSingle');
    var toolbarEl = document.getElementById('blogToolbar');
    var leadInEl = document.querySelector('.section-lead-in');
    var filtersEl = document.getElementById('blogFilters');
    var langSel = document.getElementById('blogLang');
    var writeBtn = document.getElementById('writePostBtn');
    if (!listEl) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    var isAdmin = false;
    var activeFilter = 'all';
    var listLang = 'en';
    // The language the post being read is shown in. `readPick` is set
    // only when the reader chooses one from the post's own picker; it
    // never touches the site language, so reading one post in Korean
    // does not translate the site around it.
    var readLang = null;
    var readPick = null;
    // Set from ?tag= and never changed after load: a tag filter is a
    // distinct URL, so it stays shareable and survives a reload.
    var activeTag = new URLSearchParams(location.search).get('tag') || '';
    var posts = [];

    try {
      var saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (saved.cat) activeFilter = saved.cat;
        if (saved.lang) listLang = saved.lang;
      }
    } catch (e) {}

    function saveState(extra) {
      try {
        var st = { cat: activeFilter, lang: listLang };
        if (extra) Object.keys(extra).forEach(function (k) { st[k] = extra[k]; });
        sessionStorage.setItem(STATE_KEY, JSON.stringify(st));
      } catch (e) {}
    }

    // Every language the site speaks, in the picker's order, whether or
    // not a post exists in it yet; English is the default. Same as the
    // downloads list, so the two pages behave alike.
    function buildLangSelect() {
      if (!langSel) return;
      langSel.innerHTML = R.LANGS.map(function (l) {
        return '<option value="' + escapeHTML(l.code) + '">' + escapeHTML(l.label) + '</option>';
      }).join('');
      if (!R.LANGS.some(function (l) { return l.code === listLang; })) listLang = 'en';
      langSel.value = listLang;
    }

    // Which languages the posts passing the category and tag filters are
    // written in — used to point somewhere useful when the chosen one
    // has nothing.
    function langsPresent() {
      var seen = {};
      posts.filter(matchesFilters).forEach(function (p) {
        postLangs(p).forEach(function (c) { seen[c] = true; });
      });
      return R.LANGS.map(function (l) { return l.code; }).filter(function (c) { return seen[c]; });
    }

    function matchesFilters(p) {
      if (activeFilter !== 'all' && p.category !== activeFilter) return false;
      if (activeTag) {
        return (p.tags || []).some(function (tag) {
          return tag.toLowerCase() === activeTag.toLowerCase();
        });
      }
      return true;
    }

    /* ---------------- Rendering ---------------- */

    function renderCategoryHero() {
      if (activeFilter === 'all' || !listEl.parentElement) return;
      var heroDiv = listEl.parentElement.querySelector('.blog-category-hero');
      if (!heroDiv) {
        heroDiv = document.createElement('div');
        heroDiv.className = 'blog-category-hero';
        listEl.parentElement.insertBefore(heroDiv, listEl);
      }
      var desc = t('blog.cat.' + activeFilter + '.desc', '');
      heroDiv.innerHTML = desc ? '<p>' + escapeHTML(desc) + '</p>' : '';
      heroDiv.hidden = !desc;
    }

    function renderTagBanner() {
      if (!listEl.parentElement) return;
      var banner = listEl.parentElement.querySelector('.blog-tag-banner');
      if (!activeTag) { if (banner) banner.remove(); return; }
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'blog-tag-banner';
        listEl.parentElement.insertBefore(banner, listEl);
      }
      banner.innerHTML =
        '<span>' + escapeHTML(t('blog.taggedWith', 'Tagged')) + ' <strong>#' +
          escapeHTML(activeTag) + '</strong></span>' +
        '<a href="blog.html">' + escapeHTML(t('blog.clearTag', 'Clear')) + '</a>';
    }

    function renderCards() {
      var shown = posts.filter(function (p) {
        return matchesFilters(p) && postLangs(p).indexOf(listLang) !== -1;
      });
      renderCategoryHero();
      renderTagBanner();
      listEl.innerHTML = shown.map(cardHTML).join('');

      if (shown.length) {
        emptyEl.hidden = true;
      } else {
        emptyEl.hidden = false;
        // Nothing in this language: name the ones that do have a post,
        // as buttons, rather than leaving a dead end.
        var others = langsPresent().filter(function (c) { return c !== listLang; });
        if (others.length) {
          emptyText.textContent = t('blog.noneInLang', 'Nothing here in {lang} yet.')
            .replace('{lang}', R.langLabel(listLang));
          suggestEl.innerHTML = '<span class="res-lang-suggest-label">' +
            escapeHTML(t('resources.availableIn', 'Available in')) + '</span>' +
            others.map(function (c) {
              return '<button type="button" class="btn btn-ghost" data-lang="' + escapeHTML(c) + '">' +
                escapeHTML(R.langLabel(c)) + '</button>';
            }).join('');
          suggestEl.hidden = false;
        } else {
          emptyText.textContent = t('blog.emptyNote', 'No posts yet — the first one is on its way.');
          suggestEl.innerHTML = '';
          suggestEl.hidden = true;
        }
      }

      listEl.querySelectorAll('a[href^="blog.html?post="]').forEach(function (a) {
        a.addEventListener('click', function () {
          saveState({ scrollY: window.scrollY });
          try { sessionStorage.setItem(RETURN_KEY, '1'); } catch (e) {}
        });
      });
    }

    // One compact row per post, the same shape a download's card has:
    // a 64px glyph square, then title, excerpt, category · date, and the
    // languages it is written in. The title's link is stretched over the
    // card in CSS, so the whole card opens the post with one tab stop.
    function cardHTML(p) {
      var href = 'blog.html?post=' + encodeURIComponent(p.slug) + '&pl=' + encodeURIComponent(listLang);
      var codes = postLangs(p);
      var shown = codes.slice(0, 3);
      var more = codes.length - shown.length;
      var excerpt = field(p, 'excerpt', listLang);
      return '<article class="res-card' + (p.published ? '' : ' res-card--draft') + '">' +
        '<span class="res-thumb"><span class="res-cover-glyph kr" aria-hidden="true">' +
          escapeHTML(GLYPH[p.category] || '') + '</span></span>' +
        '<div class="res-card-body">' +
          (p.published ? '' : '<span class="res-draft">' + escapeHTML(t('blog.draft', 'Draft')) + '</span>') +
          '<h3><a href="' + href + '">' + escapeHTML(field(p, 'title', listLang)) + '</a></h3>' +
          (excerpt ? '<p class="res-card-desc">' + escapeHTML(excerpt) + '</p>' : '') +
          '<p class="res-meta">' + escapeHTML(categoryLabel(p.category) + ' · ' + formatDate(p.created_at)) + '</p>' +
          '<div class="res-card-foot">' +
            '<span class="res-langs" aria-label="' + escapeHTML(t('blog.writtenIn', 'Written in')) + '">' +
              shown.map(function (c) { return '<span class="res-chip">' + escapeHTML(R.langShort(c)) + '</span>'; }).join('') +
              (more > 0 ? '<span class="res-chip res-chip--more">+' + more + '</span>' : '') +
            '</span>' +
            '<span class="res-view">' + escapeHTML(t('blog.readMore', 'Read more')) + ' →</span>' +
          '</div>' +
        '</div>' +
      '</article>';
    }

    function restoreScroll() {
      var back = false;
      try { back = sessionStorage.getItem(RETURN_KEY) === '1'; sessionStorage.removeItem(RETURN_KEY); } catch (e) {}
      if (!back) return;
      try {
        var st = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
        if (st && typeof st.scrollY === 'number') window.scrollTo(0, st.scrollY);
      } catch (e) {}
    }

    function findPost(id) {
      return posts.filter(function (p) { return String(p.id) === String(id); })[0];
    }

    function renderSingle(post) {
      if (!singleEl) return;
      singleEl.hidden = false;
      listEl.hidden = true;
      if (toolbarEl) toolbarEl.hidden = true;
      if (leadInEl) leadInEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      var postUrl = location.origin + location.pathname + '?post=' + encodeURIComponent(post.slug);

      // Which language to read it in: the one asked for in ?pl=, else
      // the language of the site, else the one it was written in. When
      // the wanted language is missing the page says so instead of
      // silently showing something else.
      var codes = postLangs(post);
      // Resolved from scratch on every render: were the reader's own
      // choice allowed to stand in for what they asked for, the notice
      // below would vanish the first time anything re-rendered.
      var wanted = readPick ||
        new URLSearchParams(location.search).get('pl') ||
        (window.DURU_I18N && window.DURU_I18N.lang) || 'en';
      var missing = codes.indexOf(wanted) === -1;
      readLang = missing ? (codes.indexOf(post.lang) !== -1 ? post.lang : codes[0]) : wanted;

      var langHTML = '';
      if (codes.length > 1 || missing) {
        langHTML = '<div class="blog-lang-row">' +
          '<label class="dl-lang" for="blogReadLang"><span>' +
            escapeHTML(t('blog.readIn', 'Read in')) + '</span>' +
            '<select id="blogReadLang">' + codes.map(function (c) {
              return '<option value="' + escapeHTML(c) + '"' + (c === readLang ? ' selected' : '') + '>' +
                escapeHTML(R.langLabel(c)) + '</option>';
            }).join('') + '</select></label>' +
          (missing ? '<p class="blog-lang-note">' +
            escapeHTML(t('blog.langMissing', 'Not written in {lang} yet — showing {shown}.')
              .replace('{lang}', R.langLabel(wanted)).replace('{shown}', R.langLabel(readLang))) +
            '</p>' : '') +
          '</div>';
      }

      var adminHTML = '';
      if (isAdmin) {
        adminHTML = '<div class="res-status ' + (post.published ? 'res-status--live' : 'res-status--draft') + '">' +
          '<span>' + escapeHTML(post.published
            ? t('blog.statusLive', 'Published — everyone can read this post.')
            : t('blog.statusDraft', 'Not published yet — only admins can read this post.')) + '</span>' +
          '<span class="res-status-actions">' +
            '<button type="button" class="btn ' + (post.published ? 'btn-outline-dark' : 'btn-primary') + '" id="blogPublishBtn">' +
              escapeHTML(post.published ? t('blog.unpublish', 'Unpublish') : t('blog.publishNow', 'Publish now')) +
            '</button>' +
            '<button type="button" class="btn btn-ghost" id="blogEditBtn">' + escapeHTML(t('blog.edit', 'Edit')) + '</button>' +
            '<button type="button" class="btn btn-ghost blog-delete-btn" id="blogDeleteBtn">' + escapeHTML(t('blog.delete', 'Delete')) + '</button>' +
          '</span>' +
        '</div>';
      }

      var currentIdx = posts.filter(function (p) { return p.published || isAdmin; }).findIndex(function (p) { return p.id === post.id; });
      var prevPost = currentIdx > 0 ? posts.filter(function (p) { return p.published || isAdmin; })[currentIdx - 1] : null;
      var nextPost = currentIdx >= 0 && currentIdx < posts.length - 1 ? posts.filter(function (p) { return p.published || isAdmin; })[currentIdx + 1] : null;

      var navHTML = '';
      if (prevPost || nextPost) {
        navHTML = '<div class="blog-nav">';
        if (prevPost) {
          navHTML += '<a href="blog.html?post=' + encodeURIComponent(prevPost.slug) + '" class="blog-nav-prev">' +
            '<span class="blog-nav-label">' + escapeHTML(t('blog.prevPost', '← Previous')) + '</span>' +
            '<span class="blog-nav-title">' + escapeHTML(field(prevPost, 'title', readLang)) + '</span>' +
            '</a>';
        }
        if (nextPost) {
          navHTML += '<a href="blog.html?post=' + encodeURIComponent(nextPost.slug) + '" class="blog-nav-next">' +
            '<span class="blog-nav-label">' + escapeHTML(t('blog.nextPost', 'Next →')) + '</span>' +
            '<span class="blog-nav-title">' + escapeHTML(field(nextPost, 'title', readLang)) + '</span>' +
            '</a>';
        }
        navHTML += '</div>';
      }

      singleEl.innerHTML =
        '<a class="blog-back" href="blog.html">' + escapeHTML(t('blog.backToAll', '← All posts')) + '</a>' +
        '<span class="blog-meta">' + escapeHTML(categoryLabel(post.category)) +
          (post.published ? '' : ' · <span class="blog-draft-tag">' + escapeHTML(t('blog.draft', 'Draft')) + '</span>') +
        '</span>' +
        '<h1>' + escapeHTML(field(post, 'title', readLang)) + '</h1>' +
        '<p class="blog-date">' + escapeHTML(formatDate(post.created_at)) + '</p>' +
        langHTML +
        adminHTML +
        '<div class="blog-post-actions">' +
          '<button type="button" class="like-btn" id="likePostBtn" data-id="' + post.id + '" data-liked="false">' +
            '<span class="like-icon">♡</span>' +
            '<span class="like-count" id="likeCount">0</span>' +
          '</button>' +
        '</div>' +
        '<div class="post-body">' + paragraphs(field(post, 'body', readLang)) + '</div>' +
        renderTags(post.tags) +
        '<div class="blog-share">' +
          '<span class="blog-share-label">' + escapeHTML(t('blog.share', 'Share this post')) + '</span>' +
          '<div class="blog-share-buttons">' +
            '<a href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(field(post, 'title', readLang) + ' — Duru Korean') + '&url=' + encodeURIComponent(postUrl) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn twitter" title="Twitter" aria-label="Share on Twitter">𝕏</a>' +
            '<a href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(postUrl) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn facebook" title="Facebook" aria-label="Share on Facebook">f</a>' +
            '<a href="https://share.naver.com/web/shareView?url=' + encodeURIComponent(postUrl) + '&title=' + encodeURIComponent(field(post, 'title', readLang)) + '" target="_blank" rel="noopener noreferrer" class="blog-share-btn naver" title="Naver" aria-label="Share on Naver">N</a>' +
            (kakaoKey()
              ? '<button type="button" class="blog-share-btn kakao" title="KakaoTalk" aria-label="Share on KakaoTalk" data-title="' + escapeHTML(field(post, 'title', readLang)) + '" data-url="' + escapeHTML(postUrl) + '">K</button>'
              : '') +
            '<button type="button" class="blog-share-btn copy" title="Copy link" aria-label="Copy link" data-url="' + escapeHTML(postUrl) + '">🔗</button>' +
          '</div>' +
        '</div>' +
        navHTML;
      document.title = field(post, 'title', readLang) + ' — Duru Korean';
      setupShareButtons();
      setupLikeButton(post.id);

      var readSel = singleEl.querySelector('#blogReadLang');
      if (readSel) {
        readSel.addEventListener('change', function () {
          readPick = readSel.value;
          renderSingle(post);
        });
      }
      var pubBtn = singleEl.querySelector('#blogPublishBtn');
      if (pubBtn) pubBtn.addEventListener('click', function () { togglePublished(post); });
      var editBtn = singleEl.querySelector('#blogEditBtn');
      if (editBtn) editBtn.addEventListener('click', function () { openEditor(post); });
      var delBtn = singleEl.querySelector('#blogDeleteBtn');
      if (delBtn) delBtn.addEventListener('click', function () { confirmDelete(post); });
    }

    // KakaoTalk sharing needs a per-site JavaScript key from the Kakao
    // developer console. Without one the button is not rendered at all,
    // rather than shown and failing on click. The SDK is fetched on first
    // use so sites without a key pay nothing for it.
    function kakaoKey() {
      return (window.DURU_KAKAO_CONFIG && window.DURU_KAKAO_CONFIG.jsKey) || '';
    }

    var kakaoSDK = null;
    function loadKakao() {
      if (kakaoSDK) return kakaoSDK;
      kakaoSDK = new Promise(function (resolve, reject) {
        if (window.Kakao) return resolve(window.Kakao);
        var s = document.createElement('script');
        s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
        s.onload = function () { resolve(window.Kakao); };
        s.onerror = function () { reject(new Error('Kakao SDK failed to load')); };
        document.head.appendChild(s);
      }).then(function (Kakao) {
        if (Kakao && !Kakao.isInitialized()) Kakao.init(kakaoKey());
        return Kakao;
      });
      return kakaoSDK;
    }

    function setupShareButtons() {
      var kakaoBtn = singleEl.querySelector('.blog-share-btn.kakao');
      if (kakaoBtn) {
        kakaoBtn.addEventListener('click', function () {
          loadKakao().then(function (Kakao) {
            Kakao.Share.sendDefault({
              objectType: 'text',
              text: kakaoBtn.dataset.title,
              link: { mobileWebUrl: kakaoBtn.dataset.url, webUrl: kakaoBtn.dataset.url }
            });
          }).catch(function () {
            if (window.DURU_NOTIFY) {
              window.DURU_NOTIFY.error(t('blog.shareFailed', 'Sharing is unavailable right now.'));
            }
          });
        });
      }

      var copyBtn = singleEl.querySelector('.blog-share-btn.copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          var url = copyBtn.dataset.url;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(function () {
              var orig = copyBtn.textContent;
              copyBtn.textContent = '✓';
              setTimeout(function () { copyBtn.textContent = orig; }, 2000);
            });
          } else {
            window.prompt('Copy this link:', url);
          }
        });
      }
    }

    function setupLikeButton(postId) {
      if (!window.DURU_LIKE) return;
      var likeBtn = singleEl.querySelector('#likePostBtn');
      if (!likeBtn) return;

      var likeCount = singleEl.querySelector('#likeCount');
      var liked = false;

      window.DURU_LIKE.getLikeCount('post', postId).then(function (count) {
        if (likeCount) likeCount.textContent = String(count);
      });

      window.DURU_LIKE.hasUserLiked('post', postId).then(function (userLiked) {
        liked = userLiked;
        if (liked) {
          likeBtn.classList.add('liked');
          likeBtn.querySelector('.like-icon').textContent = '♥';
        }
      });

      likeBtn.addEventListener('click', function () {
        likeBtn.disabled = true;
        window.DURU_LIKE.toggleLike('post', postId).then(function () {
          liked = !liked;
          if (liked) {
            likeBtn.classList.add('liked');
            likeBtn.querySelector('.like-icon').textContent = '♥';
          } else {
            likeBtn.classList.remove('liked');
            likeBtn.querySelector('.like-icon').textContent = '♡';
          }
          likeBtn.disabled = false;
          window.DURU_LIKE.getLikeCount('post', postId).then(function (count) {
            if (likeCount) likeCount.textContent = String(count);
          });
        }).catch(function () {
          likeBtn.disabled = false;
          window.alert(t('like.loginRequired', 'Sign in to like'));
        });
      });
    }

    function renderNotFound() {
      if (!singleEl) return;
      singleEl.hidden = false;
      listEl.hidden = true;
      if (toolbarEl) toolbarEl.hidden = true;
      if (leadInEl) leadInEl.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
      singleEl.innerHTML =
        '<a class="blog-back" href="blog.html">' + escapeHTML(t('blog.backToAll', '← All posts')) + '</a>' +
        '<h1>' + escapeHTML(t('blog.notFoundTitle', 'Post not found')) + '</h1>' +
        '<p>' + escapeHTML(t('blog.notFoundBody', 'That post may have been removed, or the link is wrong.')) + '</p>';
    }

    /* ---------------- Loading ---------------- */

    function loadPosts() {
      // Admins additionally receive drafts, because the RLS policy lets
      // them; nothing here asks for them explicitly.
      return client.from('posts').select('*').order('created_at', { ascending: false })
        .then(function (res) {
          if (res.error) { console.error('Failed to load posts:', res.error.message); return; }
          posts = res.data || [];
          buildLangSelect();
          updateFilterCounts();
          var slug = new URLSearchParams(location.search).get('post');
          if (slug) {
            var match = posts.filter(function (p) { return p.slug === slug; })[0];
            if (match) renderSingle(match); else renderNotFound();
          } else {
            markActiveFilter();
            renderCards();
            restoreScroll();
          }
        });
    }

    /* ---------------- Editor ---------------- */

    var overlay = null;
    var editing = null;
    var saving = false;
    var autoSaveTimer = null;
    var lastSaveTime = null;

    function buildEditor() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="auth-modal post-modal post-modal-wide" role="dialog" aria-modal="true" aria-labelledby="postEditorTitle">' +
          '<button type="button" class="auth-close" id="postCloseBtn" aria-label="Close">&times;</button>' +
          '<h2 id="postEditorTitle"></h2>' +
          '<div class="auto-save-status"></div>' +
          '<div class="auth-message" data-msg="post" hidden></div>' +
          '<div class="post-editor-container">' +
            '<form id="postForm" novalidate class="post-editor-form">' +
              '<div class="auth-field"><label for="postTitle"></label>' +
                '<input type="text" id="postTitle" required maxlength="160"></div>' +
              '<div class="auth-field"><label for="postCategory"></label>' +
                '<select id="postCategory">' + CATEGORIES.map(function (c) {
                  return '<option value="' + c + '"></option>';
                }).join('') + '</select></div>' +
              '<div class="auth-field"><label for="postExcerpt"></label>' +
                '<textarea id="postExcerpt" rows="2" maxlength="400"></textarea></div>' +
              '<div class="auth-field"><label for="postTags"></label>' +
                '<input type="text" id="postTags" maxlength="280" placeholder="hangul, beginner"></div>' +
              '<div class="auth-field"><label for="postBody"></label>' +
                '<textarea id="postBody" rows="12" required maxlength="40000"></textarea></div>' +
              '<div class="auth-field"><label for="postLang"></label>' +
                '<select id="postLang">' + R.LANGS.map(function (l) {
                  return '<option value="' + escapeHTML(l.code) + '">' + escapeHTML(l.label) + '</option>';
                }).join('') + '</select></div>' +
              // The same post in other languages. Collapsed, because most
              // of the time only one language is being written.
              '<details class="res-more" id="postTranslations"><summary></summary>' +
                '<p class="resource-hint" id="postTranslationsHint"></p>' +
                R.LANGS.map(function (l) {
                  return '<details class="res-more res-more--nested" data-tr="' + escapeHTML(l.code) + '">' +
                    '<summary>' + escapeHTML(l.label) + ' <span class="post-tr-state"></span></summary>' +
                    '<div class="auth-field"><input type="text" data-tr-title="' + escapeHTML(l.code) + '" maxlength="160"></div>' +
                    '<div class="auth-field"><textarea data-tr-excerpt="' + escapeHTML(l.code) + '" rows="2" maxlength="400"></textarea></div>' +
                    '<div class="auth-field"><textarea data-tr-body="' + escapeHTML(l.code) + '" rows="8" maxlength="40000"></textarea></div>' +
                  '</details>';
                }).join('') +
              '</details>' +
              '<label class="post-publish-row"><input type="checkbox" id="postPublished"> <span id="postPublishedLabel"></span></label>' +
              '<button type="submit" class="btn btn-primary auth-submit" id="postSubmit"></button>' +
            '</form>' +
            '<div class="post-preview-pane">' +
              '<div class="post-preview-title" data-i18n="blog.preview">Preview</div>' +
              '<div id="postPreview" class="post-preview"></div>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeEditor(); });
      overlay.querySelector('#postCloseBtn').addEventListener('click', closeEditor);
      overlay.querySelector('#postForm').addEventListener('submit', savePost);
      var bodyTextarea = overlay.querySelector('#postBody');
      if (bodyTextarea) {
        bodyTextarea.addEventListener('input', updatePreview);
        bodyTextarea.addEventListener('change', updatePreview);
      }
      overlay.querySelector('#postLang').addEventListener('change', markTranslationState);
      overlay.querySelectorAll('[data-tr-body]').forEach(function (el) {
        el.addEventListener('input', markTranslationState);
      });
      return overlay;
    }

    // "Written" / "—" beside each language, and the language the post
    // itself is in hidden from the list so it cannot be filled twice.
    function markTranslationState() {
      if (!overlay) return;
      var base = overlay.querySelector('#postLang').value;
      overlay.querySelectorAll('[data-tr]').forEach(function (box) {
        var code = box.dataset.tr;
        box.hidden = code === base;
        var body = overlay.querySelector('[data-tr-body="' + code + '"]');
        var state = box.querySelector('.post-tr-state');
        if (state) {
          state.textContent = body && body.value.trim()
            ? t('blog.trWritten', 'written') : t('blog.trEmpty', 'empty');
          state.className = 'post-tr-state' + (body && body.value.trim() ? ' is-written' : '');
        }
      });
    }

    function readTranslations() {
      var base = overlay.querySelector('#postLang').value;
      var out = {};
      R.LANGS.forEach(function (l) {
        if (l.code === base) return;
        var title = overlay.querySelector('[data-tr-title="' + l.code + '"]').value.trim();
        var excerpt = overlay.querySelector('[data-tr-excerpt="' + l.code + '"]').value.trim();
        var body = overlay.querySelector('[data-tr-body="' + l.code + '"]').value.trim();
        if (!title && !excerpt && !body) return;
        var entry = {};
        if (title) entry.title = title;
        if (excerpt) entry.excerpt = excerpt;
        if (body) entry.body = body;
        out[l.code] = entry;
      });
      return out;
    }

    function updatePreview() {
      if (!overlay) return;
      var preview = overlay.querySelector('#postPreview');
      if (!preview) return;
      var body = overlay.querySelector('#postBody').value;
      preview.innerHTML = '<div class="post-body">' + paragraphs(body) + '</div>';
    }

    function updateAutoSaveStatus() {
      if (!overlay) return;
      var statusEl = overlay.querySelector('.auto-save-status');
      if (!statusEl) return;
      if (lastSaveTime) {
        statusEl.textContent = t('blog.lastSaved', 'Saving…').replace('Saving…', 'Saved ' + formatDate(lastSaveTime));
        statusEl.style.color = 'var(--ink-dim)';
      } else {
        statusEl.textContent = '';
      }
    }

    function startAutoSave() {
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      autoSaveTimer = setInterval(function () {
        if (overlay && !overlay.hidden && editing && !saving) {
          var title = overlay.querySelector('#postTitle').value.trim();
          var body = overlay.querySelector('#postBody').value.trim();
          if (title && body) {
            var row = {
              title: title,
              category: overlay.querySelector('#postCategory').value,
              excerpt: overlay.querySelector('#postExcerpt').value.trim() || null,
              tags: parseTags(overlay.querySelector('#postTags').value),
              body: body,
              lang: overlay.querySelector('#postLang').value,
              i18n: readTranslations(),
              published: overlay.querySelector('#postPublished').checked,
              updated_at: new Date().toISOString()
            };
            client.from('posts').update(row).eq('id', editing.id).then(function (res) {
              if (!res.error) {
                lastSaveTime = new Date().toISOString();
                updateAutoSaveStatus();
              }
            });
          }
        }
      }, 30000);
    }

    function labelEditor() {
      var o = buildEditor();
      o.querySelector('#postEditorTitle').textContent = editing
        ? t('blog.editorEditTitle', 'Edit post') : t('blog.editorNewTitle', 'Write a post');
      o.querySelector('label[for="postTitle"]').textContent = t('blog.fieldTitle', 'Title');
      o.querySelector('label[for="postCategory"]').textContent = t('blog.fieldCategory', 'Category');
      o.querySelector('label[for="postExcerpt"]').textContent = t('blog.fieldExcerpt', 'Summary (shown on the card)');
      o.querySelector('label[for="postTags"]').textContent = t('blog.fieldTags', 'Tags (comma separated)');
      o.querySelector('label[for="postBody"]').textContent = t('blog.fieldBody', 'Body');
      o.querySelector('label[for="postLang"]').textContent = t('blog.fieldLang', 'Written in');
      o.querySelector('#postTranslations > summary').textContent = t('blog.translations', 'Other languages');
      o.querySelector('#postTranslationsHint').textContent =
        t('blog.translationsHint', 'Fill in a language to offer the post in it. A language needs a body to count as written.');
      o.querySelectorAll('[data-tr-title]').forEach(function (el) {
        el.placeholder = t('blog.fieldTitle', 'Title');
      });
      o.querySelectorAll('[data-tr-excerpt]').forEach(function (el) {
        el.placeholder = t('blog.fieldExcerpt', 'Summary (shown on the card)');
      });
      o.querySelectorAll('[data-tr-body]').forEach(function (el) {
        el.placeholder = t('blog.fieldBody', 'Body');
      });
      markTranslationState();
      o.querySelector('#postPublishedLabel').textContent = t('blog.fieldPublished', 'Publish now (leave off to save as a draft)');
      o.querySelector('#postSubmit').textContent = t('blog.save', 'Save');
      CATEGORIES.forEach(function (c, i) {
        o.querySelectorAll('#postCategory option')[i].textContent = categoryLabel(c);
      });
      updateAutoSaveStatus();
    }

    function setMsg(type, text) {
      var el = overlay.querySelector('[data-msg="post"]');
      el.className = 'auth-message ' + type;
      el.textContent = text;
      el.hidden = false;
    }

    function openEditor(post) {
      editing = post || null;
      var o = buildEditor();
      labelEditor();
      lastSaveTime = null;
      o.querySelector('[data-msg="post"]').hidden = true;
      o.querySelector('#postTitle').value = editing ? editing.title : '';
      o.querySelector('#postCategory').value = editing ? editing.category : CATEGORIES[0];
      o.querySelector('#postExcerpt').value = editing && editing.excerpt ? editing.excerpt : '';
      o.querySelector('#postTags').value = editing && editing.tags ? editing.tags.join(', ') : '';
      o.querySelector('#postBody').value = editing ? editing.body : '';
      o.querySelector('#postLang').value = (editing && editing.lang) ||
        (window.DURU_I18N && window.DURU_I18N.lang) || 'en';
      var tr = (editing && editing.i18n) || {};
      R.LANGS.forEach(function (l) {
        var entry = tr[l.code] || {};
        o.querySelector('[data-tr-title="' + l.code + '"]').value = entry.title || '';
        o.querySelector('[data-tr-excerpt="' + l.code + '"]').value = entry.excerpt || '';
        o.querySelector('[data-tr-body="' + l.code + '"]').value = entry.body || '';
      });
      o.querySelector('#postTranslations').open = false;
      markTranslationState();
      updatePreview();
      o.hidden = false;
      o.querySelector('#postTitle').focus();
      if (editing) startAutoSave();
    }

    function closeEditor() {
      if (overlay) overlay.hidden = true;
      editing = null;
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      autoSaveTimer = null;
      lastSaveTime = null;
    }

    function savePost(e) {
      e.preventDefault();
      if (saving) return;
      var title = overlay.querySelector('#postTitle').value.trim();
      var body = overlay.querySelector('#postBody').value.trim();
      if (!title) { setMsg('error', t('blog.errNoTitle', 'Please give the post a title.')); return; }
      if (!body) { setMsg('error', t('blog.errNoBody', 'Please write something in the body.')); return; }

      var row = {
        title: title,
        category: overlay.querySelector('#postCategory').value,
        excerpt: overlay.querySelector('#postExcerpt').value.trim() || null,
        tags: parseTags(overlay.querySelector('#postTags').value),
        body: body,
        lang: overlay.querySelector('#postLang').value,
        i18n: readTranslations(),
        published: overlay.querySelector('#postPublished').checked,
      };

      saving = true;
      var btn = overlay.querySelector('#postSubmit');
      btn.disabled = true;
      btn.textContent = t('blog.saving', 'Saving…');

      var op;
      if (editing) {
        row.updated_at = new Date().toISOString();
        op = client.from('posts').update(row).eq('id', editing.id);
      } else {
        row.slug = makeSlug(title);
        op = client.auth.getUser().then(function (res) {
          row.created_by = res.data && res.data.user ? res.data.user.id : null;
          return client.from('posts').insert(row);
        });
      }

      op.then(function (res) {
        saving = false;
        btn.disabled = false;
        btn.textContent = t('blog.save', 'Save');
        if (res && res.error) {
          setMsg('error', t('blog.errSaveFailed', 'Couldn’t save: {msg}').replace('{msg}', schemaHint(res.error.message)));
          return;
        }
        closeEditor();
        loadPosts();
      });
    }

    /* ---------------- Publish ---------------- */

    // Publishing lives on the post itself, next to what is being
    // published, rather than as a checkbox inside the editor.
    function togglePublished(post) {
      var next = !post.published;
      client.from('posts')
        .update({ published: next, updated_at: new Date().toISOString() })
        .eq('id', post.id)
        .then(function (res) {
          if (res.error) {
            if (window.DURU_NOTIFY) window.DURU_NOTIFY.error(schemaHint(res.error.message));
            return;
          }
          post.published = next;
          renderSingle(post);
        });
    }

    /* ---------------- Delete ---------------- */

    function confirmDelete(post) {
      if (!post) return;
      var ok = window.confirm(
        t('blog.confirmDelete', '“{title}” will be permanently removed. This can’t be undone.')
          .replace('{title}', post.title));
      if (!ok) return;
      client.from('posts').delete().eq('id', post.id).then(function (res) {
        if (res.error) { window.alert(res.error.message); return; }
        if (new URLSearchParams(location.search).get('post') === post.slug) {
          location.href = 'blog.html';
        } else {
          loadPosts();
        }
      });
    }

    function updateFilterCounts() {
      if (!filtersEl) return;
      // Counts follow the language being browsed, so a chip never
      // promises posts the language filter is about to hide.
      var inLang = posts.filter(function (p) {
        if (postLangs(p).indexOf(listLang) === -1) return false;
        if (!activeTag) return true;
        return (p.tags || []).some(function (tag) { return tag.toLowerCase() === activeTag.toLowerCase(); });
      });
      filtersEl.querySelectorAll('.filter-btn[data-filter]').forEach(function (btn) {
        var filter = btn.dataset.filter;
        var count = filter === 'all' ? inLang.length : countByCategory(inLang, filter);
        var countEl = btn.querySelector('.filter-count');
        if (!countEl && count > 0) {
          countEl = document.createElement('span');
          countEl.className = 'filter-count';
          btn.appendChild(countEl);
        }
        if (countEl) countEl.textContent = '(' + count + ')';
      });
    }

    /* ---------------- Filters, admin state ---------------- */

    function markActiveFilter() {
      if (!filtersEl) return;
      filtersEl.querySelectorAll('.filter-btn[data-filter]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.filter === activeFilter);
      });
    }

    if (filtersEl) {
      filtersEl.addEventListener('click', function (e) {
        var btn = e.target.closest('.filter-btn');
        if (!btn) return;
        activeFilter = btn.dataset.filter;
        markActiveFilter();
        saveState();
        updateFilterCounts();
        renderCards();
      });
    }

    if (langSel) {
      langSel.addEventListener('change', function () {
        listLang = langSel.value;
        saveState();
        updateFilterCounts();
        renderCards();
      });
    }

    if (suggestEl) {
      suggestEl.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-lang]');
        if (!btn) return;
        listLang = btn.dataset.lang;
        if (langSel) langSel.value = listLang;
        saveState();
        updateFilterCounts();
        renderCards();
      });
    }

    if (writeBtn) writeBtn.addEventListener('click', function () { openEditor(null); });

    function applyAdmin(user) {
      if (!user) {
        isAdmin = false;
        if (writeBtn) writeBtn.hidden = true;
        return loadPosts();
      }
      return client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        .then(function (res) {
          isAdmin = !!(res && res.data);
          if (writeBtn) writeBtn.hidden = !isAdmin;
          return loadPosts();
        });
    }

    client.auth.getSession().then(function (res) {
      applyAdmin(res.data && res.data.session && res.data.session.user);
    });
    client.auth.onAuthStateChange(function (_event, session) {
      applyAdmin(session && session.user);
    });

    // Labels inside rendered cards are translated at render time, so a
    // language switch has to re-render rather than rely on the DOM scan.
    document.addEventListener('duru:langchange', function () {
      buildLangSelect();
      updateFilterCounts();
      var slug = new URLSearchParams(location.search).get('post');
      if (slug) {
        var match = posts.filter(function (p) { return p.slug === slug; })[0];
        // Switching the site's language re-picks the reading language
        // too, but only on the way in — a reader who chose one on this
        // page keeps it until they leave.
        if (match) renderSingle(match);
      } else {
        renderCards();
      }
      if (overlay && !overlay.hidden) labelEditor();
    });
  });
})();
