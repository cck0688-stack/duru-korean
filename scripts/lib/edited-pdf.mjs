// DURU KOREAN — what replacing a sheet with the owner's edited PDF needs
// (shared by replace-en-pdf.mjs and adopt-edits.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { textIsReal, pageBreakdown } from '../pdf/check.mjs';

export function csv(text) {
  const rows = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push([...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));
  }
  return rows;
}

export async function fromDrive(id) {
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

export function prepare(bytes, work, n, fill) {
  const src = path.join(work, n + '-in.pdf');
  const dst = path.join(work, n + '-out.pdf');
  fs.writeFileSync(src, bytes);
  const extra = [];
  if (fill) { const f = path.join(work, n + '-fill.json'); fs.writeFileSync(f, JSON.stringify(fill)); extra.push(f); }
  const info = JSON.parse(execFileSync('python3', ['-P', '-c', PY, src, dst, ...extra], { encoding: 'utf8' }));
  return { info, pdf: fs.readFileSync(dst) };
}

export function judge(info, pdf) {
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


// What a hand-edited Hangul sheet says that the stored sheet does not: the
// words on page 2 (Korean, romanization, meaning, example, its meaning) and
// the squares to trace on page 1 (the grey examples), card by card.
//
// The owner's editor stacked its changes over the old page rather than
// replacing it, so a page holds the old text under the new. A table
// he retyped is in other fonts than Chromium's own (Droid Sans, DejaVu,
// Helvetica, Nimbus); when there are such lines the table is read from
// those alone, else from the original.
const PY_HANGUL = [
  'import sys, json, re, pymupdf',
  'd = pymupdf.open(sys.argv[1])',
  'HAN = re.compile(r"[\\uac00-\\ud7a3\\u3131-\\u318e]")',
  'def lines(p):',
  '    out, seen = [], set()',
  '    for b in p.get_text("dict")["blocks"]:',
  '        for l in b.get("lines", []):',
  '            t = "".join(s["text"] for s in l["spans"]).strip()',
  '            if not t: continue',
  '            k = (round(l["bbox"][1] / 3), round(l["bbox"][0] / 6), t)',
  '            if k in seen: continue',
  '            seen.add(k)',
  '            out.append({"x": l["bbox"][0], "y": l["bbox"][1], "size": max(s["size"] for s in l["spans"]), "t": t,',
  '                        "own": not l["spans"][0]["font"].startswith("Type3")})',
  '    return out',
  'def norm(t): return t.replace(" ", "").upper()',
  'res = {"words": [], "trace": []}',
  'p1 = lines(d[0])',
  'marks = sorted({round(l["y"]) for l in p1 if norm(l["t"]).startswith("TRACEAND")})',
  'for my in marks:',
  '    got = sorted([l for l in p1 if my < l["y"] < my + 52 and l["size"] >= 18 and HAN.search(l["t"]) and len(l["t"]) <= 4], key=lambda l: l["x"])',
  '    res["trace"].append([l["t"] for l in got][:4])',
  'p2 = lines(d[1]) if d.page_count > 1 else []',
  'top = next((l["y"] for l in p2 if norm(l["t"]).startswith("NOWTHEWORDS")), None)',
  'end = next((l["y"] for l in p2 if norm(l["t"]).startswith("YOURTURN")), 9999)',
  'if top is not None:',
  '    body = [l for l in p2 if top + 14 < l["y"] < end - 8 and norm(l["t"]) not in ("WORD", "MEANING", "INUSE")]',
  '    if any(l["own"] and l["x"] < 185 and l["size"] >= 11 and HAN.search(l["t"]) for l in body):',
  '        body = [l for l in body if l["own"]]',
  '    heads = []',
  '    for h in sorted([l for l in body if l["x"] < 185 and l["size"] >= 11 and HAN.search(l["t"])], key=lambda l: l["y"]):',
  '        if heads and abs(h["y"] - heads[-1]["y"]) < 10:',
  '            if len(h["t"]) > len(heads[-1]["t"]): heads[-1] = dict(heads[-1], t=h["t"])',
  '        else: heads.append(h)',
  '    for i, h in enumerate(heads):',
  '        a = h["y"] - 9',
  '        b = heads[i + 1]["y"] - 9 if i + 1 < len(heads) else end - 8',
  '        row = [l for l in body if a <= l["y"] < b]',
  '        c1 = sorted([l for l in row if l["x"] < 185 and l is not h and l["size"] < 11], key=lambda l: l["y"])',
  '        c2 = sorted([l for l in row if 185 <= l["x"] < 340 and not HAN.search(l["t"])], key=lambda l: l["y"])',
  '        c3 = sorted([l for l in row if l["x"] >= 340 or (l["x"] >= 185 and HAN.search(l["t"]))], key=lambda l: l["y"])',
  '        ko = [l["t"] for l in c3 if HAN.search(l["t"])]',
  '        en = [l["t"] for l in c3 if not HAN.search(l["t"])]',
  '        res["words"].append({"korean": h["t"], "roman": " ".join(l["t"] for l in c1), "meaning": " ".join(l["t"] for l in c2),',
  '                             "example": " ".join(ko), "exampleMeaning": " ".join(en)})',
  'print(json.dumps(res, ensure_ascii=False))'
].join('\n');

export function parseHangul(file) {
  return JSON.parse(execFileSync('python3', ['-P', '-c', PY_HANGUL, file], { encoding: 'utf8', maxBuffer: 50e6 }));
}

// How far a sheet that came out at three pages runs over: the height of the
// text on the pages past the second (points), for the log.
export function overflowPt(pdf, work) {
  const f = path.join(work, 'over-' + process.pid + '.pdf');
  fs.writeFileSync(f, pdf);
  const py = [
    'import sys, pymupdf',
    'd = pymupdf.open(sys.argv[1]); tot = 0',
    'for p in list(d)[2:]:',
    '    ys = [b[3] - b[1] for b in p.get_text("blocks") if 100 < b[1] < 770]',
    '    tot += sum(ys)',
    'print(round(tot))'
  ].join('\n');
  try { return Number(execFileSync('python3', ['-P', '-c', py, f], { encoding: 'utf8' }).trim()); } catch (e) { return -1; } finally { fs.rmSync(f, { force: true }); }
}
