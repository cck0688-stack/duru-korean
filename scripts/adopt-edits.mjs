// DURU KOREAN — the owner's edited sheets, in every language
//
// The owner (2026-10-11) edited the 100 Hangul Starter and 102 Grammar
// Cheat Sheets by hand and asked for them to replace ours in every
// language, then to be held for him to publish.
//
//   English   his PDF itself (fonts cut down, checked), except sheets
//             he marked as missing text (--content-only): those are set
//             from the sheet's own text in the new layout.
//   others    the sheet's stored text in each language, set again in
//             the new layout (templates.mjs: hangul letter cards,
//             grammar two-column table) — the layouts are his.
//             Hangul: his words (he added and cut some) and trace
//             squares are read from his PDF; a word he added that a
//             language does not have is translated (Sonnet, one call
//             for the sheet).
//
// Every PDF is checked; one that does not come out at two pages is not
// put in (named in the log). A resource with a file replaced is held
// (unpublished, review) for the owner's Publish. No new file is made
// public. Read-online text for hangul is written to --read-out.
//
//   node scripts/adopt-edits.mjs --shelf=hangul|grammar --index=FILE --read=DIR
//        [--ids=FILE | --dir=DIR] [--only=NNN] [--content-only=NNN,..] [--dry-run] [--read-out=DIR] [--out=DIR]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { rest, where, replace } from './relayout-sheets.mjs';
import { csv, fromDrive, prepare, judge, parseHangul, overflowPt } from './lib/edited-pdf.mjs';
import { renderSheet } from './pdf/render.mjs';
import { writeRead } from './build-read.mjs';
import { LANGUAGE_NAMES } from '../api/_providers.js';
import { subscriptionConfig, useSubscription } from './lib/claude-code.mjs';
import { withPatience } from './lib/patiently.mjs';
import { resolveProvider } from '../api/_providers.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const SHELF = arg('shelf');
const DRY = args.includes('--dry-run');
const ONLY = arg('only');
const CONTENT_ONLY = (arg('content-only') || '').split(',').filter(Boolean);
const READ = arg('read');
const READ_OUT = arg('read-out');
const OUT = arg('out');
const LANGS = Object.keys(LANGUAGE_NAMES);
const log = (...a) => console.log(...a);

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ').');
  return body.access_token;
}

const han = (s) => String(s || '').replace(/[^가-힣ㄱ-ㅣ]/g, '');
// "얼마예요?" and "얼마예요" are one word; "한국어 [한구거" starts with 한국어.
const sameWord = (a, b) => { const x = han(a), y = han(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); };

// Underlines in "Watch out": the wrong word and the right one, the words
// right before "(X)" and "(O)".
function marksFor(watchOut) {
  return (watchOut || []).map((w) => [...String(w).matchAll(/(\S+?)\s*\((?:X|O)\)/g)].map((m) => m[1]));
}

async function translateWords(cfg, entries, langs) {
  const names = langs.map((l) => LANGUAGE_NAMES[l] + ' (' + l + ')').join(', ');
  const prop = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['meaning', 'exampleMeaning'],
    properties: { meaning: { type: 'string' }, exampleMeaning: { type: 'string' } } } };
  const schema = { type: 'object', additionalProperties: false, required: langs,
    properties: Object.fromEntries(langs.map((l) => [l, prop])) };
  const system = 'Translate each vocabulary entry\'s English meaning and the English translation of its Korean example sentence ' +
    'into each target language, in the order given. Short and natural, as in a worksheet word table. ' +
    'Target languages: ' + names + '. Return one array per language code, one item per entry.';
  const raw = await cfg.provider.chat(cfg, system, JSON.stringify(entries.map((e) => ({
    korean: e.korean, meaning: e.meaning, example: e.example, exampleMeaning: e.exampleMeaning }))), schema);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function hold(token, id, note) {
  await rest(token, 'resources?id=eq.' + id, {
    method: 'PATCH', body: JSON.stringify({ published: false, status: 'review', updated_at: new Date().toISOString() })
  });
  await rest(token, 'resource_reviews', {
    method: 'POST', body: JSON.stringify([{ resource_id: id, action: 'unpublished', note }])
  });
}

async function main() {
  const rows = csv(fs.readFileSync(arg('index'), 'utf8')).slice(1).filter((r) => r[0] === SHELF);
  const byNo = {};
  rows.forEach((r) => { byNo[String(r[1]).padStart(3, '0')] = { file: r[2], title: r[3], id: r[5] }; });
  const ids = arg('ids') ? JSON.parse(fs.readFileSync(arg('ids'), 'utf8')) : null;
  const dir = arg('dir');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-'));
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  let cfg = null;
  if (SHELF === 'hangul') {
    cfg = useSubscription(process.env, 'SHEET_PROVIDER')
      ? withPatience(subscriptionConfig(process.env).translator, log)
      : withPatience(resolveProvider(process.env), log);
    cfg.timeoutMs = 240000;
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const stat = { done: 0, failed: 0, files: 0, skippedLang: [], held: 0 };

  const numbers = ids ? Object.keys(ids) : fs.readdirSync(dir).filter((f) => /^\d{3}-.*\.pdf$/.test(f)).map((f) => f.slice(0, 3));
  for (const n of numbers.sort()) {
    if (ONLY && ONLY !== n) continue;
    if (arg('from') && n < arg('from')) continue;
    if (arg('to') && n > arg('to')) continue;
    try {
      const row = byNo[n];
      if (!row) throw new Error('목록에 없는 번호');
      const want = row.file.replace(/^\d{3}-/, '').replace(/\.pdf$/, '');
      let hisBytes, hisFile;
      if (ids) {
        if (want !== ids[n].key) throw new Error('이름이 맞지 않습니다 (' + row.file + ' ≠ ' + ids[n].key + ')');
        hisBytes = await fromDrive(ids[n].id);
      } else {
        hisFile = fs.readdirSync(dir).find((f) => f.startsWith(n + '-'));
        if (hisFile.replace(/^\d{3}-/, '').replace(/\.pdf$/, '') !== want) throw new Error('이름이 맞지 않습니다 (' + row.file + ' ≠ ' + hisFile + ')');
        hisBytes = fs.readFileSync(path.join(dir, hisFile));
      }
      const contentOnly = CONTENT_ONLY.includes(n);

      // His English: the PDF, fonts cut down and checked.
      const outputs = {};
      const prep = prepare(hisBytes, work, n, null);
      const parsed = SHELF === 'hangul' && !contentOnly ? parseHangul(path.join(work, n + '-in.pdf')) : null;
      if (!contentOnly) {
        const check = judge(prep.info, prep.pdf);
        if (!check.ok) throw new Error('영어판 검사를 통과하지 못했습니다: ' + check.why.join('; '));
        outputs.en = { pdf: prep.pdf, check, bytes: prep.pdf.length, hash: crypto.createHash('sha256').update(prep.pdf).digest('hex') };
      }

      // The stored sheet in every language, in the new layout.
      const editions = {};
      for (const lang of LANGS) {
        const f = path.join(READ, row.id, lang + '.json');
        if (fs.existsSync(f)) editions[lang] = JSON.parse(fs.readFileSync(f, 'utf8'));
      }
      if (!editions.en) throw new Error('읽기용 영어 본문이 없습니다');

      // Hangul: his words, and the squares he traced, over the stored text.
      let fresh = [];
      if (parsed && parsed.words.length) {
        const missing = {};
        for (const [lang, ed] of Object.entries(editions)) {
          const have = ed.words || [];
          ed.words = parsed.words.map((pw, i) => have.find((w) => sameWord(w.korean, pw.korean)) || (missing[lang] = missing[lang] || []).push(i) && null);
        }
        const newIdx = [...new Set(Object.values(missing).flat())].sort((a, b) => a - b);
        if (newIdx.length) {
          fresh = newIdx.map((i) => parsed.words[i]);
          const langs = Object.keys(editions).filter((l) => l !== 'en');
          const tr = DRY ? {} : await translateWords(cfg, fresh, langs);
          for (const [lang, ed] of Object.entries(editions)) {
            ed.words = ed.words.map((w, i) => {
              if (w) return w;
              const pw = parsed.words[i];
              const k = newIdx.indexOf(i);
              const t = lang === 'en' ? pw : (tr[lang] && tr[lang][k]);
              return { korean: pw.korean.replace(/\s*\[.*$/, ''), roman: pw.roman, example: pw.example,
                meaning: (t && t.meaning) || pw.meaning, exampleMeaning: (t && t.exampleMeaning) || pw.exampleMeaning };
            });
          }
        }
      }
      for (const ed of Object.values(editions)) {
        ed.words = (ed.words || []).filter(Boolean);
        if (SHELF === 'hangul' && parsed && Array.isArray(ed.letters) && parsed.trace.length === ed.letters.length) {
          ed.letters = ed.letters.map((l, i) => ({ ...l, ...(parsed.trace[i].length ? { trace: parsed.trace[i] } : {}) }));
        }
        if (SHELF === 'grammar') ed.watchOutMark = marksFor(ed.watchOut);
        ed.category = SHELF;
      }

      for (const [lang, ed] of Object.entries(editions)) {
        if (outputs[lang]) continue;
        if (lang === 'en' && !contentOnly) continue;
        const r = await renderSheet(ed, { category: SHELF, lang, browser });
        if (r.check.pages !== 2 || !r.check.ok) {
          stat.skippedLang.push(n + ' ' + lang + ' (' + r.check.pages + '쪽' + (r.check.pages > 2 ? ', 넘친 글 약 ' + overflowPt(r.pdf, work) + 'pt' : '') + (r.check.ok ? '' : ', ' + r.check.why.join('; ').slice(0, 80)) + ')');
          continue;
        }
        outputs[lang] = { pdf: r.pdf, check: r.check, bytes: r.bytes, hash: r.hash };
      }
      log(n + ' ' + row.title.slice(0, 22) + ' — ' + Object.keys(outputs).length + '/' + Object.keys(editions).length + '개 언어' +
          (fresh.length ? ', 새 낱말 ' + fresh.length + '개' : '') +
          (parsed ? ', 낱말 ' + parsed.words.length + '개' : '') +
          (stat.skippedLang.filter((x) => x.startsWith(n + ' ')).length ? ' ! ' + stat.skippedLang.filter((x) => x.startsWith(n + ' ')).join(', ') : ''));
      if (OUT) for (const [lang, o] of Object.entries(outputs)) fs.writeFileSync(path.join(OUT, n + '-' + want + '(' + lang + ').pdf'), o.pdf);
      if (READ_OUT && SHELF === 'hangul') for (const [lang, ed] of Object.entries(editions)) writeRead(row.id, lang, ed, READ_OUT);
      if (DRY) { stat.done += 1; continue; }

      const token = await signIn();
      const [res] = await rest(token, 'resources?select=id,title,status,resource_files(id,lang,version,published,storage_key,draft_key)&id=eq.' + row.id);
      if (!res) throw new Error('자료를 찾지 못했습니다');
      let put = 0;
      for (const [lang, o] of Object.entries(outputs)) {
        const f = (res.resource_files || []).filter((x) => x.lang === lang && where(x)).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
        if (!f) { stat.skippedLang.push(n + ' ' + lang + ' (파일 없음)'); continue; }
        const loc = where(f);
        await replace(token, loc, o.pdf);
        if (loc.bucket === 'resources' && f.draft_key) await replace(token, { bucket: 'resource-drafts', key: f.draft_key.replace(/^resource-drafts\//, '') }, o.pdf);
        await rest(token, 'resource_files?id=eq.' + f.id, {
          method: 'PATCH', body: JSON.stringify({ file_size: o.bytes, file_hash: o.hash, page_count: 2, check_result: { ...o.check, editedByOwner: true } })
        });
        put += 1;
      }
      stat.files += put;
      if (put && res.status === 'published') {
        await hold(token, res.id, '사장님이 편집한 PDF로 모든 언어를 교체했습니다. 확인 후 게시해 주세요. (All languages replaced by the owner\'s edited layout — check, then publish.)');
        stat.held += 1;
      }
      stat.done += 1;
    } catch (err) {
      stat.failed += 1; log(n + ' — 실패: ' + err.message);
    }
  }
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
  log('');
  log('처리 ' + stat.done + '편 · 실패 ' + stat.failed + '편 · 바꾼 PDF ' + stat.files + '개 · 검토 대기로 내림 ' + stat.held + '편' + (DRY ? ' (연습)' : ''));
  if (stat.skippedLang.length) { log('바꾸지 못한 언어 ' + stat.skippedLang.length + '개:'); stat.skippedLang.forEach((x) => log('  - ' + x)); }
  try { const { usageReport } = await import('./lib/claude-code.mjs'); const u = usageReport(); if (u) log(u); } catch (e) { /* none */ }
  if (stat.failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
