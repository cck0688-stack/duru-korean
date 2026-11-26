// DURU KOREAN — POST /api/rewrite-post
//
// The admin's "Rewrite the draft" (owner, 2026-11-20): the owner reads a post he does not like, writes
// what to change (and may edit the draft text himself), and presses "Generate". This writes the new
// version of the post — title, summary and body — and returns it; the editor shows it and the owner
// saves it with the editor's own Save (which also translates it). Nothing is stored here.
//
//   POST { title, excerpt, body, instructions }          (owner, 2026-11-26: the default way)
//   → 202 { job }   the draft is written on the owner's Claude subscription by a GitHub Actions run
//                   (.github/workflows/rewrite-draft.yml); that run puts the result in rework-output.
//   GET  ?job=<id>
//   → 200 { status: 'pending' } | { status:'done', title, excerpt, body } | { status:'failed', error }
//   Needs GH_DISPATCH_TOKEN on Vercel (a fine-grained GitHub token for this repository: Actions read/write,
//   Contents read). Without it — or when the admin typed an API key — the old way is used:
//   POST { …, apiKey?, baseUrl?, model? } → 200 { title, excerpt, body, provider, model } at once, with that key.
//   Authorization: Bearer <the admin's Supabase access token>
//
// Who writes: the server's own key (the same one api/translate.js uses: ANTHROPIC_API_KEY, OPENAI_API_KEY,
// GOOGLE_API_KEY …) or, when the server has none, a key the admin types in the page (kept only in his
// browser, sent with each request, never stored or logged here). Any of the providers in api/_providers.js;
// the provider is told from the key's look (sk-ant… Anthropic, AIza… Google, otherwise OpenAI-compatible,
// with baseUrl for another gateway).

import crypto from 'node:crypto';
import { TranslateError, PROVIDERS, resolveProvider } from './_providers.js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

const fail = (res, status, message) => res.status(status).json({ error: message });

async function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Sign in first.' };
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token };
  try {
    const who = await fetch(SUPABASE_URL + '/auth/v1/user', { headers });
    if (!who.ok) return { ok: false, status: 401, message: 'Sign in first.' };
    const user = await who.json();
    const adm = await fetch(SUPABASE_URL + '/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(user.id), { headers });
    const rows = adm.ok ? await adm.json() : [];
    if (!Array.isArray(rows) || !rows.length) return { ok: false, status: 403, message: 'Only an admin can do this.' };
    return { ok: true };
  } catch (e) { return { ok: false, status: 503, message: 'Could not check the login.' }; }
}

// A provider config from a key the admin typed.
function fromKey(apiKey, baseUrl, model) {
  const name = /^sk-ant-/.test(apiKey) ? 'anthropic' : /^AIza/.test(apiKey) ? 'google' : 'openai';
  const provider = PROVIDERS[name];
  return {
    name, provider, apiKey, label: provider.label,
    model: model || provider.defaultModel, fastModel: provider.fastModel || provider.defaultModel,
    baseUrl: baseUrl || provider.defaultBaseUrl || '', effort: 'low'
  };
}

const SYSTEM = [
  '당신은 한국을 여행하거나 한국에서 생활하는 외국인 독자를 위한 블로그 에디터입니다.',
  '아래 글 초안을, 주인이 적은 요청에 맞게 다시 쓰세요.',
  '- 요청에 적힌 것은 반드시 반영하고, 요청에 없는 부분의 사실과 구성은 그대로 두세요.',
  '- 초안 본문이 주인이 직접 고친 것일 수 있습니다. 고친 문장은 살리세요.',
  '- 확실하지 않은 사실(비자 금액, 정확한 날짜 등)을 지어내지 마세요.',
  '- 별표(*)나 마크다운 강조는 쓰지 마세요. 소제목은 "## " 로 시작하는 줄만 씁니다.',
  '- 한국어로 쓰고, 쉽고 자연스러운 "~요" 체로, 한 문단은 짧게 쓰세요.',
  '- JSON으로만 답하세요: title(제목), excerpt(카드에 나올 한두 문장 요약), body(본문).'
].join('\n');

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'excerpt', 'body'],
  properties: { title: { type: 'string' }, excerpt: { type: 'string' }, body: { type: 'string' } }
};

const REPO = process.env.GH_REPO || 'cck0688-stack/duru-korean';
const REF = process.env.GH_REF || 'claude/duru-korean-homepage-raysf6';
const gh = (path, init = {}) => fetch('https://api.github.com/repos/' + REPO + path, {
  ...init, headers: { Authorization: 'Bearer ' + process.env.GH_DISPATCH_TOKEN, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'duru-rewrite', ...(init.headers || {}) }
});

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return fail(res, 405, 'Use POST or GET.');
  const who = await requireAdmin(req);
  if (!who.ok) return fail(res, who.status, who.message);

  if (req.method === 'GET') {
    const job = String((req.query && req.query.job) || '');
    if (!/^[0-9a-f]{20,64}$/.test(job)) return fail(res, 400, 'Bad job.');
    if (!process.env.GH_DISPATCH_TOKEN) return fail(res, 503, 'GitHub is not set up.');
    try {
      const r = await gh('/contents/rewrite-jobs/' + job + '.json?ref=rework-output');
      if (r.status === 404) return res.status(200).json({ status: 'pending' });
      if (!r.ok) return fail(res, 502, 'GitHub said ' + r.status);
      const j = await r.json();
      const o = JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8'));
      return res.status(200).json(o);
    } catch (e) { return fail(res, 502, 'Could not read the result.'); }
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  b = b || {};
  const body = String(b.body || ''), title = String(b.title || ''), excerpt = String(b.excerpt || '');
  const instructions = String(b.instructions || '').trim();
  if (!body.trim()) return fail(res, 400, 'The draft is empty.');
  if (body.length > 20000 || instructions.length > 4000) return fail(res, 413, 'Too long.');
  if (!instructions) return fail(res, 400, 'Write what to change first.');

  // The default: the owner's subscription, through GitHub Actions.
  if (process.env.GH_DISPATCH_TOKEN && !String(b.apiKey || '').trim()) {
    const job = crypto.randomBytes(12).toString('hex');
    try {
      const r = await gh('/actions/workflows/rewrite-draft.yml/dispatches', { method: 'POST',
        body: JSON.stringify({ ref: REF, inputs: { job, payload: JSON.stringify({ title, excerpt, body, ask: instructions }) } }) });
      if (r.status !== 204) return fail(res, 502, 'GitHub said ' + r.status + ' when starting it.');
    } catch (e) { return fail(res, 502, 'Could not start it.'); }
    return res.status(202).json({ job });
  }

  let cfg;
  try {
    const typed = String(b.apiKey || '').trim();
    if (typed) {
      if (typed.length > 300) return fail(res, 400, 'That key looks wrong.');
      cfg = fromKey(typed, String(b.baseUrl || '').trim().slice(0, 200), String(b.model || '').trim().slice(0, 80));
    } else {
      cfg = resolveProvider(process.env);
    }
    if (!cfg.provider.chat) return fail(res, 400, 'That provider cannot write text.');
    cfg.effort = 'low';
    const user = '[현재 제목]\n' + title + '\n\n[현재 요약]\n' + excerpt + '\n\n[현재 본문]\n' + body +
      '\n\n[주인의 요청]\n' + instructions;
    const text = await cfg.provider.chat(cfg, SYSTEM, user, SCHEMA);
    let out;
    try { out = JSON.parse(String(text).replace(/^```(?:json)?|```$/g, '').trim()); } catch (e) { return fail(res, 502, 'The answer was not readable. Try again.'); }
    const clean = (s) => String(s || '').replace(/\*\*?/g, '').trim();
    if (!out || !clean(out.body)) return fail(res, 502, 'The answer was empty. Try again.');
    return res.status(200).json({ title: clean(out.title) || title, excerpt: clean(out.excerpt), body: clean(out.body), provider: cfg.name, model: cfg.model });
  } catch (err) {
    if (err instanceof TranslateError) {
      // No key on the server: the page then asks the admin for one.
      return res.status(err.status === 503 ? 503 : err.status || 502).json({ error: err.message, needKey: err.status === 503 });
    }
    return fail(res, 502, 'Could not write the draft.');
  }
}
