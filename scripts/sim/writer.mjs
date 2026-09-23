// DURU KOREAN — Community simulation: what the personas say
//
// Every word here is written by a model asked to sound like one
// particular learner — their language, their level of Korean, the
// things they care about — and then screened before it is posted:
// lengths are counted, anything that looks like contact details is
// refused, and on OpenAI the text goes through the moderation endpoint
// as well. A screen that fails twice drops the message rather than
// posting something that got through on the third try.

import { LANG_NAMES, chars, pick } from './lib.mjs';

const WORDS = ['apple', 'river', 'maple', 'cloud', 'tiger', 'lemon', 'ocean', 'pencil', 'garden', 'rocket',
  'forest', 'candle', 'silver', 'harbor', 'violet', 'meadow', 'window', 'bridge', 'coffee', 'summer',
  'winter', 'autumn', 'spring', 'planet', 'island', 'falcon', 'button', 'marble', 'rabbit', 'orange',
  'pepper', 'breeze', 'castle', 'dragon', 'feather', 'galaxy', 'honey', 'jungle', 'kitten', 'ladder',
  'mango', 'noodle', 'olive', 'pillow', 'quartz', 'ribbon', 'saddle', 'tulip', 'velvet', 'walnut',
  'yellow', 'zebra', 'anchor', 'basket', 'cherry', 'dolphin', 'engine', 'fossil', 'guitar', 'helmet',
  'jacket', 'kettle', 'lantern', 'mirror', 'needle', 'otter', 'parrot', 'puzzle', 'rainbow', 'sparrow',
  'thunder', 'umbrella', 'valley', 'whistle', 'blossom', 'compass', 'daisy', 'ember', 'glacier', 'hazel'];

// An English word and five digits, on example.com — a domain reserved
// so that nothing sent to it reaches anybody.
export function emailFor(taken) {
  for (;;) {
    const e = pick(WORDS) + String(10000 + Math.floor(Math.random() * 90000)) + '@example.com';
    if (!taken.has(e)) { taken.add(e); return e; }
  }
}

export const TOPIC_BRIEF = {
  ask: 'Ask & Help — a real question about learning Korean or everyday life in Korea, asked by someone who wants an answer.',
  share: 'Share & Talk — sharing something: a study method that worked, a funny mistake, a small moment from life in Korea, a Korean word they love.',
  meet: 'Meet & Connect — looking for someone to practise with or study alongside, online: a language exchange partner, a study buddy, a reading group.'
};

const SAFETY = [
  'Hard rules — never break these:',
  '- Only harmless topics: learning Korean, and ordinary everyday life in Korea.',
  '- Nothing illegal, nothing discriminatory or insulting about any group, no politics or religion arguments.',
  '- No personal information of any kind: no real full names, emails, phone numbers, addresses, school or',
  '  company names, social media handles, KakaoTalk IDs, links or places to meet in person.',
  '- Meeting up means online only. Never suggest meeting in person or sharing contact details; say "let\'s',
  '  practise here in the comments" or similar.',
  '- No risky advice: for health, visas, law or money, say to check the official source or ask a professional.',
  '- Do not say which country you are from or your nationality. You may mention the language you speak.',
  '- Never mention being an AI, a model, a simulation or a persona.'
].join('\n');

const HUMAN = [
  'Write like a real person typing on a phone in a forum: first person, natural, a little informal,',
  'specific rather than generic. Vary how you start — not every message opens with a greeting.',
  'No hashtags, no bullet lists, at most one emoji and often none. Learners of Korean often drop in a',
  'Korean word or phrase they are practising; do that sometimes, not always.'
].join('\n');

function strict(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function parse(text, what) {
  try { return JSON.parse(text); } catch (e) { throw new Error(what + ': JSON 이 아닌 답'); }
}

/* ---------------- the screen ---------------- */

const CONTACT = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,                 // an email
  /https?:\/\/|www\.|\.(com|net|org|kr|io)\b/i,  // a link
  /(?:\+?\d[\s-]?){8,}/,                       // a phone number
  /(^|\s)@[a-z0-9_.]{3,}/i,                    // a handle
  /kakao|카톡|line id|whatsapp|instagram|telegram|wechat|微信|zalo/i
];

export function looksUnsafe(text) {
  return CONTACT.some((re) => re.test(text));
}

async function moderated(cfg, text) {
  if (cfg.name !== 'openai' || !cfg.apiKey) return false;
  try {
    const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/moderations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) return false;          // the screen above still ran
    const data = await res.json();
    return !!(data.results && data.results[0] && data.results[0].flagged);
  } catch (e) {
    return false;
  }
}

async function screened(cfg, make, min, max, what) {
  let why = '';
  for (let i = 0; i < 3; i += 1) {
    const body = String((await make(why)) || '').trim();
    const n = chars(body);
    if (n < min || n > max) { why = 'The last one was ' + n + ' characters; it must be between ' + min + ' and ' + max + '.'; continue; }
    if (looksUnsafe(body)) { why = 'The last one contained contact details or a link. Leave all of that out.'; continue; }
    if (await moderated(cfg, body)) { why = 'The last one was not appropriate for a friendly learners\' forum.'; continue; }
    return body;
  }
  throw new Error(what + ': 기준을 통과한 글을 받지 못했습니다 (' + why + ')');
}

/* ---------------- people ---------------- */

export async function inventPeople(cfg, langs) {
  const system = [
    'You invent members for an online community of people learning Korean. For each language given,',
    'invent one member who writes in that language.',
    '',
    '- nickname: what they chose to be called on the forum, written in their own language and script',
    '  (Korean in Hangul, Japanese in Japanese, Chinese in Chinese characters, the others in Latin script',
    '  as people really write them). A forum handle, 2–16 characters, not a famous person, not a full real name.',
    '  Every nickname must be different.',
    '- voice: one English sentence for the writer only — their Korean level, what they are into, how they write',
    '  (e.g. "Beginner, loves K-dramas, writes short excited messages with small typos").',
    '  Do not mention nationality or country.',
    '',
    SAFETY
  ].join('\n');
  const item = strict({ lang: { type: 'string' }, nickname: { type: 'string' }, voice: { type: 'string' } });
  const schema = strict({ people: { type: 'array', items: item } });
  const out = parse(await cfg.provider.chat(cfg, system,
    'Languages, in order: ' + langs.map((l) => LANG_NAMES[l] + ' (' + l + ')').join(', ') + '.', schema), '회원');
  const people = Array.isArray(out.people) ? out.people : [];
  return langs.map((lang, i) => {
    const p = people.find((x) => x && x.lang === lang && !x.used) || people[i] || {};
    p.used = true;
    const nick = String(p.nickname || '').trim().slice(0, 40);
    return { lang, nickname: nick && !looksUnsafe(nick) ? nick : null, voice: String(p.voice || '').slice(0, 300) };
  });
}

/* ---------------- posts ---------------- */

export async function writePost(cfg, persona, recent) {
  const target = pick([60, 90, 120, 160, 200, 250, 300, 360, 390]);
  const system = [
    'You are ' + persona.nickname + ', a member of an online community of Korean learners.',
    'You write only in ' + LANG_NAMES[persona.lang] + '. About you (for your eyes only): ' + persona.voice,
    '',
    'Write your first post, in this section: ' + TOPIC_BRIEF[persona.topic],
    persona.topic === 'ask' ? 'Ask one clear question that other learners could actually answer.' : '',
    'Length: about ' + target + ' characters, and never under 50 or over 400.',
    '',
    HUMAN, '', SAFETY,
    '',
    'Posts already on the board — write about something different:',
    recent.slice(0, 30).map((r) => '- ' + r.slice(0, 80)).join('\n') || '(none yet)'
  ].join('\n');
  const schema = strict({ body: { type: 'string' } });
  return screened(cfg, async (why) => parse(await cfg.provider.chat(cfg, system + (why ? '\n\n' + why : ''),
    'Write the post.', schema), '글').body, 50, 400, '글');
}

/* ---------------- replies ---------------- */

export async function writeReply(cfg, persona, thread, target, category) {
  const shown = thread.map((m) => (m.id === target.id ? '>>> ' : '') +
    m.display_name + ' (' + LANG_NAMES[m.lang] + '): ' + m.body).join('\n\n');
  const isAuthor = thread[0] && thread[0].user_id === persona.user_id;
  const role = category === 'ask'
    ? (isAuthor
      ? 'You asked the question. Reply to the message marked >>> — thank them, say whether it helped, or ask a short follow-up.'
      : 'Answer the question, or add to the answer marked >>>, from your own experience. Be concretely helpful.')
    : 'Reply to the message marked >>> so the conversation carries on naturally — react, share your own experience, ask something back.';
  const system = [
    'You are ' + persona.nickname + ', a member of an online community of Korean learners.',
    'You write only in ' + LANG_NAMES[persona.lang] + ', even though others write in their own languages —',
    'the site translates for everyone. About you (for your eyes only): ' + persona.voice,
    '',
    'The section: ' + TOPIC_BRIEF[category],
    role,
    'Length: 20 to 300 characters. Short replies are fine.',
    '',
    HUMAN, '', SAFETY
  ].join('\n');
  const schema = strict({ body: { type: 'string' } });
  return screened(cfg, async (why) => parse(await cfg.provider.chat(cfg, system + (why ? '\n\n' + why : ''),
    'The thread so far:\n\n' + shown + '\n\nWrite your reply.', schema), '답글').body, 20, 300, '답글');
}
