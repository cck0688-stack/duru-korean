// DURU KOREAN — sample posts on the LIVE Community
//
// The owner asked for the invented members' writing to appear on the
// real site too, and, later, for the "Sample" badge to be shown to
// admins only until they say otherwise. So:
//
//   - Every row it writes has is_sample = true (supabase/schema.sql
//     §39). The Community page shows a "Sample" badge on it to admins
//     only; visitors see no mark. The column stays, so every sample
//     can be found and removed at once.
//   - It writes through the site's bot account (DURU_BOT_EMAIL, the
//     one the blog and worksheet runs already use), with one display
//     name per sample writer — no sign-ups, no invented addresses in
//     the live project's Auth, nothing added to the member count.
//   - Sample writers talk only in sample threads. They never reply to a
//     real member's post and never heart one, so no real person gets an
//     answer, or a heart, from someone who does not exist.
//   - Hearts go through the anonymous heart path, one reader id per
//     sample writer.
//
// The daily check of what these threads look like to readers of each
// language is verify-live.mjs. The test-project simulation (run.mjs) is
// separate and off unless SIM_TEST is on; this one only ever talks to
// the project named in js/supabase-config.js, and refuses any other.
//
//   SUPABASE_URL, SUPABASE_ANON_KEY    the live project (already set)
//   DURU_BOT_EMAIL, DURU_BOT_PASSWORD  the bot account (already set)
//
//   node scripts/sim/live.mjs [--dry-run] [--signups=N] [--replies=N] [--likes=N]

import crypto from 'node:crypto';
import { resolveProvider } from '../../api/_providers.js';
import { withPatience } from '../lib/patiently.mjs';
import { useSubscription, subscriptionAccount } from '../lib/claude-code.mjs';
import { liveProject, DETECT, LANGS, TOPICS, seoulNow, pick, between, shuffle, log } from './lib.mjs';
import { inventPeople, writePost, writeReply, placeless } from './writer.mjs';
import { balanced, chooseThread, threadOf } from './run.mjs';

const ONLINE = 8;
// Owner, 2026-10-20: days that went without posts are filled in, dated by that day's plan.
const BACKFILL = process.env.BACKFILL_DATE || '';
const plannedAt = (date, minute) => new Date(Date.parse(date + 'T00:00:00+09:00') + (minute * 60 + Math.floor(Math.random() * 60)) * 1000).toISOString();
const THREAD_DAYS = 10;


// ── the day's plan (owner, 2026-10-12): three to five people write a day,
// a hundred characters, two hundred, three hundred — all sorts — and they
// come in at irregular times, never at a fixed rhythm. The plan comes from
// the date, so every run of the day reads the same one.
function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CENTRES = [[70, 1], [100, 3], [130, 1.5], [160, 1.5], [200, 3], [240, 1.5], [300, 3], [360, 1]];
export function dayPlan(date) {
  const r = rng('duru-day:' + date);
  const n = r() < 0.34 ? 3 : r() < 0.5 ? 4 : 5;
  const when = [];
  for (let guard = 0; when.length < n && guard < 200; guard += 1) {
    const m = 540 + Math.floor(r() * 870);           // 09:00 – 23:30
    if (when.every((x) => Math.abs(x - m) >= 25)) when.push(m);
  }
  when.sort((a, b) => a - b);
  const total = CENTRES.reduce((x, c) => x + c[1], 0);
  return when.map((minute) => {
    let k = r() * total, centre = CENTRES[0][0];
    for (const c of CENTRES) { k -= c[1]; if (k < 0) { centre = c[0]; break; } }
    centre = Math.round(centre * (0.9 + r() * 0.2));
    return { minute, min: Math.round(centre * 0.78), max: Math.round(centre * 1.22), centre };
  });
}

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? Number(hit.slice(name.length + 3)) : null;
};
const DRY = args.includes('--dry-run');

export function liveEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = String(env.SUPABASE_ANON_KEY || '');
  const email = String(env.DURU_BOT_EMAIL || '');
  const password = String(env.DURU_BOT_PASSWORD || '');
  const missing = [!url && 'SUPABASE_URL', !anon && 'SUPABASE_ANON_KEY',
    !email && 'DURU_BOT_EMAIL', !password && 'DURU_BOT_PASSWORD'].filter(Boolean);
  if (missing.length) throw new Error('설정이 없습니다: ' + missing.join(', '));
  // Only the site's own project: the address the pages themselves use.
  if (url !== liveProject()) {
    throw new Error('거부: SUPABASE_URL 이 js/supabase-config.js 의 사이트 주소와 다릅니다.');
  }
  return { url, anon, email, password };
}

export function client(env, token) {
  return async function call(p, init = {}) {
    let last;
    for (let i = 0; i < 3; i += 1) {
      try {
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
        if (!res.ok) {
          const err = new Error(p.split('?')[0] + ' ' + res.status + ': ' + text.slice(0, 200));
          if (res.status < 500 && res.status !== 429) throw Object.assign(err, { final: true });
          throw err;
        }
        return text ? JSON.parse(text) : null;
      } catch (err) {
        last = err;
        if (err.final) throw err;
        await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
      }
    }
    throw last;
  };
}

export async function signInBot(env) {
  const res = await fetch(env.url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.anon },
    body: JSON.stringify({ email: env.email, password: env.password })
  });
  const body = await res.json().catch(() => ({}));
  // Never the password, and never the token.
  if (!res.ok || !body.access_token) throw new Error('봇 계정 로그인 실패 (' + res.status + ').');
  return { token: body.access_token, userId: body.user && body.user.id };
}

// The one lock this side needs: the live database must have been given
// §39, which is what marks these rows as samples. Without it
// they would appear unlabelled, so nothing is written.
async function assertLabelled(call) {
  try {
    await call('stories?select=id,is_sample&limit=1');
    await call('sample_personas?select=id&limit=1');
  } catch (err) {
    throw new Error('거부: 운영 데이터베이스에 schema.sql §39 (예시 글 표시)가 아직 없습니다. ' +
      'Supabase SQL Editor 에서 §39 를 먼저 실행하세요. (' + err.message + ')');
  }
}

function anonIdFor(nickname) {
  return 'sample-' + crypto.createHash('sha256').update('duru-sample:' + nickname).digest('hex').slice(0, 24);
}

export async function tick() {
  const env = liveEnv();
  const bot = await signInBot(env);
  const call = client(env, bot.token);
  const anon = client(env);
  await assertLabelled(call);

  const cfg = withPatience(useSubscription(process.env, 'SIM_PROVIDER')
    ? subscriptionAccount(process.env.SIM_MODEL || 'sonnet')
    : resolveProvider(process.env), log);
  cfg.effort = 'low';
  cfg.timeoutMs = 180000;
  log('작성: ' + cfg.label + ' / ' + cfg.model);

  const now = BACKFILL ? { date: BACKFILL, hour: 23, minute: 59 } : seoulNow();
  log('실제 사이트 예시 글 — ' + now.date + ' ' + now.hour + ':' + String(now.minute).padStart(2, '0') +
      ' (서울)' + (DRY ? ' (연습)' : ''));

  const personas = await call('sample_personas?select=*&order=created_at.asc&limit=5000');
  const byNick = new Map(personas.map((p) => [p.nickname, p]));

  /* 0. names with a place in them are put right, posts included */
  if (!DRY) {
    for (const p of personas) {
      const clean = placeless(p.nickname);
      if (!clean || clean === p.nickname || byNick.has(clean)) continue;
      try {
        await call('sample_personas?id=eq.' + p.id, { method: 'PATCH', body: JSON.stringify({ nickname: clean }) });
        await call('stories?is_sample=is.true&display_name=eq.' + encodeURIComponent(p.nickname),
          { method: 'PATCH', body: JSON.stringify({ display_name: clean }) });
        log('  이름 고침: ' + p.nickname + ' → ' + clean);
        byNick.delete(p.nickname); p.nickname = clean; byNick.set(clean, p);
      } catch (err) { log('  이름 고침 실패 · ' + p.nickname + ' — ' + err.message); }
    }
  }

  /* 1. the day's writers: three to five, one at a time, at irregular times */
  const plan = dayPlan(now.date);
  const nowMin = now.hour * 60 + now.minute;
  const arrived = plan.filter((x) => x.minute <= nowMin).length;
  const joinedToday = personas.filter((p) => p.joined_on === now.date).length;
  log('오늘 계획: ' + plan.length + '명 · 들어오는 시각 ' + plan.map((x) => String(Math.floor(x.minute / 60)).padStart(2, '0') + ':' + String(x.minute % 60).padStart(2, '0')).join(', ') +
      ' · 글자 수 ' + plan.map((x) => x.min + '~' + x.max).join(', ') + ' · 지금까지 ' + joinedToday + '명');
  // Only one new person per run, so a late run does not post them all at once.
  const due = flag('signups') ?? (BACKFILL ? Math.max(0, plan.length - joinedToday) : arrived > joinedToday ? 1 : 0);
  if (due > 0) {
    const langs = balanced(personas, due, 'lang', LANGS);
    const topics = balanced(personas, due, 'topic', TOPICS);
    // The pool is large now: show the model the names in use and ask again before giving up.
    const inUse = [...byNick.keys()].sort(() => Math.random() - 0.5).slice(0, 150);
    let people = await inventPeople(cfg, langs, inUse);
    for (let again = 0; again < 2 && people.some((w) => !w.nickname || byNick.has(w.nickname)); again += 1) {
      const redo = await inventPeople(cfg, langs, inUse);
      people = people.map((w, k) => (!w.nickname || byNick.has(w.nickname)) ? redo[k] : w);
    }
    let made = 0;
    for (let i = 0; i < due; i += 1) {
      const who = people[i];
      if (!who.nickname || byNick.has(who.nickname)) { log('  건너뜀 — 닉네임이 없거나 겹칩니다'); continue; }
      const row = { nickname: who.nickname, lang: who.lang, topic: topics[i], voice: who.voice,
                    anon_id: anonIdFor(who.nickname), joined_on: now.date };
      if (DRY) { log('  (연습) 예시 작성자: ' + row.nickname + ' · ' + row.lang + ' · ' + row.topic); continue; }
      try {
        const [saved] = await call('sample_personas', {
          method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row])
        });
        personas.push(saved); byNick.set(saved.nickname, saved); made += 1;
      } catch (err) { log('  작성자 저장 실패 — ' + err.message); }
    }
    log('새 예시 작성자: ' + made + '명 (오늘 ' + (joinedToday + made) + '/' + plan.length + ')');
  }

  /* 2. sample threads only — a real member's post is never touched */
  const since = new Date(Date.now() - THREAD_DAYS * 86400000).toISOString();
  const raw = await anon('stories?select=id,user_id,display_name,body,lang,category,parent_id,created_at' +
    '&is_sample=is.true&created_at=gte.' + since + '&order=created_at.asc&limit=5000');
  // Every sample row belongs to the bot account; for who-said-what the
  // writer is the display name, so give each row its writer's id.
  const stories = raw.map((s) => ({ ...s, user_id: (byNick.get(s.display_name) || {}).id || s.user_id }));

  // The language shown beside a post is the language it is written in.
  // Rows saved before the detector stopped calling any post with a
  // quoted Korean word "Korean" are corrected, and their translations
  // (made from the wrong source) are dropped so they are made again.
  for (const st of stories) {
    log('  · ' + (st.parent_id ? '  답글 ' : '글 ') + st.display_name + ' [' + st.lang + '] 감지=' + DETECT.detect(st.body));
  }
  if (!DRY) {
    for (const st of stories) {
      const writer = byNick.get(st.display_name);
      const right = DETECT.detect(st.body) || (writer && writer.lang) || st.lang;
      if (!right || right === st.lang) continue;
      try {
        await call('stories?id=eq.' + st.id, { method: 'PATCH', body: JSON.stringify({ lang: right, mt: {} }) });
        log('  언어 고침: ' + st.display_name + ' ' + st.lang + ' → ' + right);
        st.lang = right;
      } catch (err) { log('  언어 고침 실패 — ' + err.message); }
    }
  }

  // Whoever came in today and has not written yet writes now, a little
  // after the run starts (a random wait, so it is never on the same minute).
  const todays = personas.filter((p) => p.joined_on === now.date);
  const unposted = todays.filter((p) => !p.posted_at);
  const recent = stories.filter((s) => !s.parent_id).map((s) => s.body).reverse();
  let posted = 0;
  for (const p of unposted) {
    const slot = plan[Math.max(0, Math.min(plan.length - 1, todays.indexOf(p)))];
    const manner = { effort: { min: slot.min, max: slot.max, say: 'Aim for about ' + slot.centre + ' characters — ' +
      (slot.centre <= 110 ? 'a short post, one or two sentences.' : slot.centre <= 220 ? 'a few sentences.' : 'a fuller post with some detail.') } };
    try {
      if (!DRY && !BACKFILL && !flag('signups')) await new Promise((r) => setTimeout(r, between(0, 11 * 60) * 1000));
      const body = await writePost(cfg, { ...p, user_id: p.id }, recent, manner);
      if (DRY) { log('  (연습) 글 · ' + p.nickname + ' [' + p.lang + '/' + p.topic + ']: ' + body.slice(0, 60)); continue; }
      const at = BACKFILL ? plannedAt(now.date, slot.minute) : null;
      const row = await save(call, bot.userId, p, body, p.topic, null, at);
      await call('sample_personas?id=eq.' + p.id, {
        method: 'PATCH', body: JSON.stringify({ posted_at: at || new Date().toISOString() })
      });
      stories.push({ ...row, user_id: p.id }); recent.unshift(body); posted += 1;
      log('  글 · ' + p.nickname + ' [' + p.lang + '/' + p.topic + '] ' + [...body].length + '자 (목표 ' + slot.min + '~' + slot.max + ')');
    } catch (err) { log('  글 실패 · ' + p.nickname + ' — ' + err.message); }
  }

  /* 3. replies, among sample writers */
  // Only today's twenty are about: each writes the one post they came
  // to write, and it is they who answer and heart. Yesterday's people
  // do not come back — another day, other people.
  const members = personas.filter((p) => p.joined_on === now.date).map((p) => ({ ...p, user_id: p.id }));
  const online = shuffle(members).slice(0, ONLINE);
  const roots = stories.filter((s) => !s.parent_id);
  // Few people, so few answers, and not every run (irregular, never a rhythm).
  const replyCount = flag('replies') ?? (BACKFILL ? between(0, 2) : Math.random() < 0.07 ? between(1, 2) : 0);
  let replied = 0;
  for (let i = 0; i < replyCount && roots.length && online.length; i += 1) {
    const root = chooseThread(roots, stories);
    const thread = threadOf(root, stories);
    const target = Math.random() < 0.55 ? thread[thread.length - 1] : pick(thread);
    const author = members.find((p) => p.user_id === root.user_id);
    const pool = online.filter((p) => p.user_id !== target.user_id);
    const back = author && target.user_id !== author.user_id && Math.random() < 0.3 ? author : null;
    const who = back || pick(pool.length ? pool : online);
    if (!who || who.user_id === target.user_id) continue;
    try {
      const body = await writeReply(cfg, who, thread.map((m) => ({ ...m, lang: m.lang || 'en' })), target, root.category);
      if (DRY) { log('  (연습) 답글 · ' + who.nickname + ' → ' + target.display_name + ': ' + body.slice(0, 60)); continue; }
      const at = BACKFILL ? new Date(Math.min(Date.parse(target.created_at) + between(20, 180) * 60000, Date.parse(now.date + 'T23:30:00+09:00'))).toISOString() : null;
      const row = await save(call, bot.userId, who, body, root.category, target.id, at);
      stories.push({ ...row, user_id: who.user_id }); replied += 1;
      log('  답글 · ' + who.nickname + ' [' + who.lang + '] → ' + target.display_name + ' (' + root.category + ')');
    } catch (err) { log('  답글 실패 · ' + who.nickname + ' — ' + err.message); }
  }

  /* 4. hearts, on sample rows only, one anonymous reader id per writer */
  const likeCount = flag('likes') ?? (BACKFILL ? 0 : Math.random() < 0.15 ? between(1, 3) : 0);
  const likeable = stories.slice(-400);
  let liked = 0;
  for (let i = 0; i < likeCount && likeable.length && online.length; i += 1) {
    const who = pick(online);
    const item = pick(likeable);
    if (!item || item.user_id === who.user_id) continue;
    if (DRY) { liked += 1; continue; }
    try {
      const payload = JSON.stringify({ p_type: 'story', p_id: item.id, p_anon: who.anon_id });
      const state = await anon('rpc/content_like_state', { method: 'POST', body: payload });
      if (state && state[0] && state[0].liked) continue;
      await anon('rpc/toggle_content_like', { method: 'POST', body: payload });
      liked += 1;
    } catch (err) { log('  하트 실패 — ' + err.message); }
  }

  log('이번 차례: 글 ' + posted + ' · 답글 ' + replied + ' · 하트 ' + liked +
      ' · 예시 작성자 ' + personas.length + '명');
  return { posted, replied, liked, writers: personas.length };
}

async function save(call, botId, persona, body, category, parentId, createdAt) {
  const row = {
    user_id: botId,
    display_name: persona.nickname,
    body,
    category,
    lang: DETECT.detect(body) || persona.lang,
    is_sample: true,
    ...(parentId ? { parent_id: parentId } : {}),
    ...(createdAt ? { created_at: createdAt } : {})
  };
  const [saved] = await call('stories', {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row])
  });
  return saved;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  tick().catch((err) => { console.error(err.message || err); process.exit(1); });
}
