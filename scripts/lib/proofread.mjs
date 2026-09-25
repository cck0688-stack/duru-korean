// DURU KOREAN — the second pair of eyes
//
// The owner's rule (2026-09-25): no sentence and no answer on a sheet
// may be wrong — grammar sheets above all — and every sheet is checked
// twice. reviewSheet() in sheets.mjs is the first reader. This is the
// second: a stricter one that works through a checklist for the sheet's
// shelf and solves every question itself before it looks at the answer
// key. Then, when either has found something, the fixer changes exactly
// what was found and nothing else, and both read it again.
//
// And the translations: every line checked against the English it came
// from, and the Korean in it checked by machine to have come through
// untouched — a translation that "corrects" 맛있은 into 맛있는 has
// destroyed the lesson.

import { sheetSchema, unnumbered, explanatoryText, translateSheet } from './sheets.mjs';
import { translate, LANGUAGE_NAMES } from '../../api/_providers.js';

const TR_TRIES = 3;
const log = (...a) => console.log(...a);

const strictObj = (properties, isStrict) => {
  const root = { type: 'object', properties, required: Object.keys(properties) };
  if (isStrict) root.additionalProperties = false;
  return root;
};
const json = (out, what) => {
  if (typeof out !== 'string') return out;
  try { return JSON.parse(out); } catch (e) { throw new Error(what + ': 모델이 JSON이 아닌 것을 돌려줬습니다.'); }
};

// What to look at, shelf by shelf, on top of what every sheet needs.
const CHECKLIST = {
  grammar: [
    '- form 과 when: 활용 규칙 설명이 정확한가. 받침 유무, ㄹ 탈락, ㅂ·ㄷ·ㅅ·ㅎ·르 불규칙, 예외까지. 설명 안의 활용 예(먹다 → 먹은)를 하나하나 직접 활용해서 확인.',
    '- means: 그 문형의 뜻과 쓰임 설명이 맞는가. 과장되거나 틀린 일반화(“always”, “never”)가 없는가.',
    '- example: 그 줄의 문형을 실제로 쓴 자연스러운 문장인가. exampleMeaning 이 정확한 번역인가.',
    '- mark: example 에서 그 문형이 쓰인 어절이 빠짐없이, 그리고 그것만 들어 있는가. example 에 적힌 그대로인가.',
    '- watchOut: (X) 쪽이 정말 틀린 형태이고 (O) 쪽이 정말 맞는 형태인가. 이유 설명이 정확한가.',
    '- watchOutMark: 각 항목에서 틀린 말과 맞는 말의 핵심 어절이 그 항목에 적힌 그대로 들어 있는가.'
  ],
  vocab: [
    '- 낱말 하나하나: 표기, 로마자, 뜻풀이가 예문 속 뜻과 맞는가. 예문이 그 낱말을 자연스럽게 쓰는가.',
    '- 예문 번역이 정확한가.'
  ],
  reading: [
    '- 지문의 모든 문장: 맞춤법, 띄어쓰기, 조사, 시제, 자연스러움. 수준에 맞는가.',
    '- 낱말풀이의 뜻이 지문 속 뜻인가. 문제의 답이 지문에 근거가 있는가.'
  ],
  reallife: [
    '- 대화: 실제 그 장소에서 쓰는 말인가. 높임과 말투가 인물 관계에 맞는가. 번역이 정확한가.',
    '- 표현 표의 뜻과 예문이 맞는가.'
  ],
  hangul: [
    '- 글자의 소리 설명과 영어 소리 비교가 음성학적으로 맞는가. 과장이나 틀린 비교가 없는가.',
    '- 예시 낱말의 표기, 로마자, 뜻이 맞는가. 그 글자가 실제로 들어 있는가.'
  ],
  etc: [
    '- 모든 문단의 한국어와 설명이 사실에 맞는가. 확인할 수 없는 사실을 단정하지 않는가.'
  ]
};

export function auditPrompt(category) {
  return [
    '당신은 한국어 교재를 출판 직전에 마지막으로 검수하는 수석 편집자입니다. 이 학습지는 전 세계 학습자에게 배포됩니다.',
    '문장 하나, 정답 하나라도 틀리면 안 됩니다. 앞선 검수자가 이미 봤지만, 당신은 처음 보는 것처럼 처음부터 끝까지 보세요.',
    '',
    '순서:',
    '1. exercises 를 하나씩 직접 풀어 보세요. 학습지만 읽은 학습자가 풀 수 있는지, 당신의 답이 answers 의 같은 번호와 같은지.',
    '   다른 답도 맞는데 정답에 없으면 문제입니다. 문제 지시문과 빈칸·괄호 형식이 분명한지도 보세요.',
    '2. 모든 한국어: 맞춤법, 띄어쓰기, 조사, 어미, 높임, 자연스러움. 교과서에만 있는 어색한 문장도 문제입니다.',
    '3. 모든 영어 설명: 한국어에 대한 설명이 사실인가. 번역이 그 문장의 뜻인가.',
    '4. 로마자는 국어의 로마자 표기법(Revised Romanization)대로인가.',
    '   설명과 지시문(when, means, sound, as, meaning, summary, objective, note, 문제의 지시 부분)은 학습자의 언어(영어)로',
    '   써야 합니다. 한국어는 가르치는 것(낱말, 문형, 예문, 보기)으로만 들어갑니다. 설명이나 지시가 한국어로만 되어 있으면',
    '   문제입니다 — 영어로 고치세요(가르치는 한국어는 그대로 두고).',
    '5. title, summary, objective 가 학습지 내용과 맞는가.',
    '',
    '이 갈래(' + category + ')에서 특히:',
    ...(CHECKLIST[category] || CHECKLIST.etc),
    '',
    '판정:',
    '- 틀린 것만 적으세요. 취향, 더 나은 표현, 스타일은 문제가 아닙니다.',
    '- 각 문제는 where(어느 칸, 몇 번째), wrong(지금 적힌 것), fix(무엇으로 바꿀지, 바꿀 글자 그대로)로.',
    '- 틀린 곳이 없으면 verdict 는 "pass", problems 는 빈 배열.'
  ].join('\n');
}

// The second reader. { ok, problems: ["where: wrong → fix"] }
export async function auditSheet(cfg, sheet) {
  const isStrict = cfg.provider.strictSchema !== false;
  const item = strictObj({ where: { type: 'string' }, wrong: { type: 'string' }, fix: { type: 'string' } }, isStrict);
  const schema = strictObj({
    verdict: { type: 'string', enum: ['pass', 'fix'] },
    problems: { type: 'array', items: item }
  }, isStrict);
  const out = json(await cfg.provider.chat(cfg, auditPrompt(sheet.category || 'etc'),
    JSON.stringify({ ...sheet, checkThese: undefined }, null, 1), schema), '정밀 검수');
  const problems = (Array.isArray(out.problems) ? out.problems : [])
    .map((p) => (p && (p.where || p.wrong || p.fix)) ? (p.where + ': ' + p.wrong + ' → ' + p.fix).trim() : '')
    .filter(Boolean);
  return { ok: out.verdict !== 'fix' && !problems.length, problems };
}

// Changes what the readers found, and nothing else.
export async function fixSheet(cfg, sheet, problems) {
  const category = sheet.category || 'etc';
  const system = [
    '당신은 한국어 교재 편집자입니다. 아래 학습지 JSON 에서 검수자가 찾은 문제만 고치세요.',
    '',
    '- 문제로 지적된 곳만 고치세요. 지적되지 않은 글은 한 글자도 바꾸지 마세요(따옴표, 띄어쓰기, 문장 부호까지).',
    '- 고친 문장이 들어간 다른 곳(정답, 요약, mark, watchOutMark, 같은 예문을 다시 쓴 곳)도 함께 맞추세요.',
    '- 문제와 정답의 개수와 순서는 그대로. 번호는 붙이지 마세요.',
    '- 검수자의 지적이 틀렸다고 확신하면 그 부분은 고치지 말고 그대로 두세요.',
    '- 학습지에 만드는 과정 이야기(고쳤다, 검수 등)를 쓰지 마세요.',
    '- 받은 JSON 과 같은 모양으로 전부 돌려주세요.'
  ].join('\n');
  const user = '[검수에서 찾은 문제]\n- ' + problems.join('\n- ') +
    '\n\n[학습지]\n' + JSON.stringify({ ...sheet, checkThese: [] }, null, 1);
  const out = json(await cfg.provider.chat(cfg, system, user,
    sheetSchema(category, cfg.provider.strictSchema !== false)), '고치기');
  const fixed = unnumbered(out);
  fixed.category = category;
  fixed.checkThese = [];
  return fixed;
}

// Every printed string that differs between two editions of a sheet,
// with where it is — the record of what a proofread changed.
export function diffSheets(a, b) {
  const out = [];
  const walk = (x, y, at) => {
    if (typeof x === 'string' || typeof y === 'string') {
      if ((x || '') !== (y || '')) out.push({ at, before: x == null ? '' : String(x), after: y == null ? '' : String(y) });
      return;
    }
    if (Array.isArray(x) || Array.isArray(y)) {
      const n = Math.max((x || []).length, (y || []).length);
      for (let i = 0; i < n; i += 1) walk((x || [])[i], (y || [])[i], at + '[' + (i + 1) + ']');
      return;
    }
    if (x && typeof x === 'object' || y && typeof y === 'object') {
      const keys = new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
      keys.forEach((k) => { if (!['checkThese', 'category', 'tags', 'keyword'].includes(k)) walk((x || {})[k], (y || {})[k], at ? at + '.' + k : k); });
    }
  };
  walk(a, b, '');
  return out;
}

// The Korean in a line has to come through a translation untouched.
const HANGUL_RUN = /[가-힣ㄱ-ㆎ]+(?:[\s··/~-]*[가-힣ㄱ-ㆎ]+)*/g;
// A line that is itself Korean prose — an explanation or an instruction
// written in Korean ("상대에게 허락을 물을 때") — is translated like any
// other prose; only the Korean set inside a line in another language is
// the thing being taught and must come through as it is.
const LETTER = /[A-Za-z\u00c0-\u024f\uac00-\ud7a3]/g;
const HANGUL = /[\uac00-\ud7a3]/g;
export function isKoreanProse(line) {
  const letters = (String(line || '').match(LETTER) || []).length;
  const korean = (String(line || '').match(HANGUL) || []).length;
  return letters > 0 && korean / letters >= 0.6;
}
export function koreanLost(source, translated) {
  if (isKoreanProse(source)) return [];
  const runs = String(source || '').match(HANGUL_RUN) || [];
  return runs.filter((r) => !String(translated || '').includes(r));
}

// Checks one language's translation against the English, line by line.
// Answers with the lines to replace: [{ line, problem, fix }].
export async function checkTranslation(cfg, en, edition, lang, langName) {
  const src = explanatoryText(en).map((s) => s.value);
  const got = explanatoryText(edition).map((s) => s.value);
  if (src.length !== got.length) return { ok: false, lines: [], broken: true };
  const isStrict = cfg.provider.strictSchema !== false;
  const item = strictObj({ line: { type: 'integer' }, problem: { type: 'string' }, fix: { type: 'string' } }, isStrict);
  const schema = strictObj({ problems: { type: 'array', items: item } }, isStrict);
  const system = [
    'You check the ' + langName + ' translation of the explanations on a Korean-language worksheet.',
    'Each numbered line is given in English (the source) and in ' + langName + '.',
    '',
    'Report a line only when the translation is wrong: a changed meaning, a mistranslated term,',
    'a grammar explanation that no longer says what the English says, broken or unnatural ' + langName + ',',
    'or Korean (Hangul) that is not exactly as it is in the English line — the Korean is what is being',
    'taught and must stay character for character, including deliberately wrong forms marked (X).',
    'Style preferences are not problems.',
    '',
    'For each problem give the line number, what is wrong, and `fix`: the whole corrected line in ' + langName + '.',
    'No problems: an empty list.'
  ].join('\n');
  const body = src.map((s, i) => (i + 1) + '. EN: ' + s + '\n   ' + lang + ': ' + got[i]).join('\n');
  const out = json(await cfg.provider.chat(cfg, system, body, schema), '번역 검수');
  const lines = (Array.isArray(out.problems) ? out.problems : [])
    .filter((p) => p && p.line >= 1 && p.line <= src.length && String(p.fix || '').trim());
  return { ok: !lines.length, lines };
}

// Puts corrected lines back into an edition (same slots as the check).
export function applyLines(edition, lines) {
  const copy = JSON.parse(JSON.stringify(edition));
  const slots = explanatoryText(copy);
  lines.forEach((p) => { const slot = slots[p.line - 1]; if (slot) slot.set(copy, String(p.fix).trim()); });
  return copy;
}

// Marks that are not in their sentence mark nothing; say so rather than
// let a sheet go out with an example that was meant to be underlined.
export function markProblems(sheet) {
  const out = [];
  if ((sheet.category || 'grammar') !== 'grammar') return out;
  (sheet.forms || []).forEach((f, i) => {
    const marks = Array.isArray(f.mark) ? f.mark : [];
    if (!marks.length) out.push('forms[' + (i + 1) + '].mark 가 비어 있습니다 (예문에서 문형이 쓰인 어절)');
    marks.filter((m) => m && !String(f.example || '').includes(m))
      .forEach((m) => out.push('forms[' + (i + 1) + '].mark "' + m + '" 가 예문에 없습니다'));
  });
  (sheet.watchOut || []).forEach((w, i) => {
    const marks = (Array.isArray(sheet.watchOutMark) ? sheet.watchOutMark[i] : null) || [];
    if (!marks.length) out.push('watchOutMark[' + (i + 1) + '] 가 비어 있습니다 (틀린 말과 맞는 말)');
    marks.filter((m) => m && !String(w).includes(m))
      .forEach((m) => out.push('watchOutMark[' + (i + 1) + '] "' + m + '" 가 그 항목에 없습니다'));
  });
  return out;
}

// One language: translated, the Korean checked by machine, every line
// checked by a reader, the lines it corrected put back.
export async function translateChecked(cfgs, en, lang) {
  const name = LANGUAGE_NAMES[lang];
  let extra = '';
  let edition = null;
  const record = { lang, tries: 0, lost: [], fixes: [] };
  for (let t = 0; t < TR_TRIES; t += 1) {
    record.tries += 1;
    try {
      edition = await translateSheet(translate, cfgs.translator, en, lang, 'English', extra);
    } catch (err) {
      // "did not line up": one line in, one line out went wrong. Asked again.
      log('    ' + lang + ': 번역 실패 — ' + err.message + ' — 다시');
      edition = null;
      continue;
    }
    const lost = lostKorean(en, edition, lang);
    if (lost.length) {
      record.lost = lost;
      extra = 'The last attempt changed the Korean in some lines. Keep every Korean (Hangul) word exactly as written, ' +
              'including deliberately wrong forms marked (X): ' + lost.slice(0, 12).join(', ');
      log('    ' + lang + ': 한국어가 바뀐 줄 ' + lost.length + '개 — 다시 번역');
      continue;
    }
    const checked = await checkTranslation(cfgs.writer, en, edition, lang, name);
    if (checked.broken) { extra = ''; continue; }
    if (checked.lines.length) {
      // A corrected line is taken only if its Korean is still exactly the
      // English line's Korean.
      const src = explanatoryText(en).map((x) => x.value);
      const keep = checked.lines.filter((p) => lang === 'ko' || !koreanLost(src[p.line - 1], p.fix).length);
      const refused = checked.lines.filter((p) => !keep.includes(p));
      if (keep.length) {
        edition = applyLines(edition, keep);
        record.fixes = keep;
        log('    ' + lang + ': 번역 검수에서 ' + keep.length + '줄 고침');
      }
      if (refused.length) {
        record.rejectedFixes = refused;
        log('    ' + lang + ': 한국어를 바꾸는 고침 ' + refused.length + '줄은 쓰지 않았습니다');
      }
    }
    record.lost = [];
    return { edition, record };
  }
  record.failed = true;
  return { edition, record };
}

function lostKorean(en, edition, lang) {
  if (lang === 'ko') return [];
  const a = explanatoryText(en).map((s) => s.value);
  const b = explanatoryText(edition).map((s) => s.value);
  if (a.length !== b.length) return ['(줄 수가 다름)'];
  const lost = [];
  a.forEach((line, i) => koreanLost(line, b[i]).forEach((k) => lost.push(k)));
  return lost;
}

