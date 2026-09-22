// DURU KOREAN — writing one post, in the order the spec asks for
//
// Three calls, not one, because section 8.1 is the whole point: the
// title is written *after* the body, from the body. Asking for both in
// one answer means the model writes a title first and then fills the
// article in behind it, which is how you get an article that does not
// quite say what its title promised.
//
//   1. pickTopic   candidates, scored, one chosen        (spec 5, 6)
//   2. writeBody   only the body, for that topic         (spec 17-21)
//   3. wrapUp      titles, summary, tags, slug, image    (spec 8-16)
//
// Nothing here talks to a database or to Supabase. It takes a provider
// config from api/_providers.js and returns a draft; the runner decides
// what to do with it.

import { check, repairNote, LIMITS } from './quality.mjs';

const schema = (strict, properties, required) => {
  const root = { type: 'object', properties, required };
  if (strict) root.additionalProperties = false;
  return root;
};

function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${what}: 모델이 JSON이 아닌 것을 돌려줬습니다.`);
  }
}

const READER = [
  '당신은 한국을 여행하거나 한국에서 생활하는 외국인을 위한 콘텐츠 에디터입니다.',
  '',
  '독자는 한국에 다른 나라에서 온 사람들입니다 — 닷새 머무는 여행자,',
  'D-2 비자로 온 유학생, 여섯 해째 사는 가족. 한국어를 잘 못하고,',
  '한국에서 자란 사람이라면 물어볼 필요도 없는 것들을 모릅니다.',
  '',
  '가장 중요한 것: 이 독자는 한국을 **견디는 법**이 아니라 **이해하는',
  '법**을 알고 싶어 합니다. 공항에서 시내 가는 법은 어느 가이드북에나',
  '있습니다. 그런 글은 읽히지 않습니다.',
  '',
  '읽히는 글은 이런 것입니다 — 한국 사람은 생각 없이 하는 일인데,',
  '밖에서 온 사람 눈에는 이상하거나 신기한 것. 그리고 그 뒤에 실제로',
  '이유가 있는 것.',
  '',
  '  · 식당에 들어가면 묻지도 않았는데 물과 반찬이 먼저 나오고, 반찬은',
  '    더 달라고 해도 공짜다 — 왜 그런가',
  '  · 카페에 노트북과 지갑을 두고 화장실에 간다 — 그게 왜 괜찮은가',
  '  · 처음 만난 사람이 나이를 묻는다 — 무례한 게 아니라 말투를 정하려는',
  '    것이다',
  '  · 배달 음식 그릇을 문 앞에 그냥 내놓는다',
  '  · 이사할 때 집 전체가 사다리차로 창문을 통해 올라간다',
  '',
  '이런 글은 실용적이면서 동시에 "아, 그래서 그랬구나" 하게 만듭니다.',
  '목표는 칸을 채우는 것이 아니라, 독자가 다 읽고 나서 한국을 조금 더',
  '알게 되었다고 느낄 글을 쓰는 것입니다.'
].join('\n');

// ── 1. what to write about ─────────────────────────────────────────

export async function pickTopic(cfg, opts) {
  const system = [
    READER,
    '',
    '지금은 주제를 고르는 단계입니다. 아직 본문을 쓰지 마세요.',
    '',
    `후보 주제를 ${opts.count || 4}개 만들고, 각각을 스스로 평가한 뒤,`,
    '가장 나은 하나를 고르세요.',
    '',
    '[좋은 주제]',
    '- 한국에서는 당연한 일인데, 밖에서 온 사람에게는 낯설거나 신기한 것.',
    '  이게 가장 중요합니다. 후보를 만들 때 스스로 물어보세요 —',
    '  "이걸 처음 본 외국인이 놀랄까, 아니면 당연하다고 생각할까?"',
    '- 그 뒤에 이유가 있는 것. 무엇을 하는지만이 아니라 왜 그런지 말할 수',
    '  있어야 합니다.',
    '- 구체적입니다. "한국 카페 문화"가 아니라 "카페에 노트북을 두고',
    '  화장실에 가도 되는 이유"입니다.',
    '- 500~800자 안에서 제대로 설명할 수 있습니다.',
    '- 틀린 정보를 쓸 위험이 낮습니다.',
    '',
    '[피할 주제]',
    '- **가이드북에 이미 있는 생존 요령.** "메뉴에 사진이 없을 때 주문하는',
    '  법", "지하철 타는 법", "공항에서 시내 가는 법", "환전하는 법" —',
    '  틀린 말은 아니지만 아무도 읽지 않습니다. 놀랄 것이 없기 때문입니다.',
    '- "한국 문화의 특징", "서울의 매력", "한국 음식이 인기 있는 이유"처럼',
    '  넓고 뻔한 것',
    '- 한국 사람에게도 새로운 것. 이 글은 한국을 설명하는 글이지 뉴스가',
    '  아닙니다.',
    '- 아래 "이미 쓴 글"과 사실상 같은 것',
    '- 비자·최저임금·요금·정책처럼 숫자나 제도가 바뀌는 것을 단정해야 하는 것.',
    '  이런 주제는 "어디서 확인하는지"를 알려 주는 글로 바꾸면 괜찮습니다.',
    '',
    '[실용적인 주제를 살리는 법]',
    '카테고리 때문에 실용적인 주제를 써야 한다면, 놀라운 지점을 찾아서',
    '거기서 시작하세요. "택시 잡는 법"은 뻔하지만 "한국 택시는 왜 빈 차에',
    '빨간 불이 켜져 있는가"는 읽힙니다. 같은 정보가 들어가지만 들어가는',
    '문이 다릅니다.',
    '',
    '[점수]',
    '각 후보에 1~10점을 매기세요. surpriseScore 는 "한국에서 자라지 않은',
    '사람이 이걸 처음 알았을 때 얼마나 놀랄까"입니다. 가이드북에 있는',
    '내용이면 1~3점입니다.',
    '',
    '총점이 가장 높은 것을 무조건 고르지 말고, surpriseScore 가 6점 미만인',
    '후보는 고르지 마세요. 그중에서 틀릴 위험이 낮고 기존 글과 겹치지 않는',
    '것을 고르세요.'
  ].join('\n');

  const user = [
    `카테고리: ${opts.category} — ${opts.about}`,
    '',
    `지금은 ${opts.month}월입니다. 이 무렵 한국에서 일어나는 일:`,
    ...opts.seasonNotes.map((n) => `- ${n}`),
    '',
    '이 카테고리에서 외국인이 자주 하는 질문:',
    ...opts.questions.map((q) => `- ${q}`),
    '',
    opts.existingTitles.length
      ? ['이미 쓴 글 (겹치지 마세요):', ...opts.existingTitles.map((t) => `- ${t}`)].join('\n')
      : '이 사이트에는 아직 글이 없습니다.',
    '',
    '계절 이야기를 억지로 넣을 필요는 없습니다. 지금 시기에 정말 도움이',
    '되는 주제가 있으면 그것을 먼저 고려하세요.'
  ].join('\n');

  const text = await cfg.provider.chat(cfg, system, user,
    schema(cfg.provider.strictSchema !== false, {
      candidates: {
        type: 'array',
        items: schema(cfg.provider.strictSchema !== false, {
          topic: { type: 'string' },
          why: { type: 'string' },
          interestScore: { type: 'integer' },
          usefulnessScore: { type: 'integer' },
          freshnessScore: { type: 'integer' },
          curiosityScore: { type: 'integer' },
          searchIntentScore: { type: 'integer' },
          uniquenessScore: { type: 'integer' },
          surpriseScore: { type: 'integer' }
        }, ['topic', 'why', 'interestScore', 'usefulnessScore', 'freshnessScore',
            'curiosityScore', 'searchIntentScore', 'uniquenessScore', 'surpriseScore'])
      },
      chosen: { type: 'string' },
      chosenReason: { type: 'string' }
    }, ['candidates', 'chosen', 'chosenReason']));

  const out = parse(text, '주제 선정');
  const candidates = Array.isArray(out.candidates) ? out.candidates : [];
  if (!candidates.length) throw new Error('주제 선정: 후보가 하나도 없습니다.');

  // The model names its pick; if it names one that is not on its own
  // list, the highest-scoring candidate stands in rather than failing
  // the category for a formatting slip.
  const chosen = candidates.find((c) => c.topic === out.chosen) ||
    candidates.slice().sort((a, b) => score(b) - score(a))[0];

  return { candidates, chosen: chosen.topic, reason: out.chosenReason || chosen.why, scores: score.parts(chosen) };
}

const SCORES = ['interestScore', 'usefulnessScore', 'freshnessScore',
                'curiosityScore', 'searchIntentScore', 'uniquenessScore',
                'surpriseScore'];

// Surprise counts twice. The whole complaint about the first week of
// posts was that they read like a guidebook — correct, useful, and not
// worth anyone's time. A topic that only scores well on usefulness is
// exactly that, and one extra weight is enough to let a slightly less
// "useful" but genuinely surprising topic win.
function score(c) {
  return SCORES.reduce((sum, k) => sum + (Number(c[k]) || 0), 0) +
    (Number(c.surpriseScore) || 0);
}
score.parts = (c) => SCORES.reduce((out, k) => {
  out[k] = Number(c[k]) || 0;
  return out;
}, {});

// ── 2. the body, and nothing else ──────────────────────────────────

const BODY_RULES = [
  '[본문 규칙]',
  '1. 한국어로 씁니다.',
  '2. 초등학교 3~4학년이 이해할 수 있는 쉬운 말을 씁니다.',
  '3. ~해요, ~랍니다 같은 친근한 말투를 씁니다.',
  `4. 공백을 포함해 ${LIMITS.bodyMin}~${LIMITS.bodyMax}자로 씁니다.`,
  '5. 소제목을 2~3개 넣습니다. 소제목 줄은 "## "로 시작합니다.',
  '6. 첫 문단은 독자가 실제로 겪는 상황이나 궁금증으로 엽니다.',
  '7. "안녕하세요", "오늘은 ~에 대해 알아보겠습니다"로 시작하지 않습니다.',
  '8. **왜 그런지를 반드시 설명합니다.** 무엇을 하는지만 나열한 글은',
  '   가이드북이고, 가이드북은 읽히지 않습니다. 한국 사람이 왜 그렇게',
  '   하는지 — 역사든, 아파트 구조든, 말투의 규칙이든 — 한 번은 말합니다.',
  '9. 독자가 바로 쓸 수 있는 것을 최소 하나는 넣습니다 — 어디서 하는지,',
  '   어떻게 하는지, 무엇을 조심해야 하는지.',
  '9-1. 번호를 매긴 목록은 한 덩어리에 5개를 넘기지 않습니다. 일곱 가지',
  '     방법을 늘어놓은 글보다, 두세 가지를 제대로 설명한 글이 낫습니다.',
  '10. 확인되지 않은 숫자나 제도를 지어내지 않습니다. 바뀔 수 있는 것은',
  '    "어디서 확인하면 되는지"로 씁니다.',
  '11. 제목은 쓰지 않습니다. 본문만 씁니다.'
].join('\n');

export async function writeBody(cfg, opts) {
  const system = [READER, '', '지금은 본문만 쓰는 단계입니다. 제목은 나중에 붙입니다.',
                  '', BODY_RULES].join('\n');
  const user = [
    `카테고리: ${opts.category} — ${opts.about}`,
    `주제: ${opts.topic}`,
    opts.reason ? `이 주제를 고른 이유: ${opts.reason}` : ''
  ].filter(Boolean).join('\n');

  const text = await cfg.provider.chat(cfg, system, user,
    schema(cfg.provider.strictSchema !== false,
      { content: { type: 'string' } }, ['content']));
  return String(parse(text, '본문 작성').content || '').trim();
}

// ── 3. everything that wraps the body ──────────────────────────────

const WRAP_RULES = [
  '[제목]',
  `제목 후보를 ${LIMITS.titleCandidatesMin}개 이상 만드세요. 질문형, 숫자형,`,
  '흔한 실수형, 문제 해결형, 의외의 사실형처럼 서로 다른 방식으로.',
  `제목은 ${LIMITS.titleMin}~${LIMITS.titleMax}자입니다.`,
  '제목은 본문이 실제로 말하는 것과 정확히 같아야 합니다.',
  '"충격", "99%가 모르는", "무조건", "절대", "비밀" 같은 말은 쓰지 않습니다.',
  '후보 중 가장 자연스럽고 읽고 싶어지는 것 하나를 고르세요.',
  '',
  '[요약]',
  `${LIMITS.summaryMin}~${LIMITS.summaryMax}자, 두세 문장.`,
  '제목을 그대로 반복하지 않습니다.',
  '본문에 없는 내용을 넣지 않습니다.',
  '이 글을 읽으면 무엇을 알게 되는지 씁니다.',
  '',
  '[태그]',
  `${LIMITS.tagsMin}~${LIMITS.tagsMax}개.`,
  '본문에 실제로 나오는 것만. 검색할 만한 말로.',
  '"한국", "정보", "추천", "블로그" 같은 말은 태그가 아닙니다.',
  '장소나 서비스 이름이 중요하면 넣으세요.',
  '',
  '[slug]',
  '영어 소문자와 하이픈만. 짧고 뜻이 통하게.',
  '예: seoul-subway-card-not-working',
  '',
  '[이미지 프롬프트]',
  '이 글을 한눈에 보여 줄 대표 이미지용 영어 프롬프트.',
  '글자, 로고, 워터마크가 나오지 않게 씁니다.'
].join('\n');

export async function wrapUp(cfg, opts) {
  const system = [READER, '', '본문은 이미 다 썼습니다. 이제 그 글에 붙일 것들을 만듭니다.',
                  '', WRAP_RULES].join('\n');
  const user = [
    `카테고리: ${opts.category}`,
    `주제: ${opts.topic}`,
    '',
    '본문:',
    opts.content
  ].join('\n');

  const text = await cfg.provider.chat(cfg, system, user,
    schema(cfg.provider.strictSchema !== false, {
      titleCandidates: { type: 'array', items: { type: 'string' } },
      title: { type: 'string' },
      summary: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      slug: { type: 'string' },
      imagePrompt: { type: 'string' }
    }, ['titleCandidates', 'title', 'summary', 'tags', 'slug', 'imagePrompt']));

  const out = parse(text, '제목·요약·태그');
  return {
    titleCandidates: (out.titleCandidates || []).map((x) => String(x || '').trim()).filter(Boolean),
    title: String(out.title || '').trim(),
    summary: String(out.summary || '').trim(),
    tags: (out.tags || []).map((x) => String(x || '').trim().replace(/^#+/, '')).filter(Boolean),
    slug: slugify(out.slug),
    imagePrompt: String(out.imagePrompt || '').trim()
  };
}

export function slugify(raw) {
  return String(raw || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

// A readable slug that is not taken. "-2", "-3" rather than a random
// suffix: the URL is for people, and a tail of noise helps nobody.
export function freeSlug(wanted, taken) {
  const base = slugify(wanted) || 'post';
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 50; n += 1) {
    const candidate = `${base}-${n}`.slice(0, 60).replace(/-+$/, '');
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`.slice(0, 60);
}

// ── 4. fixing what the checks caught ───────────────────────────────

export async function repair(cfg, draft, problems) {
  const system = [
    READER, '',
    '이미 쓴 글에 문제가 있습니다. 아래 지적을 모두 고쳐서 다시 주세요.',
    '지적되지 않은 부분은 그대로 두세요. 처음부터 다시 쓰지 마세요.',
    '', BODY_RULES, '', WRAP_RULES
  ].join('\n');

  const user = [
    '고쳐야 할 것:',
    repairNote(problems),
    '',
    '지금 글:',
    JSON.stringify({
      topic: draft.topic, title: draft.title, titleCandidates: draft.titleCandidates,
      summary: draft.summary, content: draft.content, tags: draft.tags, slug: draft.slug
    }, null, 2)
  ].join('\n');

  const text = await cfg.provider.chat(cfg, system, user,
    schema(cfg.provider.strictSchema !== false, {
      title: { type: 'string' },
      titleCandidates: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      slug: { type: 'string' }
    }, ['title', 'titleCandidates', 'summary', 'content', 'tags', 'slug']));

  const out = parse(text, '수정');
  return {
    ...draft,
    title: String(out.title || draft.title).trim(),
    titleCandidates: (out.titleCandidates || draft.titleCandidates || [])
      .map((x) => String(x || '').trim()).filter(Boolean),
    summary: String(out.summary || draft.summary).trim(),
    content: String(out.content || draft.content).trim(),
    tags: (out.tags || draft.tags || []).map((x) => String(x || '').trim().replace(/^#+/, '')).filter(Boolean),
    slug: slugify(out.slug) || draft.slug
  };
}

// ── the whole thing, for one category ──────────────────────────────

export async function writeOne(cfg, opts, log) {
  const note = log || (() => {});

  note('주제 고르는 중');
  const picked = await pickTopic(cfg, opts);
  note(`주제: ${picked.chosen}`);

  note('본문 쓰는 중');
  const content = await writeBody(cfg, { ...opts, topic: picked.chosen, reason: picked.reason });

  note('제목·요약·태그 만드는 중');
  const wrapped = await wrapUp(cfg, { ...opts, topic: picked.chosen, content: content });

  let draft = {
    category: opts.category,
    topic: picked.chosen,
    content: content,
    ...wrapped,
    candidates: picked.candidates,
    scores: picked.scores
  };

  // Section 51: a draft that fails the checks is handed back with the
  // list, not passed to the admin. Twice, then it is left failed —
  // a model that cannot count to 500 in two tries will not on the third.
  const rounds = opts.repairRounds == null ? 2 : opts.repairRounds;
  let problems = check(draft, opts.existing);
  for (let i = 0; i < rounds && problems.length; i += 1) {
    note(`검수에서 ${problems.length}가지 걸림 — 고치는 중 (${i + 1}회)`);
    draft = await repair(cfg, draft, problems);
    problems = check(draft, opts.existing);
  }

  draft.slug = freeSlug(draft.slug, (opts.existing && opts.existing.slugs) || []);
  draft.problems = problems;
  return draft;
}
