// DURU KOREAN — Community simulation: one tick
//
// Runs every twenty minutes, around the clock, against the TEST
// project only (see lib.mjs for the two locks). Each tick:
//
//   1. Sign-ups. Twenty new members a day, every day — the first tick
//      after midnight in Seoul brings in whoever is missing, so a
//      missed tick costs nothing. Each writes in one of the site's
//      eight languages, the least-represented ones first, and is given
//      one of the three topics.
//   2. Posts. Every member writes exactly one post, in their topic, in
//      their language. Today's newcomers are spread over the rest of
//      the day rather than all arriving at once.
//   3. Replies. A handful of members who are "online" this tick answer
//      questions and carry conversations on — today's threads mostly,
//      older ones too, and sometimes a reply to a reply. Each writes in
//      their own language; the site does the translating.
//   4. Hearts. Plenty of them, on posts and replies, never on one's own.
//
// Everything goes in the way the site itself would put it: the same
// columns, the language chosen by the site's own detector with the
// writer's language as the fallback — exactly what the composer does.
//
//   node scripts/sim/run.mjs tick [--dry-run] [--signups=N] [--replies=N] [--likes=N]

import { resolveProvider } from '../../api/_providers.js';
import { withPatience } from '../lib/patiently.mjs';
import { useSubscription, subscriptionAccount } from '../lib/claude-code.mjs';
import {
  simEnv, assertSimDatabase, rest, signUp, signIn, DETECT, LANGS, TOPICS,
  seoulNow, pick, between, shuffle, log
} from './lib.mjs';
import { emailFor, inventPeople, writePost, writeReply } from './writer.mjs';

const PER_DAY = 20;
const TICKS_PER_HOUR = 3;
const ONLINE = 8;                  // members "online" in one tick
const THREAD_DAYS = 10;            // how far back a reply may reach

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? Number(hit.slice(name.length + 3)) : null;
};
const DRY = args.includes('--dry-run');

export function balanced(personas, n, key, values) {
  const count = Object.fromEntries(values.map((v) => [v, 0]));
  personas.forEach((p) => { if (p[key] in count) count[p[key]] += 1; });
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const least = Math.min(...values.map((v) => count[v]));
    const v = pick(values.filter((x) => count[x] === least));
    count[v] += 1;
    out.push(v);
  }
  return out;
}

export async function tick() {
  const env = simEnv();
  await assertSimDatabase(env);
  // On the owner's Claude subscription when its token is here (see
  // lib/claude-code.mjs); otherwise an API key, as before.
  const cfg = withPatience(useSubscription(process.env, 'SIM_PROVIDER')
    ? subscriptionAccount(process.env.SIM_MODEL || 'sonnet')
    : resolveProvider(process.env), log);
  cfg.effort = 'low';
  cfg.timeoutMs = 180000;
  log('작성: ' + cfg.label + ' / ' + cfg.model);

  const anon = rest(env);
  const now = seoulNow();
  log('커뮤니티 시뮬레이션 — ' + now.date + ' ' + now.hour + ':' + String(now.minute).padStart(2, '0') +
      ' (서울)' + (DRY ? ' (연습)' : ''));

  let personas = await anon('sim_personas?select=*&order=created_at.asc&limit=5000');
  const sessions = new Map();          // user_id -> token
  const session = async (p) => {
    if (!sessions.has(p.user_id)) sessions.set(p.user_id, (await signIn(env, p.email)).token);
    return sessions.get(p.user_id);
  };

  /* 1. sign-ups */
  const joinedToday = personas.filter((p) => p.joined_on === now.date).length;
  const due = flag('signups') ?? Math.max(0, PER_DAY - joinedToday);
  if (due > 0) {
    const langs = balanced(personas, due, 'lang', LANGS);
    const topics = balanced(personas, due, 'topic', TOPICS);
    const people = await inventPeople(cfg, langs);
    const taken = new Set(personas.map((p) => p.email));
    const nicks = new Set(personas.map((p) => p.nickname));
    let made = 0;
    for (let i = 0; i < due; i += 1) {
      const who = people[i];
      if (!who.nickname || nicks.has(who.nickname)) { log('  가입 건너뜀 — 닉네임이 없거나 겹칩니다'); continue; }
      const email = emailFor(taken);
      if (DRY) { log('  (연습) 가입: ' + who.nickname + ' · ' + who.lang + ' · ' + topics[i] + ' · ' + email); continue; }
      try {
        const s = await signUp(env, email, { nickname: who.nickname });
        const call = rest(env, s.token);
        const row = { user_id: s.userId, email, nickname: who.nickname, lang: who.lang,
                      topic: topics[i], voice: who.voice, joined_on: now.date };
        await call('sim_personas', { method: 'POST', body: JSON.stringify([row]) });
        // The nickname the site's composer fills in for them.
        await call('user_profiles', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify([{ user_id: s.userId, nickname: who.nickname }])
        }).catch((e) => log('  (프로필 닉네임 저장 실패: ' + e.message + ')'));
        sessions.set(s.userId, s.token);
        personas.push({ ...row, posted_at: null });
        nicks.add(who.nickname);
        made += 1;
      } catch (err) {
        log('  가입 실패 — ' + err.message);
        if (/Confirm email/.test(err.message)) throw err;
      }
    }
    log('가입: ' + made + '명 (오늘 ' + (joinedToday + made) + '/' + PER_DAY + ')');
  }

  /* 2. posts */
  const since = new Date(Date.now() - THREAD_DAYS * 86400000).toISOString();
  const stories = await anon('stories?select=id,user_id,display_name,body,lang,category,parent_id,created_at' +
    '&created_at=gte.' + since + '&order=created_at.asc&limit=5000');
  const unposted = personas.filter((p) => !p.posted_at && p.joined_on <= now.date);
  const ticksLeft = Math.max(1, (24 - now.hour) * TICKS_PER_HOUR - Math.floor(now.minute / 20));
  const postsNow = Math.min(unposted.length, Math.ceil(unposted.length / ticksLeft));
  const recent = stories.filter((s) => !s.parent_id).map((s) => s.body).reverse();
  let posted = 0;
  for (const p of shuffle(unposted).slice(0, postsNow)) {
    try {
      const body = await writePost(cfg, p, recent);
      if (DRY) { log('  (연습) 글 · ' + p.nickname + ' [' + p.lang + '/' + p.topic + ']: ' + body.slice(0, 60)); continue; }
      const row = await save(env, await session(p), p, body, p.topic, null, 'post');
      await rest(env, await session(p))('sim_personas?user_id=eq.' + p.user_id, {
        method: 'PATCH', body: JSON.stringify({ posted_at: new Date().toISOString() })
      });
      stories.push(row); recent.unshift(body); posted += 1;
      log('  글 · ' + p.nickname + ' [' + p.lang + '/' + p.topic + '] ' + [...body].length + '자');
    } catch (err) { log('  글 실패 · ' + p.nickname + ' — ' + err.message); }
  }

  /* 3. who is online */
  const members = personas.filter((p) => p.joined_on <= now.date);
  const online = shuffle(members).slice(0, ONLINE);

  /* 4. replies */
  const roots = stories.filter((s) => !s.parent_id);
  const replyCount = flag('replies') ?? between(1, 3);
  let replied = 0;
  for (let i = 0; i < replyCount && roots.length && online.length; i += 1) {
    const root = chooseThread(roots, stories);
    const thread = threadOf(root, stories);
    // Mostly the newest word in the thread; sometimes the post itself.
    const target = Math.random() < 0.55 ? thread[thread.length - 1] : pick(thread);
    const author = personas.find((p) => p.user_id === root.user_id);
    // The person who asked comes back to answer the answers, now and then.
    const pool = online.filter((p) => p.user_id !== target.user_id);
    const back = author && target.user_id !== author.user_id && Math.random() < 0.3 ? author : null;
    const who = back || pick(pool.length ? pool : online);
    if (!who || who.user_id === target.user_id) continue;
    try {
      const body = await writeReply(cfg, who, thread.map((m) => ({ ...m, lang: m.lang || 'en' })), target, root.category);
      if (DRY) { log('  (연습) 답글 · ' + who.nickname + ' → ' + target.display_name + ': ' + body.slice(0, 60)); continue; }
      const row = await save(env, await session(who), who, body, root.category, target.id, 'reply');
      stories.push(row); replied += 1;
      log('  답글 · ' + who.nickname + ' [' + who.lang + '] → ' + target.display_name + ' (' + root.category + ')');
    } catch (err) { log('  답글 실패 · ' + who.nickname + ' — ' + err.message); }
  }

  /* 5. hearts */
  const likeCount = flag('likes') ?? between(4, 9);
  const likeable = stories.slice(-400);
  let liked = 0;
  for (let i = 0; i < likeCount && likeable.length && online.length; i += 1) {
    const who = pick(online);
    const item = pick(likeable);
    if (!item || item.user_id === who.user_id) continue;
    if (DRY) { liked += 1; continue; }
    try {
      const call = rest(env, await session(who));
      const state = await call('rpc/content_like_state', {
        method: 'POST', body: JSON.stringify({ p_type: 'story', p_id: item.id, p_anon: null })
      });
      if (state && state[0] && state[0].liked) continue;       // toggling again would take it back
      await call('rpc/toggle_content_like', {
        method: 'POST', body: JSON.stringify({ p_type: 'story', p_id: item.id, p_anon: null })
      });
      liked += 1;
    } catch (err) { log('  하트 실패 — ' + err.message); }
  }

  log('이번 차례: 글 ' + posted + ' · 답글 ' + replied + ' · 하트 ' + liked +
      ' · 온라인 ' + online.length + '명 · 회원 ' + personas.length + '명');
  return { posted, replied, liked, members: personas.length };
}

// Today's threads most of the time, older ones sometimes, and a
// question nobody has answered yet ahead of everything else.
export function chooseThread(roots, stories) {
  const replies = (id) => stories.filter((s) => s.parent_id === id).length;
  const hour = Date.now() - 3600000;
  const unanswered = roots.filter((r) => r.category === 'ask' && !replies(r.id) &&
                                        new Date(r.created_at).getTime() < hour);
  if (unanswered.length && Math.random() < 0.6) return pick(unanswered);
  const day = Date.now() - 86400000;
  const today = roots.filter((r) => new Date(r.created_at).getTime() > day);
  if (today.length && Math.random() < 0.65) return pick(today);
  return pick(roots);
}

export function threadOf(root, stories) {
  const out = [];
  (function walk(id) {
    const row = stories.find((s) => s.id === id);
    if (row) out.push(row);
    stories.filter((s) => s.parent_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((c) => walk(c.id));
  })(root.id);
  return out;
}

async function save(env, token, persona, body, category, parentId, kind) {
  const detected = DETECT.detect(body);
  const row = {
    user_id: persona.user_id,
    display_name: persona.nickname,
    body,
    category,
    // What the composer does: the detector's guess, or failing that the
    // language the writer reads the site in.
    lang: detected || persona.lang,
    ...(parentId ? { parent_id: parentId } : {})
  };
  const call = rest(env, token);
  const [saved] = await call('stories', {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row])
  });
  await call('sim_log', {
    method: 'POST',
    body: JSON.stringify([{ story_id: saved.id, user_id: persona.user_id, kind,
      intended_lang: persona.lang, detected_lang: detected, body_hash: DETECT.hashText(body) }])
  });
  return saved;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const cmd = args.find((a) => !a.startsWith('--')) || 'tick';
  if (cmd !== 'tick') { console.error('사용법: node scripts/sim/run.mjs tick [--dry-run]'); process.exit(2); }
  tick().catch((err) => { console.error(err.message || err); process.exit(1); });
}
