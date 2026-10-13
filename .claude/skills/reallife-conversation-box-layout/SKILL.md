---
name: reallife-conversation-box-layout
description: The owner's approved layout for Real-life Korean sheets (sample 집안일 나누기, 2026-10-13) — the whole conversation sits in ONE big rounded box, no lines or boxes between turns, Phrases to keep table follows on page 1, two A4 pages. Use when making, remaking or checking a Real-life Korean (reallife) sheet or its English PDF.
---

# Real-life Korean — conversation in one box (owner-approved, 2026-10-13)

Reference: resource 6613f43c-90f5-42fc-87f1-666d50df5305 (집안일 나누기), English PDF.

## Page 1
- Title, aim box, the setting note, then "1 THE CONVERSATION".
- The conversation is **one large rounded box** (`.dlg-box`, flag `dialogueBox: true` on the sheet,
  templates.mjs `reallife`). Inside: speaker name in red, Korean line, grey translation.
  Speaker names (지원, 민수) are red, bold, left-aligned, about the size of the script (13px), in a narrow 34px column
  so the whole conversation sits close to the box's left edge (owner, 2026-10-13: the left was too empty).
  **No separator lines and no separate boxes per turn** (owner: "크게 하나만 그려").
- Box padding and turn spacing are kept small so "2 PHRASES TO KEEP" still fits on page 1.
- Then the phrases table (phrase / meaning / in use).

## Page 2
- Your turn (exercises) and the answers; exactly two A4 pages in every language.

## How to apply
- Sheets set `dialogueBox: true` themselves; new Real-life sheets should use it by default.
- Existing sheet: `redo-sheet.yml` with `mode=dialogue`, `langs=en`, `dry_run=true` first (pictures on
  rework-output/shots/redo-sheet), then `dry_run=false`. The script falls back to the old layout if two
  pages are not reached — check the log line ("예전 모양" means the box did not fit).
- English only unless the owner asks for other languages. The resource stays held (review) for his Publish. Never publish.
