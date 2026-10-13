---
name: worksheet-line-breaks
description: The owner's line-break rules for every worksheet (2026-10-13, from 업무 메신저 쓰기 and 한국어 공부법 안내 읽기) — speaker names on one line, English gloss under the Korean term, "예:" example on its own line, Your turn questions with the instruction, the Korean and each (a)/(b) choice on separate lines. Nothing squeezed side by side. Use when making, remaking or checking any worksheet or its English PDF.
---

# Nothing squeezed side by side (owner, 2026-10-13)

Reference sheets: 업무 메신저 쓰기 (2e2ca528-c8d2-4c6e-b9b1-c37cc4faecd7, reallife) and
한국어 공부법 안내 읽기 (81243113-7516-4c0a-814f-bb031e56295e, etc), English PDFs.

1. **The conversation** (Real-life): each speaker name is on ONE line ("김 팀장", "이수진" never break). The name
   column is as wide as the longest name (templates.mjs `whoWidth`, `--who-w`), so the whole conversation sits to the right of it.
   Names are bold, red, left-aligned, about the size of the script (13px).
2. **Term rows** (Everything Else lists, `itemRows`): the English gloss goes on the NEXT line under the Korean term,
   not beside it. In the explanation column the example "예: …" is on its own line under the text, for every row.
3. **Your turn** (every shelf, `practice`/`splitAsk`): the English instruction on one line, the Korean it is about on the line below,
   and each "(a) … (b) …" choice on its own line. Circled ①②③ parts are already one per line. Don't write the instruction and the
   Korean sentence on the same line.
4. Space on page two is not a reason to pack lines: use it.
- Two A4 pages in every language; if a longer language will not fit, cut words, never type size.
- Existing sheets: re-render with workflow redo-sheet.yml `mode=rerender`, `langs=en`, `dry_run=true` first
  (pictures on rework-output/shots/redo-sheet), then `dry_run=false`. Held for review; never publish.
