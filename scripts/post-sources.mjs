#!/usr/bin/env node
// DURU KOREAN — sources for blog posts that have none
//
// The owner reads, before publishing, which sites a post's facts come
// from (admin only, content_sources, schema §43). Posts written before
// that table existed — or while it did not, when the list was lost —
// have none. This names them for such posts from what each post says,
// with the same rules the daily run uses, and saves them where only an
// admin can read them.
//
// The repository and so its logs are public: nothing here prints a
// source, only how many were saved.
//
//   node scripts/post-sources.mjs [--find="수고"] [--dry-run] [--limit=N]

import { resolveProvider } from '../api/_providers.js';
import { withPatience } from './lib/patiently.mjs';
import { useSubscription, subscriptionAccount } from './lib/claude-code.mjs';
import { postReferences } from './lib/generate.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const arg = (n) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DRY = args.includes('--dry-run');
const FIND = (arg('find') || '').trim().toLowerCase();
const LIMIT = Number(arg('limit')) || 0;
const log = (...a) => console.log(...a);

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ').');
  return body.access_token;
}

async function rest(token, p, init = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + p, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(p.split('?')[0] + ' ' + res.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

async function main() {
  const cfg = withPatience(useSubscription(process.env, 'BLOG_PROVIDER')
    ? Object.assign(subscriptionAccount(process.env.BLOG_MODEL || 'sonnet'), { timeoutMs: 300000 })
    : resolveProvider(process.env), log);
  let token = await signIn();

  let have;
  try {
    have = await rest(token, 'content_sources?select=post_id&post_id=not.is.null&limit=10000');
  } catch (err) {
    throw new Error('참고 자료 표(content_sources)가 없습니다 — schema.sql §43 을 먼저 실행해 주세요. (' + err.message + ')');
  }
  const done = new Set(have.map((r) => r.post_id));

  let posts = await rest(token, 'posts?select=id,title,body,published,mt&order=created_at.desc&limit=2000');
  posts = posts.filter((p) => String(p.body || '').trim() && !done.has(p.id));
  if (FIND) {
    posts = posts.filter((p) => (p.title || '').toLowerCase().includes(FIND) ||
      Object.values(p.mt || {}).some((m) => String((m && m.title) || '').toLowerCase().includes(FIND)));
  }
  if (LIMIT) posts = posts.slice(0, LIMIT);
  log('참고 자료가 없는 글 ' + posts.length + '편' + (DRY ? ' · 연습 (저장하지 않음)' : ''));

  let saved = 0, empty = 0, failed = 0;
  for (const [i, post] of posts.entries()) {
    if (i && i % 10 === 0) token = await signIn();
    try {
      const refs = await postReferences(cfg, post);
      if (!refs.length) { empty += 1; log('· ' + post.title + ' — 사실이 아니라 경험으로 쓴 글 (0개)'); continue; }
      if (!DRY) {
        await rest(token, 'content_sources', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(refs.map((r) => ({ post_id: post.id, domain: r.domain, url: r.url || null, about: r.about })))
        });
      }
      saved += 1;
      // The count only: this log is public.
      log('· ' + post.title + ' — ' + refs.length + '개' + (DRY ? '' : ' 저장'));
    } catch (err) {
      failed += 1;
      log('✗ ' + post.title + ' — ' + err.message);
    }
  }
  log('');
  log('저장 ' + saved + '편 · 출처 없음 ' + empty + '편 · 실패 ' + failed + '편');
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
