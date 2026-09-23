// DURU KOREAN — Community simulation: the parts every step shares
//
// ── Where it runs ─────────────────────────────────────────────────
//
// Only against a Supabase project made for testing. Two locks, and
// either one alone stops it:
//
//   1. The address. The live project's address is read from
//      js/supabase-config.js — the same file the site uses, so the two
//      cannot drift apart — and a simulation pointed at it refuses to
//      start. There is no default address; SIM_SUPABASE_URL must be set.
//   2. The database. The test project carries a table the live one
//      never will (sim_environment, from scripts/sim/sim-schema.sql).
//      No such table, no writes.
//
// ── Configuration ─────────────────────────────────────────────────
//
//   SIM_SUPABASE_URL        the TEST project's URL
//   SIM_SUPABASE_ANON_KEY   the TEST project's anon (publishable) key
//   SIM_PASSWORD_SECRET     any long random string; each persona's
//                           password is derived from it and the email,
//                           so no password is ever stored anywhere
//   OPENAI_API_KEY          (or another provider, as api/_providers.js)

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..', '..');

export const LANGS = ['en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh'];
export const LANG_NAMES = {
  en: 'English', vi: 'Vietnamese', es: 'Spanish', id: 'Indonesian',
  'pt-BR': 'Brazilian Portuguese', ko: 'Korean', ja: 'Japanese', zh: 'Simplified Chinese'
};
export const TOPICS = ['ask', 'share', 'meet'];
export const MARKER = 'duru-community-sim';

export function log(...parts) { console.log(...parts); }

/* ---------------- the two locks ---------------- */

export function liveProject() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'supabase-config.js'), 'utf8');
  const m = /url:\s*'([^']+)'/.exec(src);
  return m ? m[1].replace(/\/+$/, '') : '';
}

function refOf(url) {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(url || '');
  return m ? m[1].toLowerCase() : null;
}

export function simEnv(env = process.env) {
  const url = String(env.SIM_SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = String(env.SIM_SUPABASE_ANON_KEY || '');
  const secret = String(env.SIM_PASSWORD_SECRET || '');
  const missing = [
    !url && 'SIM_SUPABASE_URL', !anon && 'SIM_SUPABASE_ANON_KEY', !secret && 'SIM_PASSWORD_SECRET'
  ].filter(Boolean);
  if (missing.length) throw new Error('시험 환경 설정이 없습니다: ' + missing.join(', '));
  if (secret.length < 16) throw new Error('SIM_PASSWORD_SECRET 은 16자 이상이어야 합니다.');

  const live = liveProject();
  const liveRef = refOf(live);
  if (url === live || (liveRef && refOf(url) === liveRef)) {
    throw new Error('거부: SIM_SUPABASE_URL 이 운영 중인 사이트의 프로젝트입니다. ' +
      '시뮬레이션은 시험용으로 따로 만든 프로젝트에서만 돌아갑니다.');
  }
  return { url, anon, secret };
}

export async function assertSimDatabase(env) {
  let rows;
  try {
    rows = await rest(env)('sim_environment?select=name');
  } catch (err) {
    throw new Error('거부: 이 데이터베이스에는 시험 환경 표시(sim_environment)가 없습니다. ' +
      'scripts/sim/sim-schema.sql 을 시험 프로젝트에서 실행했는지 확인하세요. (' + err.message + ')');
  }
  if (!Array.isArray(rows) || !rows.some((r) => r.name === MARKER)) {
    throw new Error('거부: sim_environment 에 ' + MARKER + ' 표시가 없습니다.');
  }
}

/* ---------------- talking to the test project ---------------- */

async function withRetry(what, run) {
  let last;
  for (let i = 0; i < 4; i += 1) {
    try { return await run(); } catch (err) {
      last = err;
      if (!/fetch failed|ECONN|ETIMEDOUT|socket|429|50\d|rate limit/i.test(String(err && err.message))) break;
      const wait = /429|rate limit/i.test(String(err.message)) ? 65000 : 3000 * (i + 1);
      log('  ' + what + ' — ' + err.message + ' / ' + Math.round(wait / 1000) + '초 뒤 다시');
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export function rest(env, token) {
  return async function call(p, init = {}) {
    return withRetry(p.split('?')[0], async () => {
      const res = await fetch(env.url + '/rest/v1/' + p, {
        ...init,
        headers: {
          apikey: env.anon,
          Authorization: 'Bearer ' + (token || env.anon),
          'Content-Type': 'application/json',
          ...(init.headers || {})
        }
      });
      const text = await res.text();
      if (!res.ok) throw new Error(p.split('?')[0] + ' ' + res.status + ': ' + text.slice(0, 200));
      return text ? JSON.parse(text) : null;
    });
  };
}

// A persona's password is never stored: it is recomputed from the
// secret and the email whenever the persona needs to sign in.
export function passwordFor(env, email) {
  return 'Sim-' + crypto.createHmac('sha256', env.secret).update(email).digest('base64url').slice(0, 28);
}

async function authCall(env, p, body) {
  return withRetry('auth', async () => {
    const res = await fetch(env.url + '/auth/v1/' + p, {
      method: 'POST',
      headers: { apikey: env.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error('auth ' + res.status + ': ' + (data.msg || data.error_description || data.message || data.error || '?'));
    }
    return data;
  });
}

export async function signUp(env, email, data) {
  const out = await authCall(env, 'signup', { email, password: passwordFor(env, email), data });
  const token = out.access_token || (out.session && out.session.access_token);
  const user = out.user || (out.session && out.session.user) || (out.id ? out : null);
  if (!token || !user) {
    throw new Error('가입은 됐지만 세션이 없습니다. 시험 프로젝트의 Authentication → Sign In / Providers → ' +
      'Email 에서 "Confirm email" 을 꺼 주세요.');
  }
  return { token, userId: user.id };
}

export async function signIn(env, email) {
  const out = await authCall(env, 'token?grant_type=password', { email, password: passwordFor(env, email) });
  return { token: out.access_token, userId: out.user && out.user.id };
}

/* ---------------- the site's own detector ---------------- */

// The composer guesses the writer's language with js/lang-detect.js.
// The simulation runs that same file rather than a copy of it, so what
// it stores is exactly what a person's browser would have stored — and
// the verifier can report how often the guess was right.
export const DETECT = (() => {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'lang-detect.js'), 'utf8'), { window: win });
  return win.DURU_LANGDETECT;
})();

/* ---------------- time, chance ---------------- */

export function seoulNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

export function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
export function between(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
export function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function chars(s) { return [...String(s || '')].length; }
