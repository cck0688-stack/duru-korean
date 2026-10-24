#!/usr/bin/env python3.13
"""DURU KOREAN — split the Book 1 workbook PDF into one PDF per unit (owner, 2026-10-24).

  python3.13 scripts/split-workbook.py WORKBOOK.pdf OUTDIR

Units come from the "BOOK 1 / L9" tag in each page's footer text. Each unit file keeps only its own
pages (unused objects dropped), and the footer "BOOK 1 / L9 / 59 OF 109" becomes "BOOK 1 / L9 / 02 OF 08"
(the number inside the unit; the footer is right-aligned, so its x moves with the new width).
Needs pikepdf. The whole workbook is published as it is."""
import sys, re, os, json
import pikepdf

# Helvetica 8 pt advance widths (per 1000) for the characters of the footer
W = {' ': 278, '/': 278, 'B': 667, 'O': 778, 'K': 667, 'S': 667, 'T': 611, 'A': 667, 'R': 722, 'L': 556, 'C': 722, 'P': 667, 'F': 611}
for d in '0123456789': W[d] = 556
def width(s, size=8): return sum(W[c] for c in s) * size / 1000

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
FOOT = re.compile(rb'^BOOK 1  /  (\S+)  /  (\d+) OF (\d+)$')

pdf = pikepdf.open(src)
units = []  # (tag, [page indexes])
for i, page in enumerate(pdf.pages):
    tag = None
    for operands, op in pikepdf.parse_content_stream(page):
        if str(op) == 'Tj' and isinstance(operands[0], pikepdf.String):
            m = FOOT.match(bytes(operands[0]))
            if m: tag = m.group(1).decode()
    if tag is None: raise SystemExit(f'page {i + 1}: no footer tag')
    if units and units[-1][0] == tag: units[-1][1].append(i)
    else: units.append((tag, [i]))
assert sum(len(p) for _, p in units) == len(pdf.pages)

def code(tag):
    if tag == 'START': return 'S'
    m = re.fullmatch(r'L(\d+)', tag)
    return 'L%02d' % int(m.group(1)) if m else tag  # CP1..CP3

result = {}
for tag, pages in units:
    doc = pikepdf.open(src)
    keep = set(pages)
    for i in range(len(doc.pages), 0, -1):
        if (i - 1) not in keep: del doc.pages[i - 1]
    n = len(pages)
    for k, page in enumerate(doc.pages, start=1):
        ops = pikepdf.parse_content_stream(page)
        for j, (operands, op) in enumerate(ops):
            if str(op) == 'Tj' and isinstance(operands[0], pikepdf.String):
                m = FOOT.match(bytes(operands[0]))
                if not m: continue
                old = bytes(operands[0]).decode()
                new = f'BOOK 1  /  {tag}  /  {k:02d} OF {n:02d}'
                tm = ops[j - 1]
                assert str(tm[1]) == 'Tm'
                right = float(tm[0][4]) + width(old)
                tm[0][4] = pikepdf.Object.parse(('%.3f' % (right - width(new))).encode())
                ops[j] = ([pikepdf.String(new)], op)
        page.Contents = doc.make_stream(pikepdf.unparse_content_stream(ops))
    for key in list(doc.Root.keys()):
        if key not in ('/Type', '/Pages', '/Metadata'): del doc.Root[key]
    doc.docinfo['/Title'] = f'Duru Korean Book 1 — Worksheet ({tag})'
    f = os.path.join(out, f'DuruKorean1_{code(tag)}_Worksheet.pdf')
    doc.save(f, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    result[tag] = {'file': f, 'pages': n, 'first': pages[0] + 1, 'last': pages[-1] + 1}
print(json.dumps(result, ensure_ascii=False))
