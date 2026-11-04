#!/usr/bin/env node
// DURU KOREAN — the blog topic plan (owner, 2026-11-05): topics chosen ahead, one per shelf per day,
// checked against every post on the site and against each other, so a day's writing never has to
// pick (and never repeats). Written to content/blog-plan/plan.json (+ PLAN.md to read).
//   node scripts/plan-topics.mjs [--from=2026-11-06] [--days=30] [--only=travel,dining]
// Nothing is published or saved to the site. generate-drafts.mjs follows the plan when
// content/blog-plan/plan.json is on the deploy branch (the owner moves it there after reading PLAN.md).
import fs from 'node:fs';
import { resolveProvider } from '../api/_providers.js';
import { withPatience } from './lib/patiently.mjs';
import { useSubscription, subscriptionAccount, usageReport } from './lib/claude-code.mjs';
import { READER, schema, parse, overlap, isBanned } from './lib/generate.mjs';
import { seasonFor, questionsFor } from './lib/season.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d; };
const FROM = arg('from', '2026-11-06');
const DAYS = Number(arg('days', 30));
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = 'content/blog-plan';
const log = (...a) => console.log(...a);

const CATEGORIES = [
  { id: 'travel', about: 'arriving and getting around Korea as a visitor: apps, transport, money, etiquette' },
  { id: 'dining', about: 'eating in Korea: how to order and eat, street food, convenience stores, dietary needs' },
  { id: 'style', about: 'Korean beauty and fashion: skincare, clinics, brands, shopping and tax refunds' },
  { id: 'explore', about: 'neighbourhoods, K-pop and drama locations, everyday Korean experiences, day trips' },
  { id: 'campus', about: 'living here long term: visas and paperwork, housing, healthcare, multicultural support' },
  { id: 'career', about: 'working in Korea: part-time work permits, job hunting, resumes, internships' },
  { id: 'language', about: 'the Korean language itself: useful expressions, common mistakes, what a word really means' },
  { id: 'etc', about: 'cultural nuances, news and policy for foreigners, and anything that fits nowhere else' }
];

const dates = [];
{ const [y, m, d] = FROM.split('-').map(Number);
  for (let i = 0; i < DAYS; i += 1) dates.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10)); }
const monthNotes = (iso) => seasonFor(new Date(iso + 'T12:00:00Z')).notes;

const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const rows = await (await fetch(SUPABASE_URL + '/rest/v1/posts?select=title,topic,category&order=post_date.desc&limit=1000',
  { headers: { apikey: KEY, Authorization: 'Bearer ' + token } })).json();
if (!Array.isArray(rows)) throw new Error('글 목록을 읽지 못했습니다');
log('사이트의 글 ' + rows.length + '편을 읽었습니다');

const cfg = withPatience(useSubscription(process.env, 'BLOG_PROVIDER')
  ? Object.assign(subscriptionAccount(process.env.BLOG_MODEL || 'opus'), { timeoutMs: 600000 })
  : resolveProvider(process.env), log);
const strict = cfg.provider.strictSchema !== false;

const closeTo = (topic, pool) => Math.max(0, ...pool.map((r) => Math.max(overlap(topic, r.topic || ''), overlap(topic, r.title || ''))));
let plan = [];
try { plan = JSON.parse(fs.readFileSync(OUT + '/plan.json', 'utf8')).entries.filter((e) => !dates.includes(e.date) || (ONLY.length && !ONLY.includes(e.category))); } catch (e) { /* first run */ }

for (const cat of CATEGORIES) {
  if (ONLY.length && !ONLY.includes(cat.id)) continue;
  log('── ' + cat.id);
  const mine = rows.filter((r) => r.category === cat.id);
  let todo = dates.slice();
  const made = [];
  for (let round = 0; round < 3 && todo.length; round += 1) {
    const pool = [...rows, ...plan, ...made]; // the whole site, what other shelves plan, what this one has so far
    const system = [
      READER, '',
      '지금은 앞으로의 주제를 미리 정하는 단계입니다. 본문을 쓰지 마세요.',
      `"${cat.id}" 선반(${cat.about})의 주제를 아래 날짜마다 하나씩 정하세요.`,
      '',
      '[기준]',
      '- 한국에서는 당연한데 밖에서 온 사람에게는 낯설고 신기한 것, 그리고 그 뒤에 이유가 있는 것. 구체적일 것.',
      '- 서로 달라야 합니다: 같은 소재를 다른 각도로 다시 쓰는 것도 겹침입니다. 날짜끼리, 그리고 이미 쓴 글과 겹치면 안 됩니다.',
      '- 한 달 안에 같은 틀(전부 "왜 ~할까요?" 식, 전부 식당 이야기 식)이 몰리지 않게 소재의 결을 섞으세요.',
      '- 계절·행사 소재는 그 시기의 날짜에 놓으세요 (월별 메모 참고). 날짜를 단정하지 말고 "그 무렵" 정도로만 다루는 주제로.',
      '- 절대 쓰지 않는 소재 (주인이 정했습니다): 옷 가게 탈의실과 얼굴 가리개(페이스 커버) 이야기.',
      '- 확실하지 않은 사실이나 곧 바뀔 제도(비자 금액·정확한 날짜)에 기대는 주제는 피하세요.',
      '- topic은 한 문장의 구체적인 한국어 주제, why는 독자가 놀랄 지점을 한 줄로.',
      '',
      '이 선반에서 외국인이 자주 하는 질문 (소재의 증거로만 쓰고 그대로 베끼지 마세요):',
      ...questionsFor(cat.id).map((q) => '- ' + q),
      '',
      '월별 메모:',
      ...[...new Set(todo.map((d) => d.slice(0, 7)))].map((ym) => `- ${ym}: ` + monthNotes(ym + '-15').join(' / ')),
      '',
      '이미 쓴 글 (이 선반):', ...mine.slice(0, 80).map((r) => '- ' + (r.topic || r.title)),
      '',
      '다른 선반의 최근 글과 이미 정해 둔 주제 (같은 소재면 겹침):',
      ...rows.filter((r) => r.category !== cat.id).slice(0, 80).map((r) => `- [${r.category}] ${r.topic || r.title}`),
      ...plan.filter((p) => p.category !== cat.id).slice(0, 80).map((p) => `- [${p.category} ${p.date}] ${p.topic}`),
      ...made.map((p) => `- [${cat.id} ${p.date}] ${p.topic}`)
    ].join('\n');
    const user = '다음 날짜의 주제를 정하세요:\n' + todo.join('\n');
    const out = parse(await cfg.provider.chat(cfg, system, user, schema(strict, {
      items: { type: 'array', items: schema(strict, { date: { type: 'string' }, topic: { type: 'string' }, why: { type: 'string' } }, ['date', 'topic', 'why']) }
    }, ['items'])), '주제 계획');
    let bad = 0;
    for (const it of out.items || []) {
      if (!todo.includes(it.date) || !it.topic) continue;
      if (isBanned(it.topic) || closeTo(it.topic, [...pool, ...made]) >= 0.3) { bad += 1; continue; }
      made.push({ date: it.date, category: cat.id, topic: it.topic.trim(), why: (it.why || '').trim() });
    }
    todo = dates.filter((d) => !made.some((m) => m.date === d));
    log(`  ${round + 1}회: ${made.length}/${dates.length} (겹치거나 금지라 버린 것 ${bad})`);
  }
  if (todo.length) log('  ※ 채우지 못한 날짜: ' + todo.join(', '));
  plan.push(...made);
}

plan.sort((a, b) => a.date.localeCompare(b.date) || CATEGORIES.findIndex((c) => c.id === a.category) - CATEGORIES.findIndex((c) => c.id === b.category));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + '/plan.json', JSON.stringify({ generated: new Date().toISOString(), from: FROM, days: DAYS, entries: plan }, null, 1));
let md = '# 블로그 주제 계획\n\n사장님이 읽고 빼거나 바꿀 주제를 알려 주세요. 확정되면 이 순서대로 하루 8편씩 씁니다.\n';
let day = '';
for (const p of plan) {
  if (p.date !== day) { day = p.date; md += `\n## ${day}\n`; }
  md += `- **${p.category}** — ${p.topic}  \n  _${p.why}_\n`;
}
fs.writeFileSync(OUT + '/PLAN.md', md);
log('계획 ' + plan.length + '개를 ' + OUT + ' 에 썼습니다');
try { log(usageReport ? usageReport() : ''); } catch (e) { /* the report is optional */ }
