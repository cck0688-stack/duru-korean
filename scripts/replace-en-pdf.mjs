// DURU KOREAN — put the owner's own edited English PDFs in place of ours
//
// The owner (2026-10-11) edited the 100 Hangul Starter sheets by hand
// (Drive folder "Hangul-Starter-aligned (1)", shared by link) and asked
// for those PDFs to be the English download. What this does, per sheet:
//
//   1. takes the file from Drive (content/edited/…-drive-ids.json maps
//      the number in its name to the Drive file; series-zip/index.csv
//      maps that number to the resource);
//   2. makes it small: the edited files carry whole fonts (3.4 MB each);
//      the fonts are cut down to the glyphs used (about 0.6 MB), which
//      changes nothing on the page (checked: identical pixels);
//   3. checks it — A4, two pages, real text on both, nothing under 8 pt,
//      nothing off the page — and writes the check where the review
//      screen reads it;
//   4. replaces the English PDF (same key, so links keep working);
//   5. holds the download on the review screen (the rule: a replaced
//      download waits for the owner's Publish; CLAUDE.md).
//
// Other languages are not touched. --skip=NNN,NNN leaves sheets alone
// (the five the owner marked as missing their Sound text).
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD, SUPABASE_URL / SUPABASE_ANON_KEY
//   node scripts/replace-en-pdf.mjs --index=FILE --ids=FILE [--dry-run] [--only=NNN] [--skip=NNN,..] [--out=DIR]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { rest, where, download, replace } from './relayout-sheets.mjs';
import { csv, fromDrive, prepare, judge } from './lib/edited-pdf.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DRY = args.includes('--dry-run');
const ONLY = arg('only');
const SKIP = (arg('skip') || '').split(',').filter(Boolean);
const OUT = arg('out');
// --fill=008,032,..: the Sound text of these is missing from the edited file;
// it is copied in from the sheet's own text (--read=DIR holds <resource id>.json).
const FILL = (arg('fill') || '').split(',').filter(Boolean);
const READ = arg('read');
const log = (...a) => console.log(...a);

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ').');
  return body.access_token;
}

async function hold(token, id) {
  await rest(token, 'resources?id=eq.' + id, {
    method: 'PATCH', body: JSON.stringify({ published: false, status: 'review', updated_at: new Date().toISOString() })
  });
  await rest(token, 'resource_reviews', {
    method: 'POST',
    body: JSON.stringify([{ resource_id: id, action: 'unpublished',
      note: '사장님이 편집한 영어판 PDF로 교체했습니다. 확인 후 게시해 주세요. (Replaced by the owner\'s edited English PDF — check, then publish.)' }])
  });
}

async function run() {
  const ids = JSON.parse(fs.readFileSync(arg('ids') || 'content/edited/hangul-starter-drive-ids.json', 'utf8'));
  const index = csv(fs.readFileSync(arg('index'), 'utf8')).slice(1).filter((r) => r[0] === 'hangul');
  const byNo = {};
  index.forEach((r) => { byNo[String(r[1]).padStart(3, '0')] = { file: r[2], title: r[3], id: r[5] }; });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'edited-'));
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  let done = 0, failed = 0, skipped = 0;
  const held = [];
  for (const n of Object.keys(ids).sort()) {
    if (ONLY && ONLY !== n) continue;
    if (SKIP.includes(n)) { skipped += 1; log(n + ' — 건너뜁니다 (사장님 확인사항)'); continue; }
    try {
      const row = byNo[n];
      if (!row) throw new Error('목록에 없는 번호');
      // The number and the keyword in the file name must both agree.
      const want = row.file.replace(/^\d{3}-/, '').replace(/\.pdf$/, '');
      if (want !== ids[n].key) throw new Error('이름이 맞지 않습니다 (' + row.file + ' ≠ ' + ids[n].key + ')');
      const raw = await fromDrive(ids[n].id);
      let fill = null;
      if (FILL.includes(n)) {
        const own = JSON.parse(fs.readFileSync(path.join(READ, row.id + '.json'), 'utf8'));
        fill = (own.letters || []).map((l) => ({ sound: l.sound || '', as: l.as || '' }));
        if (!fill.length) throw new Error('원본에 letters가 없습니다');
      }
      const { info, pdf } = prepare(raw, work, n, fill);
      const check = judge(info, pdf);
      log(n + ' ' + row.title.slice(0, 28) + ' — ' + info.pages + '쪽, ' + Math.round(raw.length / 1024) + 'KB → ' +
          Math.round(pdf.length / 1024) + 'KB, 글자 최소 ' + Math.min(...info.minfont) + 'pt' + (check.ok ? '' : ' ! ' + check.why.join('; ')));
      if (OUT) fs.writeFileSync(path.join(OUT, n + '-' + want + '.pdf'), pdf);
      if (!check.ok) throw new Error('검사를 통과하지 못했습니다: ' + check.why.join('; '));
      if (DRY) { done += 1; continue; }
      const token = await signIn();
      const [res] = await rest(token, 'resources?select=id,title,status,resource_files(id,lang,version,published,storage_key,draft_key)&id=eq.' + row.id);
      if (!res) throw new Error('자료를 찾지 못했습니다');
      const en = (res.resource_files || []).filter((f) => f.lang === 'en' && where(f))
        .sort((a, b) => (b.version || 1) - (a.version || 1))[0];
      if (!en) throw new Error('영어판 파일이 없습니다');
      const loc = where(en);
      await replace(token, loc, pdf);
      // The draft copy is what is published again on approval.
      if (loc.bucket === 'resources' && en.draft_key) {
        await replace(token, { bucket: 'resource-drafts', key: en.draft_key.replace(/^resource-drafts\//, '') }, pdf);
      }
      await rest(token, 'resource_files?id=eq.' + en.id, {
        method: 'PATCH',
        body: JSON.stringify({ file_size: pdf.length, file_hash: crypto.createHash('sha256').update(pdf).digest('hex'),
          page_count: 2, check_result: check })
      });
      if (res.status === 'published') { await hold(token, res.id); held.push(res.title); }
      done += 1;
    } catch (err) {
      failed += 1; log(n + ' — 실패: ' + err.message);
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
  log('');
  log('교체 ' + done + '편 · 건너뜀 ' + skipped + '편 · 실패 ' + failed + '편' + (DRY ? ' (연습: 아무것도 바꾸지 않았습니다)' : ''));
  if (held.length) log('검토 화면으로 보낸 자료: ' + held.length + '편 (확인 후 게시해 주세요)');
  if (failed) process.exitCode = 1;
}

run().catch((err) => { console.error(err.message || err); process.exit(1); });
