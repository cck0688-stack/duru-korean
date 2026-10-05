# Curriculum data for the daily worksheets

The daily worksheets (scripts/generate-sheets.mjs) take their subjects
from these lists, in order, instead of a model choosing them
(the owner, 2026-10-05: "그래야 체계적이거든"). See scripts/lib/curriculum.mjs.

| File | Rows | What |
|---|---|---|
| `official_grammar_336.json` | 336 | 국제 통용 한국어 표준 교육과정 grammar, levels 1–6. **The only source for a grammar item's level.** |
| `official_vocab_10635.json` | 10,635 | The same document's vocabulary, levels 1–6, with a collocation. Used to check the level of a vocabulary sheet's words. |
| `sejong_topics.json` | 135 | 세종학당 기본 교육과정 topics, levels 1–4. Subjects for the vocab, reading and real-life shelves. |

Source and licence: 국립국어원 국제 통용 한국어 표준 교육과정 적용 연구 4단계
(2017, 2020-11-17 수정) and 국립국어원·세종학당재단 『세종학당 한국어 기본 교육과정』(2020),
both 공공누리 제1유형 (credit the source; commercial use allowed). Quote the
`source` string of a row exactly when crediting it.

Rules from the owner's notes that the code follows:

- A grammar item's level comes from `official_grammar_336.json` only.
- The same written form is not the same item: `-던-` (전성어미, 3급) and
  `-던2` (종결어미, 6급) are different. Always read `category` and
  `meaning` together; the writer is told the other items that share a form.
- ±1 level is allowed when the scene needs it; more than that is not.
- 세종 4급 ≈ 표준 3급: a Sejong topic's level is read as the standard level
  `min(level, 3)`.

The series grammar ledger (duru_grammar_192.json) is deliberately not in
this public repository.
