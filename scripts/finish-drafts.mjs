#!/usr/bin/env node
// DURU KOREAN — finish worksheet drafts whose saving stopped halfway
//
// A sheet is saved in steps: the resource row, its PDFs, then its rights
// record (resource_sources) and the "generated" review entry. On
// 2026-10-05 four finished sheets stopped at the rights record (a fault
// in the insert, since fixed), leaving rows and PDFs with no record.
// This adds what is missing — never anything else — and saves the PDFs
// to --out so they can be looked at. It publishes nothing.
//
//   node scripts/finish-drafts.mjs --since=2026-10-05 [--out=dir]
//        [--mark=grammar=OK-002,OK-003] [--mark=reallife=S1:자기소개]
//
// --mark records syllabus items as done on a shelf's plan, for sheets
// finished here rather than by the run that wrote them.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { signIn, api, markDone, selfRows, creditRows } from './generate-sheets.mjs';
import { shelfCredits } from './lib/curriculum.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const since = arg('since');
const out = arg('out');
const log = (...a) => console.log(...a);

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since || '')) throw new Error('--since=YYYY-MM-DD 가 필요합니다');
  const { token, userId } = await signIn();
  const call = api(token);
  const from = new Date(Date.parse(since + 'T00:00:00+09:00')).toISOString();

  const rows = await call('resources?select=id,title,category,status,published&origin=eq.auto' +
    '&publish_location=eq.free-resources&created_at=gte.' + encodeURIComponent(from) + '&order=created_at');
  log(since + ' 이후 자동 생성 ' + rows.length + '편');

  let fixed = 0;
  for (const r of rows) {
    const have = await call('resource_sources?select=id&resource_id=eq.' + r.id + '&limit=1');
    const files = await call('resource_files?select=lang,draft_key,page_count&resource_id=eq.' + r.id);
    const state = have.length ? '기록 있음' : '기록 없음';
    log('· [' + r.category + '] ' + r.title + ' — 파일 ' + files.length + '개, ' + state +
        (files.length ? ' (' + files.map((f) => f.lang + ' ' + f.page_count + '쪽').join(', ') + ')' : ''));
    if (!have.length) {
      if (files.length < 10) { log('    파일이 다 있지 않아 손대지 않습니다'); continue; }
      await call('resource_sources', { method: 'POST', body: JSON.stringify(selfRows(r.id, [])) });
      const credits = creditRows(r.id, shelfCredits(r.category));
      if (credits.length) await call('resource_sources', { method: 'POST', body: JSON.stringify(credits) });
      const reviewed = await call('resource_reviews?select=id&resource_id=eq.' + r.id + '&limit=1');
      if (!reviewed.length) {
        await call('resource_reviews', { method: 'POST',
          body: JSON.stringify([{ resource_id: r.id, actor_id: userId, action: 'generated' }]) });
      }
      fixed += 1;
      log('    권리 기록과 생성 기록을 채웠습니다 (게시하지 않음)');
    }
    if (out && files.length) {
      const dir = path.join(out, r.category + '-' + r.id.slice(0, 8));
      mkdirSync(dir, { recursive: true });
      for (const f of files) {
        const key = String(f.draft_key || '').replace(/^resource-drafts\//, '');
        const res = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/resource-drafts/' + key, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
        });
        if (res.ok) writeFileSync(path.join(dir, f.lang + '.pdf'), Buffer.from(await res.arrayBuffer()));
        else log('    ' + f.lang + ' 내려받기 실패 (' + res.status + ')');
      }
      writeFileSync(path.join(dir, 'title.txt'), r.title + '\n');
    }
  }

  for (const m of args.filter((a) => a.startsWith('--mark='))) {
    const [shelf, list] = m.slice(7).split('=');
    for (const id of String(list || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      await markDone(token, shelf, id);
      log('진도: ' + shelf + ' ' + id + ' 완료로 기록');
    }
  }
  log('채운 것 ' + fixed + '편');
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
