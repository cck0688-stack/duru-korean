// DURU KOREAN — set the worksheets already made in the current layout
//
// The owner changed how a worksheet sits on the page (2026-09-25: no
// half-empty pages, the answers under the questions rather than on a
// page of their own — see scripts/pdf/sheet.css) and asked for the
// sheets already on the shelf to be set again the same way.
//
// What a sheet says was never stored apart from its PDF, so it is read
// back out of the PDF: the text (scripts/pdf/pdftext.py), handed to the
// model to put back into the sheet's shape, word for word, and rendered
// again. The new PDF replaces the old one only when it says the same
// thing — the same characters, in the same order, once what the layout
// itself adds (footer, page numbers, headings) is set aside. A file
// that does not match exactly is left as it was and named in the log.
//
// One thing is left out on purpose: a note about making the sheet
// ("I fixed both problems from the last review…") that a rewrite once
// put in a sheet's note box. When the English edition's note is that,
// the note goes from every language's edition.
//
// Only sheets the engine made (origin 'auto') are touched, published or
// still waiting for review; rejected ones are not. The same file keys
// are kept, so every link to a download keeps working.
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD, SUPABASE_URL / SUPABASE_ANON_KEY
//   and the model account the daily run uses (CLAUDE_CODE_OAUTH_TOKEN or
//   an API key).
//
//   node scripts/relayout-sheets.mjs [--dry-run] [--limit=N] [--only=<resource id>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveProvider } from '../api/_providers.js';
import { sheetSchema, unnumbered, MAKING_OF, SHELVES } from './lib/sheets.mjs';
import { withPatience } from './lib/patiently.mjs';
import { subscriptionAccount, useSubscription } from './lib/claude-code.mjs';
import { renderSheet, labelsFor } from './pdf/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

// "The same thing": no character gained or lost, and the order kept.
export const SAME = { hist: 0.002, ratio: 0.995 };
const TRIES = 2;
const AT_ONCE = 4;

const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DRY = args.includes('--dry-run');
const LIMIT = Number(arg('limit')) || 0;
const ONLY = arg('only');

const log = (...a) => console.log(...a);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'relayout-'));

/* ---------------- the database and storage ---------------- */

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
  return body.access_token;
}

const auth = (token, extra) => ({ apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, ...(extra || {}) });

async function rest(token, p, init = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + p, {
    ...init, headers: auth(token, { 'Content-Type': 'application/json', ...(init.headers || {}) })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(p.split('?')[0] + ' ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

// "resource-drafts/<id>/en-v1.pdf" or "auto/<id>/en-v1.pdf" in the
// public bucket: which bucket, and the key inside it.
function where(f) {
  if (f.published && f.storage_key) return { bucket: 'resources', key: f.storage_key.replace(/^resources\//, '') };
  if (f.draft_key) return { bucket: 'resource-drafts', key: f.draft_key.replace(/^resource-drafts\//, '') };
  return null;
}

async function download(token, loc) {
  const res = await fetch(SUPABASE_URL + '/storage/v1/object/' + loc.bucket + '/' + loc.key, { headers: auth(token) });
  if (!res.ok) throw new Error(loc.bucket + ' 내려받기 실패 (' + res.status + ')');
  return Buffer.from(await res.arrayBuffer());
}

// The public bucket lets an admin add and delete but not overwrite, so
// the old file goes first and the new one takes its key.
async function replace(token, loc, bytes) {
  const put = () => fetch(SUPABASE_URL + '/storage/v1/object/' + loc.bucket + '/' + loc.key, {
    method: 'POST', headers: auth(token, { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }), body: bytes
  });
  let res = await put();
  if (!res.ok) {
    await fetch(SUPABASE_URL + '/storage/v1/object/' + loc.bucket + '/' + loc.key, { method: 'DELETE', headers: auth(token) });
    res = await put();
  }
  if (!res.ok) throw new Error(loc.bucket + ' 올리기 실패 (' + res.status + '): ' + (await res.text()).slice(0, 160));
}

/* ---------------- reading the old sheet back ---------------- */

function py(req) {
  return JSON.parse(execFileSync('python3', [path.join(HERE, 'pdf', 'pdftext.py')],
    { input: JSON.stringify(req), maxBuffer: 32 * 1024 * 1024 }).toString());
}

const FIELDS = {
  words: 'words: 표의 한 줄이 한 항목. korean = 왼쪽 굵은 한국어, roman = 그 아래 작은 기울임 글씨, meaning = 가운데 칸, ' +
         'example = 오른쪽 칸의 한국어 문장, exampleMeaning = 그 아래 작은 글씨.',
  passage: 'passage: 지문의 문단들. words: 낱말풀이 표 (korean, roman, meaning, example, exampleMeaning).',
  forms: 'forms: 표의 한 줄이 한 항목. form = 왼쪽 굵은 글씨, when = 그 아래 작은 기울임 설명, means = 가운데 칸, ' +
         'example = 오른쪽 칸의 한국어 문장, exampleMeaning = 그 아래 작은 글씨. watchOut: 주의할 점 상자 하나가 한 항목.',
  dialogue: 'setting: 대화 위의 상자 (없으면 빈 문자열). dialogue: 대화 한 줄 = who (왼쪽 이름), korean, meaning (그 아래). ' +
            'words: 대화 아래 표현 표 (korean, roman, meaning, example, exampleMeaning).',
  letters: 'letters: 표의 한 줄 = letter, sound, as (sound 아래 작은 글씨). words: 낱말 표.',
  sections: 'sections: 소제목(heading)과 그 아래 문단들(paragraphs). note: 주황색 상자 안의 글 (없으면 빈 문자열).'
};

function prompt(category, lang) {
  const shape = (SHELVES[category] || SHELVES.etc).shape;
  return [
    '아래는 두루한국어 학습지 PDF 에서 뽑아낸 글자입니다 (학습지 언어: ' + lang + ', 갈래: ' + category + ').',
    '이 학습지를 원래의 JSON 형태로 되돌리세요. 새 편집으로 다시 찍기 위한 것입니다.',
    '',
    '가장 중요한 것: 글자를 한 자도 바꾸지 마세요. 번역, 맞춤법 고침, 다듬기, 요약, 보태기, 빼기 모두 안 됩니다.',
    'PDF 의 줄바꿈 때문에 끊긴 낱말과 문장만 이어 붙이세요.',
    '',
    '틀(편집)이 넣은 것은 빼세요:',
    '- 맨 위 "DURU KOREAN · FREE DOWNLOADS" 와 수준·시간 표시 (level 과 minutes 칸에 값만 넣으세요. minutes 는 숫자).',
    '- 대문자로 된 칸 제목 (예: THE PATTERN, WATCH OUT, YOUR TURN, ANSWERS, WHAT THIS IS FOR 와 그 언어의 같은 말), 표의 머리줄.',
    '- 문제와 정답 앞의 번호 "1)". 페이지 아래의 durukorean.com, 제목, 쪽 번호.',
    '',
    'title = 맨 위 큰 제목. summary = 제목 아래 문단. objective = 학습 목표 상자 안의 글.',
    'exercises = 문제들, answers = 정답들 (같은 개수, 같은 순서).',
    FIELDS[shape] || FIELDS.sections,
    '해당하는 글이 없는 칸은 빈 문자열이나 빈 배열로 두세요. tags 와 checkThese 는 빈 배열.'
  ].join('\n');
}

async function readBack(cfg, category, lang, text, hint) {
  const out = await cfg.provider.chat(cfg, prompt(category, lang) + (hint ? '\n\n' + hint : ''),
    text, sheetSchema(category, cfg.provider.strictSchema !== false));
  const sheet = unnumbered(typeof out === 'string' ? JSON.parse(out) : out);
  sheet.category = category;
  return sheet;
}

/* ---------------- one download ---------------- */

export async function relayout(token, cfg, browser, r) {
  // The newest version of each language.
  const newest = {};
  (r.resource_files || []).forEach((f) => {
    if (!where(f)) return;
    if (!newest[f.lang] || (f.version || 1) > (newest[f.lang].version || 1)) newest[f.lang] = f;
  });
  const files = Object.values(newest);
  if (!files.length) return { done: 0, kept: 0 };

  // Read every language back first: whether the note goes is decided
  // by the English one, for all of them.
  const read = {};
  await pool(files, AT_ONCE, async (f) => {
    const loc = where(f);
    const old = path.join(WORK, r.id + '-' + f.lang + '-old.pdf');
    fs.writeFileSync(old, await download(token, loc));
    const text = py({ op: 'text', path: old }).pages.join('\n');
    read[f.lang] = { f, loc, old, text };
  });

  const en = read.en || read[files[0].lang];
  let dropNote = false;
  let done = 0, kept = 0;

  // English first: whether the note goes is decided there. The rest
  // then a few at a time — a read-back is a model call, and eight of
  // them one after another make a slow sheet.
  const one = async (lang) => {
    const it = read[lang];
    let hint = '';
    let result = null;
    for (let t = 0; t < TRIES && !result; t += 1) {
      let sheet;
      try {
        sheet = await readBack(cfg, r.category, lang, it.text, hint);
      } catch (err) {
        hint = ''; log('    ' + lang + ': 읽기 실패 — ' + err.message);
        continue;
      }
      if (lang === en.f.lang && sheet.note && MAKING_OF.test(sheet.note)) dropNote = true;
      it.sheet = sheet;
      const drop = [];
      const edition = { ...sheet };
      if (dropNote && edition.note) { drop.push(edition.note); edition.note = ''; }
      const out = await renderSheet(edition, { category: r.category, lang, browser });
      const fresh = path.join(WORK, r.id + '-' + lang + '-new.pdf');
      fs.writeFileSync(fresh, out.pdf);
      const L = labelsFor(lang);
      const cmp = py({ op: 'compare', old: it.old, new: fresh, title: sheet.title || r.title, drop,
        labels: Object.values(L).filter((x) => typeof x === 'string') });
      const same = cmp.hist <= SAME.hist && cmp.ratio >= SAME.ratio;
      if (same && out.check && out.check.ok) {
        result = { out, cmp };
      } else {
        hint = '지난번 결과는 원래 PDF 의 글자와 달랐습니다 (다른 글자 ' + Math.round(cmp.hist * 1000) / 10 +
               '%). 글자를 바꾸거나 빼거나 보태지 말고, 틀이 넣은 제목·번호만 빼세요.';
        log('    ' + lang + ': 원본과 다름 (hist ' + cmp.hist.toFixed(4) + ', ratio ' + cmp.ratio.toFixed(4) +
            (out.check && !out.check.ok ? ', 검사: ' + out.check.why.join('; ') : '') + ')' +
            (t + 1 < TRIES ? ' — 다시' : ''));
        (cmp.where || []).slice(0, 4).forEach((w) =>
          log('        원본 …' + w.old.slice(0, 90) + '…  /  새 …' + w.new.slice(0, 90) + '…'));
      }
    }
    if (!result) { kept += 1; log('    ' + lang + ': 그대로 둡니다'); return; }

    const { out, cmp } = result;
    log('    ' + lang + ': ' + (it.f.page_count || '?') + '쪽 → ' + out.check.pages + '쪽 (같음 ' +
        (cmp.ratio * 100).toFixed(1) + '%)' + (DRY ? ' (연습)' : ''));
    if (DRY) { done += 1; return; }
    try {
      await replace(token, it.loc, out.pdf);
      // A published file's draft copy is what gets published again if
      // it is ever re-approved, so it is set the same way.
      if (it.loc.bucket === 'resources' && it.f.draft_key) {
        await replace(token, { bucket: 'resource-drafts', key: it.f.draft_key.replace(/^resource-drafts\//, '') }, out.pdf);
      }
      await rest(token, 'resource_files?id=eq.' + it.f.id, {
        method: 'PATCH',
        body: JSON.stringify({
          file_size: out.bytes, file_hash: out.hash, page_count: out.check.pages, check_result: out.check
        })
      });
      done += 1;
    } catch (err) {
      kept += 1; log('    ' + lang + ': 교체 실패 — ' + err.message);
    }
  };
  await one(en.f.lang);
  await pool(Object.keys(read).filter((l) => l !== en.f.lang), AT_ONCE, one);
  if (dropNote) log('    (영어판의 만드는 과정 메모를 모든 언어에서 뺐습니다)');
  return { done, kept };
}

async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

/* ---------------- the run ---------------- */

export async function run() {
  const cfg = withPatience(useSubscription(process.env, 'SHEET_PROVIDER')
    ? subscriptionAccount(process.env.RELAYOUT_MODEL || 'sonnet')
    : resolveProvider(process.env), log);
  cfg.timeoutMs = Number(process.env.DURU_CALL_TIMEOUT_MS) || 240000;
  log('새 편집으로 다시 찍기' + (DRY ? ' (연습 — 아무것도 바꾸지 않습니다)' : '') + ' · 읽기: ' + cfg.label + ' / ' + cfg.model);

  const token = await signIn();
  let rows = await rest(token, 'resources?select=id,title,category,status,' +
    'resource_files(id,lang,version,published,storage_key,draft_key,page_count)' +
    '&origin=eq.auto&status=neq.rejected&publish_location=eq.free-resources&order=created_at.asc&limit=5000');
  if (ONLY) rows = rows.filter((r) => r.id === ONLY);
  if (LIMIT) rows = rows.slice(0, LIMIT);
  log('대상: ' + rows.length + '개');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let done = 0, kept = 0, failed = 0;
  try {
    for (const r of rows) {
      log('· ' + r.title + ' [' + r.category + ', ' + r.status + ']');
      try {
        const got = await relayout(token, cfg, browser, r);
        done += got.done; kept += got.kept;
      } catch (err) {
        failed += 1; log('    실패 — ' + err.message);
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  log('');
  log('새 편집으로 바꿈: ' + done + '개 파일 · 그대로 둠: ' + kept + '개 · 자료 단위 실패: ' + failed + '개');
  return { done, kept, failed };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}

