---
name: grammar-cheat-sheet-layout
description: The owner's approved layout for Grammar Cheat Sheet pages (sample 007-hago, 2026-10-12) — the pattern table fills page 1 with each cell centred up and down, Watch out starts page 2 with the wrong and the right parts underlined. Use when making, remaking or checking a Grammar Cheat Sheet or its English PDF.
---

# Grammar Cheat Sheets — page layout (owner-approved sample 007-hago, v2)

Reference: `references/007-hago-sample-en-v2.pdf` (English, two A4 pages). Approved 2026-10-12.

## Page 1 — title, aim box, "1 THE PATTERN"
- The pattern table is two columns: left = the form (bold, centred) with "when" and the meaning
  stacked under it, right = the example sentence with its translation.
- **The table fills the rest of page 1.** Rows are one height each (100 / n %), and the content of
  every cell sits **centred up and down**: the same space above and below. No big empty strip under
  the last row, none at the top of a row.
- If the table is taller than page 1 anyway (many rows), it is not stretched and nothing is forced:
  the sheet falls back to the normal two-column table.

## Page 2 — "2 WATCH OUT", "3 YOUR TURN", answers at the foot
- Watch out **starts page 2**. The notes are set close (small padding), type unchanged.
- In every Watch out line `wrong (X) → right (O): …` underline (red, bold) **the part that is wrong
  and the part that is right** — the words that differ between the two phrases, both sides:
  `빵와 우유 (X) → 빵과 우유 (O)` underlines 빵와 and 빵과; `친구 하고 → 친구하고` underlines
  `친구 하고` and `친구하고`.
- Practice parts (① ②) stand one under the other when they fit; the closer setting only runs when the
  sheet would pass two pages. Exactly two pages.

## In the code
- `scripts/pdf/templates.mjs` → `grammar()` (flag `fillPattern`), `watchMarks()`.
- `scripts/pdf/render.mjs` → sets the table's height from the room left on page 1 (measured at the
  printed width), drops the fill when the table is already taller.
- `scripts/pdf/sheet-v2.css` → `section.pat-fill`, `table.forms2.fill`.
- `scripts/adopt-edits.mjs --shelf=grammar --clean-all --langs=en` renders every English sheet this way.

## Check before delivering
Render to PNG and look at both pages: table fills page 1, text centred in each cell, Watch out on
page 2 with underlines on the differing words, still two pages.
