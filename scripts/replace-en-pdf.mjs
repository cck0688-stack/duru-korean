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
import { execFileSync } from 'node:child_process';
import { rest, where, download, replace } from './relayout-sheets.mjs';
import { textIsReal, pageBreakdown } from './pdf/check.mjs';

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

function csv(text) {
  const rows = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push([...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));
  }
  return rows;
}

async function fromDrive(id) {
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch('https://drive.google.com/uc?export=download&id=' + id, { redirect: 'follow' }).catch(() => null);
    if (res && res.ok && !/text\/html/.test(res.headers.get('content-type') || '')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 5).toString() === '%PDF-') return buf;
    }
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error('드라이브에서 받지 못했습니다');
}

// Fonts cut to the glyphs used, and what a person would look at.
const PY = [
  'import sys, json, pymupdf',
  'src, dst = sys.argv[1], sys.argv[2]',
  'fill = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None',
  'd = pymupdf.open(src)',
  'cards = 0',
  'if fill:',
  '    DJ = pymupdf.Font(fontfile="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")',
  '    WQ = pymupdf.Font(fontfile="/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc")',
  '    def fnt(ch): return WQ if ord(ch) > 0x2E80 or 0x1100 <= ord(ch) <= 0x11FF or 0x3130 <= ord(ch) <= 0x318F or 0xAC00 <= ord(ch) <= 0xD7A3 else DJ',
  '    def width(t, sz): return sum(fnt(c).text_length(c, fontsize=sz) for c in t)',
  '    def wrap(t, sz, w):',
  '        lines, cur = [], ""',
  '        for word in t.split(" "):',
  '            trial = (cur + " " + word).strip()',
  '            if width(trial, sz) <= w or not cur: cur = trial',
  '            else: lines.append(cur); cur = word',
  '        if cur: lines.append(cur)',
  '        return lines',
  '    pg = d[0]',
  '    marks = []',
  '    for b in pg.get_text("dict")["blocks"]:',
  '        for ln in b.get("lines", []):',
  '            for sp in ln["spans"]:',
  '                if sp["text"].replace(" ", "").upper().startswith("TRACEAND"): marks.append(sp["bbox"][1])',
  '    # the card starts 76 pt above its "TRACE AND COPY" label (the owner\'s layout)',
  '    cs = [pymupdf.Rect(42, my - 76, 553, my + 46) for my in sorted(marks)]',
  '    if len(cs) != len(fill): raise SystemExit("cards " + str(len(cs)) + " != letters " + str(len(fill)))',
  '    cards = len(cs)',
  '    DARK, GREY = (0.098, 0.231, 0.18), (0.26, 0.33, 0.30)',
  '    for r, l in zip(cs, fill):',
  '        tws = {DARK: pymupdf.TextWriter(pg.rect), GREY: pymupdf.TextWriter(pg.rect)}',
  '        y = r.y0 + 22',
  '        for t, sz, lh, col in ((l.get("sound") or "", 9.4, 11.5, DARK), (l.get("as") or "", 7.3, 9.0, GREY)):',
  '            if not t: continue',
  '            for line in wrap(t, sz, 243):',
  '                x = 298',
  '                cur = ""',
  '                # one run per font so each character comes from a font that has it',
  '                runs, run, rf = [], "", None',
  '                for ch in line:',
  '                    f = fnt(ch)',
  '                    if rf is not None and f is not rf: runs.append((run, rf)); run = ""',
  '                    run += ch; rf = f',
  '                if run: runs.append((run, rf))',
  '                for txt, f in runs:',
  '                    tws[col].append((x, y), txt, font=f, fontsize=sz)',
  '                    x += f.text_length(txt, fontsize=sz)',
  '                y += lh',
  '            y += 3',
  '        if y - 3 > r.y0 + 72: raise SystemExit("sound text too long for the card")',
  '        for c, tw in tws.items(): tw.write_text(pg, color=c)',
  'info = {"pages": d.page_count, "sizes": [[round(p.rect.width), round(p.rect.height)] for p in d]}',
  'mins, outside, texts = [], 0, []',
  'for p in d:',
  '    t = p.get_text("dict"); small = 99; r = p.rect',
  '    for b in t["blocks"]:',
  '        for l in b.get("lines", []):',
  '            for s in l["spans"]:',
  '                if s["text"].strip():',
  '                    small = min(small, s["size"])',
  '                    x0, y0, x1, y1 = s["bbox"]',
  '                    if x0 < r.x0 - 1 or y0 < r.y0 - 1 or x1 > r.x1 + 1 or y1 > r.y1 + 1: outside += 1',
  '    mins.append(round(small, 1)); texts.append(p.get_text())',
  'info["minfont"] = mins; info["outside"] = outside; info["chars"] = [len(x) for x in texts]; info["cards"] = cards',
  'try:',
  '    d.subset_fonts()',
  'except Exception as e:',
  '    info["subsetError"] = str(e)',
  'd.save(dst, garbage=4, deflate=True, clean=True)',
  'print(json.dumps(info))'
].join('\n');

function prepare(bytes, work, n, fill) {
  const src = path.join(work, n + '-in.pdf');
  const dst = path.join(work, n + '-out.pdf');
  fs.writeFileSync(src, bytes);
  const extra = [];
  if (fill) { const f = path.join(work, n + '-fill.json'); fs.writeFileSync(f, JSON.stringify(fill)); extra.push(f); }
  const info = JSON.parse(execFileSync('python3', ['-P', '-c', PY, src, dst, ...extra], { encoding: 'utf8' }));
  return { info, pdf: fs.readFileSync(dst) };
}

function judge(info, pdf) {
  const why = [];
  if (info.pages !== 2) why.push('the file has ' + info.pages + ' pages, not 2');
  info.sizes.forEach(([w, h], i) => { if (Math.abs(w - 595) > 3 || Math.abs(h - 842) > 3) why.push('page ' + (i + 1) + ' is not A4'); });
  info.minfont.forEach((m, i) => { if (m < 5.5) why.push('page ' + (i + 1) + ' has text under 5.5 pt'); });
  if (info.outside) why.push(info.outside + ' pieces of text run off the page');
  info.chars.forEach((c, i) => { if (c < 40) why.push('page ' + (i + 1) + ' has almost no text'); });
  const text = textIsReal(pdf);
  if (!text.ok) why.push('the text is not selectable');
  const { pages, pagesDrawingText } = pageBreakdown(pdf);
  return {
    ok: why.length === 0, why, pages, pagesDrawingText, bytes: pdf.length,
    textLength: info.chars.reduce((a, b) => a + b, 0), selectableText: text.ok,
    editedByOwner: true, checkedAt: new Date().toISOString()
  };
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
