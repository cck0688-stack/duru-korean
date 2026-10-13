---
name: worksheet-one-big-box
description: The owner's rule for every worksheet (2026-10-13, from the approved reading sample 계절마다 무엇을 먹어요?) — each section's main text sits in ONE big rounded box (reading passage, real-life conversation, Everything Else paragraphs and tips, tables), never loose lines, never a box per line. Use when making, remaking or checking any worksheet or its English PDF.
---

# One big rounded box per section (owner-approved, 2026-10-13)

Reference: reading sample a6b2cbe5-efd1-41fa-bbb7-df7d25beac42 (계절마다 무엇을 먹어요?), English PDF, two pages.

- **Reading**: "1 READ THIS" — the whole passage in one big rounded box, justified text (`passageBox`, on by default; templates.mjs `reading`).
- **Real-life**: the whole conversation in one box (see skill reallife-conversation-box-layout; `dialogueBox`, on by default).
- **Everything Else**: a section's paragraphs sit in one box (`box`, on by default unless a section says `box: false`);
  poster/timetable follow skill etc-timetable-tags-layout.
- **Vocabulary / Grammar**: the table is already one rounded box; keep it that way (grammar: skill grammar-cheat-sheet-layout).
- **Hangul Starter** keeps its approved letter cards (skill hangul-starter-card-layout).
- No separator lines or boxes per line inside the big box. Section headings (red number + serif title + rule) stay outside the box.
- Two A4 pages in every language; the box costs a little room, so cut text, never type size. This is rendering only — no extra model tokens.

## Applying to existing sheets
- Only new sheets and re-renders get it automatically (owner chose "new sheets only" first). Re-render an existing sheet with
  workflow redo-sheet.yml (`mode=passage` for reading, `mode=dialogue` for real-life), `langs=en`, `dry_run=true` first,
  pictures on rework-output/shots/redo-sheet, then false. Held for review; never publish.
