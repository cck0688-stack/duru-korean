// DURU KOREAN — a file-name keyword for every download that has none
//
// A download is saved as "<keyword>(<language>).pdf" — bank(en).pdf,
// openhours(vi).pdf (the owner's rule, 2026-09-25; schema.sql §41). The
// daily run gives new sheets one. This gives one to everything already
// on the shelf: one model call for all of them, told to answer with one
// short English word (or two run together) per download.
//
// Nothing that already has a keyword is touched, so an admin's own
// choice stays; run it again and it only fills what is still empty.
//
//   DURU_BOT_EMAIL / DURU_BOT_PASSWORD, SUPABASE_URL / SUPABASE_ANON_KEY,
//   and the model account the daily run uses.
//
//   node scripts/keywords.mjs [--dry-run]

import { resolveProvider } from '../api/_providers.js';
import { withPatience } from './lib/patiently.mjs';
import { subscriptionAccount, useSubscription } from './lib/claude-code.mjs';
import { cleanKeyword } from './lib/sheets.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(...a);

async function signIn() {
  const email = process.env.DURU_BOT_EMAIL;
  const password = process.env.DURU_BOT_PASSWORD;
  if (!email || !password) throw new Error('DURU_BOT_EMAIL 과 DURU_BOT_PASSWORD 가 필요합니다.');
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
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

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'keyword'],
        properties: { id: { type: 'string' }, keyword: { type: 'string' } }
      }
    }
  }
};

const SYSTEM = [
  '한국어 학습 자료 목록입니다. 학습자가 내려받은 파일 이름에 쓸 키워드를 하나씩 정하세요.',
  '- 영어 낱말 하나, 또는 둘을 붙인 것. 소문자, 띄어쓰기와 기호 없이, 12자 이내.',
  '- 그 자료의 주제를 가장 짧게 말하는 낱말. 예: bank, subway, openhours, pharmacy, laundromat, vowels.',
  '- 서로 다른 자료에는 되도록 서로 다른 키워드를.',
  '- 받은 id 를 그대로 돌려주세요.'
].join('\n');

export async function run() {
  const token = await signIn();
  const rows = await rest(token, 'resources?select=id,title,summary,description,tags,keyword&keyword=is.null&limit=2000');
  log('키워드가 없는 자료: ' + rows.length + '개' + (DRY ? ' (연습)' : ''));
  if (!rows.length) return 0;

  const cfg = withPatience(useSubscription(process.env, 'SHEET_PROVIDER')
    ? subscriptionAccount(process.env.RELAYOUT_MODEL || 'sonnet')
    : resolveProvider(process.env), log);
  cfg.timeoutMs = Number(process.env.DURU_CALL_TIMEOUT_MS) || 240000;

  let saved = 0;
  for (let i = 0; i < rows.length; i += 60) {
    const batch = rows.slice(i, i + 60);
    const list = batch.map((r) => ({ id: r.id, title: r.title, about: r.summary || r.description || '', tags: r.tags || [] }));
    const out = await cfg.provider.chat(cfg, SYSTEM, JSON.stringify(list, null, 1), SCHEMA);
    const items = (typeof out === 'string' ? JSON.parse(out) : out).items || [];
    const byId = new Map(items.map((x) => [x.id, cleanKeyword(x.keyword)]));
    for (const r of batch) {
      const kw = byId.get(r.id);
      if (!kw || kw.length < 2) { log('  · ' + r.title + ' — 키워드를 받지 못했습니다'); continue; }
      log('  · ' + kw + '  ←  ' + r.title);
      if (DRY) continue;
      await rest(token, 'resources?id=eq.' + r.id, { method: 'PATCH', body: JSON.stringify({ keyword: kw }) });
      saved += 1;
    }
  }
  log('저장: ' + saved + '개');
  return saved;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  run().catch((err) => { console.error(err.message || err); process.exit(1); });
}
