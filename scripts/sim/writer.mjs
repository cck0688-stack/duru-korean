// DURU KOREAN — Community simulation: what the personas say
//
// Every word here is written by a model asked to sound like one
// particular learner — their language, their level of Korean, the
// things they care about — and then screened before it is posted:
// lengths are counted, anything that looks like contact details is
// refused, and on OpenAI the text goes through the moderation endpoint
// as well. A screen that fails twice drops the message rather than
// posting something that got through on the third try.

import { LANG_NAMES, DETECT, chars, pick } from './lib.mjs';

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

// How people actually type in each language's own online spaces:
// how they laugh, the emoticons and short forms they use. A Brazilian
// laughs "kkkk", a Mexican "jajaja", a Vietnamese ":))" — nobody but a
// Korean speaker types "ㅋㅋㅋ", and a post that does reads as written by
// someone who is not who it says it is.
export const LOCAL_STYLE = {
  en: 'Laugh with "lol", "haha" or "lmao"; short forms like "tbh", "ngl", "idk", "btw", "rn", "omg"; ' +
      'emoticons like ":)" ":D" or one emoji such as 😅 😭 🙏; lowercase starts and missing full stops are normal.',
  vi: 'Laugh with "haha", "hihi", "=))", ":))" or "kkk"; particles like "nha", "nè", "á", "ạ", "hen", "luôn"; ' +
      'short forms like "k" (không), "đc" (được), "mn" (mọi người), "ko", "vs" (với), "j" (gì), "cx" (cũng); ' +
      'emoticons ":3", "^^", ":((", "T.T".',
  es: 'Laugh with "jajaja", "jaja", "jsjs" or "xD"; short forms like "q" (que), "xq"/"pq" (porque), "tmb" (también), ' +
      '"x" (por), "bn" (bien), "ntp", "porfa"; often drops the opening ¿ and ¡ and some accents; emoticons ":)" ":(" "<3".',
  id: 'Laugh with "wkwkwk", "wkwk", "haha" or "awokawok"; particles "sih", "dong", "deh", "kok", "nih", "loh", "ya"; ' +
      'short forms "yg" (yang), "gk"/"ga" (tidak), "bgt" (banget), "udh" (sudah), "blm" (belum), "aja", "gmn" (gimana), ' +
      '"tp" (tapi), "bs" (bisa), "kak"/"gan"/"min" to address people; emoticons ":D", "^^", "🙏", "😭".',
  'pt-BR': 'Laugh with "kkkk", "kkkkk", "rsrs" or "hahaha"; short forms "vc" (você), "tb"/"tbm" (também), "pq" (porque), ' +
      '"q" (que), "mto" (muito), "blz" (beleza), "tmj", "mds" (meu deus), "né", "aff"; emoticons ":)", ":(", "<3", "😂", "🥲".',
  ko: 'Laugh with "ㅋㅋㅋ" or "ㅎㅎ"; "ㅠㅠ"/"ㅜㅜ" for sad; short forms like "넘" (너무), "진짜", "ㄹㅇ", "ㄱㅅ" (감사); ' +
      'casual endings (-요 or 반말 with friends), "~" at the end of a line.',
  ja: 'Laugh with "w", "www" or "笑"; kaomoji like "(^^)", "(^_^;)", "(´;ω;`)", "( ˘ω˘ )"; "〜" and "！" at the end; ' +
      'casual forms ("〜だよね", "〜かな", "〜してみた") mixed with polite ones; "ｗ" at the end of a line.',
  zh: 'Laugh with "哈哈哈", "hhh" or "233"; particles "啦", "嘛", "呀", "哦", "吧", "~"; net slang like "绝了", "yyds", ' +
      '"真的会谢", "太难了", "冲鸭"; emoticons "QAQ", "orz", "[捂脸]", "😂"; commas used freely instead of full stops.'
};

export function human(lang) {
  return [
    'Write like a real person typing on a phone in a forum in your own language: first person, informal,',
    'specific rather than generic, a little messy. Vary how you start — not every message opens with a',
    'greeting, and most do not. Real forum posts ramble a little, repeat a word, fix a thought mid-sentence,',
    'and have the odd typo. Never polished, never balanced like an essay.',
    '',
    'How people who write in your language type online — use this, naturally, not all of it at once:',
    LOCAL_STYLE[lang] || LOCAL_STYLE.en,
    lang === 'ko' ? '' : 'Never use Korean-style laughter or crying (ㅋㅋ, ㅎㅎ, ㅠㅠ, ㅜㅜ) — that is not how people in your language type.',
    '',
    'Learners of Korean often drop in a Korean word or phrase they are practising (in Hangul); do that',
    'sometimes, not always.',
    'Never: hashtags, bullet lists, headings, em dashes (—), semicolons, "Great question!", "I hope this helps",',
    '"feel free to", "journey", "delve", closing summaries, or thanking everyone at the end.'
  ].filter((x) => x !== null).join('\n');
}


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

// Where someone is from is never shown, nicknames included: no country,
// city or country code in them (maynang_hanoi, solecito_kr).
const PLACES = ['korea', 'coreia', 'corea', 'coree', 'seul', 'kr', 'kor', 'vn', 'vie', 'viet', 'vietnam', 'br', 'bra', 'brasil', 'brazil', 'es', 'esp',
  'spain', 'mx', 'mex', 'mexico', 'ar', 'arg', 'co', 'col', 'cl', 'pe', 'id', 'ind', 'indo', 'indonesia', 'jp', 'jpn',
  'japan', 'nihon', 'cn', 'chn', 'china', 'tw', 'hk', 'us', 'usa', 'uk', 'ph', 'th', 'in', 'my', 'sg', 'au', 'ca',
  'pt', 'hanoi', 'saigon', 'hcm', 'hcmc', 'danang', 'hue', 'seoul', 'busan', 'incheon', 'daegu', 'jeju', 'jakarta',
  'bandung', 'surabaya', 'bali', 'rio', 'sp', 'saopaulo', 'madrid', 'barcelona', 'bogota', 'lima', 'cdmx', 'tokyo',
  'osaka', 'kyoto', 'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'london', 'manila', 'sydney', 'toronto'];
const PLACE_WORDS = /서울|부산|한국|대구|제주|인천|東京|大阪|日本|北京|上海|中国|台湾|香港/;

export function placeless(nickname) {
  // Words and the separators between them, kept as they were written, so
  // "Mây Nắng" stays "Mây Nắng" and only the place goes.
  const bits = String(nickname || '').trim().split(/([_.\-\s]+)/);
  const kept = [];
  for (let i = 0; i < bits.length; i += 2) {
    const word = bits[i];
    if (!word || PLACES.includes(word.toLowerCase())) continue;
    if (kept.length) kept.push(bits[i - 1] || '');
    kept.push(word.replace(PLACE_WORDS, ''));
  }
  return kept.join('').replace(/^[_.\-\s]+|[_.\-\s]+$/g, '');
}

export function looksUnsafe(text) {
  return CONTACT.some((re) => re.test(text));
}

// OpenAI's moderation endpoint is free, so it stays in the screen
// whoever writes the text — the subscription included — as long as an
// OpenAI key is around.
async function moderated(cfg, text) {
  const key = cfg.name === 'openai' ? cfg.apiKey : process.env.OPENAI_API_KEY;
  if (!key) return false;
  const base = (cfg.name === 'openai' && cfg.baseUrl) || 'https://api.openai.com/v1';
  try {
    const res = await fetch(base.replace(/\/$/, '') + '/moderations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
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

// A writer writes in their own language. The site's own detector reads
// the text the way it will when the row is saved; if it says another
// language, the text is sent back. (Korean words quoted inside are fine
// — the detector looks past them.)
function wrongLanguage(body, lang) {
  const got = DETECT.detect(body);
  return got && got !== lang ? got : null;
}

export function fitted(body, min, max) {
  const cut = [...body].slice(0, max).join('');
  const re = /[.!?。！？…)\]]+["'”’)]?\s|\n/g;
  let end = -1, m;
  while ((m = re.exec(cut + ' '))) end = m.index + m[0].trimEnd().length;
  const out = end > 0 ? cut.slice(0, end).trim() : '';
  return chars(out) >= min ? out : body;
}

async function screened(cfg, make, min, max, what, lang) {
  let why = '';
  for (let i = 0; i < 3; i += 1) {
    let body = String((await make(why)) || '').trim();
    // A little long: end it at the last whole sentence that fits, the
    // way a person would stop typing, rather than ask all over again.
    if (chars(body) > max) body = fitted(body, min, max);
    const n = chars(body);
    if (n < min || n > max) { why = 'The last one was ' + n + ' characters; it must be between ' + min + ' and ' + max + '.'; continue; }
    if (lang && lang !== 'ko' && /[ㅋㅎㅠㅜ]{2,}/.test(body)) {
      why = 'The last one used Korean-style laughter or crying (ㅋㅋ, ㅎㅎ, ㅠㅠ). People who write in ' +
        LANG_NAMES[lang] + ' do not type that; use how they laugh instead.';
      continue;
    }
    // A semicolon between clauses, not the one inside a kaomoji (^_^;).
    if (/—|;\s+[^\s)]|I hope this helps|feel free to|Great question/i.test(body)) {
      why = 'The last one sounded written, not typed: no em dashes, no semicolons, no stock phrases.';
      continue;
    }
    const other = lang && wrongLanguage(body, lang);
    if (other && process.env.SIM_DEBUG) console.log('  (다른 언어로 판정: ' + other + ') ' + body);
    if (other) {
      why = 'The last one was written in ' + (LANG_NAMES[other] || other) + '. Write every sentence in ' +
        LANG_NAMES[lang] + ' only; a Korean word or two inside is fine, other languages are not.';
      continue;
    }
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
    '  No country, city, region or nationality in it, and no country codes like _kr or _vn.',
    '  Make them feel like real forum handles people pick: a word or two they like, a nickname, maybe a',
    '  number — varied in style, not all in the same pattern.',
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
    const nick = placeless(String(p.nickname || '').trim().slice(0, 40));
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
    human(persona.lang), '', SAFETY,
    '',
    'Posts already on the board — write about something different:',
    recent.slice(0, 30).map((r) => '- ' + r.slice(0, 80)).join('\n') || '(none yet)'
  ].join('\n');
  const schema = strict({ body: { type: 'string' } });
  return screened(cfg, async (why) => parse(await cfg.provider.chat(cfg, system + (why ? '\n\n' + why : ''),
    'Write the post.', schema), '글').body, 50, 400, '글', persona.lang);
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
    human(persona.lang), '', SAFETY
  ].join('\n');
  const schema = strict({ body: { type: 'string' } });
  return screened(cfg, async (why) => parse(await cfg.provider.chat(cfg, system + (why ? '\n\n' + why : ''),
    'The thread so far:\n\n' + shown + '\n\nWrite your reply.', schema), '답글').body, 20, 300, '답글', persona.lang);
}
