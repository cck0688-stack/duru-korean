// DURU KOREAN — writing with a Claude subscription instead of an API key
//
// The worksheet run needs a model to write, review and translate. It
// can pay per call through an API key (OPENAI_API_KEY and friends, as
// api/_providers.js), or it can run on the owner's Claude subscription
// through the Claude Code command line — the same thing a person types
// `claude` for, run without anyone at the keyboard.
//
// The subscription path is chosen when CLAUDE_CODE_OAUTH_TOKEN is set
// (made once with `claude setup-token` on the owner's own computer).
// It has no per-call bill; what it has instead is the plan's usage
// allowance, shared with everything else the owner does in Claude. A
// run that reaches the allowance stops with a message that says so,
// and the next morning's run carries on.
//
// Each call is one `claude -p`: no tools, no project files, no saved
// session — a system prompt, the text, and a JSON schema the answer
// must fit, returned as structured_output. It is shaped like the other
// providers (chat(cfg, system, user, schema) → JSON text), so the
// sheets, the reviewer and the translations use it without knowing.

import { spawn } from 'node:child_process';
import os from 'node:os';
import { TranslateError } from '../../api/_providers.js';

const EFFORT = { minimal: 'low', low: 'low', medium: 'medium', high: 'high' };

function run(args, input, ms) {
  return new Promise((resolve, reject) => {
    // Run from the temp directory so no CLAUDE.md, settings or skills
    // from this repository are read into the prompt.
    // Its own process group, so that at the deadline the CLI and
    // anything it started go together — a child left holding the pipe
    // open would otherwise keep this waiting long after the deadline.
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, {
      cwd: os.tmpdir(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true
    });
    let out = '', err = '', done = false;
    const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) { /* gone */ } }
      finish({ code: null, signal: 'SIGKILL', out, err });
    }, ms);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.on('close', (code, signal) => finish({ code, signal, out, err }));
    child.stdin.end(input);
  });
}

// How long a limit that says when it resets is waited out, rather than
// the run giving up. The subscription's session limit comes back within
// the hour more often than not ("You've hit your session limit · resets
// 7:20pm (UTC)"): the 04:00 blog run met one at 04:03 on 2026-09-27,
// when the worksheet run starting the same minute had used it up, and
// lost all eight posts over a seventeen-minute wait.
// The two dawn runs are given longer (CLAUDE_LIMIT_WAIT_MIN=300): a
// limit met at 04:05 can name a reset hours away, and nobody is awake
// to start them again.
const LIMIT_WAIT_MAX = (Number(process.env.CLAUDE_LIMIT_WAIT_MIN) || 75) * 60 * 1000;

// Milliseconds until the time a limit message names, or null.
export function untilReset(said, now = new Date()) {
  const m = /resets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(?UTC\)?/i.exec(String(said || ''));
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (!m[3]) h = Number(m[1]);
  else if (/pm/i.test(m[3])) h += 12;
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, Number(m[2] || 0)));
  if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
  return at - now;
}

const LIMIT = /usage limit|session limit|limit reached|hit your limit|rate limit|out of (extra )?usage/i;

export const claudeCode = {
  label: 'Claude (구독)',
  strictSchema: true,
  async chat(cfg, system, user, jsonSchema) {
    try {
      return await claudeCode.once(cfg, system, user, jsonSchema);
    } catch (err) {
      const wait = err && err.status === 429 ? untilReset(err.said) : null;
      if (wait == null || wait > LIMIT_WAIT_MAX) throw err;
      // One more try just after the reset (plus a minute's margin).
      console.log('    Claude 구독 한도 — ' + Math.ceil(wait / 60000) + '분 뒤 초기화, 기다렸다가 다시 합니다.');
      await new Promise((r) => setTimeout(r, wait + 60000));
      return claudeCode.once(cfg, system, user, jsonSchema);
    }
  },
  async once(cfg, system, user, jsonSchema) {
    const ms = Number(cfg.timeoutMs) || 280000;
    const args = [
      '-p', '--output-format', 'json',
      '--json-schema', JSON.stringify(jsonSchema),
      '--system-prompt', system,
      '--tools', '',
      '--no-session-persistence',
      '--model', cfg.model || 'sonnet'
    ];
    const effort = EFFORT[cfg.fast ? 'minimal' : cfg.effort];
    if (effort) args.push('--effort', effort);

    let res;
    try {
      res = await run(args, user, ms);
    } catch (e) {
      throw new TranslateError(503, 'Claude Code 를 실행하지 못했습니다 (' + e.message + '). ' +
        'npm install -g @anthropic-ai/claude-code 가 먼저 필요합니다.');
    }
    if (res.signal === 'SIGKILL') {
      const e = new TranslateError(504, 'Claude did not answer within ' + Math.round(ms / 1000) + 's.');
      e.transient = true;
      throw e;
    }
    let data = null;
    try { data = JSON.parse(res.out); } catch (e) { /* reported below */ }
    const said = String((data && (data.result || data.error)) || res.err || res.out || '').slice(0, 300);
    if (!data || data.is_error || res.code !== 0) {
      if (LIMIT.test(said)) {
        const e = new TranslateError(429, 'Claude 구독 사용량 한도에 닿았습니다. (' + said + ')');
        e.said = said;
        throw e;
      }
      if (/login|auth|token|credential|401|403/i.test(said)) {
        throw new TranslateError(503, 'Claude 구독 인증이 안 됩니다. CLAUDE_CODE_OAUTH_TOKEN 을 확인하세요. (' + said + ')');
      }
      const e = new TranslateError(502, 'Claude Code 가 실패했습니다: ' + said);
      e.transient = /overloaded|529|50\d|network|ECONN|timeout/i.test(said);
      throw e;
    }
    if (data.structured_output) return JSON.stringify(data.structured_output);
    return String(data.result || '');
  }
};

// Whether this run should use the subscription: the token is here, and
// nobody has asked for the API instead — AI_PROVIDER=api for every
// run, or the run's own switch (SHEET_PROVIDER, BLOG_PROVIDER,
// SIM_PROVIDER) for one of them.
export function useSubscription(env = process.env, own) {
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) return false;
  if (String(env.AI_PROVIDER || '').toLowerCase() === 'api') return false;
  if (own && String(env[own] || '').toLowerCase() === 'api') return false;
  return true;
}

// One model on the subscription, shaped like resolveProvider()'s answer.
export function subscriptionAccount(model) {
  return { name: 'claude-code', provider: claudeCode, label: claudeCode.label,
           model: model || 'sonnet', apiKey: '', baseUrl: '' };
}

// The writer and the translator on the subscription. The larger model
// writes and reviews, as it does on OpenAI; the translations, seven per
// sheet, go to the faster one so the allowance lasts.
export function subscriptionConfig(env = process.env) {
  return {
    writer: subscriptionAccount(env.SHEET_MODEL || 'opus'),
    translator: subscriptionAccount(env.SHEET_TRANSLATE_MODEL || 'sonnet')
  };
}
