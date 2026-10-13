---
name: etc-timetable-tags-layout
description: The owner's approved layout for Everything Else sheets with a poster and a timetable (sample 축제 일정표, 2026-10-13) — poster in a box, timetable as small lettered A–F blue tags in one row with wrapping text, words list filling page 1, Reading tip on page 2, two A4 pages. Use when making, remaking or checking an Everything Else (etc) sheet with a timetable/flow.
---

# Everything Else — poster box, lettered timetable tags (owner-approved, 2026-10-13)

Reference: resource 5658f4c8-808e-4bdc-838f-0265196d0331 (축제 일정표 읽기).

- **1 The poster**: its lines sit in a rounded box (`box: true`, `tight: true`), like sections 2–4.
- **2 The timetable**: not numbered red discs and arrows. Small tags in one row (`flowStyle: 'tags'`,
  templates.mjs `tagSteps`): a blue square badge **A, B, C…**, time on top, name bold, place/sign-up note,
  English line — all text wraps, nothing cut off. Blue (not red/pink), smaller than before.
- **3 Words on a schedule**: fills the rest of page 1 (`roomy: true`).
- **4 Reading tip** starts page 2 (`newPage: true`); page 2 holds the tip, Your turn and the answers.
- Exactly two A4 pages. Longer languages (es, id, pt-BR, fr, de) did not fit in the new layout; those PDFs were left as before.

## How to apply
- Flags are per section in the stored JSON; CSS is `.tags/.tag`, `.roomy`, `.tight`, `section.k-next` in sheet-v2.css.
- Existing sheet: `redo-sheet.yml` (default mode), `dry_run=true` first, then false. Held for review; never publish.
- New Everything Else sheets with a schedule/steps flow should use these flags from the start.
