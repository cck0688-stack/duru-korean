// DURU KOREAN — /sitemap.xml
//
// Every public page in every language, each entry naming the other
// languages' addresses for it (hreflang), so a search engine indexes
// /vi/blog.html as the Vietnamese page, /ko/blog.html as the Korean one,
// and shows each reader the one in their language.
//
// Blog posts are read from the database on each request (cached at the
// edge for an hour), so a post published this morning is in it without
// anyone touching this file. Only what the public may read is listed:
// the anon key reads through the same row-level security a visitor does.
//
// Pages marked noindex (resource.html, review.html, setup-check.html) and
// pages that belong to one signed-in person are left out on purpose.

const SITE = 'https://www.durukorean.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

export const LANGS = ['en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh'];

// The addresses the site's own links use, so each entry is the page's
// canonical address and not a second spelling of it.
export const PAGES = [
  '/', '/learning-korean.html', '/book-resources.html', '/free-resources.html',
  '/blog.html', '/stories.html', '/about.html', '/faq.html', '/privacy.html', '/terms.html'
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function at(lang, bare) {
  return SITE + (lang ? '/' + lang : '') + bare;
}

export function entries(bare, lastmod) {
  const alternates = LANGS.map((l) =>
    '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + esc(at(l, bare)) + '"/>').join('\n') +
    '\n    <xhtml:link rel="alternate" hreflang="x-default" href="' + esc(at('', bare)) + '"/>';
  return LANGS.map((l) =>
    '  <url>\n    <loc>' + esc(at(l, bare)) + '</loc>\n' +
    (lastmod ? '    <lastmod>' + esc(String(lastmod).slice(0, 10)) + '</lastmod>\n' : '') +
    alternates + '\n  </url>').join('\n');
}

export function build(posts) {
  const body = PAGES.map((p) => entries(p)).concat(
    (posts || []).filter((p) => p && p.slug)
      .map((p) => entries('/blog/post/' + encodeURIComponent(p.slug), p.updated_at || p.created_at))
  ).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + body + '\n</urlset>\n';
}

async function publishedPosts() {
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/posts?select=slug,updated_at,created_at' +
      '&published=eq.true&order=created_at.desc&limit=5000', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    // The pages are still worth listing when the database is slow.
    return [];
  }
}

export default async function handler(req, res) {
  const xml = build(await publishedPosts());
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
}
