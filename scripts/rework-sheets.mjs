// DURU KOREAN — every worksheet on the shelf, proofread and made again
//
// The owner's order (2026-09-25): every sheet the engine made — the
// published ones too — checked until no sentence and no answer on it is
// wrong (grammar above all), set in the new design, made in ten
// languages (French and German added), and taken off the shelf until
// the owner has looked at it and pressed Publish.
//
// Two steps, with a person between them:
//
//   prepare   reads each sheet back out of its English PDF, word for
//             word (the relayout's read-back, checked against the PDF),
//             has it read by two reviewers (reviewSheet and the stricter
//             auditSheet), fixes what they find and has it read again,
//             then translates it into the other nine languages and has
//             every translation checked line by line. What it writes is
//             the sheet's content, not a PDF: <out>/<id>/<lang>.json, the
//             faithful read-back as orig.en.json, and report.json — every
//             change made and why, and anything still unresolved.
//             Nothing on the site is touched.
//
//   apply     takes content that has been read and passed
//             (content/sheets/<id>/<lang>.json, committed), renders every
//             language in the current design, replaces the old files
//             under the same keys, adds the languages that had none
//             (French, German), and holds the download for the owner.
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD, SUPABASE_URL / SUPABASE_ANON_KEY,
//   and the model account the daily run uses.
//
//   node scripts/rework-sheets.mjs prepare [--out=DIR] [--only=a|b] [--limit=N] [--redo] [--at-once=N]
//   node scripts/rework-sheets.mjs apply [--from=content/sheets] [--only=a|b] [--dry-run]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProvider, LANGUAGE_NAMES } from '../api/_providers.js';
import { reviewSheet, problemsWith, MAKING_OF } from './lib/sheets.mjs';
import { auditSheet, fixSheet, diffSheets, markProblems, translateChecked } from './lib/proofread.mjs';
import { withPatience } from './lib/patiently.mjs';
import { subscriptionAccount, subscriptionConfig, useSubscription } from './lib/claude-code.mjs';
import { renderSheet, labelsFor, frameText } from './pdf/render.mjs';
import { rest, where, download, replace, py, readBack, pool, SAME } from './relayout-sheets.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

export const SOURCE = 'en';
export const TARGETS = Object.keys(LANGUAGE_NAMES).filter((l) => l !== SOURCE);
const READ_TRIES = 3;
const ROUNDS = 3;          // review → fix → review again, at most this many times

const args = process.argv.slice(2);
const MODE = args[0];
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DRY = args.includes('--dry-run');
const REDO = args.includes('--redo');
const LIMIT = Number(arg('limit')) || 0;
const ONLY = arg('only');
const AT_ONCE = Number(arg('at-once')) || 2;

const log = (...a) => console.log(...a);

async function signIn() {
  const email = process.env.DURU_BOT_EMAIL;
  const password = process.env.DURU_BOT_PASSWORD;
  if (!email || !password) throw new Error('DURU_BOT_EMAIL 과 DURU_BOT_PASSWORD 가 필요합니다.');
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ').');
  return { token: body.access_token, userId: body.user && body.user.id };
}

function newestFiles(r) {
  const newest = {};
  (r.resource_files || []).forEach((f) => {
    if (!where(f)) return;
    if (!newest[f.lang] || (f.version || 1) > (newest[f.lang].version || 1)) newest[f.lang] = f;
  });
  return newest;
}

const writeJSON = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

/* ================= prepare ================= */

// The English edition, exactly as it is printed now.
async function readFaithfully(cfgs, browser, r, pdfPath, work) {
  const text = py({ op: 'text', path: pdfPath }).pages.join('\n');
  let hint = '';
  for (let t = 0; t < READ_TRIES; t += 1) {
    let sheet;
    try {
      sheet = await readBack(cfgs.reader, r.category, SOURCE, text, hint);
    } catch (err) {
      log('    읽기 실패 — ' + err.message);
      continue;
    }
    const drop = [];
    if (sheet.note && MAKING_OF.test(sheet.note)) { drop.push(sheet.note); sheet.note = ''; }
    const had = (x) => x && text.toLowerCase().includes(String(x).toLowerCase());
    if (!(sheet.task && had(sheet.task.title))) sheet.task = null;
    const out = await renderSheet(sheet, { category: r.category, lang: SOURCE, browser, check: false });
    const fresh = path.join(work, r.id + '-read.pdf');
    fs.writeFileSync(fresh, out.pdf);
    const cmp = py({ op: 'compare', old: pdfPath, new: fresh, title: sheet.title || r.title, drop,
      labels: Object.values(labelsFor(SOURCE)).filter((x) => typeof x === 'string'), frame: frameText(sheet, SOURCE) });
    if (cmp.hist <= SAME.hist && cmp.ratio >= SAME.ratio) return { sheet, dropped: drop };
    hint = '지난번 결과는 원래 PDF 의 글자와 달랐습니다 (다른 글자 ' + Math.round(cmp.hist * 1000) / 10 +
           '%). 글자를 바꾸거나 빼거나 보태지 말고, 틀이 넣은 제목·번호만 빼세요.';
    log('    원본과 다름 (hist ' + cmp.hist.toFixed(4) + ', ratio ' + cmp.ratio.toFixed(4) + ')' + (t + 1 < READ_TRIES ? ' — 다시' : ''));
  }
  return null;
}

// Two readers, then the fixer, until both find nothing.
export async function proofread(cfgs, sheet) {
  const rounds = [];
  let current = sheet;
  for (let round = 1; round <= ROUNDS + 1; round += 1) {
    const mech = problemsWith(current).concat(markProblems(current));
    const [first, second] = await Promise.all([reviewSheet(cfgs.writer, current), auditSheet(cfgs.writer, current)]);
    const found = mech.concat(first.problems, second.problems);
    rounds.push({ round, mechanical: mech, review: first.problems, audit: second.problems });
    log('    검수 ' + round + '회: ' + (found.length ? found.length + '곳' : '통과'));
    found.forEach((p) => log('      - ' + p.slice(0, 220)));
    if (!found.length) return { sheet: current, rounds, passed: true };
    if (round > ROUNDS) return { sheet: current, rounds, passed: false, unresolved: found };
    const fixed = await fixSheet(cfgs.writer, current, found);
    diffSheets(current, fixed).forEach((d) => log('      ✎ ' + d.at + ': ' + d.before.slice(0, 120) + '  →  ' + d.after.slice(0, 120)));
    current = fixed;
  }
  return { sheet: current, rounds, passed: false };
}

export async function prepareOne(cfgs, browser, token, r, outDir, work) {
  const files = newestFiles(r);
  const enFile = files[SOURCE];
  if (!enFile) throw new Error('영어판 파일이 없습니다');
  const old = path.join(work, r.id + '-en-old.pdf');
  fs.writeFileSync(old, await download(token, where(enFile)));

  const read = await readFaithfully(cfgs, browser, r, old, work);
  if (!read) throw new Error('영어판을 원본과 똑같이 읽어내지 못했습니다');
  const orig = read.sheet;
  log('    읽기: 원본과 같음');

  const checked = await proofread(cfgs, orig);
  const en = checked.sheet;
  const fixes = diffSheets(orig, en);

  const editions = { [SOURCE]: en };
  const translations = {};
  await pool(TARGETS, 3, async (lang) => {
    const got = await translateChecked(cfgs, en, lang);
    editions[lang] = got.edition;
    translations[lang] = got.record;
  });

  // Every edition rendered once here, so a sheet that would not fit or
  // fails a check is known before anyone reads it.
  const pages = {};
  for (const [lang, sheet] of Object.entries(editions)) {
    if (!sheet) continue;
    const out = await renderSheet(sheet, { category: r.category, lang, browser });
    pages[lang] = { pages: out.check.pages, ok: out.check.ok, why: out.check.why };
  }

  const dir = path.join(outDir, r.id);
  writeJSON(path.join(dir, 'orig.en.json'), orig);
  Object.entries(editions).forEach(([lang, sheet]) => { if (sheet) writeJSON(path.join(dir, lang + '.json'), sheet); });
  const report = {
    id: r.id, title: r.title, category: r.category, status: r.status, published: r.published,
    langsBefore: Object.keys(files).sort(),
    dropped: read.dropped, passed: checked.passed, unresolved: checked.unresolved || [],
    rounds: checked.rounds, fixes, translations, pages,
    preparedAt: new Date().toISOString()
  };
  writeJSON(path.join(dir, 'report.json'), report);
  return report;
}

async function prepare() {
  const out = path.resolve(arg('out') || 'rework-out');
  const onSub = useSubscription(process.env, 'SHEET_PROVIDER');
  const cfgs = {};
  if (onSub) {
    const sub = subscriptionConfig(process.env);
    cfgs.reader = withPatience(subscriptionAccount(process.env.RELAYOUT_MODEL || 'sonnet'), log);
    cfgs.writer = withPatience(sub.writer, log);
    cfgs.translator = withPatience(sub.translator, log);
  } else {
    const base = resolveProvider(process.env);
    cfgs.reader = withPatience(base, log);
    cfgs.translator = withPatience(base, log);
    cfgs.writer = withPatience(Object.assign({}, base, { model: process.env.SHEET_MODEL || base.model }), log);
  }
  cfgs.reader.timeoutMs = cfgs.translator.timeoutMs = Number(process.env.DURU_CALL_TIMEOUT_MS) || 300000;
  cfgs.writer.timeoutMs = Number(process.env.DURU_WRITE_TIMEOUT_MS) || 480000;
  log('정밀 검수 준비 · 읽기 ' + cfgs.reader.model + ' · 검수·고침 ' + cfgs.writer.model + ' · 번역 ' + cfgs.translator.model);
  log('언어: ' + [SOURCE].concat(TARGETS).join(', '));

  let { token } = await signIn();
  let rows = await rest(token, 'resources?select=id,title,category,status,published,' +
    'resource_files(id,lang,version,published,storage_key,draft_key,page_count)' +
    '&origin=eq.auto&status=neq.rejected&publish_location=eq.free-resources&order=created_at.asc&limit=5000');
  if (ONLY) {
    const want = ONLY.split('|').map((x) => x.trim()).filter(Boolean);
    rows = rows.filter((r) => want.includes(r.id) || want.includes(r.title));
  }
  const done = (r) => fs.existsSync(path.join(out, r.id, 'report.json'));
  if (!REDO) {
    const before = rows.length;
    rows = rows.filter((r) => !done(r));
    if (before !== rows.length) log('이미 준비된 ' + (before - rows.length) + '개는 건너뜁니다');
  }
  if (LIMIT) rows = rows.slice(0, LIMIT);
  log('대상: ' + rows.length + '개');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-'));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const summary = [];
  try {
    await pool(rows, AT_ONCE, async (r) => {
      log('· ' + r.title + ' [' + r.category + ', ' + r.status + ']');
      try {
        ({ token } = await signIn());
        const rep = await prepareOne(cfgs, browser, token, r, out, work);
        summary.push({ title: r.title, fixes: rep.fixes.length, passed: rep.passed,
          trFixes: Object.values(rep.translations).reduce((n, t) => n + (t.fixes || []).length, 0),
          trFailed: Object.values(rep.translations).filter((t) => t.failed).map((t) => t.lang),
          over2: Object.entries(rep.pages).filter(([, p]) => p.pages > 2).map(([l]) => l),
          bad: Object.entries(rep.pages).filter(([, p]) => !p.ok).map(([l]) => l) });
        log('  ✓ ' + r.title + ' — 고친 곳 ' + rep.fixes.length + (rep.passed ? '' : ' · 미해결 ' + rep.unresolved.length));
      } catch (err) {
        summary.push({ title: r.title, error: err.message });
        log('  ✗ ' + r.title + ' — ' + err.message);
      }
    });
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
  log('');
  log('=== 요약 ===');
  summary.forEach((s) => log(s.error ? '✗ ' + s.title + ': ' + s.error
    : (s.passed ? '✓ ' : '△ ') + s.title + ' — 내용 고침 ' + s.fixes + ' · 번역 고침 ' + s.trFixes +
      (s.trFailed.length ? ' · 번역 실패 ' + s.trFailed.join(',') : '') +
      (s.over2.length ? ' · 2쪽 넘음 ' + s.over2.join(',') : '') + (s.bad.length ? ' · 검사 실패 ' + s.bad.join(',') : '')));
  return summary;
}

/* ================= apply ================= */

async function putDraft(token, key, bytes) {
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/resource-drafts/' + key, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: bytes
  });
  if (!res.ok) throw new Error('업로드 실패 (' + res.status + '): ' + (await res.text()).slice(0, 160));
  return 'resource-drafts/' + key;
}

export async function applyOne(session, browser, r, dir) {
  const { token, userId } = session;
  const files = newestFiles(r);
  const langs = [SOURCE].concat(TARGETS).filter((l) => fs.existsSync(path.join(dir, l + '.json')));
  const report = fs.existsSync(path.join(dir, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')) : {};
  const result = { replaced: [], added: [], failed: [] };
  for (const lang of langs) {
    const sheet = JSON.parse(fs.readFileSync(path.join(dir, lang + '.json'), 'utf8'));
    const out = await renderSheet(sheet, { category: r.category, lang, browser });
    if (!out.check.ok) { result.failed.push(lang + ': ' + out.check.why.join('; ')); continue; }
    const f = files[lang];
    const note = lang + ' ' + out.check.pages + '쪽';
    if (DRY) { (f ? result.replaced : result.added).push(note); continue; }
    try {
      if (f) {
        const loc = where(f);
        await replace(token, loc, out.pdf);
        if (loc.bucket === 'resources' && f.draft_key) {
          await replace(token, { bucket: 'resource-drafts', key: f.draft_key.replace(/^resource-drafts\//, '') }, out.pdf);
        }
        await rest(token, 'resource_files?id=eq.' + f.id, {
          method: 'PATCH',
          body: JSON.stringify({ file_size: out.bytes, file_hash: out.hash, page_count: out.check.pages, check_result: out.check })
        });
        result.replaced.push(note);
      } else {
        const key = await putDraft(token, r.id + '/' + lang + '-v1.pdf', out.pdf);
        await rest(token, 'resource_files', {
          method: 'POST',
          body: JSON.stringify([{
            resource_id: r.id, lang, version: 1, file_type: 'pdf', draft_key: key,
            file_size: out.bytes, file_hash: out.hash, page_count: out.check.pages, check_result: out.check,
            published: false, mime_type: 'application/pdf', created_by: userId
          }])
        });
        result.added.push(note);
      }
    } catch (err) {
      result.failed.push(lang + ': ' + err.message);
    }
  }
  if (DRY || !(result.replaced.length || result.added.length)) return result;

  // The words on the download's own page follow the corrected English.
  const en = JSON.parse(fs.readFileSync(path.join(dir, SOURCE + '.json'), 'utf8'));
  const patch = { published: false, status: 'review', updated_at: new Date().toISOString() };
  if (en.title && en.title !== r.title) patch.title = en.title;
  if (en.summary) { patch.summary = en.summary; patch.description = en.summary; }
  if (en.objective) patch.objective = en.objective;
  await rest(token, 'resources?id=eq.' + r.id, { method: 'PATCH', body: JSON.stringify(patch) });
  const fixes = (report.fixes || []).length;
  await rest(token, 'resource_reviews', {
    method: 'POST',
    body: JSON.stringify([{ resource_id: r.id, action: 'unpublished',
      note: '정밀 검수 후 새 디자인으로 다시 만들었습니다 (내용 고침 ' + fixes + '곳, ' + langs.length + '개 언어). ' +
            '확인 후 게시해 주세요. (Proofread and remade in ' + langs.length + ' languages — check, then publish.)' }])
  });
  return result;
}

async function apply() {
  const from = path.resolve(arg('from') || 'content/sheets');
  let session = await signIn();
  let rows = await rest(session.token, 'resources?select=id,title,category,status,published,' +
    'resource_files(id,lang,version,published,storage_key,draft_key,page_count)' +
    '&origin=eq.auto&status=neq.rejected&publish_location=eq.free-resources&order=created_at.asc&limit=5000');
  rows = rows.filter((r) => fs.existsSync(path.join(from, r.id, SOURCE + '.json')));
  if (ONLY) {
    const want = ONLY.split('|').map((x) => x.trim()).filter(Boolean);
    rows = rows.filter((r) => want.includes(r.id) || want.includes(r.title));
  }
  if (LIMIT) rows = rows.slice(0, LIMIT);
  log('반영' + (DRY ? ' (연습 — 아무것도 바꾸지 않습니다)' : '') + ': ' + rows.length + '개');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const held = [];
  try {
    for (const r of rows) {
      log('· ' + r.title);
      try {
        session = await signIn();
        const got = await applyOne(session, browser, r, path.join(from, r.id));
        log('    교체 ' + got.replaced.join(', ') + (got.added.length ? ' · 추가 ' + got.added.join(', ') : '') +
            (got.failed.length ? ' · 실패 ' + got.failed.join(' / ') : ''));
        if (!DRY && (got.replaced.length || got.added.length)) held.push(r.title);
      } catch (err) {
        log('    ✗ ' + err.message);
      }
    }
  } finally {
    await browser.close();
  }
  log('');
  log('승인 대기로 보낸 자료 ' + held.length + '개:');
  held.forEach((t) => log('  - ' + t));
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const go = MODE === 'prepare' ? prepare : MODE === 'apply' ? apply : null;
  if (!go) { console.error('usage: rework-sheets.mjs prepare|apply …'); process.exit(2); }
  go().catch((err) => { console.error(err.message || err); process.exit(1); });
}
