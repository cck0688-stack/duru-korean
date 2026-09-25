#!/usr/bin/env python3
"""DURU KOREAN — what a worksheet PDF says, and whether two of them say the same thing.

Used by scripts/relayout-sheets.mjs, which sets worksheets that were
already made again in the current layout. The words are read back out of
the old PDF, and the new PDF is kept only if it says the same thing:

  text      the text of a PDF, page by page
  compare   how far two PDFs' words are from each other, once what the
            layout itself adds (running footer, page numbers) is set
            aside and every space and line break is ignored — a new
            layout breaks lines in new places, Korean words included.

Two measures, because each misses what the other catches:
  hist   characters added or lost, in any order (a changed word)
  ratio  the same characters in the same order (an answer moved to
         another question)

Reads one JSON request on stdin, writes one JSON answer on stdout.
Needs PyMuPDF (pip install pymupdf).
"""
import difflib
import json
import re
import sys
from collections import Counter

import pymupdf

PAGE_NO = re.compile(r'^\s*\d+\s*/\s*\d+\s*$')
# The owner's design (v2) prints "title | 1 / 2" as one footer line.
PAGE_NO_TAIL = re.compile(r'\s*\|\s*\d+\s*/\s*\d+\s*$')
# The numbers the template puts in front of things are the template's,
# not the sheet's, and they change between designs: "1." in the first
# sheets, "1)" after, some printed twice ("1) 1) 엄마 / 먹다", the
# model's own and the template's), and in v2 a bare "1" in a disc and
# a number in front of every section title. All of them go, on both
# sides; the order of the questions is still checked by `ratio`.
ITEM_NO = re.compile(r'^(\d{1,2})[.)]\s*(?:\1[.)]\s*)*')
LONE_MARK = re.compile(r'^(?:\d{1,2}|✓)$')
SPACE = re.compile(r'\s+')
# Curly and straight quotes are the same quote: a read-back that writes
# one for the other has not changed what the sheet says.
QUOTES = str.maketrans({'‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
                        '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"'})


def pages(path):
    with pymupdf.open(path) as doc:
        return [p.get_text() for p in doc]


def squash(s):
    return SPACE.sub('', s or '').casefold().translate(QUOTES)


def bare(text, title, drop, labels, frame=()):
    lines = []
    for line in text.splitlines():
        s = PAGE_NO_TAIL.sub('', line.strip())
        if not s or s == 'durukorean.com' or PAGE_NO.match(s) or LONE_MARK.match(s):
            continue
        lines.append(ITEM_NO.sub('', s))
    # Lower case: headings are printed in capitals by the stylesheet.
    out = squash(''.join(lines))
    # What the page header and footer print on every page (the site's
    # address, level and time, the copyright line): not the sheet.
    for f in sorted(frame or [], key=len, reverse=True):
        f = squash(f)
        if len(f) > 1:
            out = out.replace(f, '')
    # Text left out of the new edition on purpose (a note that should
    # never have been printed).
    for d in drop or []:
        d = SPACE.sub('', d or '').casefold().translate(QUOTES)
        if d:
            out = out.replace(d, '', 1)
    # The title is printed at the top and again in every page's footer,
    # and there are fewer pages now. Before the headings: a heading word
    # ("소리") inside the title would otherwise break it up.
    t = SPACE.sub('', title or '').casefold().translate(QUOTES)
    if t:
        out = out.replace(t, '')
    # The template's own headings and table heads: a table that now runs
    # onto the next page prints its head again there.
    for lab in sorted(labels or [], key=len, reverse=True):
        lab = SPACE.sub('', lab or '').casefold().translate(QUOTES)
        if len(lab) > 1:
            out = out.replace(lab, '')
    return out


def compare(old, new, title, drop, labels, frame=()):
    a = bare('\n'.join(pages(old)), title, drop, labels, frame)
    b = bare('\n'.join(pages(new)), title, [], labels, frame)
    ca, cb = Counter(a), Counter(b)
    off = sum(((ca - cb) + (cb - ca)).values())
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    # Where they differ, for the log: a few places, with a little around.
    where = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            continue
        where.append({'old': a[max(0, i1 - 12):i2 + 12], 'new': b[max(0, j1 - 12):j2 + 12]})
        if len(where) >= 6:
            break
    return {
        'hist': off / max(1, len(a)),
        'ratio': sm.ratio(),
        'where': where,
        'oldChars': len(a),
        'newChars': len(b),
    }


def main():
    req = json.load(sys.stdin)
    if req['op'] == 'text':
        out = {'pages': pages(req['path'])}
    elif req['op'] == 'compare':
        out = compare(req['old'], req['new'], req.get('title', ''), req.get('drop', []), req.get('labels', []),
                      req.get('frame', []))
    else:
        raise SystemExit('unknown op')
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
