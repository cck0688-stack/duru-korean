// DURU KOREAN — the owner's two fixes to the blog posts already written
// (owner, 2026-10-12):
//
//   1. The owner does not teach now. A sentence that calls a foreigner the
//      writer's own student ("제 제자", "제가 가르친 학생", "베트남 제자") is
//      rewritten to say just "외국인 학생", no nationality. Only those
//      sentences change; each one is translated again into the languages
//      the post already has, so the reader's pairing (posts.mt) still holds.
//   2. A photograph used by more than one post stays on the oldest post;
//      every later one gets a photo no other post has.
//
//   node scripts/fix-blog.mjs [--dry-run] [--only=words|photos]
//
// --dry-run lists what would change and changes nothing.

import { LANGUAGES, translate, resolveProvider } from '../api/_providers.js';
import { resolvePhotos, findPhoto, photoKey } from '../api/_photos.js';
import { MT } from './lib/mt.mjs';
import { useSubscription, subscriptionAccount, usageReport } from './lib/claude-code.mjs';
import { withPatience } from './lib/patiently.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const log = (...a) => console.log(...a);

// The writer as somebody's teacher, or a student named by nationality.
const TEACHER = /제가 가르|제자|가르친|가르치던|가르쳤던|가르치는 학생|가르치고 있는|제 학생|우리 학생|제 수업|우리 반 학생|베트남\s?(에서 온\s?)?(학생|친구)|베트남 출신/;

async function signIn() {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('로그인 실패 (' + res.status + ')');
  return body.access_token;
}

async function call(token, path, init) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...((init && init.headers) || {}) }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

async function allPosts(token) {
  const out = [];
  for (let from = 0; ; from += 500) {
    const rows = await call(token, 'posts?select=id,slug,title,excerpt,body,tags,lang,mt,study,category,topic,published,post_date,created_at,image_url' +
      '&order=created_at.asc&limit=500&offset=' + from);
    out.push(...rows);
    if (rows.length < 500) return out;
  }
}

// Each flagged sentence back, rewritten, one for one.
async function rewrite(cfg, sentences) {
  const system = [
    '두루 한국어 블로그 글의 문장을 고칩니다 (운영자 지시, 2026-10-12).',
    '글쓴이(한국인 운영자)는 지금 학생을 가르치고 있지 않습니다.',
    '- 외국인을 글쓴이의 제자·학생으로 쓴 부분("제 제자", "제가 가르친 학생", "우리 반 학생", "베트남 제자")을',
    '  나라 없이 그냥 "외국인 학생"(또는 문맥상 "외국인 친구")으로 바꾸세요. "베트남" 같은 나라 이름도 빼세요.',
    '- 그 밖의 내용과 말투, 문장 끝은 그대로 두세요. 한 문장은 한 문장으로 돌려주세요 (마침표를 더하지 마세요).',
    '- 그 학생이 글쓴이를 "선생님"이라고 부르는 말이 문장에 있으면 그 호칭도 빼세요.',
    '- 고칠 것이 없는 문장(예: 한국 선생님이 아이를 가르친다)은 그대로 돌려주세요.'
  ].join('\n');
  const user = '문장들(JSON 배열):\n' + JSON.stringify(sentences);
  const text = await cfg.provider.chat(cfg, system, user, {
    type: 'object', additionalProperties: false, required: ['sentences'],
    properties: { sentences: { type: 'array', items: { type: 'string' } } }
  });
  const out = JSON.parse(text).sentences || [];
  if (out.length !== sentences.length) throw new Error('고친 문장 수가 다릅니다');
  // What the model left of the writer as teacher goes by rule.
  return out.map((s, i) => (String(s || '').trim() || sentences[i])
    .replace(/제가 가르(치는|친|치던|쳤던)\s*(외국인\s*)?(학생|친구)/g, '외국인 $3')
    .replace(/(베트남|일본|중국|미국|독일)(에서 온)?\s*(학생|친구)/g, '외국인 $3'));
}

async function fixWords(cfg, token, posts) {
  let fixed = 0;
  for (const post of posts) {
    const from = post.lang || 'ko';
    const sentences = MT.sentences(post.body || '');
    const idx = sentences.map((s, i) => (TEACHER.test(s) ? i : -1)).filter((i) => i >= 0);
    const head = [post.title || '', post.excerpt || ''];
    const headIdx = head.map((s, i) => (TEACHER.test(s) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length && !headIdx.length) continue;
    log('· ' + (post.published ? '[게시] ' : '[초안] ') + post.title);
    idx.forEach((i) => log('    본문: ' + sentences[i]));
    headIdx.forEach((i) => log('    ' + (i ? '요약' : '제목') + ': ' + head[i]));
    if (DRY) { fixed += 1; continue; }
    try {
      const olds = idx.map((i) => sentences[i]).concat(headIdx.map((i) => head[i]));
      const news = await rewrite(cfg, olds);
      let body = post.body;
      idx.forEach((i, k) => { body = body.replace(sentences[i], news[k]); });
      const after = MT.sentences(body);
      if (after.length !== sentences.length) throw new Error('문장 수가 바뀌어 번역 짝이 깨집니다 — 건너뜁니다');
      const newHead = head.slice();
      headIdx.forEach((i, k) => { newHead[i] = news[idx.length + k]; });
      const changedIdx = idx.filter((i) => after[i] !== sentences[i]);
      const headChanged = headIdx.some((i) => newHead[i] !== head[i]);
      if (!changedIdx.length && !headChanged) { log('    고칠 것 없음'); continue; }
      changedIdx.forEach((i) => log('    → ' + after[i]));

      // The changed sentences (and the head, when it changed) into every language the post has.
      const mt = { ...(post.mt || {}) };
      const targets = Object.keys(mt).filter((c) => LANGUAGES[c] && c !== from);
      const tags = (post.tags || []).map((x) => String(x || ''));
      const send = changedIdx.map((i) => after[i]);
      const headSend = headChanged ? [newHead[0], newHead[1] || ' '].concat(tags) : [];
      const all = send.concat(headSend);
      const fresh = targets.length && all.length
        ? (await translate({ from, fromName: LANGUAGES[from], targets, sentences: all }, cfg)).translations : {};
      const hash = MT.fingerprint(body);
      const headHash = MT.fingerprint([newHead[0], newHead[1]].concat(tags).join('\u0000'));
      for (const c of targets) {
        const got = fresh[c] || [];
        if (got.length !== all.length || !Array.isArray(mt[c].sentences) || mt[c].sentences.length !== after.length) { delete mt[c]; continue; }
        const s = mt[c].sentences.slice();
        changedIdx.forEach((i, k) => { s[i] = got[k]; });
        const entry = { ...mt[c], sentences: s, hash, at: new Date().toISOString() };
        if (headChanged) Object.assign(entry, { title: String(got[send.length] || '').trim(), excerpt: String(got[send.length + 1] || '').trim(), headHash });
        mt[c] = entry;
      }
      const patch = { body, mt, updated_at: new Date().toISOString() };
      if (headChanged) { patch.title = newHead[0]; patch.excerpt = newHead[1] || null; }
      if (post.study && post.study.hash) patch.study = { ...post.study, hash };
      await call(token, 'posts?id=eq.' + post.id, { method: 'PATCH', body: JSON.stringify(patch) });
      fixed += 1;
    } catch (err) {
      log('    실패: ' + err.message);
    }
  }
  log('표현: ' + fixed + '편' + (DRY ? ' 고칠 예정 (연습)' : ' 고침'));
}

async function fixPhotos(cfg, photoCfg, token, posts) {
  const used = new Set(posts.map((p) => photoKey(p.image_url)).filter(Boolean));
  const seen = new Map();
  let fixed = 0;
  for (const post of posts) {
    const key = photoKey(post.image_url);
    if (!key) continue;
    if (!seen.has(key)) { seen.set(key, post); continue; }
    log('· 사진이 「' + seen.get(key).title + '」와 같음: ' + post.title);
    if (DRY) { fixed += 1; continue; }
    if (!photoCfg) { log('    사진 서비스 키가 없습니다'); continue; }
    try {
      const photo = await findPhoto(cfg, photoCfg, {
        title: post.title, topic: post.topic, content: post.body, category: post.category, avoid: used
      }, (m) => log('    ' + m));
      if (!photo) { log('    새 사진을 찾지 못했습니다'); continue; }
      used.add(photoKey(photo.url));
      await call(token, 'posts?id=eq.' + post.id, { method: 'PATCH', body: JSON.stringify({
        image_url: photo.url, image_alt: photo.alt || null, image_credit: photo.credit || null,
        image_credit_url: photo.creditUrl || null, image_source: photo.source || null, image_status: 'READY',
        updated_at: new Date().toISOString()
      }) });
      log('    → ' + photo.url);
      fixed += 1;
    } catch (err) {
      log('    실패: ' + err.message);
    }
  }
  log('사진: ' + fixed + '편' + (DRY ? ' 바꿀 예정 (연습)' : ' 바꿈'));
}

async function main() {
  const cfg = withPatience(useSubscription(process.env, 'BLOG_PROVIDER')
    ? Object.assign(subscriptionAccount(process.env.BLOG_MODEL || 'sonnet'), { timeoutMs: 300000 })
    : resolveProvider(process.env), log);
  let photoCfg = null;
  try { photoCfg = resolvePhotos(process.env); } catch (err) { log('사진 설정: ' + err.message); }
  const token = await signIn();
  const posts = await allPosts(token);
  log('블로그 글 ' + posts.length + '편' + (DRY ? ' (연습: 바꾸지 않습니다)' : ''));
  if (ONLY !== 'photos') await fixWords(cfg, token, posts);
  if (ONLY !== 'words') await fixPhotos(cfg, photoCfg, token, posts);
  try { const u = usageReport(); if (u) log(u); } catch (e) { /* none */ }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
