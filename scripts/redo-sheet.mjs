// DURU KOREAN — set one sheet again in its stored text, with layout notes
// the owner gave for that sheet alone (2026-10-13, festival timetable).
// Reads read/<id>/<lang>.json, adds the layout flags, renders every
// language, and (unless dry) replaces the files and holds the resource
// for the owner's Publish. Nothing else is touched.
//
//   node scripts/redo-sheet.mjs --id=<resource id> --read=<read dir> [--out=dir] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { rest, where, replace } from './relayout-sheets.mjs';
import { renderSheet } from './pdf/render.mjs';
import { LANGUAGE_NAMES } from '../api/_providers.js';
import { subscriptionAccount, useSubscription } from './lib/claude-code.mjs';
import { withPatience } from './lib/patiently.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const MODE = arg('mode'), LANGS_ONLY = arg('langs') ? arg('langs').split(',') : null;
const ID = arg('id'), READ = arg('read'), OUT = arg('out'), DRY = args.includes('--dry-run'), SHORTEN = args.includes('--shorten');
const log = (...a) => console.log(...a);

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ')');
  return body.access_token;
}

// Section 1 (poster) in a box; 2 (timetable) as lettered tags, roomy; 3 (words) roomy; 4 (tip) on page two.
function mark(ed) {
  if (MODE === 'rerender') return ed;
  if (MODE === 'passage') { ed.passageBox = true; return ed; }
  if (MODE === 'dialogue') { ed.dialogueBox = true; ed.category = ed.category || 'reallife'; return ed; }
  const s = ed.sections || [];
  if (MODE === 'proverb' || MODE === 'food') {
    // "food" (owner, 2026-10-13): item rows stacked in one box; a spoken exchange as turns in one big box;
    // the closing tips on page two as points; A:/B: question lines apart. Works on whatever sections the sheet has.
    s.forEach((sec) => {
      if ((sec.items || []).length) { sec.box = true; sec.tight = true; sec.stack = true; }
      const para = (sec.paragraphs || []).join(' ');
      if (!(sec.dialogue || []).length && /^[^\s:\/]{1,6}:\s/.test(para) && /\s\/\s[^\s:\/]{1,6}:\s/.test(para)) {
        const turns = para.split(/\s*\/\s*(?=[^\s:\/]{1,6}:\s)/).map((x) => x.match(/^([^\s:\/]{1,6}):\s*([\s\S]*)$/)).filter(Boolean);
        if (turns.length > 1) { sec.dialogue = turns.map((m) => ({ who: m[1], korean: m[2].trim() })); sec.paragraphs = []; }
      }
    });
    const last = s[s.length - 1];
    if (s.length > 1 && last && (last.paragraphs || []).length && !(last.items || []).length && !(last.steps || []).length && !(last.dialogue || []).length) {
      last.newPage = true; last.tight = true;
      // The tips as numbered points: the first sentence is the lead, then one point for each sentence that follows.
      const sents = String(last.paragraphs.join(' ')).split(/(?<=[.:])\s+(?=[A-Z])/);
      if (sents.length > 2 && last.paragraphs.length === 1) {
        last.points = sents.slice(1).map((x) => { const lead = x.split(/\s+(?:to|after)\s|:\s/)[0]; return { lead: lead.replace(/[.:]+$/, ''), text: x.slice(lead.length).replace(/^[:\s]*/, '') }; });
        last.points.unshift({ lead: sents[0].replace(/\.$/, ''), text: '' });
        last.paragraphs = [];
      }
    }
    ed.exercises = (ed.exercises || []).map((q) => {
      const m = typeof q === 'string' && q.match(/^(Read and explain[^:]*:)\s*(A:[\s\S]*?)\s+(B:[\s\S]*)$/);
      return m ? { ask: m[1], items: [m[2], m[3]], plain: true } : q;
    });
    ed.category = ed.category || 'etc';
    return ed;
  }
  if (s[0]) { s[0].box = true; s[0].tight = true; }
  if (s[1]) { s[1].flowStyle = 'tags'; s[1].roomy = true; }
  if (s[2]) s[2].roomy = true;
  if (s[3]) { s[3].newPage = true; s[3].tight = true; }
  ed.category = ed.category || 'etc';
  return ed;
}

// --shorten (owner, 2026-10-14): a language whose text is too long for the new layout on two pages
// gets its explanations shortened — only the explaining text in that language; every Korean word,
// item, question and answer stays, so all ten languages still teach the same sheet.
const SHORT_KEYS = new Set(['summary', 'objective', 'note', 'setting', 'text', 'paragraphs', 'meaning', 'exampleMeaning', 'line', 'en']);
function longTexts(ed) {
  const out = [];
  (function walk(o, key) {
    if (Array.isArray(o)) { o.forEach((v, i) => (typeof v === 'string' ? (SHORT_KEYS.has(key) && v.length >= 40 && out.push([o, i])) : walk(v, key))); return; }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'exercises' || k === 'answers' || k === 'title') continue;
      if (typeof v === 'string') { if (SHORT_KEYS.has(k) && v.length >= 40) out.push([o, k]); } else walk(v, k);
    }
  })(ed, '');
  return out;
}
let editor = null;
async function shorten(ed, lang, cut) {
  if (!editor) {
    if (!useSubscription(process.env)) throw new Error('구독 토큰이 없어 줄일 수 없습니다');
    editor = withPatience(subscriptionAccount(process.env.SHORTEN_MODEL || 'sonnet'), log);
    editor.timeoutMs = 300000;
  }
  const spots = longTexts(ed);
  if (!spots.length) { log(lang + ' — 줄일 설명이 없음'); return null; }
  const texts = spots.map(([o, k]) => o[k]);
  const system = [
    'You edit a Korean-learning worksheet whose explanations are written in ' + (LANGUAGE_NAMES[lang] || lang) + '.',
    'It runs onto a third A4 page. Shorten the texts below by about ' + cut + '% in total so it fits on two pages.',
    '- Keep the meaning and everything a learner needs. Cut repetition, filler and side remarks first.',
    '- Keep every Korean word, phrase and sentence exactly as written (Hangul is never changed or removed).',
    '- Keep the language of each text; do not translate.',
    '- Return exactly ' + texts.length + ' texts, in the same order, one for each text you were given.'
  ].join('\n');
  const schema = { type: 'object', additionalProperties: false, required: ['texts'],
    properties: { texts: { type: 'array', items: { type: 'string' } } } };
  const raw = await editor.provider.chat(editor, system, JSON.stringify({ texts }, null, 1), schema);
  const got = (typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw).texts;
  if (!Array.isArray(got) || got.length !== texts.length) { log(lang + ' — 줄인 글 개수가 다름 (' + (Array.isArray(got) ? got.length : typeof got) + '/' + texts.length + ')'); return null; }
  const hangul = (s) => (String(s).match(/[가-힣]+/g) || []).join(' ');
  const out = structuredClone(ed);
  const spots2 = longTexts(out);
  let changed = 0;
  spots2.forEach(([o, k], i) => {
    const n = String(got[i] || '').trim();
    // Only a shorter text that keeps its Korean is taken.
    if (n && n.length < o[k].length && hangul(n) === hangul(o[k])) { o[k] = n; changed += 1; }
  });
  const before = texts.join('').length, after = longTexts(out).map(([o, k]) => o[k]).join('').length;
  log(lang + ' — 설명 ' + changed + '/' + texts.length + '개 줄임 (' + before + '→' + after + '자)');
  return changed ? out : null;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const outputs = {};
for (const lang of Object.keys(LANGUAGE_NAMES)) {
  const f = path.join(READ, ID, lang + '.json');
  if (LANGS_ONLY && !LANGS_ONLY.includes(lang)) continue;
  if (!fs.existsSync(f)) { log(lang + ' — 본문 없음'); continue; }
  const base = JSON.parse(fs.readFileSync(f, 'utf8'));
  // The owner's layout first; a longer language is set closer, then without the page break before the tip, then as it was.
  const tries = [
    { ed: mark(structuredClone(base)), opts: {}, how: '' },
    ...(MODE === 'proverb' || MODE === 'food' ? [{ ed: mark(structuredClone(base)), opts: { compact: true }, how: ' (촘촘하게)' }] : []),
    // A longer language: the item rows side by side again (two lines a row, not three), still in one box.
    ...(MODE === 'food' ? [{ ed: (() => { const e = mark(structuredClone(base)); (e.sections || []).forEach((x) => { x.stack = false; }); return e; })(), opts: { compact: true }, how: ' (속담 줄을 나란히)' },
      { ed: (() => { const e = mark(structuredClone(base)); (e.sections || []).forEach((x) => { x.stack = false; x.newPage = false; }); return e; })(), opts: { compact: true }, how: ' (나란히, 쪽 나누기 없이)' }] : []),
    { ed: mark(structuredClone(base)), opts: { compact: true }, how: ' (촘촘하게)' },
    { ed: (() => { const e = mark(structuredClone(base)); if (e.sections) e.sections.forEach((x) => { x.newPage = false; }); return e; })(), opts: { compact: true }, how: ' (읽기 팁 쪽 나누기 없이)' },
    { ed: (() => { const e = structuredClone(base); e.category = e.category || 'etc'; return e; })(), opts: {}, how: ' (예전 모양)' }
  ];
  let r, how = '';
  for (const t of tries) {
    r = await renderSheet(t.ed, { category: t.ed.category || 'etc', lang, browser, ...t.opts });
    how = t.how;
    if (r.check.pages === 2 && r.check.ok) { if (t === tries[0]) fs.writeFileSync(f, JSON.stringify(t.ed)); break; }
  }
  // Still not on two pages in the new layout: shorten that language's explanations and try again.
  if (SHORTEN && (how === tries[tries.length - 1].how || r.check.pages !== 2 || !r.check.ok)) {
    let cur = base;
    for (const cut of [20, 30, 40]) {
      let next = null;
      try { next = await shorten(cur, lang, cut); } catch (e) { log(lang + ' — 줄이기 실패: ' + e.message); break; }
      if (!next) break;
      cur = next;
      let done = false;
      for (const opts of [{}, { compact: true }]) {
        const ed = mark(structuredClone(cur));
        const rr = await renderSheet(ed, { category: ed.category || 'etc', lang, browser, ...opts });
        if (rr.check.pages === 2 && rr.check.ok) { r = rr; how = ' (설명 ' + cut + '% 줄임)'; fs.writeFileSync(f, JSON.stringify(ed)); done = true; break; }
      }
      if (done) break;
    }
  }
  if (r.check.pages !== 2 || !r.check.ok) { log(lang + ' — 2쪽이 안 돼서 이 언어는 그대로 둡니다 (' + r.check.pages + '쪽)'); continue; }
  outputs[lang] = r;
  log(lang + ' — ' + r.check.pages + '쪽' + how + (r.check.ok ? '' : ' (검사 실패: ' + (r.check.problems || r.check.why || '') + ')'));
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, lang + '.pdf'), r.pdf); }
}
await browser.close();
if (DRY) process.exit(0);

const token = await signIn();
const [res] = await rest(token, 'resources?select=id,title,status,resource_files(id,lang,version,published,storage_key,draft_key)&id=eq.' + ID);
if (!res) throw new Error('자료를 찾지 못했습니다');
let put = 0;
for (const [lang, o] of Object.entries(outputs)) {
  const f = (res.resource_files || []).filter((x) => x.lang === lang && where(x)).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
  if (!f) { log(lang + ' — 파일 없음'); continue; }
  const loc = where(f);
  await replace(token, loc, o.pdf);
  if (loc.bucket === 'resources' && f.draft_key) await replace(token, { bucket: 'resource-drafts', key: f.draft_key.replace(/^resource-drafts\//, '') }, o.pdf);
  await rest(token, 'resource_files?id=eq.' + f.id, {
    method: 'PATCH', body: JSON.stringify({ file_size: o.bytes, file_hash: o.hash, page_count: o.check.pages, check_result: o.check })
  });
  put += 1;
}
if (put && res.status !== 'review' && res.status !== 'draft') {
  await rest(token, 'resources?id=eq.' + res.id, { method: 'PATCH', body: JSON.stringify({ published: false, status: 'review', updated_at: new Date().toISOString() }) });
  await rest(token, 'resource_reviews', { method: 'POST', body: JSON.stringify([{ resource_id: res.id, action: 'unpublished', note: '사장님 요청으로 이 자료의 모양을 고쳤습니다. 확인 후 게시해 주세요. (Layout changed at the owner\'s request — check, then publish.)' }]) });
}
log('바꾼 PDF ' + put + '개 · ' + res.title + ' (상태: ' + res.status + ')');
