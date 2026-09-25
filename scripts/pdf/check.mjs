// DURU KOREAN — what has to be true of a sheet before a person sees it
//
// Section 5.5 of the brief asks for every page to be rendered and
// looked at for clipped text, blank pages, bad line breaks and blurred
// images, and for the text to be selectable rather than a picture.
// This is that, done by machine, so that the person reviewing it is
// spending their attention on whether the Korean is any good rather
// than on whether page 3 came out empty.
//
// Nothing here decides a sheet is *good*. It decides a sheet is not
// obviously broken, which is a much smaller claim and the only one a
// program can honestly make. The result goes into
// resource_files.check_result, and publish_resource_file() refuses
// while `ok` is anything but true — see supabase/schema.sql §36f. A
// failing check is a closed door, not a warning in a log.

import zlib from 'node:zlib';

const MIN_TEXT_PER_PAGE = 40;      // characters; below this a page is suspect
const MAX_PAGES = 12;              // a free worksheet this long is a mistake
const MAX_BYTES = 8 * 1024 * 1024; // nobody should download more for a worksheet

// Is the text in this file text, or a picture of text?
//
// The two look identical on screen and are completely different to a
// learner who wants to copy a Korean word into a dictionary — which is
// why this reads the file rather than trusting how it was made.
//
// The signals have to be dug for. Chromium compresses almost
// everything, so the text-showing operators (Tj, TJ) that prove there
// are glyphs being drawn live inside deflated streams, not in the
// bytes on top. Font descriptors do stay in the clear. An earlier
// version of this looked only at the surface, decided every sheet was
// a picture, and would have blocked all of them.
export function textIsReal(pdf) {
  const raw = pdf.toString('latin1');
  const hasFontData = /\/FontDescriptor|\/FontFile/.test(raw);

  let textOps = 0;
  let images = 0;
  const marker = /stream\r?\n/g;
  let m;
  while ((m = marker.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    let body;
    try {
      body = zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1');
    } catch (e) {
      body = raw.slice(start, end);      // some streams are not deflated
    }
    if (/\bTJ\b|\bTj\b/.test(body)) textOps += 1;
    if (/\/Subtype\s*\/Image/.test(body)) images += 1;
  }
  if (/\/Subtype\s*\/Image/.test(raw)) images += 1;

  return {
    ok: hasFontData && textOps > 0,
    hasFonts: hasFontData,
    drawsText: textOps > 0,
    hasImagesOnly: images > 0 && textOps === 0
  };
}

// Everything that has to be looked at on the rendered page rather than
// in the file: what overflowed, what came out empty, what got cut off.
export async function inspectPage(page) {
  return page.evaluate(() => {
    const out = { overflow: [], tiny: [], spill: [], emptyBlocks: 0, textLength: 0, widest: 0 };
    const root = document.documentElement;
    // The sheet's own content, not the furniture. The masthead, the
    // title and the footer are about forty characters between them,
    // which is enough to make a completely empty worksheet look
    // occupied if you measure the whole page.
    out.textLength = [...document.querySelectorAll('section, .passage, .objective, .answers')]
      .map((el) => (el.innerText || '').replace(/\s+/g, ''))
      .join('').length;
    // Anything wider than the page will be sliced off at the margin.
    out.widest = Math.round(root.scrollWidth - root.clientWidth);

    document.querySelectorAll('section, .q, .turn, tr, .passage p').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > root.clientWidth + 1) out.overflow.push(el.className || el.tagName);
      const txt = (el.innerText || '').trim();
      if (!txt && !el.querySelector('.box, .rule')) out.emptyBlocks += 1;
    });
    // Text that will not wrap (a long translated pattern name, say) runs
    // out of its table cell and is printed over the next column.
    document.querySelectorAll('td, th').forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) out.spill.push((el.innerText || '').trim().slice(0, 40));
    });
    // Print small enough and nobody reads it; the brief says so outright.
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el.innerText || '').trim()) return;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size && size < 8) out.tiny.push(el.className || el.tagName);
    });
    return out;
  });
}

// How many pages there really are, and whether every one of them draws
// something.
//
// Read out of the PDF, not measured in the browser. An earlier version
// divided the page's scroll height by the height of a sheet of A4,
// which ignores every page break the stylesheet asks for — so the
// answer key, which is given a page of its own with `break-before`,
// did not exist as far as the checker was concerned. The laid-out
// document and the printed document are not the same shape, and only
// the printed one is what gets downloaded.
export function pageBreakdown(pdf) {
  const raw = pdf.toString('latin1');
  const tree = /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/.exec(raw);
  const pages = tree
    ? Number(tree[1])
    : Math.max(1, (raw.match(/\/Type\s*\/Page[^s]/g) || []).length);

  // Chromium writes one content stream per page, so a page that draws
  // no text at all shows up as a stream with no text operator in it.
  let drawing = 0;
  const marker = /stream\r?\n/g;
  let m;
  while ((m = marker.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    let body;
    try {
      body = zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1');
    } catch (e) { continue; }
    if (/\bTJ\b|\bTj\b/.test(body)) drawing += 1;
  }
  return { pages, pagesDrawingText: drawing };
}

// The whole verdict for one rendered sheet.
export async function inspect(page, pdf, sheet) {
  const why = [];

  const text = textIsReal(pdf);
  if (!text.ok) {
    if (text.hasImagesOnly || !text.drawsText) {
      why.push('the pdf draws no text, so nothing in it can be selected or searched');
    } else {
      why.push('no embedded font was found, so this may not render on another machine');
    }
  }

  const seen = await inspectPage(page);
  const { pages, pagesDrawingText } = pageBreakdown(pdf);

  if (seen.widest > 1) why.push('content runs ' + seen.widest + 'px past the page edge and will be cut off');
  if (seen.overflow.length) why.push('too wide for the page: ' + seen.overflow.slice(0, 3).join(', '));
  if (seen.spill && seen.spill.length) why.push('text runs out of its column over the next one: ' + seen.spill.slice(0, 3).join(' | '));
  if (seen.tiny.length) why.push('text under 8px, too small to read in print: ' + seen.tiny.slice(0, 3).join(', '));
  if (seen.textLength < MIN_TEXT_PER_PAGE) why.push('there is almost nothing on the sheet');

  if (pagesDrawingText < pages) {
    why.push((pages - pagesDrawingText) + ' of ' + pages + ' pages have no text on them at all');
  }

  if (pages > MAX_PAGES) why.push('it runs to ' + pages + ' pages');
  if (pdf.length > MAX_BYTES) why.push('the file is ' + Math.round(pdf.length / 1048576) + 'MB');

  // Section 10: the questions and the answers have to line up. A sheet
  // whose answer key is a different length from its exercises is wrong
  // in a way a reviewer would have to count to notice.
  const asks = Array.isArray(sheet.exercises) ? sheet.exercises.length : 0;
  const answers = Array.isArray(sheet.answers) ? sheet.answers.length : 0;
  if (asks && answers !== asks) {
    why.push('there are ' + asks + ' questions but ' + answers + ' answers');
  }

  return {
    ok: why.length === 0,
    why,
    pages,
    pagesDrawingText,
    bytes: pdf.length,
    textLength: seen.textLength,
    selectableText: text.ok,
    checkedAt: new Date().toISOString()
  };
}

export const LIMITS = { MIN_TEXT_PER_PAGE, MAX_PAGES, MAX_BYTES };
