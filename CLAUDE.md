# DURU KOREAN — working rules

- Worksheets: every worksheet (new, remade or redesigned) follows
  docs/WORKSHEET-MASTER-INSTRUCTION.md — the owner's master instruction
  (2026-09-26). The kiosk sheet (content/sheets/748acfcc-…) is the reference
  design. Always exactly two A4 pages; cut content, never shrink type; render
  the PDF to images and check every page before delivering.
- Change only what the owner asked for. Do not rework other sheets or pages
  on your own initiative.
- A replaced or new download is held (unpublished, status review) until the
  owner approves it on review.html. Never publish without the owner.
- Work only on branch `claude/duru-korean-homepage-raysf6` (it deploys);
  workflows write to `rework-output`.
- Daily output (owner, 2026-09-27): 6 blog posts and 6 worksheets every
  day at 04:00 KST — blog: 6 of the 8 shelves, rotating; worksheets: one
  per shelf. Keep this unless the owner changes it. Exception (owner,
  2026-09-29): through 2026-10-04 only one worksheet a day (shelf turns
  by date; ONE_A_DAY_UNTIL in daily-sheets.yml); blog stays at 6.
- Blog PDFs (owner, 2026-09-28): every blog post gets, per language, a
  download PDF (with the photo) and a print PDF (no photo, two pages
  where it fits; Print prints that one). scripts/blog-pdf.mjs, workflow
  blog-pdf.yml every 4 hours makes only what is missing or out of date.
