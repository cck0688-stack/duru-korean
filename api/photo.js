// DURU KOREAN — searching for a photograph, from the editor
//
// The generator finds a picture on its own each morning. This is for
// when an admin looks at what it found and wants a different one.
//
//   POST /api/photo
//   Authorization: Bearer <the caller's Supabase access token>
//   { "query": "Seoul subway station" }
//
//   200 { "service": "unsplash", "photos": [
//           { "id", "url", "thumb", "alt", "credit", "creditUrl", "source" } ] }
//
// Admin-gated for the same reason api/translate.js is: the photo
// service's key lives in an environment variable on the server and must
// never reach a browser, and an open endpoint would let anyone spend
// this site's rate limit.
//
// The "used" ping Unsplash asks for is sent when a photo is picked, not
// when it is searched — that is /api/photo with { "used": "<id>" } and
// the photo's download_location, below.
//
// Configuration (Vercel → Settings → Environment Variables):
//   UNSPLASH_ACCESS_KEY   unsplash.com/developers
//   PEXELS_API_KEY        pexels.com/api
//   PHOTO_PROVIDER        unsplash | pexels, when both keys are present

import { resolvePhotos, PhotoError } from './_photos.js';

export const config = { maxDuration: 30 };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

const MAX_QUERY = 120;
const MAX_RESULTS = 12;

function bad(res, status, message) {
  res.status(status).json({ error: message });
}

// The caller must be signed in AND listed in admin_users. The same
// check api/translate.js makes, for the same reason: the anon key is
// public, so the user's own token is what is verified.
async function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Sign in first.' };

  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token };

  const who = await fetch(SUPABASE_URL + '/auth/v1/user', { headers });
  if (!who.ok) return { ok: false, status: 401, message: 'That sign-in is no longer valid.' };
  const user = await who.json();
  if (!user || !user.id) return { ok: false, status: 401, message: 'That sign-in is no longer valid.' };

  const row = await fetch(
    SUPABASE_URL + '/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(user.id),
    { headers }
  );
  if (!row.ok) return { ok: false, status: 403, message: 'Could not confirm your account.' };
  const rows = await row.json();
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, status: 403, message: 'Only an admin can search for photos.' };
  }
  return { ok: true, user };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 405, 'Use POST.');

  let photoCfg;
  try {
    photoCfg = resolvePhotos(process.env);
  } catch (err) {
    return bad(res, 503, err.message);
  }
  if (!photoCfg) {
    return bad(res, 503, 'Photo search is not set up yet: set UNSPLASH_ACCESS_KEY or PEXELS_API_KEY.');
  }

  const allowed = await requireAdmin(req);
  if (!allowed.ok) return bad(res, allowed.status, allowed.message);

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  // Telling the service a photo was used. Unsplash asks for this when
  // one is actually put on a page, so a photographer's count is real.
  if (body.used) {
    await photoCfg.service.used(photoCfg.key, { downloadLocation: String(body.used) });
    res.status(200).json({ ok: true });
    return;
  }

  const query = String(body.query || '').trim().slice(0, MAX_QUERY);
  if (!query) return bad(res, 400, 'What should I search for?');
  const count = Math.min(Math.max(Number(body.count) || 8, 1), MAX_RESULTS);

  try {
    const photos = await photoCfg.service.search(photoCfg.key, query, count);
    res.status(200).json({ service: photoCfg.service.name, photos: photos });
  } catch (err) {
    if (err instanceof PhotoError) return bad(res, 502, err.message);
    console.error('photo search failed:', err && err.message);
    return bad(res, 502, 'The photo service did not answer. Try again.');
  }
}
