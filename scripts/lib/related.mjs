// DURU KOREAN — which earlier posts are about the same thing as a new one (owner, 2026-11-13).
// The same subject is fine when the post goes another way; the same conclusion, reasons, examples and
// sub-headings are not. Words alone cannot tell the two apart, so this only FINDS the earlier posts on the
// subject (no model, no tokens); the writer is then told what they already said, and a small model is asked
// once whether the new one goes the same way (generate.mjs).
//
// A post is its title, topic, summary and sub-headings. Words are cut to their stem (particles and endings off),
// weighted by how rare they are across the posts, and compared by cosine. Measured on the 362 published posts:
// two posts on one subject score 0.10 and up, two unrelated ones 0.08 at the 99th percentile — so the line is 0.15 (a little above, to leave out chance matches).

const PART = /(은|는|이|가|을|를|에|의|도|로|와|과|에서|으로|한테|께|요|니다|해요|어요|아요|했어요|이에요|예요|이라고|라고|죠|까요|나요)$/;

export function headings(body) {
  return String(body || '').split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim()).filter(Boolean);
}

function stems(text) {
  const out = new Map();
  for (const raw of String(text || '').replace(/[^0-9A-Za-z가-힣 \n]/g, ' ').split(/\s+/)) {
    const w = raw.replace(PART, '');
    if (w.length >= 2) out.set(w, (out.get(w) || 0) + 1);
  }
  return out;
}

const docText = (p) => [p.title, p.topic, p.excerpt, (p.heads || headings(p.body)).join(' ')].filter(Boolean).join(' ');

export function buildIndex(posts) {
  const docs = posts.map((p) => stems(docText(p)));
  const df = new Map();
  for (const d of docs) for (const w of d.keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = Math.max(1, docs.length);
  const weigh = (d) => {
    const v = new Map(); let n = 0;
    for (const [w, c] of d) {
      const f = df.get(w);
      if (f == null || f >= N * 0.2) continue;           // a word in a fifth of all posts says nothing
      const x = (1 + Math.log(c)) * Math.log(N / f);
      v.set(w, x); n += x * x;
    }
    n = Math.sqrt(n) || 1;
    for (const [w, x] of v) v.set(w, x / n);
    return v;
  };
  return { posts, vecs: docs.map(weigh), weigh };
}

const cosine = (a, b) => {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [w, x] of a) { const y = b.get(w); if (y) s += x * y; }
  return s;
};

// The earlier posts on the subject of `text` (a topic and its angle), best first.
export function findRelated(index, text, { k = 3, min = 0.15 } = {}) {
  const q = index.weigh(stems(text));
  return index.vecs.map((v, i) => ({ post: index.posts[i], score: cosine(q, v) }))
    .filter((x) => x.score >= min).sort((a, b) => b.score - a.score).slice(0, k)
    .map((x) => ({ ...x.post, heads: x.post.heads || headings(x.post.body), score: x.score }));
}

// What an earlier post already said, in a few lines for a prompt. `withEnd` adds its last paragraph (its conclusion).
export function describe(p, withEnd = false) {
  const heads = (p.heads || headings(p.body)).slice(0, 5);
  return `- 「${p.title}」` + (p.excerpt ? ` — ${String(p.excerpt).slice(0, 110)}` : '') + (heads.length ? `\n  소제목: ${heads.join(' / ')}` : '') +
    (withEnd && p.tail ? `\n  끝 문단: ${String(p.tail).slice(0, 160)}` : '');
}

// The last paragraph of a body that is not a heading: what the post ends on.
export function tailOf(body) {
  const paras = String(body || '').split(/\n{2,}/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
  return paras.length ? paras[paras.length - 1] : '';
}
