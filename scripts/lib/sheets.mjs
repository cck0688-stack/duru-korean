// DURU KOREAN — writing a worksheet
//
// The brief's §4 is the whole design of this file, and it is worth
// stating plainly because it is not the obvious way to build this:
//
//   The model is never shown somebody else's worksheet.
//
// It would be easy, and would produce better-looking output faster, to
// fetch a few existing Korean worksheets and have the model work from
// them. It would also be the thing §4.3 describes as not making a new
// resource at all — "단어 몇 개만 바꾸거나 문항 순서·색상·레이아웃만
// 바꾼 결과" — and the rights position would be somewhere between
// unclear and indefensible. So the model writes from what it knows
// about Korean, the way a teacher writing a handout does, and the
// sources recorded alongside are what a person should check the facts
// against. Nothing external is copied because nothing external is
// fetched.
//
// What this file does do about quality is refuse. A sheet whose Korean
// is thin, whose answers do not match its questions, or which repeats
// something already on the shelf comes back as an error rather than as
// a draft for somebody to notice later.

import { TranslateError } from '../../api/_providers.js';

const strict = (properties, required, isStrict) => {
  const root = { type: 'object', properties, required };
  if (isStrict) root.additionalProperties = false;
  return root;
};

function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(what + ': 모델이 JSON이 아닌 것을 돌려줬습니다.');
  }
}

// What each shelf is for, in the model's own working language. These
// are instructions to a writer, not descriptions for a reader — the
// reader-facing ones live in the site dictionaries.
export const SHELVES = {
  vocab: {
    what: '한 가지 상황이나 주제에 묶이는 낱말 8~12개와, 각각이 실제로 쓰이는 문장 하나.',
    shape: 'words'
  },
  reading: {
    what: '수준에 맞는 짧은 지문 3~5문단. 지어낸 이야기여도 좋지만 한국에서 실제로 있을 법해야 합니다. ' +
          '지문에 나온 어려운 낱말만 골라 낱말풀이를 붙입니다.',
    shape: 'passage'
  },
  grammar: {
    what: '문형 하나. 형태가 몇 가지로 갈리면 각각, 그리고 학습자가 실제로 틀리는 지점.',
    shape: 'forms'
  },
  reallife: {
    what: '한 장소에서 실제로 오가는 대화 6~10줄과, 그 안에서 건져 갈 표현들.',
    shape: 'dialogue'
  },
  hangul: {
    what: '글자 3~5개. 소리, 영어권 화자가 참고할 만한 비슷한 소리, 그리고 그 글자가 들어간 쉬운 낱말.',
    shape: 'letters'
  },
  etc: {
    what: '위 다섯 갈래에 들어가지 않는 실용 자료. 달력, 목록, 안내 같은 것.',
    shape: 'sections'
  }
};

const COMMON = [
  '당신은 한국어를 배우는 외국인을 위한 학습지를 만드는, 경력 많은 한국어 교사입니다.',
  '이 학습지는 사람이 검토한 뒤 실제 학습자에게 배포됩니다. 대충 만든 것은 검토에서 반려됩니다.',
  '',
  '지켜야 할 것:',
  '- 남의 학습지를 베끼거나 흉내 내지 마세요. 당신이 아는 한국어로 처음부터 만드세요.',
  '- 한국어는 실제로 쓰는 말이어야 합니다. 교과서에만 있고 아무도 안 쓰는 문장은 쓰지 마세요.',
  '- 맞춤법, 띄어쓰기, 조사(은/는, 이/가, 을/를)를 정확히 쓰세요. 한 글자 틀린 예문은 없는 것보다 나쁩니다.',
  '- 예문은 짧고, 그 낱말이 왜 필요한지 보여 주는 것이어야 합니다. 같은 문장 틀을 반복하지 마세요.',
  '- 영어 뜻풀이는 그 문장에서 쓰인 뜻이어야 합니다. 사전의 첫 번째 뜻을 그냥 옮기지 마세요.',
  '- 로마자 표기는 국어의 로마자 표기법(Revised Romanization)을 따르세요.',
  '- 수준을 지키세요. Beginner 에게 한자어 관용구를, Advanced 에게 인사말을 주지 마세요.',
  '- 확실하지 않은 사실(가격, 영업시간, 법, 통계)은 아예 쓰지 마세요. 지어내는 것보다 빼는 게 낫습니다.',
  '- 학습 목표는 하나로 좁게 잡으세요. "한국어 배우기" 같은 것은 목표가 아닙니다.',
  '- 문제는 학습 목표를 실제로 연습시키는 것이어야 하고, 그 학습지를 읽으면 풀 수 있어야 합니다.',
  '- 정답은 하나로 분명해야 합니다. 여러 답이 가능하면 대표 답을 쓰고 괄호에 다른 답을 적으세요.',
  '- 문제와 정답의 개수는 반드시 같아야 하고, 순서도 같아야 합니다.',
  '- 문제나 정답 앞에 번호를 붙이지 마세요. 번호는 학습지가 붙입니다.',
  '- 학습지에 들어가는 모든 칸(note, sections, watchOut 등)은 학습자에게 하는 말만 쓰세요. 검수, 수정, "고쳤습니다",',
  '  "지난번 검토" 같은 만드는 과정 이야기는 어디에도 쓰지 마세요. 사람에게 전할 말은 checkThese 에만 쓰세요.'
].join('\n');

// The shape the model must answer in — for one shelf, not for all six.
//
// It has to be one shelf at a time because of a rule that is easy to
// miss: a provider running a schema in strict mode requires every
// property to be listed as required. One schema covering all six
// shelves therefore cannot have optional fields, and a vocabulary
// sheet has no dialogue in it.
//
// The first version of this had twenty-six properties and seven
// required, which OpenAI answered with a 400 — reported, unhelpfully,
// as "that model is not available". Per-shelf schemas are smaller,
// strictly valid, and give the model a clearer target than a form with
// twenty fields it is meant to leave blank.
export function sheetSchema(category, isStrict) {
  const str = { type: 'string' };
  const strs = { type: 'array', items: str };

  const word = strict({
    korean: str, roman: str, meaning: str, example: str, exampleMeaning: str
  }, ['korean', 'roman', 'meaning', 'example', 'exampleMeaning'], isStrict);

  const shapes = {
    words: { words: { type: 'array', items: word } },
    passage: { passage: strs, words: { type: 'array', items: word } },
    forms: {
      forms: { type: 'array', items: strict({
        form: str, when: str, means: str, example: str, exampleMeaning: str, mark: strs
      }, ['form', 'when', 'means', 'example', 'exampleMeaning', 'mark'], isStrict) },
      watchOut: strs,
      watchOutMark: { type: 'array', items: strs }
    },
    dialogue: {
      setting: str,
      dialogue: { type: 'array', items: strict({
        who: str, korean: str, meaning: str
      }, ['who', 'korean', 'meaning'], isStrict) },
      words: { type: 'array', items: word }
    },
    letters: {
      letters: { type: 'array', items: strict({
        letter: str, sound: str, as: str
      }, ['letter', 'sound', 'as'], isStrict) },
      words: { type: 'array', items: word }
    },
    // The owner's kiosk design (2026-09-26): a section may be a flow of
    // steps, a list of numbered rows, or a tip set in a box. Unused
    // parts are empty.
    sections: {
      sections: { type: 'array', items: strict({
        heading: str, paragraphs: strs, box: { type: 'boolean' },
        steps: { type: 'array', items: strict({ ko: str, en: str }, ['ko', 'en'], isStrict) },
        items: { type: 'array', items: strict({ term: str, gloss: str, text: str, example: str },
          ['term', 'gloss', 'text', 'example'], isStrict) }
      }, ['heading', 'paragraphs', 'box', 'steps', 'items'], isStrict) },
      note: str
    }
  };

  const shape = shapes[(SHELVES[category] || SHELVES.etc).shape] || shapes.sections;

  // The line above the questions: what they ask the learner to do.
  const task = strict({ title: str, line: str }, ['title', 'line'], isStrict);

  const properties = Object.assign({
    title: str, keyword: str, summary: str, objective: str, level: str,
    minutes: { type: 'integer' }, tags: strs,
    task, exercises: strs, answers: strs, checkThese: strs
  }, shape);

  return strict(properties, Object.keys(properties), isStrict);
}

// Picks something the shelf has not got yet. The existing titles and
// objectives go in, so that "food vocabulary" is not written for the
// fifth time — §5.1 of the brief.
export async function pickSubject(cfg, opts) {
  const shelf = SHELVES[opts.category] || SHELVES.etc;
  const taken = (opts.existing || []).slice(0, 120);

  const system = [
    COMMON, '',
    '[이번 일]',
    '"' + opts.category + '" 갈래에 올릴 학습지 주제를 하나 고르세요.',
    '이 갈래에 들어가는 것: ' + shelf.what,
    '',
    '이미 자료실에 있는 것들입니다. 이것들과 겹치는 주제는 고르지 마세요 —',
    '제목만 다르고 배우는 내용이 같으면 겹치는 것입니다:',
    taken.length ? taken.map((t, i) => (i + 1) + '. ' + t).join('\n') : '(아직 없습니다)',
    '',
    '검색 순위가 아니라 학습에 실제로 쓸모 있는 것을 고르세요.',
    'checkThese 에는 사람이 게시 전에 사실 확인을 해야 할 항목을 적으세요.',
    '확인할 것이 없으면 빈 배열로 두세요.'
  ].join('\n');

  // Every property listed as required — see sheetSchema() for why a
  // strict schema cannot have an optional field. This is the first
  // call the run makes, so getting it wrong took the whole run down
  // before anything else was tried.
  const want = {
    subject: { type: 'string' },
    objective: { type: 'string' },
    level: { type: 'string' },
    why: { type: 'string' },
    checkThese: { type: 'array', items: { type: 'string' } }
  };
  const schema = strict(want, Object.keys(want), cfg.provider.strictSchema !== false);

  const out = await cfg.provider.chat(cfg, system,
    '갈래: ' + opts.category + '\n오늘 날짜: ' + (opts.today || ''),
    schema);
  const picked = parse(out, '주제 고르기');
  if (!picked.subject) throw new Error('주제 고르기: 주제가 비어 있습니다.');
  return picked;
}

// Writes the sheet itself.
export async function writeSheet(cfg, opts) {
  const shelf = SHELVES[opts.category] || SHELVES.etc;
  const system = [
    COMMON, '',
    '[이번 일]',
    '아래 주제로 학습지 한 장을 만드세요.',
    '이 갈래에 들어가는 것: ' + shelf.what,
    '',
    '반드시 채울 것: title, summary, objective, level, minutes, exercises, answers.',
    'title 은 한국어로, summary 와 objective 는 영어로 쓰세요.',
    '설명과 지시(뜻풀이, 발음 설명, 문형 설명, 문단의 설명, 문제의 지시문)는 모두 영어로. 한국어는 가르치는 것',
    '  (낱말, 문형, 예문, 공지문·대화 같은 읽기 자료)으로만 넣으세요.',
    '문제는 "영어 지시문: 한국어 부분" 형태로 (예: "Fill in the blank: 오늘 우유를 ____해요.").',
    'level 은 Beginner, Beginner (high), Intermediate (low), Intermediate, Advanced 중 하나.',
    '분량은 인쇄해서 A4 2쪽: 낱말·표현은 8~10개, 문제는 5~6개, 설명은 짧게.',
    'minutes 는 학습자가 이 학습지를 푸는 데 걸릴 시간입니다.',
    'keyword 는 내려받은 파일 이름에 쓸 영어 낱말 하나(또는 둘을 붙인 것)입니다. 소문자, 띄어쓰기 없이, 12자 이내.',
    '  예: bank, subway, openhours, pharmacy. 주제를 가장 짧게 말하는 낱말로.',
    'exercises 는 4~6개, answers 는 그와 정확히 같은 개수.',
    '문제는 예문·설명·목표에 이미 나온 문장이나 같은 문장 틀을 쓰지 말고 새 문장·새 낱말로 (학습지를 베끼기만 해도',
    '  풀리면 안 됩니다). 목표에서 약속한 규칙과 낱말은 모두 문제로 연습시키고, 정답이 한쪽(모두 No 등)으로 쏠리지 않게.',
    '정답에는 빈칸에 똑같이 맞는 다른 올바른 답(어순, 조사 이/은, 두고/놓고 등)도 함께 적거나, 답이 하나만 되도록',
    '  지시문을 좁히세요. 가르치지 않은 형태를 정답으로 받지는 마세요.',
    'task 는 문제 위 안내 상자입니다(영어). title 은 문제들이 시키는 일을 3~5 낱말로 (예: Choose the right word,',
    '  Fill in the blanks), line 은 어떻게 풀지 한 문장. 문제마다 하는 일이 다르면 모두를 아우르는 말로. 반드시 채우세요.',
    '',
    '[운영자 지침 — docs/WORKSHEET-MASTER-INSTRUCTION.md 의 요점]',
    '- 반드시 A4 2쪽. 2쪽에 넣으려고 글씨를 줄이지 않습니다. 내용을 페이지에 맞추세요: 중복 설명, 예문 수, 덜 중요한',
    '  정보, 긴 영어 설명, 문제 수 순으로 줄입니다. 빽빽하게 채우지 마세요.',
    '- title 은 짧고(한국어 30자 안팎) 실생활 상황이 드러나게. 문법 이름보다 상황 중심.',
    '  예: 카드 영수증 읽기: 얼마를, 어떻게 냈어요? / 약 봉투 읽기: 언제, 몇 번, 며칠 먹어요?',
    '- summary 는 영어 한 문장. objective 는 학습자가 이 학습지를 마친 뒤 할 수 있는 것을 1~2문장으로 (By the end, …).',
    '- 흐름: 배우기 → 이해 → 적용 → 문제 → 정답 확인. 1쪽은 배우는 내용, 2쪽은 연습(YOUR TURN)과 정답.',
    '- 한 개념에 핵심 설명 하나 + 실제 예문 하나면 충분합니다. 예문은 한국 생활에서 실제로 쓰는 문장.',
    '- 영어 설명은 짧고 쉬운 낱말로, 한국어보다 길어지지 않게. 학술적인 긴 문법 설명은 쓰지 마세요.',
    '- 문제는 보통 5개(4~6개). 정보 찾기, 상황 판단, 빈칸, 고르기, 순서 배열, 한국어로 답하기를 섞으세요.',
    '  문제 하나가 여러 상황을 묻는다면 "영어 지시문: ① 한국어 상황 ② 한국어 상황"처럼 ①②③으로 나눠 쓰세요',
    '  (학습지가 한 줄에 하나씩 보여 줍니다). 문제 문장은 너무 길지 않게.',
    '- 이모티콘, 장식용 그림 설명은 넣지 마세요. 성인 학습자용 전문 교재입니다.',
    '',
    '이 갈래에서 추가로 채울 것: ' + shelf.shape,
    ...(shelf.shape === 'forms'
      ? ['forms 의 mark 에는 example 문장 안에서 이 문형이 쓰인 어절을, example 에 적힌 그대로 베껴 넣으세요',
         '  (예: example "지금 커피를 마시는 사람이 제 친구예요." → mark ["마시는"]). 둘 이상이면 모두.',
         '  학습지에서 굵은 글씨와 밑줄로 표시됩니다.',
         'watchOutMark 는 watchOut 과 같은 순서, 같은 개수. 각 항목에서 틀린 말(X)과 맞는 말(O)의 핵심 어절을',
         '  그 항목에 적힌 그대로 (예: "맛있은 음식 (X) → 맛있는 음식 (O): …" → ["맛있은", "맛있는"]).']
      : []),
    ...(shelf.shape === 'sections'
      ? ['sections 는 1단 구성입니다. 각 section 에서 알맞은 하나를 쓰고 나머지는 비워 두세요:',
         '  - 순서가 있는 절차(주문, 접수, 신청 순서)는 steps: 4~6단계, ko 에 한국어 단계 이름, en 에 짧은 영어 뜻',
         '    (예: {"ko": "매장/포장", "en": "dine in/take out"}). paragraphs 와 items 는 비움.',
         '  - 버튼·표지·항목 목록은 items: 8~12개, term 에 한국어, gloss 에 짧은 영어 이름, text 에 하는 일을 영어 한 문장,',
         '    example 에 짧은 한국어 예문 (예: {"term": "포장", "gloss": "take out", "text": "Press it when you take the',
         '    food out.", "example": "바빠요? 그러면 포장을 고르세요."}).',
         '  - 읽는 팁이나 주의할 점은 paragraphs 1~2개에 box: true.',
         '  section 은 3개 안팎. note 에는 자료에 대한 짧은 안내 한 문장(없으면 빈 문자열).']
      : []),
    '',
    'checkThese 에는 게시 전에 사람이 확인해야 할 것을 적으세요.'
  ].join('\n');

  const user = [
    '갈래: ' + opts.category,
    '주제: ' + opts.subject,
    '학습 목표: ' + (opts.objective || ''),
    '수준: ' + (opts.level || 'Beginner')
  ].join('\n');

  const out = await cfg.provider.chat(cfg, system, user,
    sheetSchema(opts.category, cfg.provider.strictSchema !== false));
  const sheet = unnumbered(parse(out, '학습지 쓰기'));
  sheet.category = opts.category;
  return sheet;
}

// The template numbers the questions and the answers itself, and the
// model, asked for a list, numbers them too — so the first sheets went
// out reading "1. 1) 엄마 / 먹다 …". Whatever it wrote in front stays
// behind here: "1)", "1.", "(1)", "①". The template's own "1)" is then
// the only number on the page.
const LEADING_NUMBER = /^\s*(?:\(\d+\)|\d+\s*[.)]|[①-⑳])\s*/;

// A number is the template's to add — unless the text is a list of its
// own ("① 포장 ② 세트", "1) … 2) …"): then the first number belongs to
// the list, and taking it away left answers reading "포장 ② 세트".
const LIST_AFTER = /(?:^|\s)(?:\(2\)|2\s*[.)]|②)\s*\S/;
export function unnumbered(sheet) {
  const strip = (v) => {
    if (typeof v !== 'string') return v;
    const rest = v.replace(LEADING_NUMBER, '');
    return rest !== v && LIST_AFTER.test(rest) ? v : rest;
  };
  const each = (list, key) => (Array.isArray(list) ? list : []).map((item) => {
    if (typeof item === 'string') return strip(item);
    if (item && typeof item[key] === 'string') return Object.assign({}, item, { [key]: strip(item[key]) });
    return item;
  });
  sheet.exercises = each(sheet.exercises, 'ask');
  sheet.answers = each(sheet.answers, 'answer');
  return sheet;
}

// A second teacher reads the sheet before anyone else does. The writer
// is asked to be careful; this one is asked to be unkind — to find the
// misspelt particle, the answer that does not follow from the sheet,
// the English gloss that is the dictionary's first sense rather than
// this sentence's. What it finds goes back to the writer as a list,
// and a sheet that fails twice is not saved at all. The point is that
// "make it good" is not an instruction a model can follow, but "here
// are the four things wrong with it" is.
export async function reviewSheet(cfg, sheet) {
  const system = [
    '당신은 한국어 교재를 검수하는 편집자입니다. 아래 학습지 JSON을 읽고 잘못된 곳을 찾으세요.',
    '이 학습지는 실제 학습자에게 배포되므로, 봐줄 이유가 없습니다.',
    '',
    '반드시 확인할 것:',
    '- 한국어 문장의 맞춤법, 띄어쓰기, 조사, 어미가 모두 맞는가. 실제로 쓰는 자연스러운 말인가.',
    '- 영어 뜻풀이와 예문 번역이 정확한가. 그 문장에서 쓰인 뜻인가.',
    '- 로마자 표기가 표기법에 맞는가.',
    '- 문제가 학습 목표를 연습시키는가. 학습지만 읽고 풀 수 있는가.',
    '- 정답이 맞는가. 문제와 하나씩 짝이 맞는가. 다른 답도 가능한데 하나만 정답이라고 하지 않았는가.',
    '- 수준(level)에 맞는가.',
    '- 확인할 수 없는 사실(가격, 법, 통계)을 단정하지 않았는가.',
    '- 같은 낱말이나 같은 문장 틀이 반복되어 학습지가 얇아지지 않았는가.',
    '',
    '판정:',
    '- 잘못된 곳이 하나라도 있으면 verdict 는 "fix", problems 에 하나씩 적으세요.',
    '  각 항목은 어디가(어느 낱말·문제 번호) 어떻게 틀렸고 무엇으로 고쳐야 하는지까지 적으세요.',
    '- 취향 차이나 사소한 표현 선택은 문제가 아닙니다. 틀린 것만 적으세요.',
    '- 틀린 곳이 없으면 verdict 는 "pass", problems 는 빈 배열.'
  ].join('\n');

  const want = {
    verdict: { type: 'string', enum: ['pass', 'fix'] },
    problems: { type: 'array', items: { type: 'string' } }
  };
  const schema = strict(want, Object.keys(want), cfg.provider.strictSchema !== false);
  const out = parse(await cfg.provider.chat(cfg, system, JSON.stringify(sheet, null, 1), schema), '검수');
  const problems = Array.isArray(out.problems) ? out.problems.map((x) => String(x || '').trim()).filter(Boolean) : [];
  // A "fix" with nothing listed is nothing to fix; a "pass" with a
  // list is a list.
  return { ok: out.verdict !== 'fix' && !problems.length, problems };
}

// ── what makes a sheet unusable ────────────────────────────────────
// Refusing here is the point. A sheet that reaches the review screen
// with two questions and five answers has spent a person's attention
// on something a loop could have caught.
// Talk about making the sheet rather than about Korean. English only
// (the sheet is written in English first, and translated from that);
// Korean words like 지난번 or 고쳤어요 are ordinary example material.
export const MAKING_OF = new RegExp([
  // Not "changed" or "updated": "I changed the appointment" is an example
  // sentence's translation, not a note about the sheet.
  "\\bI(?:'ve| have)? (?:fixed|corrected|rewrote|revised|addressed)\\b",
  '\\b(?:last|previous|earlier) (?:review|draft|version|revision)\\b',
  '\\bthe review(?:er)?\\b', '\\breviewer\\b', '\\bas requested\\b',
  '\\bnow reads\\b', '\\bthis (?:revision|draft)\\b', '검수'
].join('|'), 'i');

export function problemsWith(sheet, opts = {}) {
  const bad = [];
  const n = (x) => (Array.isArray(x) ? x.length : 0);

  if (!sheet.title || sheet.title.length < 2) bad.push('제목이 없습니다.');
  if (!sheet.objective || sheet.objective.length < 15) bad.push('학습 목표가 너무 짧습니다.');
  if (n(sheet.exercises) < 3) bad.push('문제가 세 개보다 적습니다.');
  if (n(sheet.exercises) !== n(sheet.answers)) {
    bad.push('문제 ' + n(sheet.exercises) + '개에 정답 ' + n(sheet.answers) + '개입니다.');
  }
  if (!(sheet.minutes > 0 && sheet.minutes <= 90)) bad.push('학습 시간이 이상합니다.');
  // The owner's design: every YOUR TURN opens with its instruction box.
  if (!(sheet.task && String(sheet.task.title || '').trim() && String(sheet.task.line || '').trim())) {
    bad.push('task (YOUR TURN 안내 상자)의 title 과 line 을 채우세요.');
  }
  if (n(sheet.exercises) > 6) bad.push('문제가 ' + n(sheet.exercises) + '개입니다. 4~6개로 줄이세요.');

  const shape = (SHELVES[sheet.category] || SHELVES.etc).shape;
  const least = { words: 6, passage: 3, forms: 1, dialogue: 4, letters: 2, sections: 1 }[shape];
  if (n(sheet[shape]) < least) {
    bad.push(shape + ' 가 ' + n(sheet[shape]) + '개뿐입니다 (최소 ' + least + ').');
  }

  // A note to the reviewer printed on the learner's page: a rewrite
  // once put "I fixed both problems from the last review…" into the
  // sheet's note box. Whatever the model says about its own work goes
  // in checkThese, which is never printed.
  const printed = JSON.stringify({ ...sheet, checkThese: undefined });
  if (MAKING_OF.test(printed)) bad.push('학습지 본문에 만드는 과정(검수·수정) 이야기가 들어갔습니다. 학습자에게 하는 말만 남기세요.');

  // A worksheet for learning Korean with no Korean in it has gone
  // wrong in a way every other check would miss.
  const korean = JSON.stringify(sheet).match(/[가-힣]/g);
  if (!korean || korean.length < 30) bad.push('한국어가 거의 없습니다.');

  // §5.1: not the same thing again under a new name.
  const near = (opts.existing || []).find((t) => same(t, sheet.title));
  if (near) bad.push('이미 있는 자료와 제목이 같습니다: ' + near);

  return bad;
}

// Two titles are the same thing if, once the small words are gone,
// most of what is left is shared.
//
// The trailing 's' goes because "Food words" and "Food word" are the
// same worksheet, and an exact-match check would have let the second
// one through — which is the only kind of duplicate that actually
// happens, since nothing generates the identical title twice.
export function same(a, b) {
  const stem = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
  const bag = (s) => new Set(String(s || '').toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 1).map(stem));
  const x = bag(a);
  const y = bag(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  x.forEach((w) => { if (y.has(w)) shared += 1; });
  return shared / Math.min(x.size, y.size) >= 0.7;
}

// The keyword a download is saved under: "bank" in bank(en).pdf.
// Lower-case letters and digits, one or two words run together.
export function cleanKeyword(raw) {
  return String(raw || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 16);
}

export function slugify(raw) {
  return String(raw || '').toLowerCase().trim()
    .replace(/[^\w\s가-힣-]/g, '').replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'sheet';
}

export { TranslateError };

/* ------------------------------------------------------------------ *
 * The same sheet in another language
 * ------------------------------------------------------------------ */
//
// A Korean worksheet does not become a Vietnamese worksheet by being
// translated. The Korean is the subject — the words, the passage, the
// dialogue, the example sentences — and it has to survive untouched, or
// the Vietnamese edition is teaching Vietnamese.
//
// What moves is everything wrapped around it: what a word means, what
// the passage is about, what the question is asking, what the answer
// was. §5.4 of the brief puts it as "한국어 예문의 의미가 번역 과정에서
// 바뀌지 않게 한다" — and the way to guarantee that is not to send the
// Korean at all.
//
// So: walk the sheet, collect the explanatory strings and nothing else,
// translate them as one batch, and put them back where they came from.
// One list in, one list out, in the same order — the same guarantee the
// blog's translation rests on.

// Every field that explains, paired with where it lives. The Korean
// fields — korean, example, passage, form, letter, dialogue.korean —
// are deliberately absent.
// `level` too: "Intermediate (low)" is printed on every page of every
// edition, and was left in English on all of them.
const EXPLAINS = [
  ['level'], ['summary'], ['objective'], ['note'], ['setting']
];

// `ref`: the edition the lines were translated from. Which lines are
// sent is decided by it alone, so the same lines are found again in a
// translated edition — a Korean answer that the Korean edition wrote
// differently must not shift every line after it.
export function explanatoryText(sheet, ref = sheet) {
  const at = [];
  const push = (get, set, value) => {
    if (typeof value === 'string' && value.trim()) at.push({ get, set, value });
  };

  EXPLAINS.forEach(([key]) => {
    push(null, (s, v) => { s[key] = v; }, sheet[key]);
  });
  if (sheet.task) {
    push(null, (s, v) => { s.task.title = v; }, sheet.task.title);
    push(null, (s, v) => { s.task.line = v; }, sheet.task.line);
  }

  (sheet.words || []).forEach((w, i) => {
    push(null, (s, v) => { s.words[i].meaning = v; }, w.meaning);
    push(null, (s, v) => { s.words[i].exampleMeaning = v; }, w.exampleMeaning);
  });
  (sheet.forms || []).forEach((f, i) => {
    // The form's name is Korean with an English label on it — "동사 +
    // -는 (present)", "있다 / 없다 words + -는" — and the label is prose.
    // Sent every time (a translation keeps the Korean, checked by
    // proofread.mjs), so the slots line up between editions.
    push(null, (s, v) => { s.forms[i].form = v; }, f.form);
    push(null, (s, v) => { s.forms[i].when = v; }, f.when);
    push(null, (s, v) => { s.forms[i].means = v; }, f.means);
    push(null, (s, v) => { s.forms[i].exampleMeaning = v; }, f.exampleMeaning);
  });
  (sheet.watchOut || []).forEach((w, i) => {
    push(null, (s, v) => { s.watchOut[i] = v; }, w);
  });
  (sheet.dialogue || []).forEach((t, i) => {
    push(null, (s, v) => { s.dialogue[i].who = v; }, t.who);
    push(null, (s, v) => { s.dialogue[i].meaning = v; }, t.meaning);
  });
  (sheet.letters || []).forEach((l, i) => {
    push(null, (s, v) => { s.letters[i].sound = v; }, l.sound);
    push(null, (s, v) => { s.letters[i].as = v; }, l.as);
  });
  (sheet.sections || []).forEach((sec, i) => {
    push(null, (s, v) => { s.sections[i].heading = v; }, sec.heading);
    (sec.paragraphs || []).forEach((p, j) => {
      push(null, (s, v) => { s.sections[i].paragraphs[j] = v; }, p);
    });
    // A flow of steps and numbered rows (the kiosk sheet's design): the
    // Korean stays; what each step or button is called and what it does
    // is prose.
    (sec.steps || []).forEach((st, j) => {
      push(null, (s, v) => { s.sections[i].steps[j].en = v; }, st.en);
    });
    (sec.items || []).forEach((it, j) => {
      push(null, (s, v) => { s.sections[i].items[j].gloss = v; }, it.gloss);
      push(null, (s, v) => { s.sections[i].items[j].text = v; }, it.text);
    });
    push(null, (s, v) => { s.sections[i].note = v; }, sec.note);
  });
  (sheet.exercises || []).forEach((q, i) => {
    // A question with parts keeps them (Korean situations); its
    // instruction is prose.
    push(null, (s, v) => { if (typeof s.exercises[i] === 'string') s.exercises[i] = v; else s.exercises[i].ask = v; },
      typeof q === 'string' ? q : q.ask);
  });
  // An answer that is a Korean sentence is the answer, not an
  // explanation of one, so it stays as it is. Anything else is prose.
  // An answer that is only Korean is the answer, not an explanation of
  // one, so it stays as it is. One with words of explanation in it —
  // "차 (ㅊ has a strong puff of air)", "7일 동안 (7일분 = a 7-day
  // supply)" — is translated like prose; its Korean is kept (checked by
  // proofread.mjs). Those were left in English in every edition.
  (sheet.answers || []).forEach((a, i) => {
    const decide = String((ref.answers || [])[i] == null ? a : ref.answers[i]);
    if (!/[가-힣]/.test(decide) || /[A-Za-z]{3,}/.test(decide)) {
      push(null, (s, v) => { s.answers[i] = v; }, a);
    }
  });

  return at;
}

export async function translateSheet(translate, cfg, sheet, lang, fromName, extra) {
  const slots = explanatoryText(sheet);
  if (!slots.length) return JSON.parse(JSON.stringify(sheet));

  const out = await translate({
    from: 'en',
    fromName: fromName || 'English',
    targets: [lang],
    sentences: slots.map((s) => s.value),
    prompt: [
      'You translate the explanations on a Korean-language worksheet.',
      '',
      'You are given exactly ' + slots.length + ' numbered lines and must return exactly ' +
        slots.length + ', in the same order.',
      '',
      '- One line in, one line out. Never merge, split, drop or add one.',
      '- These are the explanations around Korean example sentences — what a word means,',
      '  what a question is asking. Translate them into natural everyday language a learner',
      '  would read.',
      '- Any Korean in a line stays exactly as it is, in Hangul. It is what is being taught,',
      '  not something to translate.',
      '- Keep a question a question and an instruction an instruction.',
      '- "In English" / "Answer in English" means the reader\'s own language: write the target',
      '  language there (for Korean, drop it). English kept as a sound example ("the k in key")',
      '  stays English.',
      '',
      'Target language: ' + lang + '. Return one entry, with that code.',
      ...(extra ? ['', extra] : [])
    ].join('\n')
  }, cfg);

  const got = out.translations[lang];
  if (!Array.isArray(got) || got.length !== slots.length) {
    throw new Error('번역이 원문과 개수가 맞지 않습니다 (' + lang + ').');
  }

  const copy = JSON.parse(JSON.stringify(sheet));
  slots.forEach((slot, i) => slot.set(copy, got[i]));
  return copy;
}
