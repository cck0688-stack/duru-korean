// DURU KOREAN — translating a draft the moment it is written
//
// The morning's seven drafts are written in Korean. Every reader this
// blog is for reads something else, so a Korean-only draft is invisible
// to almost everyone until somebody translates it — and asking an admin
// to translate seven posts into seven languages before breakfast is
// asking for a blog that never gets published. So the generator does it
// while it has the post in front of it, and approval becomes one click
// on something already readable in eight languages.
//
// ── Why this file loads a browser script ──────────────────────────
//
// posts.mt pairs each source sentence with its translation, and the two
// sides are split apart twice: here, to send them, and in the reader's
// browser, to line them back up. If the two splitters ever disagreed by
// one sentence the reader would meet translations under the wrong
// lines — or, because a fingerprint guards it, no translation at all.
//
// Rather than keep a second copy of that splitter in step by hand, this
// runs js/auto-translate.js — the reader's own — in Node. It is a plain
// IIFE that touches nothing but `window`, so a two-line shim is the
// whole of it, and there is exactly one splitter on this site.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, translate, vocab } from '../../api/_providers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MT_SOURCE = path.join(here, '..', '..', 'js', 'auto-translate.js');

function loadReaderModule() {
  const src = fs.readFileSync(MT_SOURCE, 'utf8');
  const win = {};
  // `document` is never touched at load time — the module only defines
  // functions — but it is passed anyway so a future top-level use of it
  // fails here, in a test, rather than at half past five in the morning.
  const doc = { addEventListener() {}, querySelector() { return null; } };
  new Function('window', 'document', src)(win, doc);
  if (!win.DURU_MT) throw new Error('js/auto-translate.js did not define window.DURU_MT');
  return win.DURU_MT;
}

export const MT = loadReaderModule();

// The same batch size the browser uses. Small batches keep each request
// short enough that one failure costs seconds, not a whole post.
const BATCH = 6;

// A batch whose sentences do not come back one for one is refused by
// the provider layer, and rightly — but that refusal is usually a model
// slipping once, not a post that cannot be translated. An admin pressing
// the button would simply press it again; nobody is awake at half past
// five to do that, so the batch asks twice before giving up. Two is the
// number: a second failure is the model disagreeing with the request,
// and a third attempt would only cost money to be told so again.
async function batchWithRetry(opts, cfg) {
  try {
    return await translate(opts, cfg);
  } catch (err) {
    if (!err || err.status !== 502) throw err;
    return translate(opts, cfg);
  }
}

// Everything the site writes in, minus the one it is written in.
export function targetsFor(from) {
  return Object.keys(LANGUAGES).filter((code) => code !== from);
}

// Title, summary and tags travel together as their own first batch,
// exactly as the browser sends them: they are not part of the body, so
// they must not be counted with it, and a reader should not meet a
// translated post under a Korean heading.
function headOf(post) {
  return [String(post.title || '').trim(), String(post.excerpt || '').trim()]
    .concat((post.tags || []).map((x) => String(x || '').trim()));
}

function headPrint(post) {
  return MT.fingerprint(headOf(post).join('\u0000'));
}

// Translate one finished post into every other language.
//
// Returns the object that goes straight into posts.mt. A language that
// did not come back with one translation per sentence is left out
// rather than stored short — the reader's `paired()` would refuse it
// anyway, and a missing translation is easier to explain than a
// mangled one.
export async function translateDraft(cfg, post, onProgress) {
  return translateInto(cfg, post, targetsFor(post.lang || 'ko'), onProgress);
}

// The same, into the languages named only — a language the site adds
// later is filled in on the posts already written without translating
// the others again.
export async function translateInto(cfg, post, targets, onProgress) {
  const from = post.lang || 'ko';
  const sentences = MT.sentences(post.body);
  if (!sentences.length || !targets.length) return {};

  // An empty summary would be an empty "sentence" to translate, so it
  // goes as a single space and comes back trimmed to nothing.
  const head = headOf(post).map((t) => t || ' ');

  const batches = [head];
  for (let i = 0; i < sentences.length; i += BATCH) batches.push(sentences.slice(i, i + BATCH));

  const collected = {};
  const heads = {};
  targets.forEach((c) => { collected[c] = []; });

  // Sequential on purpose: the batches share one rate limit, and a
  // failure part-way through should stop rather than fire the rest.
  for (let index = 0; index < batches.length; index++) {
    if (onProgress) onProgress(index, batches.length);
    const { translations } = await batchWithRetry(
      { from, fromName: LANGUAGES[from], targets, sentences: batches[index] }, cfg);
    targets.forEach((c) => {
      const got = translations[c] || [];
      if (index === 0) heads[c] = got;
      else collected[c] = collected[c].concat(got);
    });
  }

  const at = new Date().toISOString();
  const hash = MT.fingerprint(post.body);
  const headHash = headPrint(post);
  const out = {};
  targets.forEach((c) => {
    if (collected[c].length !== sentences.length) return;
    const h = heads[c] || [];
    // h is [title, excerpt, ...tags], in the order it was sent, so a
    // translated tag keeps its place beside the original it stands for.
    out[c] = {
      hash,
      headHash,
      from,
      at,
      title: String(h[0] || '').trim(),
      excerpt: String(h[1] || '').trim(),
      tags: h.slice(2).map((x) => String(x || '').trim()),
      sentences: collected[c]
    };
  });
  return out;
}

// ── the words to know, under the post ──────────────────────────────
//
// The same list the admin's button builds, built here for the same
// reason the translation is: a draft that arrives complete is a draft
// that gets approved. Five words an intermediate learner would be
// stopped by, each explained in every language the site reads in —
// one list, so switching language keeps the same words with new
// explanations.

const STUDY_WORDS = 5;    // js/auto-translate.js agrees; the test says so
const STUDY_MAX = 120;

export async function studyDraft(cfg, post) {
  const from = post.lang || 'ko';
  const targets = targetsFor(from);
  const sentences = MT.sentences(post.body).slice(0, STUDY_MAX);
  if (!sentences.length || !targets.length) return null;

  const list = await vocab(
    { from, fromName: LANGUAGES[from], targets, sentences, count: STUDY_WORDS }, cfg);
  if (!list || !list.words || !list.words.length) return null;
  return {
    hash: MT.fingerprint(post.body),
    from,
    at: new Date().toISOString(),
    model: list.model || cfg.model || '',
    words: list.words
  };
}
