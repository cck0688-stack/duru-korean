#!/usr/bin/env node
// DURU KOREAN — every published PDF in one folder, for the owner's own copy
//
// Downloads the PDFs that are live on the site (Free Downloads, and with
// --blog the blog posts' download and print PDFs) into --out, one folder
// per category and resource, with a list (목록.csv) of what each is.
// It only reads: nothing is changed, published or removed.
//
//   node scripts/export-pdfs.mjs --out=dir [--blog | --only-blog]

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { signIn, api } from './generate-sheets.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const OUT = arg('out');
const BLOG = args.includes('--blog');
const ONLY_BLOG = args.includes('--only-blog');
const log = (...a) => console.log(...a);

// Safe on Windows: no reserved characters, no trailing dot or space.
const safe = (s) => String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60) || 'untitled';
const keyword = (r) => {
  const own = String(r.keyword || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 16);
  return own.length >= 2 ? own : r.id.slice(0, 8);
};
const csv = (rows) => '﻿' + rows.map((r) => r.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n';

async function fetchFile(token, key) {
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/resources/' + key, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    }).catch(() => null);
    if (res && res.ok) return Buffer.from(await res.arrayBuffer());
    if (res && res.status < 500 && res.status !== 429) return null;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  return null;
}

async function main() {
  if (!OUT) throw new Error('--out=폴더 가 필요합니다');
  const { token } = await signIn();
  const call = api(token);
  const list = [['구분', '분류', '폴더', '파일', '언어', '쪽수', '제목', '게시일']];
  let saved = 0, failed = 0, bytes = 0;

  const resources = ONLY_BLOG ? [] : await call('resources?select=id,title,category,keyword,first_published_at,publish_location' +
    '&status=eq.published&order=first_published_at');
  log('게시된 무료 자료 ' + resources.length + '편');
  for (const r of resources) {
    const files = await call('resource_files?select=lang,storage_key,page_count&published=eq.true&resource_id=eq.' + r.id + '&order=lang');
    const day = String(r.first_published_at || '').slice(0, 10);
    const shelf = r.publish_location === 'book-resources' ? '교재자료' : '무료자료';
    const folder = path.join(shelf, safe(r.category), day + '_' + keyword(r));
    mkdirSync(path.join(OUT, folder), { recursive: true });
    for (const f of files) {
      const name = keyword(r) + '(' + f.lang + ').pdf';
      const pdf = await fetchFile(token, f.storage_key);
      if (!pdf) { failed += 1; log('  받기 실패: ' + r.title + ' ' + f.lang); continue; }
      writeFileSync(path.join(OUT, folder, name), pdf);
      saved += 1; bytes += pdf.length;
      list.push([shelf, r.category, folder, name, f.lang, f.page_count, r.title, day]);
    }
  }

  if (BLOG || ONLY_BLOG) {
    const posts = await call('posts?select=id,slug,title,category,published_at,pdf&published=eq.true&order=published_at');
    log('게시된 블로그 글 ' + posts.length + '편');
    for (const p of posts) {
      const files = (p.pdf && p.pdf.files) || {};
      const day = String(p.published_at || '').slice(0, 10);
      const folder = path.join('블로그', safe(p.category), day + '_' + safe(p.slug));
      const langs = Object.keys(files);
      if (!langs.length) continue;
      mkdirSync(path.join(OUT, folder), { recursive: true });
      for (const lang of langs) {
        for (const [key, name, pages] of [
          [files[lang].key, p.slug + '(' + lang + ').pdf', files[lang].pages],
          [files[lang].print && files[lang].print.key, p.slug + '(' + lang + ')-print.pdf', files[lang].print && files[lang].print.pages]
        ]) {
          if (!key) continue;
          const pdf = await fetchFile(token, key);
          if (!pdf) { failed += 1; log('  받기 실패: ' + p.title + ' ' + name); continue; }
          writeFileSync(path.join(OUT, folder, safe(name.replace(/\.pdf$/, '')) + '.pdf'), pdf);
          saved += 1; bytes += pdf.length;
          list.push(['블로그', p.category, folder, name, lang, pages, p.title, day]);
        }
      }
    }
  }

  writeFileSync(path.join(OUT, '목록.csv'), csv(list));
  log('받은 파일 ' + saved + '개 (' + (bytes / 1e6).toFixed(1) + 'MB), 실패 ' + failed + '개');
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
