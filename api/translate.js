// DURU KOREAN — sentence-by-sentence translation
//
// A blog post is written once, in one language, and read by people who
// speak seven others. This endpoint translates a handful of sentences
// into several languages at a time; the browser calls it in small
// batches while an admin watches a progress bar, then stores the result
// on the post itself (posts.mt). Readers never reach this endpoint —
// they read what was stored, so a post costs one translation, not one
// per visitor.
//
// It is deliberately not tied to one company. The provider lives in
// api/_providers.js behind a two-line interface; this file only checks
// who is asking, what they are asking for, and that the answer lines up
// with the question. Switching from one translation company to another
// is an environment variable.
//
// ── The contract ──────────────────────────────────────────────────
//
//   POST /api/translate
//   Authorization: Bearer <the caller's Supabase access token>
//   { "from": "ko", "to": ["en", "zh"], "sentences": ["…", "…"] }
//
//   200 { "provider": "anthropic", "model": "claude-opus-5",
//         "translations": { "en": ["…", "…"], "zh": ["…", "…"] } }
//
// Every target language comes back with exactly as many sentences as
// were sent, in the same order — that is the whole guarantee, and a
// provider that breaks it gets a 502 rather than a stored answer.
//
// The same endpoint also builds the self-study list under a Korean
// post: the words a learner would stumble on, each explained in the
// reader's own language, in the sense this post uses.
//
//   { "mode": "vocab", "from": "ko", "to": ["en", "zh"],
//     "sentences": [ …the whole post… ], "count": 5 }
//
//   200 { "provider": …, "model": …, "words": [
//           { "word": "발효", "romanization": "balhyo", "pos": "noun",
//             "sentence": "한식 맛의 핵심은 …",
//             "by": { "en": { "meaning": "fermentation",
//                             "explanation": "…" } } } ] }
//
// The same five words come back for every language, so a reader who
// switches language keeps the same list with new explanations.
//
// And it suggests the tags for a post, in the language the post is
// written in — `to` is not read in this mode:
//
//   { "mode": "tags", "from": "ko", "to": ["en"],
//     "sentences": [ …the whole post… ], "min": 3, "max": 5 }
//
//   200 { "provider": …, "model": …, "tags": ["교육", "유학", "어학연수"] }
//
// ── Configuration (Vercel → Settings → Environment Variables) ──────
//
//   One key is all that is required. Set whichever company's key you
//   have and the provider is picked from it:
//
//     ANTHROPIC_API_KEY   console.anthropic.com
//     OPENAI_API_KEY      platform.openai.com
//     GOOGLE_API_KEY      aistudio.google.com   (or GEMINI_API_KEY)
//     DEEPL_API_KEY       deepl.com/pro-api
//
//   Optional:
//     TRANSLATE_PROVIDER  anthropic | openai | google | deepl — set this
//                         when more than one key is present
//     TRANSLATE_API_KEY   the key, when you would rather not use the
//                         provider's own variable name
//     TRANSLATE_MODEL     model id. Each provider has a default, but
//                         Google renames and retires Gemini models often
//                         enough that setting this is worth it there —
//                         a name it does not know comes back as an error
//                         listing the names your key can use
//     TRANSLATE_BASE_URL  point "openai" at any OpenAI-compatible
//                         gateway — Azure OpenAI, Groq, Together,
//                         OpenRouter, a self-hosted vLLM or Ollama
//     TRANSLATE_EFFORT    low | medium | high (providers that have it)
//     SUPABASE_URL        defaults to the project below
//     SUPABASE_ANON_KEY   defaults to the key below
//
// The two Supabase values are the same public ones js/supabase-config.js
// already serves to every visitor; they are here only so a different
// project can be pointed at without editing code.

import { LANGUAGES, TranslateError, resolveProvider, translate, vocab, tags } from './_providers.js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

// One call carries at most this much. The browser batches to stay well
// inside the function's time limit, and these are the backstop: a bug
// in the page cannot turn one save into an unbounded bill.
const MAX_SENTENCES = 25;
const MAX_TARGETS = 8;
const MAX_CHARS = 8000;
// Picking the hardest words needs the whole post, not a batch of it, so
// the study list gets its own, larger ceiling — still bounded.
const MAX_VOCAB_SENTENCES = 120;
const MAX_VOCAB_CHARS = 20000;
const MAX_WORDS = 10;
const MAX_TAGS = 8;

function bad(res, status, message) {
  res.status(status).json({ error: message });
}

// The caller must be signed in to the site AND listed in admin_users.
// The anon key alone proves nothing — it is public — so the user's own
// access token is what is checked, and the admin_users read runs as
// that user, under the same Row Level Security policy the site uses.
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
    return { ok: false, status: 403, message: 'Only an admin can run translations.' };
  }
  return { ok: true, user };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 405, 'Use POST.');

  let cfg;
  try {
    cfg = resolveProvider(process.env);
  } catch (err) {
    return bad(res, err.status || 503, err.message);
  }

  const allowed = await requireAdmin(req);
  if (!allowed.ok) return bad(res, allowed.status, allowed.message);

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const mode = String(body.mode || 'sentences');
  const from = String(body.from || '');
  const targets = Array.isArray(body.to) ? body.to : [];
  const sentences = Array.isArray(body.sentences) ? body.sentences : [];
  const count = Math.min(Math.max(Number(body.count) || 5, 1), MAX_WORDS);

  if (['sentences', 'vocab', 'tags'].indexOf(mode) === -1) {
    return bad(res, 400, 'mode must be "sentences", "vocab" or "tags".');
  }
  if (!LANGUAGES[from]) return bad(res, 400, 'Unknown source language.');
  if (!targets.length || targets.length > MAX_TARGETS) return bad(res, 400, 'Pick 1–8 target languages.');
  if (targets.some(function (c) { return !LANGUAGES[c]; })) return bad(res, 400, 'Unknown target language.');
  if (targets.indexOf(from) !== -1) return bad(res, 400, 'The source language cannot also be a target.');
  if (sentences.some(function (s) { return typeof s !== 'string'; })) return bad(res, 400, 'Sentences must be text.');

  // Both whole-post jobs need the post, not a batch of it.
  const wholePost = mode === 'vocab' || mode === 'tags';
  const maxSentences = wholePost ? MAX_VOCAB_SENTENCES : MAX_SENTENCES;
  const maxChars = wholePost ? MAX_VOCAB_CHARS : MAX_CHARS;
  if (!sentences.length || sentences.length > maxSentences) {
    return bad(res, 400, 'Send 1–' + maxSentences + ' sentences per request.');
  }
  if (sentences.join('').length > maxChars) {
    return bad(res, 400, 'That is too long — send less text per request.');
  }

  try {
    if (mode === 'tags') {
      const min = Math.min(Math.max(Number(body.min) || 3, 1), MAX_TAGS);
      const max = Math.min(Math.max(Number(body.max) || 5, min), MAX_TAGS);
      const out = await tags(
        { from: from, fromName: LANGUAGES[from], sentences: sentences, min: min, max: max },
        cfg
      );
      res.status(200).json({ provider: cfg.name, model: out.model || cfg.model, tags: out.tags });
      return;
    }

    if (mode === 'vocab') {
      const list = await vocab(
        { from: from, fromName: LANGUAGES[from], targets: targets, sentences: sentences, count: count },
        cfg
      );
      res.status(200).json({ provider: cfg.name, model: list.model || cfg.model, words: list.words });
      return;
    }

    const result = await translate(
      { from: from, fromName: LANGUAGES[from], targets: targets, sentences: sentences },
      cfg
    );

    // A translation that lost or gained a sentence would pair the wrong
    // lines together for every sentence after it, so it is rejected
    // rather than passed on — whichever company produced it.
    const missing = targets.filter(function (c) {
      return !Array.isArray(result.translations[c]) || result.translations[c].length !== sentences.length;
    });
    if (missing.length) {
      return bad(res, 502, 'The translation did not line up with the source for: ' + missing.join(', '));
    }

    res.status(200).json({
      provider: cfg.name,
      model: result.model || cfg.model,
      translations: result.translations
    });
  } catch (err) {
    if (err instanceof TranslateError) return bad(res, err.status, err.message);
    console.error('translate failed:', err && err.message);
    return bad(res, 502, 'The translation service did not answer. Try again.');
  }
}
