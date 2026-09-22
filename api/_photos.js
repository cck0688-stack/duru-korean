// DURU KOREAN — finding a photograph that belongs to the post
//
// Lives in api/ rather than scripts/ because both reach it: the
// morning's generator (scripts/generate-drafts.mjs) and the editor's
// search endpoint (api/photo.js), which Vercel builds. The same reason
// _providers.js is here.
//
// Real photographs, not generated ones. A blog that tells people what a
// Korean convenience store actually looks like is worse off with a
// rendering of a convenience store that does not exist, its signage in
// Hangul that is not quite Hangul.
//
// Two services, either of which is free and licensed for commercial
// use. Set whichever key you have:
//
//   UNSPLASH_ACCESS_KEY   unsplash.com/developers
//   PEXELS_API_KEY        pexels.com/api
//
// Both licences allow commercial use without payment or permission.
// Neither lets you sell the photograph unchanged, or build something
// that competes with the service itself — neither of which this does.
// Attribution is not legally required by either licence, but both ask
// for it in their API terms, so it is stored with the photo and shown
// under it. Read the licences yourself before launch:
// unsplash.com/license and pexels.com/license.
//
// The picture is hotlinked from their CDN rather than copied into
// Supabase Storage. Unsplash asks to be hotlinked, it keeps the free
// gigabyte free, and it means a photo is never orphaned from its credit.

export { isUnsplashUrl };

export class PhotoError extends Error {
  constructor(message) { super(message); this.name = 'PhotoError'; }
}

function isUnsplashUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname === 'api.unsplash.com';
  } catch (e) {
    return false;
  }
}

const unsplash = {
  name: 'unsplash',
  label: 'Unsplash',
  envKeys: ['UNSPLASH_ACCESS_KEY'],

  async search(key, query, count) {
    const url = 'https://api.unsplash.com/search/photos?per_page=' + count +
      '&orientation=landscape&content_filter=high&query=' + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { Authorization: 'Client-ID ' + key, 'Accept-Version': 'v1' }
    });
    if (res.status === 401) throw new PhotoError('Unsplash가 키를 받지 않았습니다.');
    if (res.status === 403) throw new PhotoError('Unsplash 사용량을 넘었습니다. 잠시 뒤에 다시 해 보세요.');
    if (!res.ok) throw new PhotoError(`Unsplash가 ${res.status}로 답했습니다.`);
    const data = await res.json();
    return (data.results || []).map((p) => ({
      id: String(p.id),
      // The sized URL rather than the raw one: 1200 wide is plenty for
      // a blog and costs the reader a tenth of the bytes.
      url: p.urls && (p.urls.regular || p.urls.full),
      thumb: p.urls && p.urls.small,
      alt: (p.alt_description || p.description || '').trim(),
      credit: (p.user && p.user.name) || 'Unsplash',
      creditUrl: p.user && p.user.links && p.user.links.html,
      source: 'unsplash',
      // Unsplash's API terms ask that this be called when a photo is
      // actually used, so the photographer's view count is real.
      downloadLocation: p.links && p.links.download_location
    })).filter((p) => p.url);
  },

  async used(key, photo) {
    // The key travels in this request, so the address it travels to is
    // checked rather than trusted. api/photo.js takes this value from
    // whoever is calling it; an admin who could name any host could
    // have the server hand them Unsplash's key.
    if (!isUnsplashUrl(photo && photo.downloadLocation)) return;
    await fetch(photo.downloadLocation, {
      headers: { Authorization: 'Client-ID ' + key, 'Accept-Version': 'v1' }
    }).catch(() => {});
  }
};

const pexels = {
  name: 'pexels',
  label: 'Pexels',
  envKeys: ['PEXELS_API_KEY'],

  async search(key, query, count) {
    const url = 'https://api.pexels.com/v1/search?per_page=' + count +
      '&orientation=landscape&query=' + encodeURIComponent(query);
    const res = await fetch(url, { headers: { Authorization: key } });
    if (res.status === 401) throw new PhotoError('Pexels가 키를 받지 않았습니다.');
    if (res.status === 429) throw new PhotoError('Pexels 사용량을 넘었습니다. 잠시 뒤에 다시 해 보세요.');
    if (!res.ok) throw new PhotoError(`Pexels가 ${res.status}로 답했습니다.`);
    const data = await res.json();
    return (data.photos || []).map((p) => ({
      id: String(p.id),
      url: p.src && (p.src.large || p.src.original),
      thumb: p.src && p.src.medium,
      alt: String(p.alt || '').trim(),
      credit: p.photographer || 'Pexels',
      creditUrl: p.photographer_url,
      source: 'pexels'
    })).filter((p) => p.url);
  },

  async used() {}
};

export const SERVICES = { unsplash, pexels };

export function resolvePhotos(env) {
  const named = String(env.PHOTO_PROVIDER || '').trim().toLowerCase();
  if (named && !SERVICES[named]) {
    throw new PhotoError('PHOTO_PROVIDER가 "' + named + '"로 되어 있는데, ' +
      Object.keys(SERVICES).join(' 또는 ') + ' 중 하나여야 합니다.');
  }
  for (const name of named ? [named] : Object.keys(SERVICES)) {
    const service = SERVICES[name];
    const key = service.envKeys.map((k) => env[k]).filter(Boolean)[0];
    if (key) return { service, key, label: service.label };
  }
  return null;
}

// ── choosing one ───────────────────────────────────────────────────

// English, because that is what both services index. Two or three
// concrete nouns beat a sentence: "Seoul subway gate" finds a subway
// gate, "how to use the Seoul subway as a foreigner" finds nothing.
export async function queryFor(cfg, opts) {
  const system = [
    '당신은 블로그 글에 어울리는 사진을 찾는 사람입니다.',
    '',
    '무료 사진 사이트(Unsplash, Pexels)에서 검색할 영어 검색어를 만드세요.',
    '',
    '- 영어로, 두세 단어. 구체적인 사물이나 장소.',
    '- 문장으로 쓰지 마세요. "how to use the subway in Korea"가 아니라',
    '  "Seoul subway station"입니다.',
    '- 그 사이트에 실제로 있을 만한 것으로. 한국 관련 사진이 많지 않은',
    '  주제라면 한 단계 넓혀 주세요 — "D-2 visa document"보다',
    '  "Korean university campus"가 찾아집니다.',
    '- 사람 얼굴이 크게 나오는 사진보다 장면이 나오는 사진이 좋습니다.',
    '',
    '두 개를 주세요. 첫 번째가 가장 구체적인 것, 두 번째는 못 찾았을 때',
    '쓸 조금 더 넓은 것.'
  ].join('\n');
  const user = [`제목: ${opts.title}`, `주제: ${opts.topic}`, '', '본문:', opts.content].join('\n');

  const strict = cfg.provider.strictSchema !== false;
  const root = {
    type: 'object',
    properties: { queries: { type: 'array', items: { type: 'string' } } },
    required: ['queries']
  };
  if (strict) root.additionalProperties = false;

  const text = await cfg.provider.chat(cfg, system, user, root);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new PhotoError('검색어를 읽지 못했습니다.'); }
  const queries = (parsed.queries || []).map((q) => String(q || '').trim()).filter(Boolean);
  if (!queries.length) throw new PhotoError('검색어가 비어 있습니다.');
  return queries.slice(0, 2);
}

// The search returns whatever matched the words; this asks whether any
// of it actually belongs on this post. Saying "none of these" is a
// valid answer — a post with no picture is better than a post about
// visa paperwork with a photograph of a beach.
export async function pickPhoto(cfg, photos, opts) {
  const described = photos
    .map((p, i) => `${i}. ${p.alt || '(설명 없음)'}`)
    .join('\n');
  const system = [
    '블로그 글에 붙일 사진을 고릅니다.',
    '',
    '사진 설명 목록을 보고, 이 글에 어울리는 것 하나의 번호를 고르세요.',
    '',
    '- 글의 내용과 실제로 관계가 있어야 합니다. 나라만 같다고 어울리는',
    '  것이 아닙니다.',
    '- 글이 말하는 것과 다른 장면이면 고르지 마세요.',
    '- 어울리는 것이 하나도 없으면 chosen을 -1로 하세요. 사진이 없는',
    '  편이 엉뚱한 사진보다 낫습니다.',
    '',
    'alt에는 그 사진을 눈이 보이지 않는 독자에게 설명하는 한 문장을',
    '한국어로 쓰세요. 고르지 않았다면 빈 문자열로 두세요.'
  ].join('\n');
  const user = [
    `제목: ${opts.title}`, `주제: ${opts.topic}`, '',
    '사진 설명:', described
  ].join('\n');

  const strict = cfg.provider.strictSchema !== false;
  const root = {
    type: 'object',
    properties: {
      chosen: { type: 'integer' },
      alt: { type: 'string' },
      why: { type: 'string' }
    },
    required: ['chosen', 'alt', 'why']
  };
  if (strict) root.additionalProperties = false;

  const text = await cfg.provider.chat(cfg, system, user, root);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new PhotoError('사진 선택을 읽지 못했습니다.'); }
  const index = Number(parsed.chosen);
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) return null;
  return { ...photos[index], alt: String(parsed.alt || '').trim() || photos[index].alt, why: parsed.why };
}

// The whole thing: a query from the post, a search, a choice. Returns
// null when nothing fits, and throws only when the service itself is
// unreachable — the caller treats both as "no picture today".
export async function findPhoto(cfg, photoCfg, opts, log) {
  const note = log || (() => {});
  const queries = await queryFor(cfg, opts);
  for (const query of queries) {
    note(`사진 찾는 중: "${query}"`);
    const found = await photoCfg.service.search(photoCfg.key, query, opts.count || 8);
    if (!found.length) continue;
    const chosen = await pickPhoto(cfg, found, opts);
    if (chosen) {
      await photoCfg.service.used(photoCfg.key, chosen);
      return { ...chosen, query };
    }
    note('  어울리는 사진이 없어 다음 검색어로 넘어갑니다');
  }
  return null;
}
