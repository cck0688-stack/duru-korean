// DURU KOREAN — pages as a search engine or a link preview sees them
//
// The site's pages are plain HTML that fill themselves in with
// JavaScript: the language is applied after the page opens, and a blog
// post or a download is fetched from the database after that. Google
// runs the JavaScript eventually; Naver, Bing, Daum and every link
// preview (KakaoTalk, Facebook, X, LINE) mostly do not. They saw an
// English shell with the same title on every page.
//
// This function sends the same page with the work already done:
//
//   /vi/about.html, /ko/blog, …   the page in that language: every
//                                 data-i18n text applied, <html lang>,
//                                 title, description
//   /blog/post/<slug>, /ko/…      one post: its title, summary, body and
//                                 picture in the reader's language, and
//                                 Article structured data
//   /resource/<id>, /ja/…         one download: its title, description,
//                                 languages, and LearningResource data
//
// and on every one: canonical, hreflang alternates for all eight
// languages, Open Graph and Twitter card tags. The page's own scripts
// still run and take over exactly as before — nothing here changes what
// a person sees once the page has loaded, only what arrives first.
//
// Anything that goes wrong sends the untouched page, which works as it
// always has. Only public data is read, with the anon key, through the
// same row-level security a visitor gets.

import { parse } from 'node-html-parser';

const SITE = 'https://www.durukorean.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
export const LANGS = ['en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh', 'fr', 'de'];
const OG_LOCALE = { en: 'en_US', vi: 'vi_VN', es: 'es_ES', id: 'id_ID', 'pt-BR': 'pt_BR', ko: 'ko_KR', ja: 'ja_JP', zh: 'zh_CN', fr: 'fr_FR', de: 'de_DE' };
const PAGES = new Set(['index.html', 'about.html', 'learning-korean.html', 'book-resources.html', 'free-resources.html',
  'blog.html', 'stories.html', 'faq.html', 'privacy.html', 'terms.html', 'resource.html', 'search.html']);
const OG_IMAGE = SITE + '/assets/og-default.png';

/* ---------------- fetching ---------------- */

// Templates and dictionaries come from the deployment itself — the
// static files the CDN already serves — kept for the life of the
// function instance.
const memo = new Map();
async function fromSite(origin, path) {
  const key = origin + path;
  if (memo.has(key)) return memo.get(key);
  const res = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(path + ' ' + res.status);
  const text = await res.text();
  memo.set(key, text);
  return text;
}

async function fromDb(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error('db ' + res.status);
  return res.json();
}

/* ---------------- small helpers ---------------- */

export function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if ([...t].length <= n) return t;
  return [...t].slice(0, n - 1).join('').replace(/\s+\S*$/, '') + '…';
}

// "/vi/blog/post/x" for a language, "/blog/post/x" for none; the home
// page is "/vi", the address the host keeps (vercel.json trailingSlash).
export function at(lang, bare) {
  if (!lang) return bare;
  return '/' + lang + (bare === '/' ? '' : bare);
}

/* ---------------- the dictionary, applied ---------------- */

export function applyDict(root, dict) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = dict[el.getAttribute('data-i18n')];
    if (v != null) el.set_content(esc(v));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const v = dict[el.getAttribute('data-i18n-html')];
    if (v != null) el.set_content(String(v));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const v = dict[el.getAttribute('data-i18n-placeholder')];
    if (v != null) el.setAttribute('placeholder', String(v));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const v = dict[el.getAttribute('data-i18n-aria-label')];
    if (v != null) el.setAttribute('aria-label', String(v));
  });
}

/* ---------------- the head ---------------- */

export function setHead(root, o) {
  const head = root.querySelector('head');
  if (!head) return;
  const html = root.querySelector('html');
  if (html && o.lang) html.setAttribute('lang', o.lang);
  // What this function writes replaces what the template had, and is
  // marked the way js/i18n.js marks its own links, so the page's script
  // replaces rather than doubles them.
  head.querySelectorAll('title, meta[name="description"], meta[name="robots"], link[rel="canonical"], ' +
    'link[rel="alternate"][hreflang], meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"]')
    .forEach((el) => el.remove());
  const url = SITE + o.path;
  const parts = [
    '<title>' + esc(o.title) + '</title>',
    '<meta name="description" content="' + esc(o.description) + '">',
    o.noindex ? '<meta name="robots" content="noindex">' : '',
    '<link rel="canonical" href="' + esc(url) + '" data-duru-lang="">',
    ...LANGS.map((l) => '<link rel="alternate" hreflang="' + l + '" href="' + esc(SITE + at(l, o.bare)) + '" data-duru-lang="">'),
    '<link rel="alternate" hreflang="x-default" href="' + esc(SITE + o.bare) + '" data-duru-lang="">',
    '<meta property="og:site_name" content="Duru Korean">',
    '<meta property="og:type" content="' + (o.ogType || 'website') + '">',
    '<meta property="og:title" content="' + esc(o.title) + '">',
    '<meta property="og:description" content="' + esc(o.description) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta property="og:image" content="' + esc(o.image || OG_IMAGE) + '">',
    '<meta property="og:locale" content="' + (OG_LOCALE[o.lang] || 'en_US') + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + esc(o.title) + '">',
    '<meta name="twitter:description" content="' + esc(o.description) + '">',
    '<meta name="twitter:image" content="' + esc(o.image || OG_IMAGE) + '">',
    ...(o.jsonld || []).map((j) => '<script type="application/ld+json">' +
      JSON.stringify(j).replace(/</g, '\\u003c') + '</script>')
  ].filter(Boolean).join('\n');
  const charset = head.querySelector('meta[charset]');
  if (charset) charset.insertAdjacentHTML('afterend', '\n' + parts);
  else head.insertAdjacentHTML('afterbegin', parts);
}

function pageTitleKey(html) {
  const m = /DURU_PAGE_TITLE_KEY\s*=\s*'([^']+)'/.exec(html);
  return m ? m[1] : null;
}

// A page's own line of introduction, in its language: the banner's
// tagline, or failing that the first translated paragraph.
function describe(root, fallback) {
  const el = root.querySelector('.page-hero-tagline') || root.querySelector('.hero [data-i18n]:not(h1)') ||
    root.querySelector('main p[data-i18n]') || root.querySelector('p[data-i18n]');
  const text = el ? el.textContent.trim() : '';
  return clip(text || fallback || '', 160);
}

/* ---------------- one post ---------------- */

function postField(post, lang, name) {
  const own = post.i18n && post.i18n[lang] && post.i18n[lang][name];
  if (own && String(own).trim()) return String(own);
  const mt = post.mt && post.mt[lang];
  if (mt && mt.from === (post.lang || 'en') && mt[name]) return String(mt[name]);
  return String(post[name] || '');
}

function postBody(post, lang) {
  const own = post.i18n && post.i18n[lang] && post.i18n[lang].body;
  if (own && String(own).trim()) return String(own);
  const mt = post.mt && post.mt[lang];
  if (mt && Array.isArray(mt.sentences) && mt.sentences.length && mt.from === (post.lang || 'en')) {
    return mt.sentences.join(' ');
  }
  return String(post.body || '');
}

function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => '<p>' + esc(p.replace(/^#+\s*/, '')).replace(/\n/g, '<br>') + '</p>').join('');
}

/* ---------------- the handler ---------------- */

export async function render({ origin, kind, lang, page, slug, id }) {
  lang = LANGS.includes(lang) ? lang : '';
  const dictLang = lang || 'en';
  let template = 'index.html';
  if (kind === 'page' && PAGES.has(page)) template = page;
  if (kind === 'post') template = 'blog.html';
  if (kind === 'resource') template = 'resource.html';

  const raw = await fromSite(origin, '/' + template);
  const dict = JSON.parse(await fromSite(origin, '/js/i18n/' + dictLang + '.json'));
  const root = parse(raw, { comment: true });
  if (lang) applyDict(root, dict);
  const titleKey = pageTitleKey(raw);
  const baseTitle = (titleKey && dict[titleKey]) || (root.querySelector('title') || { textContent: 'Duru Korean' }).textContent;
  const baseDesc = (root.querySelector('meta[name="description"]') || { getAttribute: () => '' }).getAttribute('content');

  if (kind === 'post') {
    const rows = await fromDb('posts?select=*&published=eq.true&slug=eq.' + encodeURIComponent(slug) + '&limit=1');
    const post = rows && rows[0];
    const bare = '/blog/post/' + encodeURIComponent(slug);
    if (!post) {
      setHead(root, { lang: dictLang, title: baseTitle, description: baseDesc, path: at(lang, bare), bare, noindex: true });
      return { status: 404, html: root.toString() };
    }
    const title = postField(post, dictLang, 'title');
    const summary = postField(post, dictLang, 'excerpt') || clip(postBody(post, dictLang), 160);
    const day = post.published_at || post.post_date || post.created_at;
    const single = root.querySelector('#blogSingle');
    if (single) {
      single.removeAttribute('hidden');
      single.set_content(
        '<a class="blog-back" href="' + at(lang, '/blog') + '">' + esc(dict['blog.backToAll'] || '← All posts') + '</a>' +
        '<h1>' + esc(title) + '</h1>' +
        (day ? '<p class="blog-date">' + esc(String(day).slice(0, 10)) + '</p>' : '') +
        (post.image_url ? '<figure class="post-photo"><img src="' + esc(post.image_url) + '" alt="' + esc(post.image_alt || '') + '"></figure>' : '') +
        '<div class="post-body">' + paragraphs(postBody(post, dictLang)) + '</div>');
    }
    const list = root.querySelector('#blogList');
    if (list) list.setAttribute('hidden', '');
    setHead(root, {
      lang: dictLang, title: title + ' — Duru Korean', description: clip(summary, 160),
      path: at(lang, bare), bare, ogType: 'article', image: post.image_url || null,
      jsonld: [{
        '@context': 'https://schema.org', '@type': 'Article',
        headline: clip(title, 110), description: clip(summary, 300), inLanguage: dictLang,
        datePublished: day || undefined, dateModified: post.updated_at || day || undefined,
        image: post.image_url ? [post.image_url] : undefined,
        mainEntityOfPage: SITE + at(lang, bare),
        author: { '@type': 'Organization', name: 'Duru Korean', url: SITE },
        publisher: { '@type': 'Organization', name: 'Duru Korean', url: SITE,
          logo: { '@type': 'ImageObject', url: SITE + '/assets/logo.webp' } }
      }]
    });
    return { status: 200, html: root.toString() };
  }

  if (kind === 'resource') {
    const rows = await fromDb('resources?select=id,title,description,summary,objective,body,i18n,category,learning_level,cover_key,' +
      'first_published_at,created_at,updated_at,resource_files(lang,file_type)&id=eq.' + encodeURIComponent(id) + '&limit=1');
    const r = rows && rows[0];
    const bare = '/resource/' + encodeURIComponent(id);
    if (!r) {
      setHead(root, { lang: dictLang, title: baseTitle, description: baseDesc, path: at(lang, bare), bare, noindex: true });
      return { status: 404, html: root.toString() };
    }
    const tr = (r.i18n && r.i18n[dictLang]) || {};
    const title = (tr.title && tr.title.trim()) || r.title || '';
    const desc = (tr.description && tr.description.trim()) || r.description || r.summary || '';
    const langs = [...new Set((r.resource_files || []).map((f) => f.lang))];
    const catName = dict['resources.cat.' + r.category] || r.category || '';
    // As the page draws it (js/resource-detail.js): the title as written
    // in the banner, the reader's language under "About this resource".
    const original = r.title || title;
    const h1 = root.querySelector('#resTitle');
    if (h1) h1.set_content(esc(original));
    const sub = root.querySelector('#resSubtitle');
    if (sub && desc) sub.set_content(esc(desc));
    const cat = root.querySelector('#resCategory');
    if (cat) cat.set_content(esc(catName));
    const detail = root.querySelector('#resDetail');
    if (detail) detail.removeAttribute('hidden');
    const aboutTitle = root.querySelector('#resAboutTitle');
    if (aboutTitle && title !== original) aboutTitle.set_content(esc(title));
    const text = (tr.body && tr.body.trim()) || r.body || r.objective || '';
    const body = root.querySelector('#resBody');
    if (body && text) body.set_content(text.split(/\n{2,}/).map((x) => '<p>' + esc(x.trim()) + '</p>').join(''));
    const NAMES = { en: 'English', vi: 'Tiếng Việt', es: 'Español', id: 'Bahasa Indonesia', 'pt-BR': 'Português (BR)',
      ko: '한국어', ja: '日本語', zh: '中文', fr: 'Français', de: 'Deutsch' };
    const factLangs = root.querySelector('#resFactLangs');
    if (factLangs) factLangs.set_content(esc(langs.map((l) => NAMES[l] || l).join(', ')));
    // The address it now lives at is deeper than the template's, so its
    // relative links need the site root to resolve against.
    const head = root.querySelector('head');
    if (head && !head.querySelector('base')) {
      const cs = head.querySelector('meta[charset]');
      if (cs) cs.insertAdjacentHTML('afterend', '\n<base href="/">');
    }
    const cover = r.cover_key ? SUPABASE_URL + '/storage/v1/object/public/resource-covers/' + r.cover_key : null;
    setHead(root, {
      lang: dictLang, title: title + ' — ' + (catName ? catName + ' · ' : '') + 'Duru Korean',
      description: clip(desc || title, 160), path: at(lang, bare), bare, image: cover,
      jsonld: [{
        '@context': 'https://schema.org', '@type': 'LearningResource',
        name: title, description: clip(desc, 300), url: SITE + at(lang, bare),
        inLanguage: langs, learningResourceType: 'Worksheet', educationalLevel: r.learning_level || undefined,
        teaches: 'Korean language', isAccessibleForFree: true,
        datePublished: r.first_published_at || r.created_at || undefined,
        provider: { '@type': 'Organization', name: 'Duru Korean', url: SITE }
      }]
    });
    return { status: 200, html: root.toString() };
  }

  // A plain page, in a language.
  const bare = template === 'index.html' ? '/' : template === 'blog.html' ? '/blog.html'
    : template === 'stories.html' ? '/stories.html' : '/' + template;
  const jsonld = [];
  if (template === 'index.html') {
    jsonld.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Duru Korean', url: SITE, inLanguage: LANGS },
      { '@context': 'https://schema.org', '@type': 'EducationalOrganization', name: 'Duru Korean', url: SITE,
        logo: SITE + '/assets/logo.webp', email: 'cck0688@gmail.com' });
  }
  if (template === 'faq.html') {
    const qa = [];
    root.querySelectorAll('.faq-item').forEach((d) => {
      const q = d.querySelector('.faq-q [data-i18n]') || d.querySelector('.faq-q');
      const a = d.querySelectorAll('.faq-a p, .faq-a li').map((x) => x.textContent.trim()).join(' ');
      if (q && a) qa.push({ '@type': 'Question', name: q.textContent.trim(), acceptedAnswer: { '@type': 'Answer', text: a } });
    });
    if (qa.length) jsonld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa });
  }
  setHead(root, {
    lang: dictLang, title: baseTitle, description: describe(root, baseDesc),
    path: at(lang, bare), bare, jsonld, noindex: template === 'search.html'
  });
  return { status: 200, html: root.toString() };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://' + (req.headers.host || 'www.durukorean.com'));
  const q = url.searchParams;
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + (req.headers['x-forwarded-host'] || req.headers.host);
  const args = { origin, kind: q.get('kind') || 'page', lang: q.get('lang') || '', page: q.get('page') || 'index.html',
                 slug: q.get('slug') || '', id: q.get('id') || '' };
  let out;
  try {
    out = await render(args);
  } catch (err) {
    console.error('render fell back to the plain page:', err && err.message);
    // The untouched page still works: its scripts do everything.
    try {
      const template = args.kind === 'post' ? 'blog.html' : args.kind === 'resource' ? 'resource.html'
        : (PAGES.has(args.page) ? args.page : 'index.html');
      out = { status: 200, html: await fromSite(origin, '/' + template) };
    } catch (e) {
      res.status(502).send('Temporarily unavailable');
      return;
    }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Browsers always ask again (the scripts and styles change with every
  // deploy); the CDN keeps a rendered page for ten minutes.
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Vercel-CDN-Cache-Control', 'max-age=600, stale-while-revalidate=86400');
  res.status(out.status).send(out.html);
}
