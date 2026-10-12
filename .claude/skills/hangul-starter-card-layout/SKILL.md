---
name: hangul-starter-card-layout
description: The owner's approved letter-card layout for Hangul Starter sheets (sample 058, 2026-10-12) — empty trace squares, SOUND text centred, text after an arrow on its own line, syllables and single letters the same size to the eye. Use when making, remaking or checking a Hangul Starter worksheet or its English PDF.
---

# Hangul Starter — letter cards (owner-approved sample 058, v3)

Reference design: `references/058-sample-en-v3.pdf` (English, two A4 pages). The owner approved it
on 2026-10-12 ("좋아") and asked for the Hangul Starter English PDFs to be made on this basis.

## Page 1 — "1 THE LETTERS"
Each letter is one card. Header row: `LETTER` | `SOUND`.

1. **Letter column (left, centred).** The card's `letter` text. If it holds an arrow, split at
   the first `→`: the part before stays on line 1, `→ …` goes on line 2 directly under it
   (`1. 받침 + ㅇ` / `→ 받침이 넘어감`).
2. **Equal size to the eye.** One font size on every card (21 px in the template). Hangul
   syllables (가–힣) are drawn about twice as tall as single letters (ㄱ ㅂ …) at the same size, so
   syllable runs are set at 0.86 em / weight 700 and single-letter runs at 1.15 em / weight 500.
   Digits and signs stay as they are. Never let one card look bigger than another.
3. **SOUND column (right).** Everything under SOUND is **centred** (the sound line and the note).
4. **TRACE AND COPY.** Ten squares, **all empty** — no grey letters, no `ㄱ` or batchim
   pre-written in them.

## Page 2
`NOW THE WORDS` table, then `YOUR TURN` practice (answers at the foot). Practice has no answer
lines. A numbered section stays on one page.

## In the code
- `scripts/pdf/templates.mjs` → `hangul()` / `evenInk()`; sheet flag `cleanCards: true`.
- `scripts/pdf/sheet-v2.css` → `.lcard.clean`, `.lc-letter .sy`, `.lc-letter .jm`.
- `scripts/adopt-edits.mjs` sets the flag for the 16 sheets set from the stored text, and for all
  sheets with `--clean-all` (English only: `--langs=en`).

## Check before delivering
Render to PNG and look at both pages: arrow text on its own line, squares empty, SOUND centred,
no card larger than another, still exactly two pages.
