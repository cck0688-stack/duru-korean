// DURU KOREAN — rewrite posts that repeat one another (owner, 2026-10-24)
//
// Posts on the same subject are given different angles: the body is written
// again from a new angle (not the same text with other nouns), and the post
// keeps its address. Two steps, so nothing public changes before the owner sees it:
//
//   node scripts/rewrite-blog.mjs --plan=plan.json --out=DIR     writes the new Korean
//       text of each post to DIR/<id>.json and prints it (nothing on the site changes)
//
// plan.json: [{ "id": "<post id>", "angle": "...new topic line...", "reason": "...", "keep": ["ideas to avoid"] }]
import fs from 'node:fs';
import path from 'node:path';
import { withPatience } from './lib/patiently.mjs';
import { useSubscription, subscriptionAccount, usageReport } from './lib/claude-code.mjs';
import { resolveProvider } from '../api/_providers.js';
import { writeOne } from './lib/generate.mjs';
import { pickVoice } from './lib/voices.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : null; };
const log = (...a) => console.log(...a);
const ABOUT = {
  travel: 'arriving and getting around Korea as a visitor: apps, transport, money, etiquette',
  dining: 'eating in Korea: how to order and eat, street food, convenience stores, dietary needs',
  style: 'Korean beauty and fashion: skincare, clinics, brands, shopping and tax refunds',
  explore: 'neighbourhoods, K-pop and drama locations, everyday Korean experiences, day trips',
  campus: 'living here long term: visas and paperwork, housing, healthcare, multicultural support',
  career: 'working in Korea: part-time work permits, job hunting, resumes, internships',
  language: 'the Korean language itself: useful expressions, common mistakes, what a word really means',
  etc: 'cultural nuances, news and policy for foreigners, and anything that fits nowhere else'
};

async function get(pathAndQuery) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, { headers: { apikey: SUPABASE_ANON_KEY } });
  if (!res.ok) throw new Error(pathAndQuery.split('?')[0] + ' ' + res.status);
  return res.json();
}

const plan = JSON.parse(fs.readFileSync(arg('plan'), 'utf8'));
const out = path.resolve(arg('out') || 'blog-rewrite');
fs.mkdirSync(out, { recursive: true });

const cfg = withPatience(useSubscription(process.env, 'BLOG_PROVIDER')
  ? Object.assign(subscriptionAccount(process.env.BLOG_MODEL || 'sonnet'), { timeoutMs: 300000 })
  : resolveProvider(process.env), log);
log('글쓰기: ' + cfg.label + ' · ' + cfg.model);

const all = await get('posts?select=id,title,topic,category,slug,body&order=post_date.desc&limit=1000');
let n = 0;
for (const item of plan) {
  const old = all.find((p) => p.id === item.id);
  if (!old) { log('없는 글: ' + item.id); continue; }
  n += 1;
  log('── ' + old.category + ' · ' + old.title);
  const others = all.filter((p) => p.id !== old.id);
  const siblings = (item.siblings || []).map((id) => all.find((p) => p.id === id)).filter(Boolean);
  const existing = {
    titles: others.map((p) => p.title), slugs: others.map((p) => p.slug),
    allPosts: others.map((p) => ({ title: p.title, topic: p.topic })), photos: new Set()
  };
  const reason = [item.reason || '',
    '같은 소재의 다른 글들이 이미 있습니다. 이 글은 그 글들과 겹치지 않는 자기만의 내용이어야 합니다 — 같은 문장이나 같은 예시, 같은 흐름을 쓰지 마세요.',
    ...siblings.map((p) => '이미 있는 글: 「' + p.title + '」 — ' + String(p.body || '').replace(/\s+/g, ' ').slice(0, 350)),
    item.keep && item.keep.length ? '이 글에서 다루지 않는 것: ' + item.keep.join(' / ') : ''].filter(Boolean).join('\n');
  const draft = await writeOne(cfg, {
    category: old.category, about: ABOUT[old.category] || '', fixedTopic: item.angle, fixedReason: reason,
    voice: pickVoice(n + 3, Object.keys(ABOUT).indexOf(old.category), 8),
    existing, existingTitles: [], month: Number(new Date().toISOString().slice(5, 7)), seasonNotes: [], questions: []
  }, (m) => log('  ' + m));
  fs.writeFileSync(path.join(out, old.id + '.json'), JSON.stringify({ id: old.id, slug: old.slug, oldTitle: old.title, draft }, null, 2));
  log('  제목: ' + draft.title);
  log('  요약: ' + draft.summary);
  log('  태그: ' + (draft.tags || []).join(', '));
  log('  문제: ' + (draft.problems.length ? draft.problems.map((p) => p.field + ': ' + p.message).join(' | ') : '없음'));
  log('  ----- 본문 -----\n' + draft.content + '\n  -----');
}
log(usageReport ? usageReport() : '');
