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
SPACE = re.compile(r'\s+')


def pages(path):
    with pymupdf.open(path) as doc:
        return [p.get_text() for p in doc]


def bare(text, title, drop, labels):
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s == 'durukorean.com' or PAGE_NO.match(s):
            continue
        lines.append(s)
    # Lower case: headings are printed in capitals by the stylesheet.
    out = SPACE.sub('', ''.join(lines)).casefold()
    # Text left out of the new edition on purpose (a note that should
    # never have been printed).
    for d in drop or []:
        d = SPACE.sub('', d or '').casefold()
        if d:
            out = out.replace(d, '', 1)
    # The template's own headings and table heads: a table that now runs
    # onto the next page prints its head again there.
    for lab in sorted(labels or [], key=len, reverse=True):
        lab = SPACE.sub('', lab or '').casefold()
        if len(lab) > 1:
            out = out.replace(lab, '')
    # The title is printed at the top and again in every page's footer,
    # and there are fewer pages now.
    t = SPACE.sub('', title or '').casefold()
    if t:
        out = out.replace(t, '')
    return out


def compare(old, new, title, drop, labels):
    a = bare('\n'.join(pages(old)), title, drop, labels)
    b = bare('\n'.join(pages(new)), title, [], labels)
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
        out = compare(req['old'], req['new'], req.get('title', ''), req.get('drop', []), req.get('labels', []))
    else:
        raise SystemExit('unknown op')
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
