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

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const ID = arg('id'), READ = arg('read'), OUT = arg('out'), DRY = args.includes('--dry-run');
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
  const s = ed.sections || [];
  if (s[0]) { s[0].box = true; s[0].tight = true; }
  if (s[1]) { s[1].flowStyle = 'tags'; s[1].roomy = true; }
  if (s[2]) s[2].roomy = true;
  if (s[3]) { s[3].newPage = true; s[3].tight = true; }
  ed.category = ed.category || 'etc';
  return ed;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const outputs = {};
for (const lang of Object.keys(LANGUAGE_NAMES)) {
  const f = path.join(READ, ID, lang + '.json');
  if (!fs.existsSync(f)) { log(lang + ' — 본문 없음'); continue; }
  const base = JSON.parse(fs.readFileSync(f, 'utf8'));
  // The owner's layout first; a longer language is set closer, then without the page break before the tip, then as it was.
  const tries = [
    { ed: mark(structuredClone(base)), opts: {}, how: '' },
    { ed: mark(structuredClone(base)), opts: { compact: true }, how: ' (촘촘하게)' },
    { ed: (() => { const e = mark(structuredClone(base)); if (e.sections[3]) e.sections[3].newPage = false; return e; })(), opts: { compact: true }, how: ' (읽기 팁 쪽 나누기 없이)' },
    { ed: (() => { const e = structuredClone(base); e.category = e.category || 'etc'; return e; })(), opts: {}, how: ' (예전 모양)' }
  ];
  let r, how = '';
  for (const t of tries) {
    r = await renderSheet(t.ed, { category: 'etc', lang, browser, ...t.opts });
    how = t.how;
    if (r.check.pages === 2 && r.check.ok) { if (t === tries[0]) fs.writeFileSync(f, JSON.stringify(t.ed)); break; }
  }
  outputs[lang] = r;
  log(lang + ' — ' + r.check.pages + '쪽' + how + (r.check.ok ? '' : ' (검사 실패: ' + (r.check.problems || r.check.why || '') + ')'));
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, lang + '.pdf'), r.pdf); }
}
await browser.close();
if (DRY) process.exit(0);

const bad = Object.entries(outputs).filter(([, o]) => o.check.pages !== 2 || !o.check.ok).map(([l]) => l);
if (bad.length) { log('2쪽이 아니거나 검사에 걸린 언어: ' + bad.join(', ') + ' — 올리지 않습니다'); process.exit(1); }
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
