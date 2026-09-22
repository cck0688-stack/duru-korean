// DURU KOREAN — sentence-by-sentence translation for blog posts
//
// A blog post is written once, in one language, and read by people who
// speak seven others. This endpoint translates a handful of sentences
// into several languages at a time; the browser calls it in small
// batches while an admin watches a progress bar, then stores the result
// on the post itself (posts.mt). Readers never reach this endpoint —
// they read what was stored, so a post costs one translation, not one
// per visitor.
//
// It lives here rather than in the browser because the Anthropic API
// key must never be served to a visitor. Only an admin may call it:
// the caller's Supabase access token is verified against Supabase and
// checked against admin_users before a single token is spent.
//
// Environment variables (Vercel → Project → Settings → Environment
// Variables):
//
//   ANTHROPIC_API_KEY   required — console.anthropic.com → API keys
//   TRANSLATE_MODEL     optional — defaults to claude-opus-5
//   TRANSLATE_EFFORT    optional — low | medium | high (default medium)
//   SUPABASE_URL        optional — defaults to the project below
//   SUPABASE_ANON_KEY   optional — defaults to the key below
//
// The two Supabase values are the same public ones js/supabase-config.js
// already serves to every visitor; they are here only so a different
// project can be pointed at without editing code.

import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const MODEL = process.env.TRANSLATE_MODEL || 'claude-opus-5';
const EFFORT = process.env.TRANSLATE_EFFORT || 'medium';

// The site's eight languages, named as the model should name them.
const LANGUAGES = {
  en: 'English',
  vi: 'Vietnamese',
  es: 'Spanish',
  id: 'Indonesian',
  'pt-BR': 'Brazilian Portuguese',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Simplified Chinese'
};

// One call carries at most this much. The browser batches to stay well
// inside the function's time limit, and these are the backstop: a bug
// in the page cannot turn one save into an unbounded bill.
const MAX_SENTENCES = 25;
const MAX_TARGETS = 8;
const MAX_CHARS = 8000;

const SCHEMA = {
  type: 'object',
  properties: {
    languages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          sentences: { type: 'array', items: { type: 'string' } }
        },
        required: ['code', 'sentences'],
        additionalProperties: false
      }
    }
  },
  required: ['languages'],
  additionalProperties: false
};

function systemPrompt(fromName, targets, count) {
  return [
    'You translate one blog post for a Korean-language learning site, sentence by sentence.',
    '',
    'The source is ' + fromName + '. You are given exactly ' + count + ' numbered sentences ' +
      'and must return exactly ' + count + ' translated sentences per target language, in the same order.',
    '',
    'Rules:',
    '- One source sentence produces exactly one translated sentence. Never merge two, never split one,',
    '  never drop one, never add one. The counts must match or the result is unusable, because each',
    '  translation is shown directly beneath its own source sentence.',
    '- Translate what the sentence says, in natural, everyday prose a native reader would write.',
    '  Do not transliterate, do not explain, do not add notes or parentheses that are not in the source.',
    '- Keep proper nouns, place names and brand names as a reader of the target language would expect',
    '  (Seoul, 서울, 首尔, ソウル). Keep numbers, dates and prices as they are.',
    '- Keep the register of the source: a casual sentence stays casual, a polite one stays polite.',
    '- Korean words kept deliberately in the source (한글, 반말) may stay, with the target language’s',
    '  usual rendering beside them only if that is how the target language normally writes them.',
    '- If a sentence is a heading, a list item or a fragment, translate it as a heading, list item or',
    '  fragment — do not turn it into a full sentence.',
    '- Markdown marks (**, _, #, -, links) must survive in the same places.',
    '',
    'Target languages: ' + targets.map(function (c) { return LANGUAGES[c] + ' (' + c + ')'; }).join(', ') + '.',
    'Return one entry per target language, with its code exactly as given above.'
  ].join('\n');
}

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return bad(res, 503, 'Translation is not set up yet: ANTHROPIC_API_KEY is missing on the server.');
  }

  const allowed = await requireAdmin(req);
  if (!allowed.ok) return bad(res, allowed.status, allowed.message);

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const from = String(body.from || '');
  const targets = Array.isArray(body.to) ? body.to : [];
  const sentences = Array.isArray(body.sentences) ? body.sentences : [];

  if (!LANGUAGES[from]) return bad(res, 400, 'Unknown source language.');
  if (!targets.length || targets.length > MAX_TARGETS) return bad(res, 400, 'Pick 1–8 target languages.');
  if (targets.some(function (c) { return !LANGUAGES[c]; })) return bad(res, 400, 'Unknown target language.');
  if (targets.indexOf(from) !== -1) return bad(res, 400, 'The source language cannot also be a target.');
  if (!sentences.length || sentences.length > MAX_SENTENCES) {
    return bad(res, 400, 'Send 1–' + MAX_SENTENCES + ' sentences per request.');
  }
  if (sentences.some(function (s) { return typeof s !== 'string'; })) return bad(res, 400, 'Sentences must be text.');
  const chars = sentences.join('').length;
  if (chars > MAX_CHARS) return bad(res, 400, 'That batch is too long — send shorter batches.');

  const numbered = sentences.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(LANGUAGES[from], targets, sentences.length),
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: numbered }]
    });

    if (response.stop_reason === 'refusal') {
      return bad(res, 422, 'That text was declined by the translation model.');
    }

    const text = response.content
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return bad(res, 502, 'The translation came back in an unreadable shape. Try again.');
    }

    // A translation that lost or gained a sentence would pair the wrong
    // lines together for every sentence after it, so it is rejected
    // rather than stored.
    const out = {};
    for (const entry of parsed.languages || []) {
      if (!LANGUAGES[entry.code] || targets.indexOf(entry.code) === -1) continue;
      if (!Array.isArray(entry.sentences) || entry.sentences.length !== sentences.length) {
        return bad(res, 502, 'The translation did not line up with the source. Try again.');
      }
      out[entry.code] = entry.sentences.map(function (s) { return String(s == null ? '' : s); });
    }
    const missing = targets.filter(function (c) { return !out[c]; });
    if (missing.length) return bad(res, 502, 'No translation came back for: ' + missing.join(', '));

    res.status(200).json({ model: MODEL, translations: out });
  } catch (err) {
    const status = err && err.status;
    if (status === 401) return bad(res, 503, 'The translation key on the server was rejected.');
    if (status === 429) return bad(res, 429, 'Too many translations at once — wait a moment and try again.');
    console.error('translate failed:', err && err.message);
    return bad(res, 502, 'The translation service did not answer. Try again.');
  }
}
