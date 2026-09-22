// DURU KOREAN — what a draft has to clear before an admin sees it
//
// Sections 18, 27 and 51 of the spec. The rule that matters most is
// that none of this asks the model whether its own work is good enough:
// a model that has just written 430 characters will tell you it wrote
// 600. Everything here is counted, matched or looked up.
//
// check() returns the problems it found, in the model's own language,
// so a failed draft can be handed straight back with "fix these" rather
// than regenerated from nothing.

// Korean counts by character, including spaces — 공백 포함.
// [...s] rather than s.length so an emoji counts once, not twice.
export const len = (s) => [...String(s == null ? '' : s)].length;

export const LIMITS = {
  bodyMin: 500, bodyMax: 800,
  summaryMin: 80, summaryMax: 160,
  titleMin: 18, titleMax: 40,
  tagsMin: 5, tagsMax: 8,
  headingsMin: 2, headingsMax: 3,
  titleCandidatesMin: 5
};

// Section 11. Clickbait the spec bans outright.
const CLICKBAIT = [
  '충격', '충격적', '99%', '무조건', '절대', '비밀', '진실',
  '이것만 알면', '망합니다', '대박', '경악', '소름'
];

// Section 28. Openings and fillers that make every post read like the
// same machine wrote it. Banned at the start of a post; a single use
// deeper in is nobody's business.
const CLICHE_OPENINGS = [
  '안녕하세요', '오늘은', '이번 시간에는', '여러분', '자, 그럼',
  '오늘 알아볼', '지금부터'
];
const CLICHE_PHRASES = [
  '알아볼까요', '알아보겠습니다', '함께 알아보아요', '알아보도록 하겠습니다',
  '정말 재미있죠', '꼭 기억해 주세요', '도움이 되셨길', '마무리하겠습니다'
];

// Section 15. Tags so general they file nothing.
const WEAK_TAGS = [
  '한국', '정보', '좋은정보', '추천', '블로그', '일상', '꿀팁', '팁',
  'korea', 'info', 'blog', 'tips'
];

const SLUG_OK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function headingsIn(body) {
  return String(body || '').split('\n')
    .filter((line) => /^\s*#{2,3}\s+\S/.test(line)).length;
}

function firstParagraph(body) {
  return String(body || '').split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !/^\s*#{1,6}\s/.test(p))[0] || '';
}

function hits(text, needles) {
  const lower = String(text || '').toLowerCase();
  return needles.filter((n) => lower.includes(n.toLowerCase()));
}

// `existing` is what the database already holds: { titles: [], slugs: [] }.
// Both are compared loosely — a title that differs by a particle is the
// same title.
const loose = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}]/gu, '');

export function check(draft, existing) {
  const have = existing || {};
  const titles = (have.titles || []).map(loose);
  const slugs = have.slugs || [];
  const problems = [];
  const say = (field, message) => problems.push({ field, message });

  const title = String(draft.title || '').trim();
  if (!title) say('title', '제목이 비어 있습니다.');
  else {
    if (len(title) < LIMITS.titleMin || len(title) > LIMITS.titleMax) {
      say('title', `제목은 ${LIMITS.titleMin}~${LIMITS.titleMax}자로 써 주세요. 지금은 ${len(title)}자입니다.`);
    }
    if (titles.includes(loose(title))) {
      say('title', '이미 같은 제목의 글이 있습니다. 다른 각도로 다시 잡아 주세요.');
    }
    const bait = hits(title, CLICKBAIT);
    if (bait.length) {
      say('title', `과장된 표현은 쓰지 않습니다: ${bait.join(', ')}`);
    }
  }

  const candidates = Array.isArray(draft.titleCandidates) ? draft.titleCandidates : [];
  if (candidates.length < LIMITS.titleCandidatesMin) {
    say('titleCandidates', `제목 후보를 ${LIMITS.titleCandidatesMin}개 이상 주세요. 지금은 ${candidates.length}개입니다.`);
  }

  const summary = String(draft.summary || '').trim();
  if (!summary) say('summary', '요약이 비어 있습니다.');
  else if (len(summary) < LIMITS.summaryMin || len(summary) > LIMITS.summaryMax) {
    say('summary', `요약은 ${LIMITS.summaryMin}~${LIMITS.summaryMax}자로 써 주세요. 지금은 ${len(summary)}자입니다.`);
  } else if (loose(summary).includes(loose(title)) && len(title) > 10) {
    say('summary', '요약이 제목을 그대로 반복합니다. 본문에서 무엇을 얻는지 쓰세요.');
  }

  const body = String(draft.content || '').trim();
  const bodyLen = len(body);
  if (!body) say('content', '본문이 비어 있습니다.');
  else {
    if (bodyLen < LIMITS.bodyMin) {
      say('content', `본문이 ${bodyLen}자입니다. ${LIMITS.bodyMin}자 이상이 되도록 내용을 더해 주세요.`);
    } else if (bodyLen > LIMITS.bodyMax) {
      say('content', `본문이 ${bodyLen}자입니다. ${LIMITS.bodyMax}자 이하로 줄여 주세요.`);
    }
    const heads = headingsIn(body);
    if (heads < LIMITS.headingsMin || heads > LIMITS.headingsMax) {
      say('content', `소제목은 ${LIMITS.headingsMin}~${LIMITS.headingsMax}개가 좋습니다. 지금은 ${heads}개입니다. (## 로 표시)`);
    }
    const opening = firstParagraph(body);
    const stale = CLICHE_OPENINGS.filter((c) => opening.startsWith(c));
    if (stale.length) {
      say('content', `첫 문단을 "${stale[0]}"로 시작하지 마세요. 독자가 실제로 겪는 상황이나 궁금증으로 여세요.`);
    }
    const filler = hits(body, CLICHE_PHRASES);
    if (filler.length) {
      say('content', `상투적인 표현을 빼 주세요: ${filler.join(', ')}`);
    }
  }

  const tags = Array.isArray(draft.tags) ? draft.tags.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (tags.length < LIMITS.tagsMin || tags.length > LIMITS.tagsMax) {
    say('tags', `태그는 ${LIMITS.tagsMin}~${LIMITS.tagsMax}개입니다. 지금은 ${tags.length}개입니다.`);
  }
  const seen = new Set();
  const repeated = tags.filter((x) => {
    const key = loose(x);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (repeated.length) say('tags', `같은 태그가 중복됩니다: ${repeated.join(', ')}`);
  const weak = tags.filter((x) => WEAK_TAGS.includes(loose(x)));
  if (weak.length) say('tags', `너무 일반적인 태그는 빼 주세요: ${weak.join(', ')}`);

  const slug = String(draft.slug || '').trim();
  if (!slug) say('slug', 'slug가 비어 있습니다.');
  else {
    if (!SLUG_OK.test(slug)) say('slug', 'slug는 영문 소문자, 숫자, 하이픈만 씁니다.');
    if (slug.length > 60) say('slug', 'slug가 너무 깁니다. 60자 이내로 줄여 주세요.');
    if (slugs.includes(slug)) say('slug', '같은 slug가 이미 있습니다. 다른 표현으로 바꿔 주세요.');
  }

  if (!String(draft.topic || '').trim()) say('topic', '어떤 주제를 골랐는지 topic에 적어 주세요.');

  return problems;
}

// What gets handed back to the model when check() found something.
export function repairNote(problems) {
  return problems.map((p) => `- ${p.field}: ${p.message}`).join('\n');
}
