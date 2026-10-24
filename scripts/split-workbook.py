#!/usr/bin/env python3.13
"""DURU KOREAN — split the Book 1 workbook PDF into one PDF per unit (owner, 2026-10-24).

  python3.13 scripts/split-workbook.py WORKBOOK.pdf OUTDIR

Units come from the "BOOK 1 / L9" tag in each page's footer text. Each unit file keeps only its own
pages (unused objects dropped), and the footer "BOOK 1 / L9 / 59 OF 109" becomes "BOOK 1 / L9 / 02 OF 08"
(the number inside the unit; the footer is right-aligned, so its x moves with the new width).
Before splitting, the hidden text is taken out (the visible pages stay pixel for pixel the same); the cleaned whole workbook is written
as DuruKorean1_Workbook.pdf. Needs pikepdf."""
import sys, re, os, json
import pikepdf

# --- take out the text nobody can see (an old title line hidden under the real one) ---
# The stray sentence "우리 가족을 소개해요: 가족 호칭 10개" sits in Type3 fonts that nothing else uses.
STRAY_FONTS = {(n, 0) for n in (249, 260, 272, 276, 577, 582, 584, 586, 2739)}
def font_ids(res):
    out={}
    for n,f in (res.get('/Font') or {}).items(): out[str(n)]=f.objgen
    return out
import re
def tounicode(font):
    tu=font.get('/ToUnicode')
    m={}
    if tu is None: return m
    t=tu.read_bytes().decode('latin1')
    for code,uni in re.findall(r'<([0-9A-Fa-f]{2})>\s*<([0-9A-Fa-f]{4})>',t): m[int(code,16)]=chr(int(uni,16))
    for a,b,u in re.findall(r'<([0-9A-Fa-f]{2})>\s*<([0-9A-Fa-f]{2})>\s*<([0-9A-Fa-f]{4})>',t):
        for i in range(int(a,16),int(b,16)+1): m[i]=chr(int(u,16)+i-int(a,16))
    return m
def strip(pdf, targets, small=None):
    small=small or {}
    umaps={k:tounicode(pdf.get_object(k)) for k in small}
    seen=set(); removed=[0]
    def process(stream_obj, res):
        fonts=font_ids(res) if res is not None else {}
        ops=pikepdf.parse_content_stream(stream_obj)
        out=[];buf=None;changed=False
        for operands,op in ops:
            s=str(op)
            if s=='BT': buf=[(operands,op)]; continue
            if buf is not None:
                buf.append((operands,op))
                if s=='ET':
                    bad=any(str(o)=='Tf' and fonts.get(str(a[0])) in targets for a,o in buf)
                    if not bad:
                        for a,o in buf:
                            if str(o)=='Tf' and fonts.get(str(a[0])) in small:
                                um=umaps[fonts[str(a[0])]]
                                txt=''.join(um.get(b,'?') for aa,oo in buf if str(oo) in('Tj','TJ') for x in (aa[0] if str(oo)=='TJ' else aa) if isinstance(x,pikepdf.String) for b in bytes(x))
                                if txt and txt.strip() in ('',':','10'): bad=True
                    if bad: removed[0]+=1; changed=True
                    else: out.extend(buf)
                    buf=None
                continue
            out.append((operands,op))
        if buf: out.extend(buf)
        if changed: stream_obj.write(pikepdf.unparse_content_stream(out))
    def walk_res(res):
        for n,x in (res.get('/XObject') or {}).items():
            if x.objgen in seen: continue
            seen.add(x.objgen)
            if str(x.get('/Subtype'))=='/Form':
                r=x.get('/Resources')
                process(x,r)
                if r is not None: walk_res(r)
    for page in pdf.pages:
        walk_res(page.Resources)
        pass
    return removed[0]


# Helvetica 8 pt advance widths (per 1000) for the characters of the footer
W = {' ': 278, '/': 278, 'B': 667, 'O': 778, 'K': 667, 'S': 667, 'T': 611, 'A': 667, 'R': 722, 'L': 556, 'C': 722, 'P': 667, 'F': 611}
for d in '0123456789': W[d] = 556
def move_x(operands, x):
    # (a content-stream instruction hands out copies of its operands: build the Tm again)
    o = list(operands)
    o[4] = pikepdf.Object.parse(('%.3f' % x).encode())
    return o
def width(s, size=8): return sum(W[c] for c in s) * size / 1000

# The "BOOK 1 / L8" tag in the header pill (x 421 to 553 on the A4 page, owner 2026-10-24: centre it).
WB = dict(W, **{'B': 722, 'O': 778, 'K': 722, 'L': 611, 'S': 667, 'T': 611, 'A': 722, 'R': 722, 'C': 722, 'P': 667})
PILL_CENTRE = (421.0 + 553.0) / 2
def centre_tags(pdf):
    n = 0
    for page in pdf.pages:
        ops = pikepdf.parse_content_stream(page)
        for j, (operands, op) in enumerate(ops):
            if str(op) == 'Tj' and isinstance(operands[0], pikepdf.String):
                t = bytes(operands[0])
                if t.startswith(b'BOOK 1') and b' OF ' not in t:
                    assert str(ops[j - 1][1]) == 'Tm'
                    w = sum(WB[c] for c in t.decode()) * 7.5 / 1000
                    ops[j - 1] = (move_x(ops[j - 1][0], PILL_CENTRE - w / 2), ops[j - 1][1])
                    n += 1
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(ops))
    return n

src, out = sys.argv[1], sys.argv[2]


os.makedirs(out, exist_ok=True)
FOOT = re.compile(rb'^BOOK 1  /  (\S+)  /  (\d+) OF (\d+)$')

pdf = pikepdf.open(src)
removed = strip(pdf, STRAY_FONTS)
print(f'hidden text blocks removed: {removed}; tags centred: {centre_tags(pdf)}', file=sys.stderr)
cleaned = os.path.join(out, 'DuruKorean1_Workbook.pdf')
pdf.save(cleaned, object_stream_mode=pikepdf.ObjectStreamMode.generate)
src = cleaned
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
                assert str(ops[j - 1][1]) == 'Tm'
                right = float(ops[j - 1][0][4]) + width(old)
                ops[j - 1] = (move_x(ops[j - 1][0], right - width(new)), ops[j - 1][1])
                ops[j] = ([pikepdf.String(new)], op)
        page.Contents = doc.make_stream(pikepdf.unparse_content_stream(ops))
    for key in list(doc.Root.keys()):
        if key not in ('/Type', '/Pages', '/Metadata'): del doc.Root[key]
    doc.docinfo['/Title'] = f'Duru Korean Book 1 — Worksheet ({tag})'
    f = os.path.join(out, f'DuruKorean1_{code(tag)}_Worksheet.pdf')
    doc.save(f, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    result[tag] = {'file': f, 'pages': n, 'first': pages[0] + 1, 'last': pages[-1] + 1}
print(json.dumps(result, ensure_ascii=False))
