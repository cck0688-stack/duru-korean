#!/usr/bin/env node
// DURU KOREAN — one name per level on every download
//
// The level filter on Free Downloads (js/resources.js) matches
// learning_level exactly. Sheets made before 2026-10-05 carry the
// writer's own wording ("초급 (A1)", "Beginner-High (A2)"); this puts
// each into the names the generator now writes (normalizeLevel):
// Beginner, Beginner (high), Intermediate (low), Intermediate, Advanced.
// Only learning_level changes; nothing is published or unpublished.
//
//   node scripts/normalize-levels.mjs [--dry-run]

import { signIn, api } from './generate-sheets.mjs';
import { normalizeLevel } from './lib/proofread.mjs';

const DRY = process.argv.includes('--dry-run');
const KEEP = new Set(['Any level', 'Beginner', 'Beginner (high)', 'Intermediate (low)', 'Intermediate', 'Advanced']);

const { token } = await signIn();
const call = api(token);
const rows = await call('resources?select=id,title,learning_level&limit=5000');
let changed = 0;
for (const r of rows) {
  const was = r.learning_level;
  if (!was || KEEP.has(was)) continue;
  const now = normalizeLevel(was);
  console.log((DRY ? '[연습] ' : '') + was + ' → ' + now + '  ' + r.title);
  if (!DRY) {
    await call('resources?id=eq.' + r.id, { method: 'PATCH', body: JSON.stringify({ learning_level: now }), headers: { Prefer: 'return=minimal' } });
  }
  changed += 1;
}
console.log('바꾼 것 ' + changed + ' / 전체 ' + rows.length);
