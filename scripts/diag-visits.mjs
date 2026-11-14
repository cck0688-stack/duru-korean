#!/usr/bin/env node
// DURU KOREAN — read-only: where do the visits counted in the footer come from? (owner, 2026-11-14: 4,087 today)
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD })
});
const token = (await login.json()).access_token;
if (!token) throw new Error('로그인 실패');
const h = { apikey: KEY, Authorization: 'Bearer ' + token };
const since = new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 10);
const rows = [];
for (let from = 0; ; from += 1000) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/visitor_logs?select=visitor_fingerprint,visited_date,page_path,created_at&visited_date=gte.' + since + '&order=created_at.asc',
    { headers: { ...h, Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
  if (!r.ok) throw new Error('읽기 ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const page = await r.json(); rows.push(...page);
  if (page.length < 1000) break;
}
console.log('최근 15일 방문 기록 ' + rows.length + '건');
const by = (key) => rows.reduce((m, r) => { const k = key(r); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log('\n날짜별 방문 (고유 지문 수):');
const days = by((r) => r.visited_date);
for (const d of Object.keys(days).sort()) {
  const fps = new Set(rows.filter((r) => r.visited_date === d).map((r) => r.visitor_fingerprint));
  console.log('  ' + d + '  ' + String(days[d]).padStart(5) + '건  · 고유 ' + fps.size);
}
const today = rows.length ? rows[rows.length - 1].visited_date : '';
const t = rows.filter((r) => r.visited_date === today);
console.log('\n오늘(' + today + ') 시간대별 (UTC 시):');
const hours = by.call(null, (r) => 0) && t.reduce((m, r) => { const k = r.created_at.slice(11, 13); m[k] = (m[k] || 0) + 1; return m; }, {});
for (const k of Object.keys(hours).sort()) console.log('  ' + k + '시  ' + hours[k]);
console.log('\n오늘 가장 많은 지문 상위 8 (한 지문이 몇 번 기록했나):');
const fp = t.reduce((m, r) => { m[r.visitor_fingerprint] = (m[r.visitor_fingerprint] || 0) + 1; return m; }, {});
Object.entries(fp).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log('  ' + k + '  ' + v + '건'));
console.log('고유 지문 ' + Object.keys(fp).length + '개 / 오늘 ' + t.length + '건');
console.log('\n오늘 가장 많은 페이지 상위 12:');
const pg = t.reduce((m, r) => { const k = (r.page_path || '').slice(0, 70); m[k] = (m[k] || 0) + 1; return m; }, {});
Object.entries(pg).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));

// Who the most repeated visitors are: when they come, and what share of the day they are.
console.log('\n가장 많이 반복된 지문 3개: 언제 왔나 (UTC)');
Object.entries(fp).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([k, v]) => {
  const mine = t.filter((r) => r.visitor_fingerprint === k);
  console.log('  ' + k + ' ' + v + '건 · ' + mine[0].created_at.slice(11, 19) + ' ~ ' + mine[mine.length - 1].created_at.slice(11, 19) + ' · 예: ' + mine.slice(0, 3).map((r) => r.page_path).join(' | ').slice(0, 120));
});
const repeated = Object.values(fp).filter((n) => n >= 5).reduce((a, b) => a + b, 0);
const single = Object.values(fp).filter((n) => n === 1).length;
console.log('오늘 5번 이상 기록한 지문들이 합쳐서 ' + repeated + '건 · 딱 한 번만 온 지문 ' + single + '개 (전체 ' + t.length + '건)');
