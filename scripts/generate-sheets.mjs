// DURU KOREAN — the daily worksheet run
//
// Writes worksheets, renders them to PDF in eight languages, puts them
// in the private bucket and leaves them for a person to approve. It
// never publishes anything. See supabase/schema.sql §36 for why that
// is enforced in the database rather than here.
//
// ── How much it makes ──────────────────────────────────────────────
//
// One sheet per shelf per run; --count changes the one, --only picks
// the shelves. The workflow runs one shelf per job: three a day from
// 2026-10-05 (grammar, vocab, and reading or reallife on alternate
// days), the subjects from the syllabus (lib/curriculum.mjs).
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
// One sheet is three calls to the writing model (write it, two readers
// — more if they send it back; the subject comes from the shelf's list,
// made ten at a time by one call — see nextSubject), nine translations on
// the smaller model each checked by the writing model, and ten PDF
// renders which cost nothing but time. The end of the log says what the
// run spent, step by step (usageReport, on the subscription).
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

import { resolveProvider, LANGUAGE_NAMES, TranslateError } from '../api/_providers.js';
import { planSubjects, writeSheet, reviewSheet, problemsWith, slugify, cleanKeyword, same, SHELVES } from './lib/sheets.mjs';
import { auditSheet, fixSheet, sheetReferences, markProblems, translateChecked, normalizeLevel, shortenSheet } from './lib/proofread.mjs';
import { pageBreakdown } from './pdf/check.mjs';
import { withPatience } from './lib/patiently.mjs';
import { subscriptionConfig, useSubscription, stage, usageReport } from './lib/claude-code.mjs';
import { renderSheet } from './pdf/render.mjs';
import { nextFromSyllabus, levelProblems, progress } from './lib/curriculum.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

const SHELF_ORDER = ['vocab', 'reading', 'grammar', 'reallife', 'hangul', 'etc'];
const PER_SHELF = 1;                // one a shelf; the workflow picks the shelves
const SHORTEN = 3;                  // tries at fitting a long sheet on two pages
const REWRITES = 2;                 // a sheet sent back this many times is not saved
const PLAN_SIZE = 10;               // subjects asked for at once: a week, and spares

// The model that writes and reviews. The smaller one translates well
// enough and is what the site uses everywhere else; a worksheet that a
// learner will study from is worth the larger one.
const WRITING_MODEL = { openai: 'gpt-5' };
// Ten: the site's eight, and French and German (2026-09-25).
const LANGS = Object.keys(LANGUAGE_NAMES);
const SOURCE_LANG = 'en';           // sheets are written with English explanations
// Longest editions first (the 48 sheets on file, 2026-10-05: fr, de, id,
// es, pt-BR run 4–8% longer than the English; ko, ja, zh 18–26% shorter).
const BY_LENGTH = ['fr', 'de', 'id', 'es', 'pt-BR', 'vi', 'ko', 'ja', 'zh'];
const TRANSLATE_ORDER = BY_LENGTH.filter((l) => LANGS.includes(l))
  .concat(LANGS.filter((l) => l !== SOURCE_LANG && !BY_LENGTH.includes(l)));

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

/* ---------------- the shelf's list of subjects ---------------- */

// The grammar, vocab, reading and real-life shelves take their subjects
// from the syllabus (lib/curriculum.mjs: the standard curriculum's lists,
// in order); the plan file records which items are done. Any other shelf
// keeps a list of subjects still to be written, made ten at a time
// (planSubjects) instead of one call to the writing model every morning.
// The file lives in the private drafts bucket, plans/<shelf>.json, where
// only an admin can read it; one file per shelf, and one job per shelf,
// so two runs never write the same file.
const planUrl = (category) => SUPABASE_URL + '/storage/v1/object/resource-drafts/plans/' + category + '.json';

async function loadPlan(token, category) {
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/resource-drafts/plans/' + category + '.json', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!res.ok) return {};
  const body = await res.json().catch(() => null);
  return body && typeof body === 'object' ? body : {};
}

async function savePlan(token, category, plan) {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token };
  // The bucket lets an admin add and remove, not change: removed, then
  // written again.
  await fetch(planUrl(category), { method: 'DELETE', headers }).catch(() => null);
  const res = await fetch(planUrl(category), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify({ ...plan, category, updated: new Date().toISOString() })
  });
  if (!res.ok) throw new Error('주제 목록 저장 실패 (' + res.status + '): ' + (await res.text()).slice(0, 200));
}

// The next subject for the shelf: from its list, dropping any the shelf
// has got since; a new list when it has run out. Taken off the list
// before it is written, so a subject that fails is not tried again.
async function nextSubject(writer, token, category, { today, existing, ownShelf }) {
  const plan = await loadPlan(token, category);

  // The syllabus: counted as tried before it is written, done once saved
  // (markDone), so an item that fails twice is passed over.
  const planned = nextFromSyllabus(category, plan);
  if (planned) {
    plan.tried = { ...(plan.tried || {}), [planned.id]: ((plan.tried || {})[planned.id] || 0) + 1 };
    if (!DRY) await savePlan(token, category, plan).catch((err) => log('    ' + err.message));
    log('  · ' + category + ' — 교육과정 ' + planned.label + ' (진도 ' + progress(category, plan) + ')');
    return planned;
  }

  const clash = (s) => existing.some((t) => same(t, s.subject));
  let list = (Array.isArray(plan.subjects) ? plan.subjects : []).filter((s) => s && s.subject && !clash(s));
  if (!list.length) {
    const was = stage('주제 모으기');
    let fresh;
    try {
      fresh = await planSubjects(writer, {
        category, today, count: PLAN_SIZE,
        existing: ownShelf.concat(existing.filter((t) => !ownShelf.includes(t)))
      });
    } finally {
      stage(was);
    }
    for (const s of fresh) {
      if (!clash(s) && !list.some((k) => same(k.subject, s.subject))) list.push(s);
    }
    log('  · ' + category + ' — 주제 ' + list.length + '개를 새로 모았습니다' +
        (fresh.length > list.length ? ' (겹쳐서 뺀 것 ' + (fresh.length - list.length) + '개)' : ''));
    if (!list.length) throw new Error('겹치지 않는 주제를 찾지 못했습니다');
  }
  const next = list.shift();
  if (!DRY) {
    try {
      await savePlan(token, category, { ...plan, subjects: list });
    } catch (err) {
      log('    ' + err.message + ' — 다음 실행에서 주제를 새로 모읍니다');
    }
  }
  log('  · ' + category + ' — 남은 주제 ' + list.length + '개');
  return next;
}

async function markDone(token, category, id) {
  const plan = await loadPlan(token, category);
  plan.done = [...new Set([...(plan.done || []), id])];
  await savePlan(token, category, plan);
}

/* ---------------- one sheet, start to finish ---------------- */

async function makeOne(cfg, category, context, browser) {
  const writer = context.writer || cfg;

  const subject = await context.nextSubject(category);
  log('  · ' + category + ' — ' + subject.subject);

  stage('쓰기');
  let sheet = await writeSheet(writer, {
    category, subject: subject.subject,
    objective: subject.objective, level: subject.level
  });

  // What the checks find — the mechanical ones here, the two readers'
  // (reviewSheet, then the stricter auditSheet: the owner's rule that
  // every sheet is checked twice) — goes back to the writer as a list.
  // Twice; a sheet that is still wrong after that is not saved, and the
  // shelf gets a different subject tomorrow.
  // Both readers at once; how many each found is logged, to tell later
  // whether reading them one after the other would save a call or cost
  // a rewrite.
  const readTwice = async (s) => {
    const was = stage('검수');
    const [first, second] = await Promise.all([reviewSheet(writer, s), auditSheet(writer, s)]);
    stage(was);
    if (first.problems.length || second.problems.length) {
      log('    검수 ' + first.problems.length + '가지 · 감사 ' + second.problems.length + '가지');
    }
    return first.problems.concat(second.problems);
  };
  let notes = [];
  // A vocabulary sheet on the syllabus: no word above its level + 1.
  const levelCheck = (s) => (category === 'vocab' ? levelProblems(s, subject) : []);
  for (let round = 0; ; round += 1) {
    const problems = problemsWith(sheet, { existing: context.existing }).concat(markProblems(sheet), levelCheck(sheet));
    let found = [];
    if (!problems.length) found = await readTwice(sheet);
    notes = problems.concat(found);
    if (!notes.length) break;
    if (round >= REWRITES) {
      const err = new Error('검수를 통과하지 못했습니다: ' + notes.join(' '));
      err.subject = subject.subject;     // so the next try picks something else
      throw err;
    }
    log('    검수에서 ' + notes.length + '가지 걸림 — 다시 씁니다 (' + (round + 1) + '/' + REWRITES + '): ' +
        notes.join(' ').slice(0, 300));
    stage('다시 쓰기');
    sheet = await writeSheet(writer, {
      category,
      subject: subject.subject + '\n\n[지난번 검수에서 걸린 것 — 전부 고치세요]\n- ' + notes.join('\n- '),
      objective: subject.objective, level: subject.level
    });
  }

  sheet.level = normalizeLevel(sheet.level);

  // Two pages (the owner's rule, 2026-09-25): a sheet longer than that
  // even set compact is shortened, measured again, and the shorter one
  // read again by both reviewers, what they find fixed once; one that
  // still has problems, or is still longer than two pages, is not saved.
  // (recheck: both readers again, after the mechanical checks.)
  const recheck = async (s) => {
    const again = problemsWith(s, { existing: context.existing }).concat(markProblems(s), levelCheck(s));
    if (again.length) return again;
    return readTwice(s);
  };
  const pagesOf = async (s) => pageBreakdown((await renderSheet(s, { category, lang: SOURCE_LANG, browser, check: false })).pdf).pages;
  for (let t = 0, n = await pagesOf(sheet); n > 2; t += 1, n = await pagesOf(sheet)) {
    if (t >= SHORTEN) {
      const err = new Error(SHORTEN + '번 줄여도 영어판이 ' + n + '쪽이라 저장하지 않습니다');
      err.subject = subject.subject;
      throw err;
    }
    log('    영어판 ' + n + '쪽 — 2쪽으로 줄입니다');
    stage('줄이기');
    sheet = await shortenSheet(writer, sheet, n);
    sheet.level = normalizeLevel(sheet.level);
    const left = await recheck(sheet);
    if (left.length) {
      // Cutting sometimes leaves a seam — a summary that no longer quite
      // matches, a sentence that read fine beside the one taken out. The
      // reviewers say exactly what; those are fixed, and only those, and
      // the sheet read again. (Until 2026-09-27 the sheet was dropped
      // here: two reading sheets in a row lost over one word each.)
      log('    줄인 뒤 검수에서 ' + left.length + '가지 걸림 — 그 부분만 고칩니다: ' + left.join(' ').slice(0, 200));
      stage('고치기');
      sheet = await fixSheet(writer, sheet, left);
      sheet.level = normalizeLevel(sheet.level);
      const still = await recheck(sheet);
      if (still.length) {
        const err = new Error('줄인 뒤 검수를 통과하지 못했습니다: ' + still.join(' '));
        err.subject = subject.subject;
        throw err;
      }
    }
  }

  // English first: it is the language the sheet was written in, so it
  // is the one nothing can go wrong in.
  // Each translation is checked: the Korean in it by machine (it must
  // come through untouched), every line by the reader.
  // The longest languages first (TRANSLATE_ORDER), each set as soon as
  // it is translated: the first that runs onto a third page stops the
  // round there, before the shorter ones are translated for nothing —
  // the English is cut and they would all be translated again anyway.
  const makeAll = async (source) => {
    const editions = { [SOURCE_LANG]: source };
    const rendered = { [SOURCE_LANG]: await renderSheet(source, { category, lang: SOURCE_LANG, browser }) };
    if (rendered[SOURCE_LANG].check.pages > 2) return { editions, rendered };
    const was = stage('번역');
    try {
      for (const lang of TRANSLATE_ORDER) {
        const got = await translateChecked({ translator: cfg, writer }, source, lang);
        if (got.record.failed) throw new Error(lang + ' 번역에서 한국어가 바뀌어 저장하지 않습니다');
        editions[lang] = got.edition;
        rendered[lang] = await renderSheet(got.edition, { category, lang, browser });
        if (rendered[lang].check.pages > 2) break;
      }
    } finally {
      stage(was);
    }
    return { editions, rendered };
  };
  let { editions, rendered } = await makeAll(sheet);

  // Two pages in every language: a longer translation that runs onto a
  // third page gets the English cut a little, read again by both
  // reviewers, and everything translated again.
  // Up to twice: the second cut is made against what is still long.
  for (let t = 0; t < 2; t += 1) {
    const longer = Object.entries(rendered).filter(([, out]) => out.check.pages > 2).map(([lang]) => lang);
    if (!longer.length || longer.includes(SOURCE_LANG)) break;
    log('    번역판 3쪽 (' + longer.join(', ') + ') — 영어판을 조금 줄입니다' + (t ? ' (두 번째)' : ''));
    stage('줄이기');
    let short = await shortenSheet(writer, sheet, 2, longer);
    short.level = normalizeLevel(short.level);
    let left = await recheck(short);
    if (left.length) {
      stage('고치기');
      short = await fixSheet(writer, short, left);
      short.level = normalizeLevel(short.level);
      left = await recheck(short);
    }
    if (left.length) { log('    줄인 판이 검수를 통과하지 못했습니다'); break; }
    sheet = short;
    ({ editions, rendered } = await makeAll(sheet));
  }
  // Nothing longer than two pages is saved, in any language.
  const still = Object.entries(rendered).filter(([, out]) => out.check.pages > 2).map(([lang, out]) => lang + ' ' + out.check.pages + '쪽');
  if (still.length) {
    const err = new Error('2쪽을 넘어 저장하지 않습니다: ' + still.join(', '));
    err.subject = subject.subject;
    throw err;
  }
  for (const [lang, out] of Object.entries(rendered)) {
    if (!out.check.ok) log('    ! ' + lang + ': ' + out.check.why.join('; '));
  }

  // Where the facts in it come from, for the admin's eyes only (saved to
  // the admin-only table; see save()). On the faster model: it is a list.
  let references = [];
  try {
    stage('참고 자료');
    references = await sheetReferences(cfg, sheet);
  } catch (err) {
    log('    참고 자료 목록 실패 (학습지는 그대로): ' + err.message);
  }

  return { subject, sheet, editions, rendered, references };
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
      // Only once schema.sql §41 has given the table the column.
      ...(made.hasKeyword ? { keyword: cleanKeyword(sheet.keyword) || null } : {}),
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
  // The curriculum list the subject came from (공공누리 제1유형: credit
  // the source, in its own words).
  for (const credit of subject.credit || []) {
    rows.push({
      resource_id: resource.id,
      source_url: 'about:curriculum',
      source_title: String(credit).slice(0, 200),
      creator: '국립국어원',
      asset_type: 'curriculum',
      intended_use: 'level-reference',
      license_name: '공공누리 제1유형',
      commercial_allowed: 'yes',
      adaptation_allowed: 'yes',
      redistribution_allowed: 'yes',
      credit_text: String(credit),
      rights_status: 'needs-human',
      review_note: '주제와 등급을 이 교육과정 목록에서 정했습니다. 문장은 가져오지 않았습니다.'
    });
  }
  await call('resource_sources', { method: 'POST', body: JSON.stringify(rows) });

  // The sites the sheet's facts rest on, into the admin-only table
  // (schema §43), never anywhere a visitor can read. A database without
  // §43 yet keeps the sheet and says so.
  const refs = made.references || [];
  if (refs.length) {
    try {
      await call('content_sources', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(refs.map((r) => ({ resource_id: resource.id, domain: r.domain, url: r.url || null, about: r.about })))
      });
      // The count only: the run's log is public, the sources are not.
      log('    참고 자료 ' + refs.length + '개 저장 (관리자만 봄)');
    } catch (err) {
      log('    참고 자료를 저장하지 못했습니다 (schema.sql §43 이 필요합니다): ' + err.message);
    }
  }

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
  // Which account pays: the owner's Claude subscription when its token
  // is here (see lib/claude-code.mjs), otherwise an API key as before.
  // SHEET_PROVIDER=api forces the API even with the token present.
  const onSubscription = useSubscription(process.env, 'SHEET_PROVIDER');
  let cfg, writer;
  if (onSubscription) {
    const sub = subscriptionConfig(process.env);
    cfg = withPatience(sub.translator, log);
    writer = withPatience(sub.writer, log);
    cfg.timeoutMs = Number(process.env.DURU_CALL_TIMEOUT_MS) || 240000;
    writer.timeoutMs = Number(process.env.DURU_WRITE_TIMEOUT_MS) || 420000;
  } else {
    cfg = withPatience(resolveProvider(process.env), log);
    cfg.timeoutMs = Number(process.env.DURU_CALL_TIMEOUT_MS) || 180000;
    // The writer: the larger model, given longer, because a sheet it is
    // still thinking about at three minutes is usually worth the fourth.
    // (A test that shortens the call deadline shortens this one too,
    // unless it says otherwise.)
    writer = Object.assign({}, cfg, {
      model: process.env.SHEET_MODEL || WRITING_MODEL[cfg.name] || cfg.model,
      timeoutMs: Number(process.env.DURU_WRITE_TIMEOUT_MS) ||
                 (process.env.DURU_CALL_TIMEOUT_MS ? cfg.timeoutMs : Math.max(cfg.timeoutMs, 280000))
    });
  }
  log('작성·검수: ' + writer.label + ' / ' + writer.model + ' (한 번에 최대 ' + Math.round(writer.timeoutMs / 1000) + '초)');
  log('번역: ' + cfg.label + ' / ' + cfg.model + ' (한 번에 최대 ' + Math.round(cfg.timeoutMs / 1000) + '초)');

  const session = await signIn();
  const call = api(session.token);

  // What is already on the shelf, so that nothing is written twice.
  // Rejected sheets stay in this list on purpose: a subject the owner
  // turned down once is not offered again under a new title.
  const made = await call('resources?select=title,objective,category,origin,created_at&publish_location=eq.free-resources&limit=1000');
  const existing = made.map((r) => r.title + (r.objective ? ' — ' + r.objective : ''));
  const autoCount = made.filter((r) => r.origin === 'auto').length;

  const shelves = arg('only')
    ? arg('only').split(',').map((s) => s.trim()).filter((s) => SHELVES[s])
    : SHELF_ORDER.slice();
  const want = Number(arg('count')) || PER_SHELF;
  // A shelf gets its sheet once a day, by the Seoul date: a run started
  // by hand (the owner, 2026-09-26: "right after the rework") and the
  // 04:00 run on the same day do not make six. --force makes them anyway.
  const since = new Date(Date.parse(today + 'T00:00:00+09:00')).toISOString();
  const madeToday = (cat) => made.filter((r) => r.origin === 'auto' && r.category === cat && r.created_at >= since).length;
  const FORCE = args.includes('--force');

  log('자료실에 ' + made.length + '편 (자동 생성 ' + autoCount + '편). ' +
      '오늘: ' + shelves.join(', ') + ' × ' + want + '편');

  // The file-name keyword column (schema.sql §41), if it is there yet.
  const hasKeyword = await call('resources?select=keyword&limit=1').then(() => true, () => false);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  const done = [];
  const failed = [];
  try {
    for (const category of shelves) {
      // Three saved, not three tried. The reviewer turns down about
      // half of what is written — which is the point of having one —
      // so a shelf keeps going with new subjects until it has its three,
      // up to twice as many attempts. A sheet that fails review is
      // never saved to make up the number.
      const already = FORCE ? 0 : madeToday(category);
      if (already >= want) { log('  · ' + category + ' — 오늘(' + today + ') 이미 ' + already + '편 만들었습니다. 건너뜁니다.'); continue; }
      let savedHere = already;
      for (let i = 0; savedHere < want && i < want * 2; i += 1) {
        try {
          const nextSubjectHere = (cat) => nextSubject(writer, session.token, cat, {
            today, existing,
            ownShelf: made.filter((r) => r.category === cat).map((r) => r.title + (r.objective ? ' — ' + r.objective : ''))
          });
          const out = await makeOne(cfg, category, { today, existing, writer, nextSubject: nextSubjectHere }, browser);
          if (DRY) {
            const bad = Object.entries(out.rendered).filter(([, r]) => !r.check.ok);
            log('    (연습) ' + out.sheet.title + ' — ' +
                Object.keys(out.rendered).length + '개 언어' +
                (bad.length ? ', 검사 실패 ' + bad.map(([l]) => l).join(',') : ', 검사 전부 통과') +
                ' · ' + Object.entries(out.rendered).map(([l, r]) => l + ' ' + r.check.pages + '쪽').join(', '));
            // The English sheet, so a practice run can be looked at.
            log('    SHEET ' + JSON.stringify(out.sheet));
          } else {
            const saved = await save(call, session.token, session.userId, category, { ...out, hasKeyword });
            log('    저장됨: ' + saved.title);
            if (out.subject.id) {
              await markDone(session.token, category, out.subject.id)
                .catch((err) => log('    진도 기록 실패 (' + err.message + ') — 다음 실행에서 한 번 더 시도될 수 있습니다'));
            }
          }
          existing.push(out.sheet.title + ' — ' + out.sheet.objective);
          done.push(out.sheet.title);
          savedHere += 1;
        } catch (err) {
          // One shelf failing must not take the others down with it.
          failed.push(category + ': ' + err.message);
          if (err.subject) existing.push(err.subject);
          log('    실패 — ' + err.message);
        }
      }
    }
  } finally {
    await browser.close();
  }

  log('\n끝: ' + done.length + '편' + (failed.length ? ', 실패 ' + failed.length + '건' : ''));
  failed.forEach((f) => log('  ! ' + f));
  const report = usageReport();
  if (report) log('\n' + report);

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
