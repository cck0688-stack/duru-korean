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
- Worksheet subjects come from the syllabus in content/curriculum (the
  standard curriculum's grammar and vocabulary, Sejong topics), in order
  (owner, 2026-10-05) — scripts/lib/curriculum.mjs. A grammar item's
  level comes only from official_grammar_336.json; read category and
  meaning together (same form ≠ same item); ±1 level at most.
- Spend as few tokens as quality allows (owner, 2026-10-05): the runs
  log what each step spent (usageReport); check it and report.
- Blog PDFs (owner, 2026-09-28): every blog post gets, per language, a
  download PDF (with the photo) and a print PDF (no photo, two pages
  where it fits; Print prints that one). scripts/blog-pdf.mjs, workflow
  blog-pdf.yml every 4 hours makes only what is missing or out of date.
- Site design (owner, 2026-10-05): blush and plum, white header and
  footer, the home page's five pastel card colours. css/theme-v2.css on
  every page (body.theme-v2), css/home-v2.css on the home page; new pages
  and new UI follow them, not the old deep green.
