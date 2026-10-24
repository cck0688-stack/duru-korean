// DURU KOREAN — the list of the book's audio files for listen.html (owner, 2026-10-24).
// Files are named B<book>-<chapter>-<track>.mp3 (B1-03-02.mp3) or B1-CP1-01.mp3 for a review
// chapter. This reads the folder, measures each file with ffprobe and writes
// assets/audio/book1.json, keeping any title already written in that file by hand.
//
//   node scripts/audio-index.mjs [--dir=assets/audio/book1] [--out=assets/audio/book1.json]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d; };
const dir = arg('dir', 'assets/audio/book1');
const out = arg('out', 'assets/audio/book1.json');
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { chapters: [] };
const oldChapter = (key) => (prev.chapters || []).find((c) => String(c.key) === key) || {};
const files = fs.readdirSync(dir).filter((f) => /^B\d+-[0-9A-Za-z]+-\d+\.mp3$/i.test(f)).sort();
const byKey = new Map();
for (const f of files) {
  const [, , chap, track] = f.replace(/\.mp3$/i, '').match(/^(B\d+)-([0-9A-Za-z]+)-(\d+)$/) ? f.replace(/\.mp3$/i, '').match(/^(B\d+)-([0-9A-Za-z]+)-(\d+)$/) : [];
  if (!byKey.has(chap)) byKey.set(chap, []);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path.join(dir, f)]).toString().trim());
  byKey.get(chap).push({ n: Number(track), file: path.posix.join(dir.replace(/^\.?\/?/, ''), f), dur: Math.round(seconds * 10) / 10 });
}
const rank = (k) => (/^\d+$/.test(k) ? [0, Number(k)] : [1, Number((k.match(/\d+/) || [0])[0])]);
const chapters = [...byKey.keys()].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; }).map((key) => {
  const old = oldChapter(key);
  const numeric = /^\d+$/.test(key);
  const tracks = byKey.get(key).sort((a, b) => a.n - b.n).map((t) => {
    const was = (old.tracks || []).find((x) => x.n === t.n) || {};
    return { n: t.n, title: was.title || { ko: '트랙 ' + t.n, en: 'Track ' + t.n }, ...(was.text ? { text: was.text } : {}), file: t.file, dur: t.dur };
  });
  return { key, n: numeric ? Number(key) : key, label: old.label || (numeric ? 'Ch. ' + Number(key) : key),
    title: old.title || (numeric ? { ko: '챕터 ' + Number(key), en: 'Chapter ' + Number(key) } : { ko: key, en: key }), tracks };
});
fs.writeFileSync(out, JSON.stringify({ book: 'book1', chapters }, null, 2) + '\n');
console.log(chapters.length + '개 챕터, 트랙 ' + chapters.reduce((s, c) => s + c.tracks.length, 0) + '개, 총 ' + Math.round(chapters.reduce((s, c) => s + c.tracks.reduce((a, t) => a + t.dur, 0), 0) / 60) + '분');
