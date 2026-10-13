// DURU KOREAN — the worksheets' syllabus
//
// The daily worksheets follow the official lists in content/curriculum
// (the owner, 2026-10-05: "그래야 체계적이거든"), in order, level by
// level, instead of a model choosing a subject each morning:
//
//   grammar   one item of 국제 통용 한국어 표준 교육과정, levels 1–4, in its
//             own order (조사, 어미, 표현 within each level)
//   vocab     one 세종학당 topic, levels 1–4 in order; the words are checked
//             against the standard vocabulary list's levels
//   reading,  one 세종학당 topic each, in the same order, with a grammar
//   reallife  item of that level for the text or dialogue to practise
//
// Which items a shelf has done is kept in its plan file (see
// generate-sheets.mjs); nothing here calls a model.

import { readFileSync } from 'node:fs';

const dir = new URL('../../content/curriculum/', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

const GRAMMAR = load('official_grammar_336.json');
const TOPICS = load('sejong_topics.json');
// The owner's first series (2026-10-09): 100 sheets each for Hangul
// Starter, Grammar Cheat Sheets and Vocabulary, in this order, none of
// them repeating a sheet already on the shelf. These three shelves take
// their subjects from it instead of the lists above.
const SERIES = load('duru_series_300.json');
// The second series (owner, 2026-10-12): Reading Practice, Real-life Korean
// and Everything Else, 100 topics each, in order.
const SERIES2 = load('duru_series2_300.json');
for (const shelf of ['reading', 'reallife', 'etc']) SERIES[shelf] = SERIES2[shelf];
// The Level 4 series (owner, 2026-10-13): 40 each for Grammar, Vocabulary,
// Reading Practice, Real-life Korean and Everything Else, standard 4급.
// Kept out of every run until the owner has confirmed the samples:
// DURU_LEVEL4 = 'all', or the ids to make (G4-07,V4-11,…).
const SERIES3 = load('duru_series3_200.json');
const LEVEL4 = process.env.DURU_LEVEL4 || '';
const level4Open = (id) => LEVEL4 === 'all' || LEVEL4.split(',').map((x) => x.trim()).includes(id);
for (const shelf of ['grammar', 'vocab', 'reading', 'reallife', 'etc']) {
  const l4 = SERIES3[shelf].filter((r) => level4Open(r.id));
  SERIES[shelf] = process.env.DURU_LEVEL4_ONLY === '1' ? l4 : SERIES[shelf].concat(l4);
}
export const SERIES_SHELVES = ['hangul', 'grammar', 'vocab', 'reading', 'reallife', 'etc'];
let VOCAB = null;       // 1.2 MB: read only when a vocabulary sheet is checked

const SEJONG_SOURCE = '국립국어원·세종학당재단 『세종학당 한국어 기본 교육과정』(2020)';
const MAX_LEVEL = 4;
export const CURRICULUM_SHELVES = ['grammar', 'vocab', 'reading', 'reallife', 'hangul', 'etc'];

// The site's five levels, from the standard's 1–4급.
const LEVEL_NAME = { 1: 'Beginner', 2: 'Beginner (high)', 3: 'Intermediate (low)', 4: 'Intermediate' };

// 세종 4급 ≈ 표준 3급 (the owner's notes, §3.4).
const standardOf = (sejongLevel) => Math.min(sejongLevel, 3);

// Covered by sheets made before the syllabus (65 on the shelf,
// 2026-10-05), so not written again.
const ALREADY = {
  grammar: ['OK-001', 'OK-005', 'OK-011', 'OK-013', 'OK-021', 'OK-024', 'OK-025', 'OK-026', 'OK-038',
            'OK-039', 'OK-063', 'OK-064', 'OK-065', 'OK-069', 'OK-086', 'OK-088', 'OK-128', 'OK-138'],
  vocab: ['S1:음식', 'S1:가족', 'S1:교통', 'S1:물건 사기', 'S1:쇼핑'],
  reading: ['S1:날씨', 'S1:교통', 'S1:물건 사기'],
  reallife: ['S1:물건 사기', 'S1:교통', 'S1:건강', 'S1:음식']
};

// A form as printed: "-던2" → "-던".
const bare = (form) => String(form || '').replace(/\d+(\(\d+\))?$/, '').replace(/\(\d+\)$/, '');

function shown(g) {
  const v = (g.variants || []).map(bare).filter((x) => x && x !== bare(g.form)).slice(0, 3);
  return bare(g.form) + (v.length ? ' (' + v.join(', ') + ')' : '');
}

function describe(g) {
  return '표준 교육과정 ' + g.level + '급 ' + g.category + ' 「' + shown(g) + '」' + (g.meaning ? ' — ' + g.meaning : '');
}

// Items that share the written form but are not this one (§3.2):
// "-던-" (전성어미) and "-던2" (종결어미) are both "-던".
const key = (form) => bare(form).replace(/^-|-$/g, '');
function namesakes(g) {
  return GRAMMAR.filter((o) => o.id !== g.id && key(o.form) === key(g.form)).map(describe);
}

const grammarOrder = GRAMMAR.filter((g) => g.level <= MAX_LEVEL);
const topicOrder = TOPICS.flatMap((t) => t.topics.map((topic) => ({ id: 'S' + t.level + ':' + topic, level: t.level, topic })));
// The grammar a reading or a dialogue practises: endings and expressions,
// not a particle on its own.
const practisable = (level) => grammarOrder.filter((g) => g.level === level && g.category !== '조사');

function grammarSubject(g) {
  const near = namesakes(g);
  const lines = [
    '이 학습지의 문법: ' + describe(g) + ' (항목 ' + g.id + ')',
    '',
    '[기준 — 꼭 지키세요]',
    '- 국립국어원 국제 통용 한국어 표준 교육과정의 이 항목 하나를 가르칩니다. 등급과 뜻은 이 표준을 따릅니다.',
    g.meaning ? '- 이 항목의 뜻은 "' + g.meaning + '"입니다. 같은 모양의 다른 뜻으로 가르치지 마세요.'
              : '- 분류(' + g.category + ')와 ' + g.level + '급 수준에 맞는 기본 뜻으로 가르치세요.',
    near.length ? '- 모양이 같지만 다른 항목입니다. 이것들과 섞지 마세요: ' + near.join(' / ') : '',
    '- 예문의 다른 문법과 낱말은 ' + g.level + '급 이하로 쓰세요. 장면에 꼭 필요할 때만 ' + (g.level + 1) + '급까지.'
  ].filter(Boolean);
  return {
    id: g.id,
    subject: lines.join('\n'),
    objective: '「' + bare(g.form) + '」의 형태와 뜻을 알고 문장에서 바르게 쓸 수 있다.',
    level: LEVEL_NAME[g.level],
    levelNum: g.level,
    checkThese: [],
    credit: [g.source + ' — ' + g.id + ' ' + bare(g.form)],
    label: g.id + ' ' + shown(g)
  };
}

function topicSubject(shelf, t, index) {
  const std = standardOf(t.level);
  const lines = ['주제: 「' + t.topic + '」 — 세종학당 기본 교육과정 ' + t.level + '급 주제', '', '[기준 — 꼭 지키세요]'];
  const credit = [SEJONG_SOURCE + ' — ' + t.level + '급 주제 「' + t.topic + '」'];
  let g = null;
  if (shelf === 'vocab') {
    lines.push('- 이 주제에서 실제로 많이 쓰는 낱말을 고르세요. 국제 통용 한국어 표준 교육과정 ' + std + '급 이하 어휘를 중심으로,',
               '  꼭 필요할 때만 ' + (std + 1) + '급까지 씁니다. 더 높은 등급의 낱말은 검사에서 걸립니다.');
  } else {
    // Five of the level's grammar items, taken in turn through the level
    // so the shelf covers it; the writer uses the one the topic suits
    // (a fixed pairing gave 「자기소개」 with 「-겠-」).
    const pool = practisable(std);
    const five = Array.from({ length: Math.min(5, pool.length) }, (_, i) => pool[(index * 5 + i) % pool.length]);
    g = five[0];
    lines.push('- ' + (shelf === 'reading' ? '지문' : '대화') + '에서 연습할 문법 하나를 아래에서 고르세요 — 이 주제에 가장 자연스럽게 맞는 것:',
               five.map((x) => '    ' + describe(x)).join('\n'),
               '  고른 문법을 ' + (shelf === 'reading' ? '지문' : '대화') + '에 자연스럽게 2~3번 쓰세요. 학습지 전체는 A4 2쪽입니다.',
               '- 나머지 문법과 낱말은 표준 ' + std + '급 이하로 씁니다. 장면에 꼭 필요할 때만 ' + (std + 1) + '급까지.');
    credit.push(g.source + ' — ' + std + '급 문법');
  }
  return {
    id: t.id,
    subject: lines.join('\n'),
    objective: '「' + t.topic + '」에 대해 ' + std + '급 수준으로 ' +
               (shelf === 'vocab' ? '필요한 낱말을 알고 쓸 수 있다.' : shelf === 'reading' ? '짧은 글을 읽고 이해할 수 있다.' : '실제 대화를 할 수 있다.'),
    level: LEVEL_NAME[std],
    levelNum: std,
    checkThese: [],
    credit,
    label: t.id
  };
}

const GRAMMAR_BY_ID = new Map(GRAMMAR.map((g) => [g.id, g]));

// One row of the series as a subject. Its level is the standard's level
// (the row's), never a model's guess.
function seriesSubject(shelf, row) {
  const head = ['이 학습지: ' + row.id + ' 「' + row.title + '」 — DURU KOREAN ' + (/^[A-Z]4-/.test(row.id) ? '레벨 4' : SERIES2[shelf] ? '2차' : '1차') + ' 시리즈', ''];
  if (shelf === 'grammar') {
    const items = row.items.map((id) => GRAMMAR_BY_ID.get(id));
    const near = items.flatMap(namesakes).filter((x, i, a) => a.indexOf(x) === i);
    const lines = head.concat(
      row.system
        ? ['이 장은 문법 체계를 한 장에 정리합니다 (표준 ' + row.level + '급까지). 다룰 것: ' + row.content,
           '- 규칙을 표로 보이고, 규칙마다 쉬운 예문을 드세요. 처음 보는 학습자도 이 장만으로 이해할 수 있게 쓰세요.']
        : ['이 학습지의 문법 (국립국어원 국제 통용 한국어 표준 교육과정):',
           items.map((g) => '    ' + describe(g) + ' (항목 ' + g.id + ')').join('\n'),
           '핵심: ' + row.content,
           items.length > 1 ? '- 이 항목들을 한 장에서 비교해 차이가 보이게 가르치세요.' : ''],
      ['', '[기준 — 꼭 지키세요]',
       '- 등급과 뜻은 표준 교육과정을 따릅니다. 같은 모양의 다른 뜻으로 가르치지 마세요.',
       near.length ? '- 모양이 같지만 다른 항목입니다. 이것들과 섞지 마세요: ' + near.join(' / ') : '',
       '- 예문의 다른 문법과 낱말은 ' + row.level + '급 이하로 쓰세요. 장면에 꼭 필요할 때만 ' + (row.level + 1) + '급까지.']
    ).filter(Boolean);
    return {
      id: row.id, subject: lines.join('\n'),
      objective: row.system ? '「' + row.title.replace(/:.*$/, '') + '」의 규칙을 한눈에 보고 바르게 쓸 수 있다.'
                            : items.map((g) => '「' + bare(g.form) + '」').join('·') + '의 형태와 뜻을 알고 문장에서 바르게 쓸 수 있다.',
      level: LEVEL_NAME[row.level], levelNum: row.level, checkThese: [],
      credit: row.system ? [GRAMMAR[0].source] : items.map((g) => g.source + ' — ' + g.id + ' ' + bare(g.form)),
      label: row.id + ' ' + row.title
    };
  }
  if (shelf === 'vocab') {
    const lines = head.concat([
      '주제: 「' + row.topic + '」 — ' + (row.topic === '단어의 짜임' ? '어휘 확장' : '세종학당 기본 교육과정 주제'),
      row.words.length ? '중심 낱말(이것을 포함해 10개 안팎): ' + row.words.join(', ')
        : '낱말: 표준 교육과정 ' + row.level + '급 어휘 목록에서 이 주제에 맞는 ' + row.level + '급 낱말 12~15개를 고르세요 (' + row.stage + ' 단계). 쉬운 낱말(1~2급)은 피하세요.',
      '', '[기준 — 꼭 지키세요]',
      '- 국제 통용 한국어 표준 교육과정 ' + row.level + '급 이하 어휘를 중심으로, 꼭 필요할 때만 ' + (row.level + 1) + '급까지 씁니다.',
      '- 이미 자료실에 있는 어휘 학습지와 같은 낱말 묶음이 되지 않게 하세요.'
    ]);
    return {
      id: row.id, subject: lines.join('\n'),
      objective: '「' + row.title + '」에 나오는 낱말을 알고 짧은 문장에서 쓸 수 있다.',
      level: LEVEL_NAME[row.level], levelNum: row.level, checkThese: [],
      credit: row.topic === '단어의 짜임' ? [GRAMMAR[0].source] : [SEJONG_SOURCE + ' — 주제 「' + row.topic + '」', GRAMMAR[0].source],
      label: row.id + ' ' + row.title
    };
  }
  if (shelf === 'reading' || shelf === 'reallife' || shelf === 'etc') {
    const culture = shelf === 'etc' && /^E4-/.test(row.id);
    const what = { reading: '읽기 지문', reallife: '대화', etc: culture ? '한국어의 문화와 언어 감각(관용·말투·예절·문화 배경·표현의 느낌)을 설명하고 연습하는 학습 자료' : '실제 생활 자료(표지판·화면·라벨·서류·알림 등)를 그대로 옮긴 것과 그 읽는 법' }[shelf];
    const lines = head.concat([
      '주제: 「' + row.title + '」 (' + row.group + ')',
      '이 장은 이 주제의 ' + what + '을(를) 다룹니다. 이 주제에서 벗어나지 마세요.',
      '', '[기준 — 꼭 지키세요]',
      '- 같은 시리즈의 다른 주제(같은 장면·같은 문서)와 겹치지 않게, 이 주제에만 있는 내용을 쓰세요.',
      '- 낱말과 문법은 국제 통용 한국어 표준 교육과정 ' + row.level + '급 이하, 꼭 필요할 때만 ' + (row.level + 1) + '급까지.'
    ]);
    const credit = [SEJONG_SOURCE, GRAMMAR[0].source];
    if (shelf !== 'etc') {
      const pool = practisable(row.level);
      const five = Array.from({ length: Math.min(5, pool.length) }, (_, i) => pool[((row.no - 1) * 5 + i) % pool.length]);
      lines.push('- ' + (shelf === 'reading' ? '지문' : '대화') + '에서 연습할 문법 하나를 아래에서 고르세요 — 이 주제에 가장 자연스럽게 맞는 것:',
                 five.map((x) => '    ' + describe(x)).join('\n'),
                 '  고른 문법을 ' + (shelf === 'reading' ? '지문' : '대화') + '에 자연스럽게 2~3번 쓰세요. 학습지 전체는 A4 2쪽입니다.');
    } else if (culture) {
      lines.push('- 한국어 중급(4급) 학습자가 문화와 언어 감각을 익히는 자료입니다. 예시 문장·짧은 대화·비교표로 보여 주고, 학습자 나라와 다른 점을 짚어 주세요.',
                 '- 이 시리즈는 위계가 있습니다 (' + row.group + '). 앞 장에서 배운 것을 이어 가되 되풀이하지 마세요. 학습지 전체는 A4 2쪽입니다.');
    } else {
      lines.push('- 자료는 한국에서 실제로 볼 법한 모양 그대로 보여 주고, 학습자가 꼭 읽어야 할 낱말·숫자를 짚어 주세요. 학습지 전체는 A4 2쪽입니다.',
                 '- 실제 회사·브랜드·상표 이름, 실제 전화번호·주소·가격은 지어내지 마세요. 가상의 이름과 예시 숫자를 쓰세요.');
    }
    return {
      id: row.id, subject: lines.join('\n'),
      objective: '「' + row.title + '」' + (shelf === 'reading' ? '을(를) 읽고 내용을 이해할 수 있다.' : shelf === 'reallife' ? ' 상황에서 필요한 말을 할 수 있다.' : '을(를) 읽고 필요한 정보를 찾을 수 있다.'),
      level: LEVEL_NAME[row.level], levelNum: row.level, checkThese: [], credit,
      label: row.id + ' ' + row.title
    };
  }
  // hangul
  const lines = head.concat([
    '단원: ' + row.unit, '다룰 것: ' + row.content,
    row.related ? '기존 자료와의 관계: ' + row.related + ' — 같은 내용을 되풀이하지 말고 이어서 넓히세요.' : '',
    '', '[기준 — 꼭 지키세요]',
    '- 한글을 처음 배우는 사람이 읽습니다. 예시 낱말은 표준 교육과정 1~2급의 쉬운 낱말로 고르세요.',
    '- letters 칸에는 이 장의 핵심 글자·규칙 3~4개를 넣으세요. 학습자가 보고 따라 쓰는 칸입니다 (사장님, 2026-10-10):',
    '  letter 는 글자·음절·짧은 낱말만 (한글 6자 이내, 영어 설명 금지 — 예: 「ㅂ」, 「들으세요」, 「3월」). 규칙 설명은 as 에 쓰세요.',
    '  sound 는 반드시 「예시 낱말 [실제 소리]」 꼴로 채우세요 (예: 「들으세요 [드르세요]」). 비우지 마세요 — 이 낱말을 네모 칸에 따라 씁니다.',
    '- A4 두 쪽에 10개 언어(프랑스어·베트남어처럼 긴 번역 포함)가 다 들어가야 합니다. 짧게 쓰세요:',
    '  sound·as 설명은 한 줄(영어 12단어 안팎), 낱말 6개 이하, 설명 문단은 두세 문장.',
    '  문제는 4~5개, 문제마다 소문항(①②)을 두세 개 두어 마지막 쪽이 비지 않게 하세요 (정답도 함께).',
    '- 예시 낱말·문장·문제에는 이 장과 앞 장(같은 시리즈의 앞 번호)에서 배운 글자만 쓰세요.',
    '  아직 안 배운 쌍자음·겹모음·받침이 든 낱말은 쓰지 마세요 (예: 기본 글자 장에서 「예뻐요」 금지).',
    '- 소리 설명은 표준 발음법을 따르고, [ ] 안에 실제 소리를 적으세요.'
  ]).filter(Boolean);
  return {
    id: row.id, subject: lines.join('\n'),
    objective: '「' + row.title + '」을(를) 읽고 바르게 소리 낼 수 있다.',
    level: LEVEL_NAME[1], levelNum: 1, checkThese: [], credit: [],
    label: row.id + ' ' + row.title
  };
}

// The next subject for a shelf, or null when the shelf is not on the
// syllabus or has finished levels 1–4. `plan`: { done: [ids], tried: {id: n} }.
// An item tried three times (at most once a run) without a sheet being
// saved is passed over.
// `skip`: items that failed earlier in this run — the next try takes the
// next item rather than the same one again (2026-10-05: 과/와 twice).
export function nextFromSyllabus(shelf, plan, skip = new Set()) {
  if (!CURRICULUM_SHELVES.includes(shelf)) return null;
  const done = new Set([...(ALREADY[shelf] || []), ...((plan && plan.done) || [])]);
  const tried = process.env.DURU_RESET_TRIED === 'all' ? {} : ((plan && plan.tried) || {});
  // A series item gets twelve tries, not three (the owner, 2026-10-09: all
  // 100 must be made; vocab ran out of items at 91 with nine left that
  // had failed review three times each).
  const most = SERIES_SHELVES.includes(shelf) ? 12 : 3;
  const open = (id) => !done.has(id) && !skip.has(id) && (tried[id] || 0) < most;
  if (SERIES_SHELVES.includes(shelf)) {
    const row = SERIES[shelf].find((r) => open(r.id));
    return row ? seriesSubject(shelf, row) : null;
  }
  if (shelf === 'grammar') {
    const g = grammarOrder.find((x) => open(x.id));
    return g ? grammarSubject(g) : null;
  }
  const at = topicOrder.findIndex((t) => open(t.id));
  if (at < 0) return null;
  const t = topicOrder[at];
  const inLevel = topicOrder.filter((x) => x.level === t.level).indexOf(t);
  return topicSubject(shelf, t, inLevel);
}

// The lists a shelf's subjects come from, as credits.
export function shelfCredits(shelf) {
  const official = GRAMMAR[0].source;
  if (shelf === 'grammar') return [official];
  if (shelf === 'hangul') return [];
  return CURRICULUM_SHELVES.includes(shelf) ? [SEJONG_SOURCE, official] : [];
}

// How far a shelf has got, for the log.
export function progress(shelf, plan) {
  const done = new Set([...(ALREADY[shelf] || []), ...((plan && plan.done) || [])]);
  const all = SERIES_SHELVES.includes(shelf) ? SERIES[shelf].map((r) => r.id)
    : shelf === 'grammar' ? grammarOrder.map((g) => g.id) : topicOrder.map((t) => t.id);
  return all.filter((id) => done.has(id)).length + '/' + all.length;
}

function vocabLevels() {
  if (VOCAB) return VOCAB;
  VOCAB = new Map();
  // A row may name several homographs: "천02/천03" (the number) is 1급
  // while "천01" (cloth) is 5급. Each one is read, and a word takes the
  // lowest level any of its homographs has (2026-10-09: 천, 백 and 월
  // were held as 3–5급 and two number sheets failed).
  for (const v of load('official_vocab_10635.json')) {
    for (const part of String(v.word || '').split('/')) {
      const w = part.replace(/\d+$/, '').replace(/\s+/g, '');
      if (!w) continue;
      VOCAB.set(w, Math.min(VOCAB.get(w) || 99, v.level));
    }
  }
  return VOCAB;
}

// A vocabulary sheet's words above the level the subject allows (its
// level + 1), by the standard list. A word not on the list is not
// judged: a topic needs some (가족 호칭, a place name).
export function levelProblems(sheet, subject) {
  if (!subject || !subject.levelNum || !Array.isArray(sheet.words)) return [];
  const levels = vocabLevels();
  const out = [];
  for (const w of sheet.words) {
    const word = String((w && w.korean) || '').replace(/\s+/g, '');
    const lv = levels.get(word);
    if (lv && lv > subject.levelNum + 1) {
      out.push('"' + w.korean + '"은(는) 표준 교육과정 ' + lv + '급 어휘라 이 학습지(' + subject.levelNum +
               '급)에 맞지 않습니다. 같은 뜻의 쉬운 낱말로 바꾸거나 다른 낱말을 고르세요.');
    }
  }
  return out;
}
