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
  '당신은 한국어를 배우는 외국인을 위한 학습지를 만드는 교사입니다.',
  '',
  '지켜야 할 것:',
  '- 남의 학습지를 베끼거나 흉내 내지 마세요. 당신이 아는 한국어로 처음부터 만드세요.',
  '- 한국어는 실제로 쓰는 말이어야 합니다. 교과서에만 있고 아무도 안 쓰는 문장은 쓰지 마세요.',
  '- 예문은 짧고, 그 낱말이 왜 필요한지 보여 주는 것이어야 합니다.',
  '- 확실하지 않은 사실(가격, 영업시간, 법, 통계)은 아예 쓰지 마세요. 지어내는 것보다 빼는 게 낫습니다.',
  '- 학습 목표는 하나로 좁게 잡으세요. "한국어 배우기" 같은 것은 목표가 아닙니다.',
  '- 문제와 정답의 개수는 반드시 같아야 합니다.',
  '- 문제는 그 학습지를 읽으면 풀 수 있어야 합니다.'
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
function sheetSchema(category, isStrict) {
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
        form: str, when: str, means: str, example: str, exampleMeaning: str
      }, ['form', 'when', 'means', 'example', 'exampleMeaning'], isStrict) },
      watchOut: strs
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
    sections: {
      sections: { type: 'array', items: strict({
        heading: str, paragraphs: strs
      }, ['heading', 'paragraphs'], isStrict) },
      note: str
    }
  };

  const shape = shapes[(SHELVES[category] || SHELVES.etc).shape] || shapes.sections;

  const properties = Object.assign({
    title: str, summary: str, objective: str, level: str,
    minutes: { type: 'integer' }, tags: strs,
    exercises: strs, answers: strs, checkThese: strs
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
    'minutes 는 학습자가 이 학습지를 푸는 데 걸릴 시간입니다.',
    'exercises 는 3~6개, answers 는 그와 정확히 같은 개수.',
    '',
    '이 갈래에서 추가로 채울 것: ' + shelf.shape,
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

export function unnumbered(sheet) {
  const strip = (v) => (typeof v === 'string' ? v.replace(LEADING_NUMBER, '') : v);
  const each = (list, key) => (Array.isArray(list) ? list : []).map((item) => {
    if (typeof item === 'string') return strip(item);
    if (item && typeof item[key] === 'string') return Object.assign({}, item, { [key]: strip(item[key]) });
    return item;
  });
  sheet.exercises = each(sheet.exercises, 'ask');
  sheet.answers = each(sheet.answers, 'answer');
  return sheet;
}

// ── what makes a sheet unusable ────────────────────────────────────
// Refusing here is the point. A sheet that reaches the review screen
// with two questions and five answers has spent a person's attention
// on something a loop could have caught.
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

  const shape = (SHELVES[sheet.category] || SHELVES.etc).shape;
  const least = { words: 6, passage: 3, forms: 1, dialogue: 4, letters: 2, sections: 1 }[shape];
  if (n(sheet[shape]) < least) {
    bad.push(shape + ' 가 ' + n(sheet[shape]) + '개뿐입니다 (최소 ' + least + ').');
  }

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
const EXPLAINS = [
  ['summary'], ['objective'], ['note'], ['setting']
];

export function explanatoryText(sheet) {
  const at = [];
  const push = (get, set, value) => {
    if (typeof value === 'string' && value.trim()) at.push({ get, set, value });
  };

  EXPLAINS.forEach(([key]) => {
    push(null, (s, v) => { s[key] = v; }, sheet[key]);
  });

  (sheet.words || []).forEach((w, i) => {
    push(null, (s, v) => { s.words[i].meaning = v; }, w.meaning);
    push(null, (s, v) => { s.words[i].exampleMeaning = v; }, w.exampleMeaning);
  });
  (sheet.forms || []).forEach((f, i) => {
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
  });
  (sheet.exercises || []).forEach((q, i) => {
    push(null, (s, v) => { s.exercises[i] = v; }, typeof q === 'string' ? q : q.ask);
  });
  // An answer that is a Korean sentence is the answer, not an
  // explanation of one, so it stays as it is. Anything else is prose.
  (sheet.answers || []).forEach((a, i) => {
    if (!/[가-힣]/.test(String(a))) {
      push(null, (s, v) => { s.answers[i] = v; }, a);
    }
  });

  return at;
}

export async function translateSheet(translate, cfg, sheet, lang, fromName) {
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
      '',
      'Target language: ' + lang + '. Return one entry, with that code.'
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
