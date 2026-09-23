// DURU KOREAN — the daily worksheet run
//
// Writes worksheets, renders them to PDF in eight languages, puts them
// in the private bucket and leaves them for a person to approve. It
// never publishes anything. See supabase/schema.sql §36 for why that
// is enforced in the database rather than here.
//
// ── How much it makes ──────────────────────────────────────────────
//
// An empty library is useless, so the first stretch fills the shelves:
// six sheets a day, one per shelf, until there are sixty. After that
// one a day, rotating, which is about a hundred and fifty a year — a
// library rather than a landfill.
//
// That is counted from what is actually on the shelf, not from the
// calendar. A day that is missed, or a run that half-fails, corrects
// itself the next morning instead of leaving a permanent hole.
//
// ── What it costs ──────────────────────────────────────────────────
//
// One sheet is two model calls (pick a subject, write it) plus seven
// translations, and eight PDF renders which cost nothing but time.
// A sheet is translated once, ever.
//
// ── Configuration ──────────────────────────────────────────────────
//
//   DURU_BOT_EMAIL            a site account that is in admin_users
//   DURU_BOT_PASSWORD         — the same pair the blog's run uses
//   one provider key          as api/translate.js documents
//   SUPABASE_URL              optional, defaults to the project below
//   SUPABASE_ANON_KEY         optional
//
// The bot is an ordinary account rather than the service_role key, for
// the same reason the blog's run uses one: if these secrets leak, what
// leaks is an account that can write drafts, not a key that reads every
// row in the database.
//
//   node scripts/generate-sheets.mjs [--only=vocab] [--count=2] [--dry-run]

import { resolveProvider, translate, LANGUAGES, TranslateError } from '../api/_providers.js';
import { pickSubject, writeSheet, problemsWith, translateSheet, slugify, SHELVES } from './lib/sheets.mjs';
import { withPatience } from './lib/patiently.mjs';
import { renderSheet } from './pdf/render.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

const SHELF_ORDER = ['vocab', 'reading', 'grammar', 'reallife', 'hangul', 'etc'];
const SEED_TARGET = 60;             // six a day for ten days, then one
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

  const subject = await pickSubject(cfg, {
    category, today, existing: context.existing
  });
  log('  · ' + category + ' — ' + subject.subject);

  let sheet = await writeSheet(cfg, {
    category, subject: subject.subject,
    objective: subject.objective, level: subject.level
  });

  let problems = problemsWith(sheet, { existing: context.existing });
  if (problems.length) {
    log('    다시 씁니다: ' + problems.join(' '));
    sheet = await writeSheet(cfg, {
      category,
      subject: subject.subject + '\n\n[지난번 문제점] ' + problems.join(' '),
      objective: subject.objective, level: subject.level
    });
    problems = problemsWith(sheet, { existing: context.existing });
    if (problems.length) throw new Error('학습지가 기준에 못 미칩니다: ' + problems.join(' '));
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
      created_by: userId
    }])
  });

  for (const [lang, out] of Object.entries(rendered)) {
    const path = slug + '/' + lang + '-v1.pdf';
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

function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : 0;
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
  log('번역·작성: ' + cfg.label + ' / ' + cfg.model +
      ' (한 번에 최대 ' + Math.round(cfg.timeoutMs / 1000) + '초)');

  const session = await signIn();
  const call = api(session.token);

  // What is already on the shelf: for not repeating it, and for
  // deciding how many to make.
  const made = await call('resources?select=title,objective,category,origin&publish_location=eq.free-resources&limit=500');
  const existing = made.map((r) => r.title + (r.objective ? ' — ' + r.objective : ''));
  const autoCount = made.filter((r) => r.origin === 'auto').length;

  const seeding = autoCount < SEED_TARGET;
  let shelves;
  if (arg('only')) {
    shelves = arg('only').split(',').map((s) => s.trim()).filter((s) => SHELVES[s]);
  } else if (seeding) {
    shelves = SHELF_ORDER.slice();
  } else {
    shelves = [SHELF_ORDER[dayNumber(today) % SHELF_ORDER.length]];
  }
  const want = Number(arg('count')) || 1;

  log('자료실에 ' + made.length + '편 (자동 생성 ' + autoCount + '편). ' +
      (seeding ? '채우는 중 — ' : '유지 중 — ') + shelves.join(', '));

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  const done = [];
  const failed = [];
  try {
    for (const category of shelves) {
      for (let i = 0; i < want; i += 1) {
        try {
          const out = await makeOne(cfg, category, { today, existing }, browser);
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
