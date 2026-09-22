#!/usr/bin/env node
// DURU KOREAN — the morning's seven drafts
//
// Run by .github/workflows/daily-drafts.yml, once a day, before seven
// in the morning Seoul time. Writes seven drafts and stops; nothing
// here publishes anything. An admin reads them at blog.html and
// approves what is worth approving.
//
// It signs in as an ordinary Supabase account that happens to be in
// admin_users — not with the service_role key. That matters: if this
// job's secrets ever leak, what leaks is an account that can write blog
// drafts, not a key that reads every row in the database. Row Level
// Security still applies to every write below.
//
//   DURU_BOT_EMAIL      the account, which must be in admin_users
//   DURU_BOT_PASSWORD
//   OPENAI_API_KEY      (or ANTHROPIC_API_KEY / GOOGLE_API_KEY)
//   UNSPLASH_ACCESS_KEY (or PEXELS_API_KEY) — optional. Without one,
//                       the posts are written without a photograph.
//   TRANSLATE_PROVIDER  optional, when more than one key is present
//   TRANSLATE_MODEL     optional
//   SUPABASE_URL        optional, defaults to the project below
//   SUPABASE_ANON_KEY   optional
//
//   --dry-run   write nothing; print what would have been saved
//   --only=travel,dining   just those categories

import { resolveProvider } from '../api/_providers.js';
import { writeOne } from './lib/generate.mjs';
import { seasonFor, questionsFor, seoulToday, seoulDate } from './lib/season.mjs';
import { resolvePhotos, findPhoto } from '../api/_photos.js';
import { translateDraft } from './lib/mt.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';

// The same seven, described the same way, as js/blog-categories.js.
// Kept here rather than imported because that file is browser script
// that assigns to window; if the two ever disagree the test says so.
const CATEGORIES = [
  { id: 'travel', about: 'arriving and getting around Korea as a visitor: apps, transport, money, etiquette' },
  { id: 'dining', about: 'eating in Korea: how to order and eat, street food, convenience stores, dietary needs' },
  { id: 'style', about: 'Korean beauty and fashion: skincare, clinics, brands, shopping and tax refunds' },
  { id: 'explore', about: 'neighbourhoods, K-pop and drama locations, everyday Korean experiences, day trips' },
  { id: 'campus', about: 'living here long term: visas and paperwork, housing, healthcare, multicultural support' },
  { id: 'career', about: 'working in Korea: part-time work permits, job hunting, resumes, internships' },
  { id: 'etc', about: 'cultural nuances, news and policy for foreigners, and anything that fits nowhere else' }
];

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').slice(7)
  .split(',').map((s) => s.trim()).filter(Boolean);

const log = (...parts) => console.log(...parts);

// ── talking to Supabase ────────────────────────────────────────────

async function withRetry(what, run, tries) {
  const max = tries == null ? 3 : tries;
  let last;
  for (let i = 0; i < max; i += 1) {
    try {
      return await run();
    } catch (err) {
      last = err;
      // A refusal is a refusal. Only a connection that fell over, or a
      // server that said it was busy, is worth asking again.
      if (!/fetch failed|network|ECONN|timeout|429|50\d/i.test(String(err && err.message))) break;
      const wait = 2000 * Math.pow(2, i);
      log(`  ${what} 실패, ${wait / 1000}초 뒤 다시 시도합니다 (${i + 1}/${max})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

async function signIn() {
  const email = process.env.DURU_BOT_EMAIL;
  const password = process.env.DURU_BOT_PASSWORD;
  if (!email || !password) {
    throw new Error('DURU_BOT_EMAIL 과 DURU_BOT_PASSWORD 가 필요합니다.');
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Never the password, and never the token.
    throw new Error(`로그인 실패 (${res.status}): ${body.error_description || body.msg || '알 수 없음'}`);
  }
  return { token: body.access_token, userId: body.user && body.user.id };
}

function rest(token) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  return async function call(path, init) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { ...headers, ...((init && init.headers) || {}) }
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = (data && (data.message || data.hint)) || text || String(res.status);
      const err = new Error(`${res.status} ${message}`);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  };
}

// ── one day's work ─────────────────────────────────────────────────

async function main() {
  const today = seoulToday();
  const when = seoulDate();
  const season = seasonFor(when);

  let cfg;
  try {
    cfg = resolveProvider(process.env);
  } catch (err) {
    log('글을 쓸 수 없습니다:', err.message);
    process.exit(1);
  }
  // A photo service is optional. Without a key the posts are written
  // exactly as before, with nothing where the picture would be.
  let photoCfg = null;
  try {
    photoCfg = resolvePhotos(process.env);
  } catch (err) {
    log('사진 설정에 문제가 있습니다:', err.message);
  }

  log(`두루 블로그 — ${today} (서울 기준), ${season.month}월`);
  log(`글쓰기: ${cfg.label} · ${cfg.model}`);
  log(`사진: ${photoCfg ? photoCfg.label : '없음 (키가 설정되지 않았습니다)'}`);
  if (DRY) log('※ --dry-run: 아무것도 저장하지 않습니다\n');

  let wanted = ONLY.length
    ? CATEGORIES.filter((c) => ONLY.includes(c.id))
    : CATEGORIES;
  if (!wanted.length) {
    log(`--only 에 적은 카테고리가 없습니다: ${ONLY.join(', ')}`);
    process.exit(1);
  }

  let call = null;
  let userId = null;
  let existing = { titles: [], slugs: [], byCategory: {} };

  if (!DRY) {
    const session = await withRetry('로그인', signIn);
    call = rest(session.token);
    userId = session.userId;

    // Claim the day. The unique index on batch_date says whether this
    // is the first run today.
    let claimed = true;
    try {
      await call('blog_batches', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ batch_date: today, total: wanted.length, status: 'RUNNING' })
      });
    } catch (err) {
      if (err.code !== '23505') throw err;
      claimed = false;
    }

    // Already claimed means the day has been run — but not necessarily
    // finished. It can have stopped part-way, or a test run can have
    // taken the day with one category. Exiting here left those days
    // short with no way back but hand-written SQL, so instead the run
    // asks what is actually on the shelf and writes only what is not:
    // never a second post for a category, never nothing when six are
    // missing. The unique index on (batch_date, category) is what makes
    // that safe — it, not this check, is what stops a duplicate.
    if (!claimed) {
      const done = await withRetry('오늘 저장된 글 확인',
        () => call(`posts?select=category&batch_date=eq.${today}`));
      const have = new Set((done || []).map((r) => r.category));
      const missing = wanted.filter((c) => !have.has(c.id));
      if (!missing.length) {
        log(`${today} 는 이미 다 돌았습니다 (${have.size}편). 아무것도 하지 않고 끝냅니다.`);
        return;
      }
      log(`${today} 에 이미 ${have.size}편이 있습니다 — 빠진 ${missing.length}편만 씁니다: ` +
          `${missing.map((c) => c.id).join(', ')}\n`);
      wanted = missing;
      await call(`blog_batches?batch_date=eq.${today}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'RUNNING' })
      });
    }

    existing = await readExisting(call);
    log(`기존 글 ${existing.titles.length}편을 읽었습니다 (중복 방지용)\n`);
  }

  const results = [];
  for (const category of wanted) {
    log(`── ${category.id}`);
    try {
      const draft = await writeOne(cfg, {
        category: category.id,
        about: category.about,
        month: season.month,
        seasonNotes: season.notes,
        questions: questionsFor(category.id),
        existingTitles: (existing.byCategory[category.id] || []).slice(0, 20),
        existing: existing
      }, (m) => log(`  ${m}`));

      if (draft.problems.length) {
        log(`  검수 통과 못 함 — 저장하지 않습니다:`);
        draft.problems.forEach((p) => log(`    ${p.field}: ${p.message}`));
        results.push({ category: category.id, ok: false, stage: 'CONTENT_VALIDATION_FAILED',
                       error: draft.problems.map((p) => p.field).join(', ') });
        continue;
      }

      // Section 30: a picture that cannot be found must not cost the
      // writing. Everything below is inside its own try.
      draft.photo = null;
      if (photoCfg) {
        try {
          draft.photo = await findPhoto(cfg, photoCfg, {
            title: draft.title, topic: draft.topic, content: draft.content
          }, (m) => log(`  ${m}`));
          if (!draft.photo) log('  어울리는 사진을 찾지 못했습니다 — 사진 없이 저장합니다');
          else log(`  사진: ${draft.photo.credit} (${draft.photo.source})`);
        } catch (err) {
          log(`  사진 실패 (글은 그대로 저장합니다): ${err.message}`);
        }
      }

      // A draft nobody can read is a draft nobody approves. Seven
      // languages, now, while the post is in hand — so approval is one
      // click on something already readable, not the start of an
      // afternoon's translating. Like the photograph, it sits in its
      // own try: a translation that fails costs the translation, never
      // the writing. The admin editor can fill it in afterwards.
      draft.mt = {};
      try {
        draft.mt = await translateDraft(cfg, {
          lang: 'ko', title: draft.title, excerpt: draft.summary,
          tags: draft.tags, body: draft.content
        }, (done, total) => {
          if (done === 0) log(`  번역 중 (${total}묶음)`);
        });
        const got = Object.keys(draft.mt);
        log(got.length
          ? `  번역: ${got.join(', ')} (${got.length}개 언어)`
          : '  번역이 돌아오지 않았습니다 — 한국어로만 저장합니다');
      } catch (err) {
        log(`  번역 실패 (글은 그대로 저장합니다): ${err.message}`);
      }

      log(`  제목: ${draft.title}`);
      if (DRY) {
        log(`  요약: ${draft.summary}`);
        log(`  태그: ${draft.tags.join(', ')}`);
        log(`  slug: ${draft.slug}`);
        log(`  사진: ${draft.photo ? draft.photo.url : '없음'}`);
        log(`  번역: ${Object.keys(draft.mt).join(', ') || '없음'}`);
        log(`  본문 ${[...draft.content].length}자\n`);
        results.push({ category: category.id, ok: true, title: draft.title, slug: draft.slug });
        continue;
      }

      try {
        await withRetry('저장', () => call('posts', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(rowFor(draft, category.id, today, userId))
        }));
      } catch (err) {
        // The unique index on (batch_date, category) answering means
        // the row is already there — a reply that went missing on its
        // way back, and the retry arriving after it. The draft is
        // saved; saying it failed would send someone looking for it.
        if (err.code !== '23505') throw err;
        log('  이미 저장되어 있습니다.');
      }

      // Taken now, so the next category in this same run cannot repeat it.
      existing.titles.push(draft.title);
      existing.slugs.push(draft.slug);
      (existing.byCategory[category.id] = existing.byCategory[category.id] || []).push(draft.title);

      log(`  저장했습니다 (임시저장)\n`);
      results.push({ category: category.id, ok: true, title: draft.title, slug: draft.slug });
    } catch (err) {
      // Section 45: one category falling over is one category, not the
      // morning.
      log(`  실패: ${err.message}\n`);
      results.push({ category: category.id, ok: false, stage: stageOf(err), error: err.message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  if (!DRY) {
    await call(`blog_batches?batch_date=eq.${today}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: ok === results.length ? 'COMPLETED' : (ok ? 'PARTIAL' : 'FAILED'),
        succeeded: ok,
        failed: results.length - ok,
        detail: { results: results },
        completed_at: new Date().toISOString()
      })
    }).catch((err) => log('batch 기록 실패:', err.message));
  }

  report(today, results);
  if (!ok) process.exit(1);
}

function stageOf(err) {
  const m = String(err && err.message);
  if (/주제 선정/.test(m)) return 'TOPIC_SELECTION_FAILED';
  if (/본문 작성/.test(m)) return 'TEXT_GENERATION_FAILED';
  if (/제목·요약·태그|수정/.test(m)) return 'TITLE_GENERATION_FAILED';
  if (/^\d{3} /.test(m)) return 'DB_SAVE_FAILED';
  return 'TEXT_GENERATION_FAILED';
}

async function readExisting(call) {
  const rows = await call(
    'posts?select=title,slug,category&order=post_date.desc&limit=300');
  const byCategory = {};
  (rows || []).forEach((r) => {
    (byCategory[r.category] = byCategory[r.category] || []).push(r.title);
  });
  return {
    titles: (rows || []).map((r) => r.title),
    slugs: (rows || []).map((r) => r.slug),
    byCategory: byCategory
  };
}

function rowFor(draft, category, today, userId) {
  return {
    title: draft.title,
    slug: draft.slug,
    category: category,
    excerpt: draft.summary,
    body: draft.content,
    tags: draft.tags,
    lang: 'ko',
    published: false,
    topic: draft.topic,
    title_candidates: draft.titleCandidates,
    image_prompt: draft.imagePrompt || null,
    // Hotlinked from the service's CDN, with the credit beside it —
    // see section 29 of supabase/schema.sql for why it is not copied
    // into Supabase Storage.
    image_url: draft.photo ? draft.photo.url : null,
    image_alt: draft.photo ? draft.photo.alt : null,
    image_credit: draft.photo ? draft.photo.credit : null,
    image_credit_url: draft.photo ? draft.photo.creditUrl : null,
    image_source: draft.photo ? draft.photo.source : null,
    image_status: draft.photo ? 'READY' : 'FAILED',
    // Section 23's shape, written by the same splitter the reader's
    // browser uses — see scripts/lib/mt.mjs.
    mt: draft.mt || {},
    batch_date: today,
    // post_date is left to the database, which computes today in Seoul.
    // This is the day the post will carry however long it waits for
    // approval — see section 28 of supabase/schema.sql.
    created_by: userId || null
  };
}

// Section 44.
function report(today, results) {
  const ok = results.filter((r) => r.ok);
  const lines = [
    '',
    '두루 블로그 — 오늘의 초안',
    '',
    `날짜: ${today}`,
    `생성: ${results.length}  ·  성공: ${ok.length}  ·  실패: ${results.length - ok.length}`,
    ''
  ];
  results.forEach((r) => {
    lines.push(r.ok ? `  ${r.category}: ${r.title}` : `  ${r.category}: 실패 (${r.stage})`);
  });
  lines.push('', 'durukorean.com/blog 에서 검토하고 승인해 주세요.');
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    import('node:fs').then((fs) =>
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n'));
  }
}

main().catch((err) => {
  console.error('멈췄습니다:', err && err.message);
  process.exit(1);
});
