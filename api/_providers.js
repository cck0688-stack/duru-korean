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
  async translate(opts, cfg) {
    // The one provider with an SDK in this project, so it uses it.
    const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined });
    let response;
    try {
      response = await client.messages.create({
        model: cfg.model,
        max_tokens: 16000,
        system: systemPrompt(opts.fromName, opts.targets, opts.sentences.length),
        output_config: { effort: cfg.effort, format: { type: 'json_schema', schema: schema(true) } },
        messages: [{ role: 'user', content: numbered(opts.sentences) }]
      });
    } catch (err) {
      if (err && err.status === 401) throw new TranslateError(503, 'The Anthropic key on the server was rejected.');
      if (err && err.status === 429) throw new TranslateError(429, 'Too many translations at once — wait a moment and try again.');
      throw new TranslateError(502, 'Anthropic did not answer. Try again.');
    }
    if (response.stop_reason === 'refusal') {
      throw new TranslateError(422, 'That text was declined by the translation model.');
    }
    const text = response.content
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');
    return { model: cfg.model, translations: parseLanguages(text, opts.targets, opts.sentences.length) };
  }
};

/* ------------------------------------------------------------------ *
 * OpenAI, and anything that speaks its chat-completions shape
 * ------------------------------------------------------------------ */

const openai = {
  envKeys: ['OPENAI_API_KEY'],
  defaultModel: 'gpt-4o-mini',
  defaultBaseUrl: 'https://api.openai.com/v1',
  label: 'OpenAI',
  async translate(opts, cfg) {
    const response = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: systemPrompt(opts.fromName, opts.targets, opts.sentences.length) },
          { role: 'user', content: numbered(opts.sentences) }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'translations', strict: true, schema: schema(true) }
        }
      })
    });
    const data = await readJSON(response, cfg.label);
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    return { model: cfg.model, translations: parseLanguages(text || '', opts.targets, opts.sentences.length) };
  }
};

/* ------------------------------------------------------------------ *
 * Google Gemini
 * ------------------------------------------------------------------ */

const google = {
  envKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  defaultModel: 'gemini-2.0-flash',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  label: 'Google',
  async translate(opts, cfg) {
    const url = cfg.baseUrl.replace(/\/$/, '') + '/models/' + encodeURIComponent(cfg.model) + ':generateContent';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(opts.fromName, opts.targets, opts.sentences.length) }] },
        contents: [{ role: 'user', parts: [{ text: numbered(opts.sentences) }] }],
        // Gemini's schema dialect rejects additionalProperties, so the
        // looser schema goes here; the count check still guards the answer.
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema(false) }
      })
    });
    const data = await readJSON(response, cfg.label);
    const parts = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts;
    const text = (parts || []).map(function (p) { return p.text || ''; }).join('');
    return { model: cfg.model, translations: parseLanguages(text, opts.targets, opts.sentences.length) };
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
