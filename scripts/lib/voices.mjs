// DURU KOREAN — thirty ways to write the same kind of post
//
// The first weeks of generated posts all read the same: a hook, three
// numbered things, a closing line. Each one was fine; seven a day of
// them is a machine, and a reader can hear it.
//
// So the shape of a post is picked before it is written, from thirty
// that are genuinely different — different openings, different spines,
// different places to stand. A post written as a single scene does not
// sound like one written as a myth being corrected, which does not
// sound like one written as a walk through a building.
//
// ── How one is picked ──────────────────────────────────────────────
//
// Not at random. Random repeats: with thirty shapes and seven posts a
// day, two of a morning's posts would share one about half the time.
// The index walks instead — day number times the number of shelves,
// plus which shelf this is. Within a morning every post gets a
// different shape; from one morning to the next every shelf moves on;
// and because 30 and 8 share only 2, a shelf does not see the same
// shape again for fifteen days.
//
// It is also reproducible, which matters when a draft comes out badly
// and the question is which shape produced it.

export const VOICES = [
  {
    id: 'scene',
    name: '한 장면으로 시작하기',
    how: [
      '실제로 일어날 법한 한 장면으로 시작하세요. 시간, 장소, 그 사람이',
      '무엇을 보고 있는지. 설명은 장면 다음에 옵니다.',
      '"어느 금요일 저녁 7시, 홍대 골목의 식당 문을 열고 들어섭니다."'
    ]
  },
  {
    id: 'myth',
    name: '흔한 오해를 바로잡기',
    how: [
      '외국인이 흔히 믿는 것 하나를 먼저 적고, 그게 왜 틀렸는지',
      '설명하세요. 비웃지 말고, 왜 그렇게 믿게 되는지도 짚어 주세요.'
    ]
  },
  {
    id: 'why-chain',
    name: '왜를 세 번 묻기',
    how: [
      '현상 하나를 말하고 "왜?"라고 묻고, 그 답에 다시 "왜?"라고 묻기를',
      '세 번 하세요. 세 번째 답이 이 글의 진짜 내용입니다.'
    ]
  },
  {
    id: 'compare',
    name: '바깥과 나란히 두기',
    how: [
      '독자의 나라에서는 어떻게 하는지를 한 문단, 한국에서는 어떻게',
      '하는지를 한 문단. 어느 쪽이 낫다는 말은 하지 마세요.'
    ]
  },
  {
    id: 'timeline',
    name: '시간 순서로 따라가기',
    how: [
      '처음부터 끝까지 순서대로 따라가세요. 도착해서, 그다음에, 그다음에.',
      '번호가 아니라 시간이 뼈대입니다.'
    ]
  },
  {
    id: 'mistake',
    name: '내가 했던 실수에서 출발하기',
    how: [
      '누군가 실제로 했을 법한 실수 하나를 먼저 보여 주고, 그때 무슨',
      '일이 일어나는지, 그리고 무엇을 알았어야 했는지 씁니다.'
    ]
  },
  {
    id: 'object',
    name: '사물 하나를 들여다보기',
    how: [
      '물건 하나로 글 전체를 끌고 가세요 — 영수증, 손잡이, 간판, 그릇.',
      '그 사물을 설명하면 그 뒤의 문화가 따라 나옵니다.'
    ]
  },
  {
    id: 'dialogue',
    name: '짧은 대화로 보여주기',
    how: [
      '두세 줄짜리 실제 대화를 한국어로 적고, 그 아래에서 그 대화의 각',
      '부분이 무엇을 하고 있는지 풀어 주세요.'
    ]
  },
  {
    id: 'numbers',
    name: '숫자 하나에서 시작하기',
    how: [
      '확실히 아는 숫자 하나로 시작하세요 — 시간, 거리, 개수. 지어내지',
      '말고, 확실하지 않으면 다른 방식을 쓰세요.'
    ]
  },
  {
    id: 'map',
    name: '공간을 따라 걷기',
    how: [
      '장소를 걸어 들어가듯 쓰세요. 문 앞, 들어서면, 왼쪽에, 안쪽에.',
      '독자가 머릿속에 지도를 그릴 수 있게.'
    ]
  },
  {
    id: 'before-after',
    name: '전과 후',
    how: [
      '예전에는 어땠고 지금은 어떤지. 무엇이 바뀌었고 무엇이 남았는지.',
      '옛날 이야기가 아니라 지금을 설명하기 위한 과거여야 합니다.'
    ]
  },
  {
    id: 'question-answer',
    name: '독자의 질문에 답하기',
    how: [
      '독자가 실제로 할 법한 질문을 소제목으로 쓰고 그 아래에서 답하세요.',
      '소제목이 질문, 본문이 답입니다.'
    ]
  },
  {
    id: 'cost',
    name: '값을 따져 보기',
    how: [
      '돈이든 시간이든 품이든, 드는 값을 놓고 이야기하세요. 정확한',
      '금액을 지어내지 말고 "어디서 확인하는지"로 쓰세요.'
    ]
  },
  {
    id: 'rule-exception',
    name: '규칙과 예외',
    how: [
      '규칙을 한 문장으로 먼저 말하고, 나머지는 그 규칙이 통하지 않는',
      '경우들에 쓰세요. 예외 쪽이 더 재미있습니다.'
    ]
  },
  {
    id: 'origin',
    name: '어쩌다 이렇게 됐는가',
    how: [
      '지금의 모습을 만든 이유를 찾아가세요 — 아파트 구조, 전쟁 뒤의',
      '사정, 법이 바뀐 해. 확실한 것만 쓰세요.'
    ]
  },
  {
    id: 'two-people',
    name: '두 사람의 하루',
    how: [
      '같은 상황을 두 사람이 어떻게 다르게 겪는지 보여 주세요 — 한국인',
      '한 명, 외국인 한 명. 둘 다 잘못한 게 없어야 합니다.'
    ]
  },
  {
    id: 'checklist',
    name: '문 나서기 전에',
    how: [
      '나가기 전에 확인할 것들로 쓰되, 각 항목마다 왜 그게 필요한지',
      '한 줄씩 붙이세요. 목록은 다섯 개를 넘기지 않습니다.'
    ]
  },
  {
    id: 'word',
    name: '낱말 하나 풀어내기',
    how: [
      '한국어 낱말 하나를 제목처럼 앞세우고, 그 말이 실제로 어떻게',
      '쓰이는지를 통해 문화를 설명하세요.'
    ]
  },
  {
    id: 'seasonal',
    name: '지금 이 계절이라서',
    how: [
      '지금 시기에만 일어나는 일에서 출발하세요. 날씨, 명절, 학기,',
      '이사철. 시기가 지나도 읽을 만한 내용이 남아야 합니다.'
    ]
  },
  {
    id: 'etiquette',
    name: '몰라서 무례해지는 지점',
    how: [
      '나쁜 뜻 없이 한 행동이 실례가 되는 지점을 짚고, 무엇을 하면',
      '되는지 알려 주세요. 겁주지 말고.'
    ]
  },
  {
    id: 'shortcut',
    name: '아는 사람만 하는 방법',
    how: [
      '한국 사람은 당연히 아는데 아무도 알려 주지 않는 방법 하나를',
      '중심에 두세요. 왜 아무도 말해 주지 않는지도 한 줄.'
    ]
  },
  {
    id: 'senses',
    name: '감각으로 쓰기',
    how: [
      '소리, 냄새, 온도, 손에 닿는 느낌으로 쓰세요. 정보는 그 감각을',
      '설명하는 과정에서 나옵니다.'
    ]
  },
  {
    id: 'faq-trap',
    name: '검색해도 안 나오는 것',
    how: [
      '검색하면 나오는 답을 먼저 한 줄로 정리하고, 그 답이 부족한',
      '이유와 실제로 알아야 하는 것을 쓰세요.'
    ]
  },
  {
    id: 'letter',
    name: '먼저 온 사람이 쓰는 편지',
    how: [
      '여섯 달 먼저 온 사람이 이제 막 도착한 사람에게 말하듯 쓰세요.',
      '가르치는 말투가 아니라 알려 주는 말투로.'
    ]
  },
  {
    id: 'anatomy',
    name: '뜯어보기',
    how: [
      '하나를 부분으로 나눠 각각이 무엇인지 설명하세요 — 영수증의 각 줄,',
      '계약서의 각 항목, 상의 각 그릇.'
    ]
  },
  {
    id: 'if-then',
    name: '이럴 땐 이렇게',
    how: [
      '두세 가지 상황을 놓고 각각 어떻게 하면 되는지 쓰세요. 상황이',
      '소제목이고, 판단 기준이 본문입니다.'
    ]
  },
  {
    id: 'counter',
    name: '나도 그렇게 생각했는데',
    how: [
      '글쓴이도 처음엔 그렇게 생각했다가 알고 보니 아니더라는 구조로',
      '쓰세요. 무엇이 생각을 바꿨는지가 핵심입니다.'
    ]
  },
  {
    id: 'unwritten',
    name: '아무도 적어두지 않은 규칙',
    how: [
      '어디에도 쓰여 있지 않은데 모두가 지키는 것을 찾아 적으세요.',
      '어기면 어떻게 되는지도 한 줄.'
    ]
  },
  {
    id: 'zoom-out',
    name: '작은 것에서 큰 것으로',
    how: [
      '아주 사소한 것 하나에서 시작해 그것이 사회의 무엇과 이어지는지로',
      '넓혀 가세요. 억지로 크게 만들지는 마세요.'
    ]
  },
  {
    id: 'practical-why',
    name: '방법 다음에 이유',
    how: [
      '앞의 절반은 무엇을 어떻게 하는지, 뒤의 절반은 왜 그렇게 되어',
      '있는지. 두 번째 절반이 이 글을 기억하게 만듭니다.'
    ]
  }
];

export const VOICE_COUNT = VOICES.length;

// The walking index described at the top of this file. `day` is any
// integer that moves by one each day — the runner passes the Seoul date
// as a day number — and `slot` is which shelf this is, 0-based.
export function pickVoice(day, slot, total) {
  const n = VOICES.length;
  const spread = Math.max(1, total || 1);
  const i = (((day * spread + slot) % n) + n) % n;
  return VOICES[i];
}

// A date as a day count, so consecutive days differ by one.
export function dayNumber(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}
