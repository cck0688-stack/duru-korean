// DURU KOREAN — reading the community in your own language
//
// A member writes in Vietnamese. A reader who has the site in English
// presses "Read in English" and gets that post, and the replies under
// it, in English — without a Vietnamese board existing, without the
// post being duplicated, and without the author's Vietnamese being
// thrown away. One post, one id, one thread; the translation is
// something attached to it.
//
// ── The contract ──────────────────────────────────────────────────
//
//   POST /api/community-translate
//   { "ids": ["<uuid>", …], "to": "en" }
//
//   200 {
//     "to": "en",
//     "engine": "openai:gpt-5",
//     "items": {
//       "<uuid>": { "body": "…", "from": "vi", "cached": false },
//       "<uuid>": { "same": true },            // already in English
//       "<uuid>": { "error": "…" }
//     }
//   }
//
// ── Why it takes ids and not text ─────────────────────────────────
//
// This endpoint is open: a reader does not sign in to read, and asking
// them to would defeat the entire point. An open endpoint that
// translates whatever text it is handed is somebody else's free
// translation API, billed to this site.
//
// So it never accepts text. It accepts the id of a row that is already
// public, reads that row itself, and translates that. The most anyone
// can spend is what it costs to translate the posts that exist into
// the eight languages the site publishes — a number that is finite,
// that shrinks every time a translation is cached, and that a visitor
// cannot grow except by writing posts, which they could do anyway.
//
// ── Why the translation is stored, and how ────────────────────────
//
// A popular thread read by a hundred people should cost one
// translation, not a hundred. Translations are written back onto the
// row (stories.mt) and come down with the row on the next page load,
// so the second reader makes no request at all.
//
// The write is the delicate part, because the reader who triggered it
// does not own the post. It does not use service_role — that key reads
// every row of every table and has no business in a function a visitor
// can reach. It uses a secret that can do exactly one thing: the SQL
// function public.cache_story_translation compares TRANSLATE_CACHE_SECRET
// against its own copy and writes nothing if it does not match. See
// supabase/schema.sql §33a.
//
// If the secret is not set, translations still work; they are simply
// re-fetched each time instead of remembered. Deploy first, configure
// after.
//
// ── Configuration (Vercel → Settings → Environment Variables) ─────
//
//   The translation provider is the one api/translate.js already uses —
//   whichever of ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY /
//   DEEPL_API_KEY is set, with the optional TRANSLATE_* overrides.
//   Nothing new is needed for translation itself.
//
//   New, and optional:
//     TRANSLATE_CACHE_SECRET   any long random string. Put the same
//                              string in the database:
//                                insert into public.app_secrets (name, value)
//                                values ('translate_cache', '<the string>')
//                                on conflict (name) do update set value = excluded.value;

import { LANGUAGES, TranslateError, asFast, resolveProvider, translate } from './_providers.js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const CACHE_SECRET = process.env.TRANSLATE_CACHE_SECRET || '';

// A thread: one post and its replies. Deep enough for any real
// conversation, low enough that one press cannot become a large bill.
const MAX_IDS = 25;
// The stories table already caps a body at 4000 characters; this is the
// backstop for the whole request.
const MAX_CHARS = 24000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The community's own instruction, rather than the blog's.
//
// Two reasons it is its own. The blog's is written for an article —
// markdown marks, headings, numbered lists — and would tidy a post into
// something its author did not say. And it is five hundred tokens long,
// which is free at four in the morning and is not free when somebody is
// watching a spinner: this one is a fifth of that, and every one of
// those tokens is read before the first word comes back.
function prompt(fromName, code, count) {
  return [
    'You translate one short post from a community forum where learners of Korean talk to each',
    'other. They are ordinary people writing quickly, not writers.',
    '',
    'The source is ' + fromName + '. You are given exactly ' + count + ' numbered lines and must',
    'return exactly ' + count + ', in the same order.',
    '',
    '- One line in, one line out. Never merge, split, drop or add one.',
    '- Plain everyday language, the way a person would actually write it. Do not explain, do not',
    '  add notes, do not tidy up what they said.',
    '- Keep the register: casual stays casual, polite stays polite.',
    '- Keep names, numbers, prices and dates as they are.',
    '- The "1. 2. 3." in front of the lines is how they are handed to you, not part of them.',
    '  Never repeat it. A number the writer typed themselves stays exactly as written.',
    '',
    'Target language: ' + LANGUAGES[code] + ' (' + code + '). Return one entry, with that code.'
  ].join('\n');
}

// Now and then a model hands a line back exactly as it came instead of
// translating it — seen with Portuguese posts shown to Indonesian readers,
// which quote a word or two of Indonesian. Kept, that would sit under the
// "translated" mark in the source language for every reader after. A line
// counts when it has a dozen letters or more (a "kkkk" or an emoji line
// rightly stays as it is); more than half of those unchanged is an echo.
export function echoed(source, out) {
  const norm = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().toLowerCase();
  const letters = (x) => (String(x).match(/\p{L}/gu) || []).length;
  let long = 0;
  let same = 0;
  source.forEach((line, i) => {
    if (letters(line) < 12) return;
    long += 1;
    if (norm(line) === norm(out[i])) same += 1;
  });
  return long > 0 && same * 2 > long;
}

function bad(res, status, message) {
  res.status(status).json({ error: message });
}

// Must match hashText in js/lang-detect.js exactly — the browser uses
// the stored hash to decide whether a cached translation still belongs
// to the body it can see. test_community_mt.mjs compares the two.
export function hashText(text) {
  const s = String(text == null ? '' : text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// A body is translated line by line, with the blank lines left where
// they are. That keeps paragraphs where the author put them, and it
// keeps the promise the provider makes — n lines in, n lines out —
// meaningful at the level the page renders.
export function linesOf(body) {
  return String(body == null ? '' : body).split('\n');
}

export function rebuild(lines, translated) {
  let i = 0;
  return lines.map((line) => (line.trim() ? (translated[i++] ?? line) : line)).join('\n');
}

async function readStories(ids) {
  const url = SUPABASE_URL + '/rest/v1/stories'
    + '?select=id,body,lang,mt'
    + '&id=in.(' + ids.map(encodeURIComponent).join(',') + ')';
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
  });
  if (!r.ok) throw new TranslateError(502, 'Could not read those posts.');
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

// Best effort by design: a translation that could not be remembered is
// still a translation, and the reader should never see an error about
// the site's own bookkeeping.
async function remember(id, lang, body, hash, engine) {
  if (!CACHE_SECRET) return false;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/cache_story_translation', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_secret: CACHE_SECRET, p_id: id, p_lang: lang,
        p_body: body, p_hash: hash, p_engine: engine
      })
    });
    if (!r.ok) {
      console.warn('translation cache refused:', r.status);
      return false;
    }
    return (await r.json()) === true;
  } catch (err) {
    console.warn('translation cache failed:', err && err.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 405, 'Use POST.');

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const to = String(body.to || '');
  const asked = Array.isArray(body.ids) ? body.ids : [];

  if (!LANGUAGES[to]) return bad(res, 400, 'Unknown target language.');
  if (!asked.length || asked.length > MAX_IDS) {
    return bad(res, 400, 'Ask for 1–' + MAX_IDS + ' posts at a time.');
  }
  const ids = asked.filter((id) => typeof id === 'string' && UUID.test(id));
  if (ids.length !== asked.length) return bad(res, 400, 'Those are not post ids.');

  let cfg;
  try {
    // Somebody is waiting on this one, so it runs on the fast profile.
    cfg = asFast(resolveProvider(process.env));
  } catch (err) {
    return bad(res, err.status || 503, err.message);
  }

  let rows;
  try {
    rows = await readStories(Array.from(new Set(ids)));
  } catch (err) {
    return bad(res, err.status || 502, err.message);
  }

  const items = {};
  const work = [];
  let chars = 0;

  for (const row of rows) {
    const text = String(row.body || '');
    const from = LANGUAGES[row.lang] ? row.lang : null;

    if (!text.trim()) { items[row.id] = { same: true }; continue; }
    // Written in the language being asked for: there is nothing to do,
    // and pretending otherwise would put a machine translation in front
    // of a reader who could have had the author's own words.
    if (from === to) { items[row.id] = { same: true }; continue; }

    const hash = hashText(text);
    const kept = row.mt && row.mt[to];
    const keptEcho = kept && kept.body &&
      echoed(linesOf(text).filter((l) => l.trim()), linesOf(String(kept.body)).filter((l) => l.trim()));
    if (kept && kept.body && kept.hash === hash && !keptEcho) {
      items[row.id] = { body: String(kept.body), from: from, cached: true };
      continue;
    }

    chars += text.length;
    if (chars > MAX_CHARS) {
      items[row.id] = { error: 'too-long' };
      continue;
    }
    work.push({ id: row.id, text: text, from: from, hash: hash });
  }

  const engine = cfg.name + ':' + cfg.model;
  // Started as each translation lands and collected at the very end,
  // after the answer has already gone out. Remembering a translation is
  // this site's bookkeeping; there is no reason for a reader to sit and
  // watch a spinner through a database write that does nothing for them.
  const writes = [];

  await Promise.all(work.map(async (job) => {
    const lines = linesOf(job.text);
    const units = lines.filter((l) => l.trim());
    try {
      const ask = (again) => translate({
        // A post written before the language column existed says
        // nothing about itself. An empty `from` is DeepL's way of
        // spelling "detect it", and the sentence below is how the
        // model-backed providers are told the same thing.
        from: job.from || '',
        targets: [to],
        sentences: units,
        prompt: prompt(
          job.from ? LANGUAGES[job.from]
            : 'an unknown language, which you should work out from the text itself',
          to, units.length
        ) + (again
          ? '\n\nThe last answer gave the lines back untranslated. Every line must be written in ' +
            LANGUAGES[to] + ', even where the writer quotes a word of it; copy nothing across.'
          : '')
      }, cfg);
      let got = (await ask(false)).translations[to];
      if (Array.isArray(got) && got.length === units.length && echoed(units, got)) {
        got = (await ask(true)).translations[to];
        if (Array.isArray(got) && got.length === units.length && echoed(units, got)) {
          // Better the author's words with the button to try again than
          // the author's words labelled as a translation, kept for good.
          items[job.id] = { error: 'failed' };
          return;
        }
      }
      if (!Array.isArray(got) || got.length !== units.length) {
        items[job.id] = { error: 'mismatched' };
        return;
      }
      const text = rebuild(lines, got);
      writes.push(remember(job.id, to, text, job.hash, engine));
      items[job.id] = { body: text, from: job.from, cached: false };
    } catch (err) {
      if (!(err instanceof TranslateError)) {
        console.error('community translate failed:', err && err.message);
      }
      items[job.id] = { error: 'failed' };
    }
  }));

  res.status(200).json({ to: to, engine: engine, items: items });

  // The reader has their translation by now. This is what makes the
  // next reader's free, and if it fails they simply pay for theirs too.
  if (writes.length) await Promise.allSettled(writes);
}
