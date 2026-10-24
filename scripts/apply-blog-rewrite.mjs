// DURU KOREAN — put the rewritten text into the posts (owner, 2026-10-24: "그래 진행해").
// The post keeps its address (slug), its photo and its date; the title, summary, body,
// tags, translations and word list are replaced. The PDFs follow by themselves
// (blog-pdf.yml makes what is out of date). Reads DIR/<id>.json from rewrite-blog.mjs.
//
//   node scripts/apply-blog-rewrite.mjs --dir=DIR [--only=id,id] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { withPatience } from './lib/patiently.mjs';
import { useSubscription, subscriptionAccount, usageReport } from './lib/claude-code.mjs';
import { resolveProvider } from '../api/_providers.js';
import { translateDraft, studyDraft } from './lib/mt.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ')');
  return body.access_token;
}

const dir = path.resolve(arg('dir'));
const only = (arg('only') || '').split(',').filter(Boolean);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && (!only.length || only.includes(f.slice(0, -5))));
const cfg = withPatience(useSubscription(process.env, 'BLOG_PROVIDER')
  ? Object.assign(subscriptionAccount(process.env.BLOG_MODEL || 'sonnet'), { timeoutMs: 300000 })
  : resolveProvider(process.env), log);
let token = DRY ? null : await signIn();

for (const f of files) {
  const { id, oldTitle, draft } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (draft.problems && draft.problems.length) { log('건너뜀(검수 문제): ' + oldTitle); continue; }
  log('── ' + oldTitle + ' → ' + draft.title);
  let mt = {};
  try {
    mt = await translateDraft(cfg, { lang: 'ko', title: draft.title, excerpt: draft.summary, tags: draft.tags, body: draft.content });
    log('  번역: ' + Object.keys(mt).join(', '));
  } catch (err) { log('  번역 실패: ' + err.message); }
  // A post must not go up with its old translations or none: stop this one instead.
  if (!Object.keys(mt).length) { log('  번역이 없어 이 글은 바꾸지 않습니다'); continue; }
  let study = null;
  try { study = await studyDraft(cfg, { lang: 'ko', title: draft.title, body: draft.content }); log('  낱말: ' + (study ? study.words.length + '개' : '없음')); }
  catch (err) { log('  낱말 목록 실패: ' + err.message); }
  const patch = { title: draft.title, excerpt: draft.summary, body: draft.content, tags: draft.tags, topic: draft.topic,
    title_candidates: draft.titleCandidates, mt, study };
  if (DRY) { log('  (연습) 바꾸지 않음'); continue; }
  const res = await fetch(SUPABASE_URL + '/rest/v1/posts?id=eq.' + id, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  const text = await res.text();
  if (!res.ok || text === '[]') { log('  교체 실패: ' + res.status + ' ' + text.slice(0, 200)); continue; }
  log('  교체했습니다');
}
log(usageReport());
