// DURU KOREAN — the daily worksheet run
//
// Writes worksheets, renders them to PDF in eight languages, puts them
// in the private bucket and leaves them for a person to approve. It
// never publishes anything. See supabase/schema.sql §36 for why that
// is enforced in the database rather than here.
//
// ── How much it makes ──────────────────────────────────────────────
//
// Three sheets on each of the six shelves, every morning, eighteen a
// day, until the owner says stop. --count changes the three; --only
// picks the shelves. The workflow runs one shelf per job so that six
// jobs of three take the time of three sheets, not eighteen.
//
// ── What "good" means here ─────────────────────────────────────────
//
// A sheet is written by the larger model, then read by a second pass
// asked to find what is wrong with it — a misspelt particle, an answer
// that does not follow, a gloss that is the dictionary's first sense
// rather than this sentence's. What it finds goes back to the writer;
// a sheet that fails twice is not saved. Nothing here is "good enough":
// the review screen is a person's time, and it should be spent on
// sheets that are ready to go out, not on catching what a loop can.
//
// ── What it costs ──────────────────────────────────────────────────
//
// One sheet is three calls to the writing model (pick a subject, write
// it, review it — more if the review sends it back) plus seven
// translations on the smaller model, and eight PDF renders which cost
// nothing but time. A sheet is translated once, ever.
//
// ── Configuration ──────────────────────────────────────────────────
//
//   DURU_BOT_EMAIL            a site account that is in admin_users
//   DURU_BOT_PASSWORD         — the same pair the blog's run uses
//   one provider key          as api/translate.js documents
//   SHEET_MODEL               optional — the model that writes and
//                             reviews; defaults to the provider's
//                             larger model (gpt-5 on OpenAI). The
//                             translations use TRANSLATE_MODEL as usual.
//   SUPABASE_URL              optional, defaults to the project below
//   SUPABASE_ANON_KEY         optional
//
// The bot is an ordinary account rather than the service_role key, for
// the same reason the blog's run uses one: if these secrets leak, what
// leaks is an account that can write drafts, not a key that reads every
// row in the database.
//
//   node scripts/generate-sheets.mjs [--only=vocab,reading] [--count=3] [--dry-run]

import { resolveProvider, translate, LANGUAGES, TranslateError } from '../api/_providers.js';
import { pickSubject, writeSheet, reviewSheet, problemsWith, translateSheet, slugify, SHELVES } from './lib/sheets.mjs';
import { withPatience } from './lib/patiently.mjs';
import { renderSheet } from './pdf/render.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

const SHELF_ORDER = ['vocab', 'reading', 'grammar', 'reallife', 'hangul', 'etc'];
const PER_SHELF = 3;                // every shelf, every day, until told to stop
const REWRITES = 2;                 // a sheet sent back this many times is not saved

// The model that writes and reviews. The smaller one translates well
// enough and is what the site uses everywhere else; a worksheet that a
// learner will study from is worth the larger one.
const WRITING_MODEL = { openai: 'gpt-5' };
const LANGS = Object.keys(LANGUAGES);
const SOURCE_LANG = 'en';           // sheets are written with English explanations

const args = process.argv.slice(2);
const arg = (name) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY = args.includes('--dry-run');

function log(...parts) { console.log(...parts); }

/* ---------------- talking to Supabase ---------------- */

async function signIn() {
  const email = process.env.DURU_BOT_EMAIL;
  const password = process.env.DURU_BOT_PASSWORD;
  if (!email || !password) {
    throw new Error('DURU_BOT_EMAIL 과 DURU_BOT_PASSWORD 가 필요합니다.');
  }
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Never the password, and never the token.
    throw new Error('로그인 실패 (' + res.status + ').');
  }
  return { token: body.access_token, userId: body.user && body.user.id };
}

function api(token) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
  return async function call(path, init) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      ...init, headers: { ...headers, ...((init && init.headers) || {}) }
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new Error(res.status + ' ' + ((data && (data.message || data.hint)) || text));
    }
    return data;
  };
}

async function putDraft(token, path, bytes) {
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/resource-drafts/' + path, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true'
    },
    body: bytes
  });
  if (!res.ok) throw new Error('업로드 실패 (' + res.status + '): ' + (await res.text()).slice(0, 200));
  return 'resource-drafts/' + path;
}

/* ---------------- one sheet, start to finish ---------------- */

async function makeOne(cfg, category, context, browser) {
  const today = context.today;
  const writer = context.writer || cfg;

  const subject = await pickSubject(writer, {
    category, today, existing: context.existing
  });
  log('  · ' + category + ' — ' + subject.subject);

  let sheet = await writeSheet(writer, {
    category, subject: subject.subject,
    objective: subject.objective, level: subject.level
  });

  // What the checks find — the mechanical ones here, the reader's ones
  // in reviewSheet() — goes back to the writer as a list. Twice; a
  // sheet that is still wrong after that is not saved, and the shelf
  // gets a different subject tomorrow.
  let notes = [];
  for (let round = 0; ; round += 1) {
    const problems = problemsWith(sheet, { existing: context.existing });
    const review = problems.length ? { ok: false, problems: [] } : await reviewSheet(writer, sheet);
    notes = problems.concat(review.problems);
    if (!notes.length) break;
    if (round >= REWRITES) throw new Error('검수를 통과하지 못했습니다: ' + notes.join(' '));
    log('    검수에서 ' + notes.length + '가지 걸림 — 다시 씁니다 (' + (round + 1) + '/' + REWRITES + '): ' +
        notes.join(' ').slice(0, 300));
    sheet = await writeSheet(writer, {
      category,
      subject: subject.subject + '\n\n[지난번 검수에서 걸린 것 — 전부 고치세요]\n- ' + notes.join('\n- '),
      objective: subject.objective, level: subject.level
    });
  }

  // English first: it is the language the sheet was written in, so it
  // is the one nothing can go wrong in.
  const editions = { [SOURCE_LANG]: sheet };
  for (const lang of LANGS) {
    if (lang === SOURCE_LANG) continue;
    editions[lang] = await translateSheet(translate, cfg, sheet, lang, LANGUAGES[SOURCE_LANG]);
  }

  const rendered = {};
  for (const [lang, edition] of Object.entries(editions)) {
    const out = await renderSheet(edition, { category, lang, browser });
    rendered[lang] = out;
    if (!out.check.ok) log('    ! ' + lang + ': ' + out.check.why.join('; '));
  }

  return { subject, sheet, editions, rendered };
}

/* ---------------- saving it as a draft ---------------- */

async function save(call, token, userId, category, made) {
  const { subject, sheet, rendered } = made;
  const slug = slugify(sheet.title) + '-' + Date.now().toString(36);

  const [resource] = await call('resources', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      title: sheet.title,
      summary: sheet.summary,
      objective: sheet.objective,
      minutes: sheet.minutes,
      tags: Array.isArray(sheet.tags) ? sheet.tags.slice(0, 8) : [],
      slug,
      category,
      publish_location: 'free-resources',
      file_type: 'pdf',
      learning_level: sheet.level,
      description: sheet.summary,
      description_language: SOURCE_LANG,
      storage_key: 'pending/' + slug,
      file_size: 0,
      status: 'review',
      origin: 'auto',
      // Said outright: the column defaults to true, and a draft that
      // leaves it there is on the public list before anyone reads it.
      published: false,
      created_by: userId
    }])
  });

  // The folder is the row's id, not the slug: the slug is Korean, and
  // Storage refuses any key with a character outside ASCII in it
  // ("InvalidKey"). The third real run wrote, translated and rendered
  // a whole sheet and then lost it at the upload. The id is a UUID,
  // which nothing refuses, and it is what the review screen uses for
  // the public key too, so the two never disagree.
  for (const [lang, out] of Object.entries(rendered)) {
    const path = resource.id + '/' + lang + '-v1.pdf';
    const key = await putDraft(token, path, out.pdf);
    await call('resource_files', {
      method: 'POST',
      body: JSON.stringify([{
        resource_id: resource.id,
        lang,
        version: 1,
        file_type: 'pdf',
        draft_key: key,
        file_size: out.bytes,
        file_hash: out.hash,
        page_count: out.check.pages,
        check_result: out.check,
        published: false,
        mime_type: 'application/pdf',
        created_by: userId
      }])
    });
  }

  // §5.3. Nothing external was copied into the sheet — the model wrote
  // it from what it knows — so what is recorded is what a person should
  // check the facts against before this goes out, and it is recorded as
  // needing exactly that.
  const toCheck = Array.isArray(sheet.checkThese) && sheet.checkThese.length
    ? sheet.checkThese
    : (subject.checkThese || []);
  const rows = (toCheck.length ? toCheck : ['이 학습지의 한국어 표현과 사실 관계']).map((what) => ({
    resource_id: resource.id,
    source_url: 'about:self-authored',
    source_title: String(what).slice(0, 200),
    creator: 'DURU KOREAN',
    asset_type: 'fact',
    intended_use: 'fact-check',
    commercial_allowed: 'unclear',
    adaptation_allowed: 'unclear',
    redistribution_allowed: 'unclear',
    rights_status: 'needs-human',
    review_note: '자동 생성된 학습지입니다. 외부 문장·문항·그림을 가져오지 않았습니다. ' +
                 '게시 전에 사람이 내용과 사실을 확인해야 합니다.'
  }));
  await call('resource_sources', { method: 'POST', body: JSON.stringify(rows) });

  await call('resource_reviews', {
    method: 'POST',
    body: JSON.stringify([{ resource_id: resource.id, actor_id: userId, action: 'generated' }])
  });

  return resource;
}

/* ---------------- the run ---------------- */

function todayInSeoul() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function run() {
  const today = todayInSeoul();
  log('DURU KOREAN 자료실 — ' + today + (DRY ? ' (연습)' : ''));

  // Every model call asks again when a connection drops or a deadline
  // passes — see lib/patiently.mjs. The deadline is three minutes, not
  // the five Node allows before it gives up without saying why: long
  // enough to write a worksheet, short enough to leave room for the
  // two further tries.
  const cfg = withPatience(resolveProvider(process.env), log);
  cfg.timeoutMs = Number(process.env.DURU_CALL_TIMEOUT_MS) || 180000;

  // The writer: the larger model, given longer, because a sheet it is
  // still thinking about at three minutes is usually worth the fourth.
  // (A test that shortens the call deadline shortens this one too,
  // unless it says otherwise.)
  const writer = Object.assign({}, cfg, {
    model: process.env.SHEET_MODEL || WRITING_MODEL[cfg.name] || cfg.model,
    timeoutMs: Number(process.env.DURU_WRITE_TIMEOUT_MS) ||
               (process.env.DURU_CALL_TIMEOUT_MS ? cfg.timeoutMs : Math.max(cfg.timeoutMs, 280000))
  });
  log('작성·검수: ' + cfg.label + ' / ' + writer.model + ' (한 번에 최대 ' + Math.round(writer.timeoutMs / 1000) + '초)');
  log('번역: ' + cfg.label + ' / ' + cfg.model + ' (한 번에 최대 ' + Math.round(cfg.timeoutMs / 1000) + '초)');

  const session = await signIn();
  const call = api(session.token);

  // What is already on the shelf, so that nothing is written twice.
  // Rejected sheets stay in this list on purpose: a subject the owner
  // turned down once is not offered again under a new title.
  const made = await call('resources?select=title,objective,category,origin&publish_location=eq.free-resources&limit=1000');
  const existing = made.map((r) => r.title + (r.objective ? ' — ' + r.objective : ''));
  const autoCount = made.filter((r) => r.origin === 'auto').length;

  const shelves = arg('only')
    ? arg('only').split(',').map((s) => s.trim()).filter((s) => SHELVES[s])
    : SHELF_ORDER.slice();
  const want = Number(arg('count')) || PER_SHELF;

  log('자료실에 ' + made.length + '편 (자동 생성 ' + autoCount + '편). ' +
      '오늘: ' + shelves.join(', ') + ' × ' + want + '편');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  const done = [];
  const failed = [];
  try {
    for (const category of shelves) {
      for (let i = 0; i < want; i += 1) {
        try {
          const out = await makeOne(cfg, category, { today, existing, writer }, browser);
          if (DRY) {
            const bad = Object.entries(out.rendered).filter(([, r]) => !r.check.ok);
            log('    (연습) ' + out.sheet.title + ' — ' +
                Object.keys(out.rendered).length + '개 언어' +
                (bad.length ? ', 검사 실패 ' + bad.map(([l]) => l).join(',') : ', 검사 전부 통과'));
          } else {
            const saved = await save(call, session.token, session.userId, category, out);
            log('    저장됨: ' + saved.title);
          }
          existing.push(out.sheet.title + ' — ' + out.sheet.objective);
          done.push(out.sheet.title);
        } catch (err) {
          // One shelf failing must not take the others down with it.
          failed.push(category + ': ' + err.message);
          log('    실패 — ' + err.message);
        }
      }
    }
  } finally {
    await browser.close();
  }

  log('\n끝: ' + done.length + '편' + (failed.length ? ', 실패 ' + failed.length + '건' : ''));
  failed.forEach((f) => log('  ! ' + f));

  // A run that made nothing at all is a failed run, and has to look
  // like one. One shelf falling over while the others work is a
  // warning; every shelf falling over came back green, took thirty
  // seconds, and was indistinguishable from a quiet success until
  // somebody opened the log.
  if (!done.length && failed.length) {
    const err = new Error('아무것도 만들지 못했습니다:\n  ' + failed.join('\n  '));
    err.madeNothing = true;
    throw err;
  }
  return { done, failed };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  run().catch((err) => {
    console.error(err instanceof TranslateError ? err.message : err);
    process.exit(1);
  });
}
