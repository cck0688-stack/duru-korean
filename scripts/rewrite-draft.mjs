#!/usr/bin/env node
// DURU KOREAN — rewrite one draft from the owner's note (owner, 2026-11-26: the editor's "Generate", run on his
// Claude subscription in GitHub Actions instead of an API key). Reads the draft and the note from the
// environment, writes out/<job>.json: { status:'done', title, excerpt, body } or { status:'failed', error }.
// The page polls api/rewrite-post for that file. Nothing on the site changes here.
import fs from 'node:fs';
import { withPatience } from './lib/patiently.mjs';
import { useSubscription, subscriptionAccount } from './lib/claude-code.mjs';
import { resolveProvider } from '../api/_providers.js';
import { READER, schema, parse, plain } from './lib/generate.mjs';

const job = process.env.JOB || '';
const out = 'out'; fs.mkdirSync(out, { recursive: true });
const done = (o) => fs.writeFileSync(`${out}/${job}.json`, JSON.stringify({ ...o, at: new Date().toISOString() }));
const log = (...a) => console.log(...a);
try {
  if (!/^[0-9a-f]{20,64}$/.test(job)) throw new Error('bad job id');
  const d = JSON.parse(process.env.PAYLOAD || '{}');
  if (!String(d.body || '').trim() || !String(d.ask || '').trim()) throw new Error('draft or note missing');
  const cfg = withPatience(useSubscription(process.env, 'BLOG_PROVIDER')
    ? Object.assign(subscriptionAccount(process.env.BLOG_MODEL || 'sonnet'), { timeoutMs: 300000 })
    : resolveProvider(process.env), log);
  const strict = cfg.provider.strictSchema !== false;
  const system = [
    READER, '',
    '지금은 이미 있는 글 초안을, 주인이 적은 요청에 맞게 다시 쓰는 단계입니다.',
    '- 요청에 적힌 것은 반드시 반영하고, 요청에 없는 부분의 사실과 구성은 그대로 두세요.',
    '- 초안 본문은 주인이 직접 고친 것일 수 있습니다. 고친 문장은 살리세요.',
    '- 확실하지 않은 사실(비자 금액, 정확한 날짜 등)을 지어내지 마세요.',
    '- 별표(*)나 마크다운 강조는 쓰지 마세요. 소제목은 "## " 로 시작하는 줄만 씁니다.',
    '- 쉽고 자연스러운 "~요" 체로, 한 문단은 짧게 씁니다.',
    '- JSON으로만 답하세요: title(제목), excerpt(카드에 나올 한두 문장 요약), body(본문).'
  ].join('\n');
  const user = '[현재 제목]\n' + (d.title || '') + '\n\n[현재 요약]\n' + (d.excerpt || '') + '\n\n[현재 본문]\n' + d.body +
    '\n\n[주인의 요청]\n' + d.ask;
  const o = parse(await cfg.provider.chat(cfg, system, user, schema(strict,
    { title: { type: 'string' }, excerpt: { type: 'string' }, body: { type: 'string' } }, ['title', 'excerpt', 'body'])), '다시 쓰기');
  const body = plain(o.body).trim();
  if (!body) throw new Error('empty answer');
  done({ status: 'done', title: plain(o.title).trim() || d.title || '', excerpt: plain(o.excerpt).trim(), body });
  log('done ' + job);
} catch (err) {
  log('failed: ' + (err && err.message));
  if (/^[0-9a-f]{20,64}$/.test(job)) done({ status: 'failed', error: String((err && err.message) || err).slice(0, 300) });
  process.exit(0);
}
