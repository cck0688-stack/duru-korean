# DURU KOREAN — working rules

- Worksheets: every worksheet (new, remade or redesigned) follows
  docs/WORKSHEET-MASTER-INSTRUCTION.md — the owner's master instruction
  (2026-09-26). The kiosk sheet (content/sheets/748acfcc-…) is the reference
  design. Always exactly two A4 pages; cut content, never shrink type; render
  the PDF to images and check every page before delivering. A numbered
  section stays on one page (owner, 2026-09-29): pulled back by setting
  the sheet closer, else moved whole to the next page (render.mjs).
- Change only what the owner asked for. Do not rework other sheets or pages
  on your own initiative.
- A replaced or new download is held (unpublished, status review) until the
  owner approves it on review.html. Never publish without the owner.
- Work only on branch `claude/duru-korean-homepage-raysf6` (it deploys);
  workflows write to `rework-output`.
- Daily output (owner, 2026-10-06, plan A; was 6 posts / 3 sheets):
  8 blog posts and 8 worksheets every day at 01:00 KST — blog: one
  on every shelf; worksheets: grammar 2, vocab 2, hangul 2 (added
  2026-10-09 for the series), reading 1, reallife 1. Keep this unless
  the owner changes it.
  Until the first series is done (owner, 2026-10-09: all 300 by
  10-15, running without a break): the 01:00 run is off; daily-sheets
  runs every two hours, hangul/grammar/vocab only, each run stopping
  new sheets after 290 minutes, so runs follow back to back. A shelf
  stops when its 100 are done. Put the 01:00 run back afterwards.
- First series (owner, 2026-10-09): Hangul Starter, Grammar Cheat
  Sheets and Vocabulary, 100 new sheets each, in the order of
  content/curriculum/duru_series_300.json (none repeats a sheet already
  on the shelf; grammar covers every standard 1–3급 item). Standard 4급
  is a later series.
  Opus writes and audits; Sonnet
  does the first review, fixes, cuts, translations and their check
  (owner, 2026-10-09: save tokens). Every draft gets read-online
  files (read/<id>/<lang>.json) so it reads on its page once published.
  Hangul layout (owner, 2026-10-10): each letter is a card — a short
  letter/word on top (never cut off), its sound beside it with room,
  and squares to trace (grey) and copy, one per syllable. Practice
  parts get an answer line. review.html shows each draft's read text.
- The owner's hand-edited Hangul (100) and Grammar (102) sheets (owner,
  2026-10-11): scripts/adopt-edits.mjs, workflow adopt-edits.yml (dry_run by
  default; from/to, only, read_only). English is his PDF; every other
  language is the stored text set in his layout; each replaced resource is
  held (review) for his Publish. Hangul read-online text goes to
  rework-output/read. Hangul 009, 017, 028, 031, 033, 035, 058, 062, 065, 082,
  085 (and the 5 he named) are set from the stored text (his PDF had tiny
  text). Left on the old layout: grammar 100 (vi, es, id, pt-BR, fr, de: table
  too long for two pages); grammar 018 and 044 have no files for some languages.
- Grammar page layout (owner, 2026-10-12, sample 007-hago): skill
  .claude/skills/grammar-cheat-sheet-layout — pattern table fills page 1, cells
  centred up and down, Watch out on page 2 with the differing words underlined.
  English first (adopt-edits --shelf=grammar --clean-all --langs=en); other
  languages later, when the owner says.
- Grammar duplicates (owner, 2026-10-12): 018-goyo (same as 043) and 044-haveto
  (same as 064) are not published; 043 and 064 are. They stay held in review,
  not deleted. Their layout is still edited with the rest.
- Hangul letter cards (owner, 2026-10-12, sample 058 v3): skill
  .claude/skills/hangul-starter-card-layout — empty trace squares, SOUND
  text centred, text after an arrow on its own line, letters the same
  size to the eye. The Hangul Starter English PDFs are to be made on it;
  built for the owner to look at first (adopt-edits keep_pdfs, never
  replaced before he agrees).
- Second series (owner, 2026-10-12, confirmed): Reading Practice, Real-life
  Korean and Everything Else (etc), 100 topics each, in the order of
  content/curriculum/duru_series2_300.json (RD/RL/EE ids). One sample per
  shelf first; the rest after the owner approves the samples.
- Worksheet subjects come from the syllabus in content/curriculum (the
  standard curriculum's grammar and vocabulary, Sejong topics), in order
  (owner, 2026-10-05) — scripts/lib/curriculum.mjs. A grammar item's
  level comes only from official_grammar_336.json; read category and
  meaning together (same form ≠ same item); ±1 level at most.
- Spend as few tokens as quality allows (owner, 2026-10-05): the runs
  log what each step spent (usageReport); check it and report.
- Community sample posts (owner, 2026-10-12): 3–5 writers a day, each
  100/200/300 characters or thereabouts, arriving at irregular times — the
  day's plan comes from the date (scripts/sim/live.mjs dayPlan); replies and
  hearts are few and irregular. No rhythm should show.
- Blog voice and photos (owner, 2026-10-12): the owner does not teach now —
  never "my student"/"베트남 제자"; just "외국인 학생", no nationality. A
  post's photo is never one another post already uses (generate-drafts
  passes the used photos to findPhoto).
- Blog PDFs (owner, 2026-09-28): every blog post gets, per language, a
  download PDF (with the photo) and a print PDF (no photo, two pages
  where it fits; Print prints that one). scripts/blog-pdf.mjs, workflow
  blog-pdf.yml every 4 hours makes only what is missing or out of date.
- Site design (owner, 2026-10-05): blush and plum, white header and
  footer, the home page's five pastel card colours. css/theme-v2.css on
  every page (body.theme-v2), css/home-v2.css on the home page; new pages
  and new UI follow them, not the old deep green.
- Real-life conversation box and Everything Else timetable tags (owner, 2026-10-13):
  skills .claude/skills/reallife-conversation-box-layout (the whole conversation in
  ONE big rounded box, no lines between turns) and etc-timetable-tags-layout (poster
  boxed, lettered A–F timetable tags, tip on page two). New sheets of those kinds use them.
- Level 4 series (owner, 2026-10-13): Grammar, Vocabulary, Reading, Real-life and Everything
  Else, 40 each, standard 4급 (content/curriculum/duru_series3_200.json, readable list
  docs/LEVEL4-LIST.md). English samples first, then the owner's confirmation; held back from
  the daily chains until then (DURU_LEVEL4). Everything Else is culture and language sense; TOPIK later.
- One big rounded box per section (owner, 2026-10-13, reading sample 계절마다 무엇을 먹어요?):
  skill .claude/skills/worksheet-one-big-box — passage, conversation, Everything Else
  paragraphs all in one big box; applies to every new sheet and re-render. Production runs
  without a break (24 hours a day) until the owner says stop; nothing is published.
- Line breaks (owner, 2026-10-13): skill .claude/skills/worksheet-line-breaks — speaker names on one
  line, English gloss and "예:" example on their own lines, Your turn instruction / Korean / (a)(b)
  choices on separate lines. Level 4 is made in English only until the owner has edited it; the
  other nine languages are made from his edited English afterwards (his word).
