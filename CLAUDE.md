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
- Daily output (owner, 2026-10-05): 6 blog posts and 3 worksheets every
  day at 04:00 KST — blog: 6 of the 8 shelves, rotating; worksheets:
  grammar and vocab every day, reading / reallife on alternate days.
  Keep this unless the owner changes it.
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
