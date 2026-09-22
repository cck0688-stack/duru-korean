// DURU KOREAN — translation providers
//
// The site does not care which company translates its sentences. This
// file holds one small adapter per provider, all with the same shape:
//
//   translate({ fromName, targets, sentences }) → { model, translations }
//
// where `translations` is { "<lang code>": ["…", "…"] } with exactly one
// translated sentence per source sentence. Everything above this file —
// the HTTP handler, the admin check, the alignment check, the browser —
// is provider-neutral, so switching companies is one environment
// variable, not a rewrite.
//
// An adapter supplies one method, `chat(cfg, system, user, schema)`,
// which sends an instruction and some text and returns the JSON that
// comes back. Translating and picking vocabulary are both written once
// on top of that, so a new provider costs one adapter, not two features.
// DeepL is the exception: it translates and does nothing else, so it
// brings its own `translate` and no `chat` at all.
//
// Adding another provider means adding one entry to PROVIDERS below.
// Anything that speaks the OpenAI chat-completions shape (Azure OpenAI,
// Groq, Together, OpenRouter, Fireworks, a self-hosted vLLM or Ollama)
// needs no new code at all — point TRANSLATE_BASE_URL at it.

import Anthropic from '@anthropic-ai/sdk';

// The site's eight languages, named as a translator should name them.
export const LANGUAGES = {
  en: 'English',
  vi: 'Vietnamese',
  es: 'Spanish',
  id: 'Indonesian',
  'pt-BR': 'Brazilian Portuguese',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Simplified Chinese'
};

export class TranslateError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ *
 * The instruction, shared by every provider that takes one
 * ------------------------------------------------------------------ */

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
    '- If a sentence is a heading, a list item or a fragment, translate it as a heading, list item or',
    '  fragment — do not turn it into a full sentence.',
    '- Markdown marks (**, _, #, -, links) must survive in the same places.',
    '',
    'Target languages: ' + targets.map(function (c) { return LANGUAGES[c] + ' (' + c + ')'; }).join(', ') + '.',
    'Return one entry per target language, with its code exactly as given above.'
  ].join('\n');
}

function numbered(sentences) {
  return sentences.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
}

// The self-study corner: the words a learner would stumble on, each
// explained in the reader's own language, in the sense this post uses.
function vocabPrompt(targets, count) {
  return [
    'You prepare a short self-study list for a Korean-language learning site.',
    '',
    'You are given one blog post written in Korean, as numbered sentences. Pick the ' + count +
      ' Korean words or expressions an intermediate learner is most likely to be stopped by,',
    'and explain each one.',
    '',
    'Choosing the words:',
    '- Pick words that carry the meaning of the post, not the easiest nouns in it and not',
    '  grammar particles (은/는, 이/가, 에서) on their own.',
    '- A set phrase or an idiom counts as one word (자리매김하다, 눈에 띄다).',
    '- Give the dictionary form: a verb or adjective ends in -다 (재해석되다, not 재해석된).',
    '- No proper nouns, no numbers, no words that are the same in the target language.',
    '- Each word must actually appear in the post.',
    '',
    'Explaining them:',
    '- A Korean word usually has several meanings. Give the one THIS post uses and no other:',
    '  "발효" beside kimchi is food fermentation, not a law taking effect.',
    '- `meaning` is the short gloss — two or three words a reader could put in a notebook.',
    '- `explanation` is one or two sentences saying what the word does in this sentence, and',
    '  anything a learner needs to use it: what it attaches to, how formal it is, a near',
    '  synonym worth knowing. Write it in the target language, not in Korean.',
    '- `sentence` is the sentence from the post the word appears in, copied exactly.',
    '- `romanization` uses Revised Romanization (balhyo, jarimaegimhada).',
    '- `pos` is one of: noun, verb, adjective, adverb, phrase.',
    '',
    'Return the same ' + count + ' words for every language, in the same order, with one entry',
    'per target language inside each word.',
    '',
    'Target languages: ' + targets.map(function (c) { return LANGUAGES[c] + ' (' + c + ')'; }).join(', ') + '.'
  ].join('\n');
}

// What a post is: a one-line summary, the shelf it belongs on, and its
// tags. All three are read off the same text, so they are asked for
// together — one request rather than three, and one reading of the post
// rather than three that might disagree with each other.
//
// They come back in the language the post is written in. A summary sits
// on the card under the title, and a tag is the author's own label that
// a reader clicks to find the others like it; both belong to the
// writing. (Readers in another language get them translated with
// everything else — see posts.mt.)
function outlinePrompt(langName, categories, audiences, min, max) {
  var topics = categories.map(function (c) {
    return '   - ' + c.id + ': ' + c.about;
  }).join('\n');
  var lines = [
    'You file one blog post for a site written for people visiting or living in Korea',
    'from somewhere else — tourists, international students, and long-term residents.',
    '',
    'Read the post and return the following, all written in ' + langName + '.',
    '',
    '1. `summary` — one or two sentences saying what a reader would get from this post.',
    '   It sits under the title on the card, so write it to make someone open the post,',
    '   not to save them from having to. Under 250 characters. No "This post is about".',
    '',
    '2. `category` — exactly one of these ids, whichever the post belongs on:',
    topics,
    '   Pick "etc" only when none of the others is defensible.',
    ''
  ];
  if (audiences && audiences.length) {
    lines.push('3. `audiences` — who this post is actually useful to. One or more of:');
    lines.push(audiences.map(function (a) { return '   - ' + a.id + ': ' + a.about; }).join('\n'));
    lines.push('   Pick every one it genuinely helps, and no more. A post about extending a');
    lines.push('   student visa is not for tourists; a subway guide is for all three.');
    lines.push('');
    lines.push('4. `tags` — between ' + min + ' and ' + max + ' of them:');
  } else {
    lines.push('3. `tags` — between ' + min + ' and ' + max + ' of them:');
  }
  return lines.concat([
    '   - A tag is what the post is ABOUT, the way a reader looking for more like it would',
    '     think of it. Not every noun in the text, and not a summary.',
    '   - One to three words each. No hash marks, no punctuation, no quotes, no numbering.',
    '   - Order them broadest first, most specific last.',
    '   - No duplicates and no two tags that mean the same thing.',
    '   - Lowercase, unless the language or the word itself calls for capitals (a place, a brand).',
    '   - Do not tag it with the obvious ("Korean", "blog", "post") — every post here would',
    '     carry those.'
  ]).join('\n');
}

function outlineSchema(strict, categories, audiences) {
  var root = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      category: { type: 'string', enum: categories.map(function (c) { return c.id; }) },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['summary', 'category', 'tags']
  };
  if (audiences && audiences.length) {
    root.properties.audiences = {
      type: 'array',
      items: { type: 'string', enum: audiences.map(function (a) { return a.id; }) }
    };
    root.required.push('audiences');
  }
  if (strict) root.additionalProperties = false;
  return root;
}

function parseOutline(text, categories, audiences, min, max) {
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new TranslateError(502, 'That came back in an unreadable shape. Try again.');
  }
  var seen = {};
  var tags = ((parsed && parsed.tags) || [])
    .map(function (x) { return String(x == null ? '' : x).trim().replace(/^#+/, '').trim(); })
    .filter(function (x) {
      if (!x || x.length > 32) return false;
      var key = x.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    })
    .slice(0, max);

  var ids = categories.map(function (c) { return c.id; });
  var category = String((parsed && parsed.category) || '').trim();
  // A category that is not one of the seven is worse than none: it would
  // fail the database's check constraint on save.
  if (ids.indexOf(category) === -1) category = '';

  var allowed = {};
  (audiences || []).forEach(function (a) { allowed[a.id] = true; });
  var picked = {};
  var who = ((parsed && parsed.audiences) || [])
    .map(function (x) { return String(x == null ? '' : x).trim(); })
    .filter(function (x) {
      if (!allowed[x] || picked[x]) return false;
      picked[x] = true;
      return true;
    });

  var summary = String((parsed && parsed.summary) || '').trim().slice(0, 300);

  if (!summary && !category && !tags.length) {
    throw new TranslateError(502, 'Nothing usable came back. Try again.');
  }
  return { summary: summary, category: category, audiences: who, tags: tags };
}

function vocabSchema(strict) {
  var by = {
    type: 'object',
    properties: {
      code: { type: 'string' },
      meaning: { type: 'string' },
      explanation: { type: 'string' }
    },
    required: ['code', 'meaning', 'explanation']
  };
  var word = {
    type: 'object',
    properties: {
      word: { type: 'string' },
      romanization: { type: 'string' },
      pos: { type: 'string' },
      sentence: { type: 'string' },
      by: { type: 'array', items: by }
    },
    required: ['word', 'romanization', 'pos', 'sentence', 'by']
  };
  if (strict) { by.additionalProperties = false; word.additionalProperties = false; }
  var root = {
    type: 'object',
    properties: { words: { type: 'array', items: word } },
    required: ['words']
  };
  if (strict) root.additionalProperties = false;
  return root;
}

// The answer every language model is asked for. `strict` is set where a
// provider supports it; where it does not, the count check in the
// handler still catches a malformed answer.
function schema(strict) {
  var entry = {
    type: 'object',
    properties: {
      code: { type: 'string' },
      sentences: { type: 'array', items: { type: 'string' } }
    },
    required: ['code', 'sentences']
  };
  if (strict) entry.additionalProperties = false;
  var root = {
    type: 'object',
    properties: { languages: { type: 'array', items: entry } },
    required: ['languages']
  };
  if (strict) root.additionalProperties = false;
  return root;
}

// The vocabulary answer, checked before it is handed back: the right
// number of words, each with an entry for every language asked for.
// A list that is short or missing a language is refused rather than
// shown half-filled.
function parseVocab(text, targets, count) {
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new TranslateError(502, 'The word list came back in an unreadable shape. Try again.');
  }
  var words = (parsed && parsed.words) || [];
  if (!Array.isArray(words) || words.length < 1) {
    throw new TranslateError(502, 'No words came back for the study list. Try again.');
  }
  return words.slice(0, count).map(function (w) {
    var by = {};
    ((w && w.by) || []).forEach(function (e) {
      if (e && targets.indexOf(e.code) !== -1) {
        by[e.code] = { meaning: String(e.meaning || ''), explanation: String(e.explanation || '') };
      }
    });
    var missing = targets.filter(function (c) { return !by[c] || !by[c].meaning; });
    if (missing.length) {
      throw new TranslateError(502, 'The study list is missing: ' + missing.join(', ') + '. Try again.');
    }
    return {
      word: String((w && w.word) || ''),
      romanization: String((w && w.romanization) || ''),
      pos: String((w && w.pos) || ''),
      sentence: String((w && w.sentence) || ''),
      by: by
    };
  }).filter(function (w) { return w.word; });
}

function parseLanguages(text, targets, count) {
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new TranslateError(502, 'The translation came back in an unreadable shape. Try again.');
  }
  var out = {};
  for (const entry of (parsed && parsed.languages) || []) {
    if (!entry || targets.indexOf(entry.code) === -1) continue;
    if (!Array.isArray(entry.sentences) || entry.sentences.length !== count) {
      throw new TranslateError(502, 'The translation did not line up with the source. Try again.');
    }
    out[entry.code] = entry.sentences.map(function (s) { return String(s == null ? '' : s); });
  }
  return out;
}

async function readJSON(response, label) {
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new TranslateError(503, 'The ' + label + ' key on the server was rejected.');
    }
    if (response.status === 429) {
      throw new TranslateError(429, 'Too many translations at once — wait a moment and try again.');
    }
    throw new TranslateError(502, label + ' answered ' + response.status + '. Try again.');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new TranslateError(502, label + ' sent something that was not JSON.');
  }
}

/* ------------------------------------------------------------------ *
 * Anthropic
 * ------------------------------------------------------------------ */

const anthropic = {
  envKeys: ['ANTHROPIC_API_KEY'],
  defaultModel: 'claude-opus-5',
  label: 'Anthropic',
  strictSchema: true,
  async chat(cfg, system, user, jsonSchema) {
    // The one provider with an SDK in this project, so it uses it.
    const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined });
    let response;
    try {
      response = await client.messages.create({
        model: cfg.model,
        max_tokens: 16000,
        system,
        output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: jsonSchema } },
        messages: [{ role: 'user', content: user }]
      });
    } catch (err) {
      if (err && err.status === 401) throw new TranslateError(503, 'The Anthropic key on the server was rejected.');
      if (err && err.status === 429) throw new TranslateError(429, 'Too many requests at once — wait a moment and try again.');
      throw new TranslateError(502, 'Anthropic did not answer. Try again.');
    }
    if (response.stop_reason === 'refusal') {
      throw new TranslateError(422, 'That text was declined by the model.');
    }
    return response.content
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');
  }
};

/* ------------------------------------------------------------------ *
 * OpenAI, and anything that speaks its chat-completions shape
 * ------------------------------------------------------------------ */

// Model names come and go at every provider, and a gateway offers a
// different set again, so a name the endpoint does not know turns into
// an error that lists the ones it does rather than a bare 404.
async function chatModelHint(base, apiKey) {
  try {
    const res = await fetch(base.replace(/\/$/, '') + '/models', {
      headers: { Authorization: 'Bearer ' + apiKey }
    });
    if (!res.ok) return '';
    const data = await res.json();
    const names = (data.data || [])
      .map(function (m) { return String(m.id || ''); })
      .filter(function (n) { return n && !/embed|whisper|tts|dall|image|audio|moder/i.test(n); })
      .sort()
      .slice(0, 8);
    return names.length ? ' Models this key can use include: ' + names.join(', ') + '.' : '';
  } catch (e) {
    return '';
  }
}

const openai = {
  envKeys: ['OPENAI_API_KEY'],
  defaultModel: 'gpt-5-mini',
  defaultBaseUrl: 'https://api.openai.com/v1',
  label: 'OpenAI',
  strictSchema: true,
  async chat(cfg, system, user, jsonSchema) {
    const response = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'answer', strict: true, schema: jsonSchema }
        }
      })
    });
    if (response.status === 404 || response.status === 400) {
      const hint = await chatModelHint(cfg.baseUrl, cfg.apiKey);
      throw new TranslateError(503, cfg.label + ' did not accept the model "' + cfg.model +
        '". Set TRANSLATE_MODEL to one it offers.' + hint);
    }
    const data = await readJSON(response, cfg.label);
    return (data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '') || '';
  }
};

/* ------------------------------------------------------------------ *
 * Google Gemini
 * ------------------------------------------------------------------ */

// Google retires and renames Gemini models often enough that any default
// written here goes stale. Rather than guess, a model the API does not
// know turns into an error that lists the ones it does.
async function geminiModelHint(base, apiKey) {
  try {
    const res = await fetch(base.replace(/\/$/, '') + '/models', { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) return '';
    const data = await res.json();
    const names = (data.models || [])
      .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; })
      .map(function (m) { return String(m.name || '').replace(/^models\//, ''); })
      .filter(function (n) { return /flash|pro/.test(n); })
      .slice(0, 6);
    return names.length ? ' Models this key can use include: ' + names.join(', ') + '.' : '';
  } catch (e) {
    return '';
  }
}

const google = {
  envKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  defaultModel: 'gemini-2.0-flash',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  label: 'Google',
  // Gemini's schema dialect rejects additionalProperties, so it gets the
  // looser schema; the checks on the way back still guard the answer.
  strictSchema: false,
  async chat(cfg, system, user, jsonSchema) {
    const url = cfg.baseUrl.replace(/\/$/, '') + '/models/' + encodeURIComponent(cfg.model) + ':generateContent';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: jsonSchema }
      })
    });
    if (response.status === 404 || response.status === 400) {
      const hint = await geminiModelHint(cfg.baseUrl, cfg.apiKey);
      throw new TranslateError(503, 'Google did not accept the model "' + cfg.model +
        '". Set TRANSLATE_MODEL to one it offers.' + hint);
    }
    const data = await readJSON(response, cfg.label);
    const parts = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts;
    return (parts || []).map(function (p) { return p.text || ''; }).join('');
  }
};

/* ------------------------------------------------------------------ *
 * DeepL — a translation service rather than a language model
 * ------------------------------------------------------------------ */

// DeepL names its targets its own way. The map is the translation from
// the site's codes; whether DeepL still serves each one is DeepL's
// business, so a rejection comes back naming the language rather than as
// a bare 400 — its supported list grows over time and hardcoding a
// guess here would go stale.
const DEEPL_TARGET = {
  en: 'EN-US',
  es: 'ES',
  id: 'ID',
  'pt-BR': 'PT-BR',
  ko: 'KO',
  ja: 'JA',
  zh: 'ZH',
  vi: 'VI'
};
const DEEPL_SOURCE = { en: 'EN', es: 'ES', id: 'ID', 'pt-BR': 'PT', ko: 'KO', ja: 'JA', zh: 'ZH', vi: 'VI' };

const deepl = {
  envKeys: ['DEEPL_API_KEY'],
  defaultModel: '',
  label: 'DeepL',
  // A free-tier key ends in ":fx" and lives on a different host.
  baseUrlFor(key) {
    return /:fx$/.test(key) ? 'https://api-free.deepl.com/v2' : 'https://api.deepl.com/v2';
  },
  async translate(opts, cfg) {
    const base = (cfg.baseUrl || deepl.baseUrlFor(cfg.apiKey)).replace(/\/$/, '');
    const source = DEEPL_SOURCE[opts.from];
    const out = {};
    // One request per target language: DeepL translates into one
    // language at a time. Alignment is free here — it answers with one
    // translation per input string, in order, as long as it is told not
    // to re-split the sentences itself.
    for (const code of opts.targets) {
      const target = DEEPL_TARGET[code];
      if (!target) {
        throw new TranslateError(400, 'DeepL does not translate into ' + LANGUAGES[code] + '. Use another provider for it.');
      }
      const response = await fetch(base + '/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'DeepL-Auth-Key ' + cfg.apiKey },
        body: JSON.stringify({
          text: opts.sentences,
          source_lang: source || undefined,
          target_lang: target,
          // DeepL would otherwise re-split the sentences itself and the
          // counts would stop matching.
          split_sentences: '0',
          preserve_formatting: true
        })
      });
      if (response.status === 400) {
        throw new TranslateError(400, 'DeepL would not translate into ' + LANGUAGES[code] +
          '. It may not offer that language — use another provider for it.');
      }
      if (response.status === 456) {
        throw new TranslateError(429, 'The DeepL character quota for this month is used up.');
      }
      const data = await readJSON(response, 'DeepL');
      const list = (data && data.translations) || [];
      if (list.length !== opts.sentences.length) {
        throw new TranslateError(502, 'The translation did not line up with the source. Try again.');
      }
      out[code] = list.map(function (t) { return String((t && t.text) || ''); });
    }
    return { model: 'deepl', translations: out };
  }
};

export const PROVIDERS = { anthropic, openai, google, deepl };

/* ------------------------------------------------------------------ *
 * The two jobs, written once on top of whichever adapter is in use
 * ------------------------------------------------------------------ */

export async function translate(opts, cfg) {
  // DeepL translates and nothing else, so it brings its own.
  if (cfg.provider.translate) return cfg.provider.translate(opts, cfg);
  const text = await cfg.provider.chat(
    cfg,
    systemPrompt(opts.fromName, opts.targets, opts.sentences.length),
    numbered(opts.sentences),
    schema(cfg.provider.strictSchema !== false)
  );
  return { model: cfg.model, translations: parseLanguages(text, opts.targets, opts.sentences.length) };
}

export async function outline(opts, cfg) {
  if (!cfg.provider.chat) {
    throw new TranslateError(400, cfg.label + ' only translates — it cannot read a post. ' +
      'Set TRANSLATE_PROVIDER to anthropic, openai or google for this.');
  }
  const text = await cfg.provider.chat(
    cfg,
    outlinePrompt(opts.fromName, opts.categories, opts.audiences, opts.min, opts.max),
    numbered(opts.sentences),
    outlineSchema(cfg.provider.strictSchema !== false, opts.categories, opts.audiences)
  );
  return Object.assign({ model: cfg.model },
    parseOutline(text, opts.categories, opts.audiences, opts.min, opts.max));
}

export async function vocab(opts, cfg) {
  if (!cfg.provider.chat) {
    throw new TranslateError(400, cfg.label + ' only translates — it cannot build a study list. ' +
      'Set TRANSLATE_PROVIDER to anthropic, openai or google for this.');
  }
  const text = await cfg.provider.chat(
    cfg,
    vocabPrompt(opts.targets, opts.count),
    numbered(opts.sentences),
    vocabSchema(cfg.provider.strictSchema !== false)
  );
  return { model: cfg.model, words: parseVocab(text, opts.targets, opts.count) };
}

// Which provider to use, and with what. An explicit TRANSLATE_PROVIDER
// wins; otherwise the first provider whose key is present is taken, so
// a site that only ever sets one key needs no other configuration.
export function resolveProvider(env) {
  const named = String(env.TRANSLATE_PROVIDER || '').trim().toLowerCase();
  const order = named ? [named] : Object.keys(PROVIDERS);
  if (named && !PROVIDERS[named]) {
    throw new TranslateError(503, 'TRANSLATE_PROVIDER is set to "' + named +
      '", which is not one of: ' + Object.keys(PROVIDERS).join(', ') + '.');
  }

  for (const name of order) {
    const provider = PROVIDERS[name];
    const key = env.TRANSLATE_API_KEY ||
      provider.envKeys.map(function (k) { return env[k]; }).filter(Boolean)[0];
    if (!key) continue;
    return {
      name: name,
      provider: provider,
      apiKey: key,
      label: provider.label,
      model: env.TRANSLATE_MODEL || provider.defaultModel,
      baseUrl: env.TRANSLATE_BASE_URL || provider.defaultBaseUrl || '',
      effort: env.TRANSLATE_EFFORT || 'medium'
    };
  }

  throw new TranslateError(503,
    'Translation is not set up yet: no provider key on the server. Set TRANSLATE_API_KEY (with ' +
    'TRANSLATE_PROVIDER), or one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, DEEPL_API_KEY.');
}
