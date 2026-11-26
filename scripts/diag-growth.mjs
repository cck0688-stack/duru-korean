#!/usr/bin/env node
// DURU KOREAN — read-only: visits and sign-ups over time, where visitors land, which language (owner, 2026-11-26).
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ejiwgvlinlffkyycuyym.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2';
const login = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: process.env.DURU_BOT_EMAIL, password: process.env.DURU_BOT_PASSWORD }) });
const token = (await login.json()).access_token; if (!token) throw new Error('로그인 실패');
const h = { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const get = async (p) => { const out = []; for (let f = 0; ; f += 1000) { const r = await fetch(SUPABASE_URL + '/rest/v1/' + p, { headers: { ...h, Range: f + '-' + (f + 999), 'Range-Unit': 'items' } }); if (!r.ok) throw new Error(p.split('?')[0] + ' ' + r.status); const pg = await r.json(); out.push(...pg); if (pg.length < 1000) break; } return out; };
const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
const v = await get('visitor_logs?select=visitor_fingerprint,visited_date,page_path&visited_date=gte.' + since + '&order=visited_date.asc');
// A fingerprint seen on only one day with one page and many such per day looks like a robot; show the plain numbers.
const byDay = {}; for (const r of v) (byDay[r.visited_date] ||= new Set()).add(r.visitor_fingerprint);
console.log('방문 기록(60일) ' + v.length + '건\n날짜별 고유 방문자:');
for (const d of Object.keys(byDay).sort()) console.log('  ' + d + ' ' + byDay[d].size);
const lang = {}; const top = {};
for (const r of v) { const p = String(r.page_path || '/'); const m = p.match(/^\/(en|ko|vi|es|id|pt-BR|ja|zh|fr|de)(\/|$)/); const l = m ? m[1] : '(없음)'; lang[l] = (lang[l] || 0) + 1; const k = p.replace(/\/[0-9a-f-]{36}.*/, '/:id').replace(/\/blog\/[^/]+$/, '/blog/:slug').split('?')[0]; top[k] = (top[k] || 0) + 1; }
console.log('\n언어 주소별:', JSON.stringify(lang));
console.log('\n많이 본 페이지 상위 25:'); for (const [k, n] of Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log('  ' + String(n).padStart(6) + '  ' + k);
const per = {}; for (const r of v) (per[r.visitor_fingerprint] ||= new Set()).add(r.visited_date);
const days = Object.values(per).map((s) => s.size); const ret = days.filter((n) => n >= 2).length;
console.log('\n고유 방문자 ' + days.length + '명 · 이틀 이상 온 사람 ' + ret + '명 (' + (days.length ? (100 * ret / days.length).toFixed(1) : 0) + '%)');
try {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/admin_list_members', { method: 'POST', headers: h, body: '{}' });
  if (!r.ok) throw new Error(r.status);
  const m = await r.json();
  console.log('\n회원 ' + m.length + '명');
  const wk = {}; for (const x of m) { const d = String(x.joined_at).slice(0, 10); wk[d] = (wk[d] || 0) + 1; }
  console.log('가입일: ' + Object.entries(wk).sort().map(([d, n]) => d + ' ' + n).join(' · '));
  const cnt = (f) => m.reduce((a, x) => { const k = f(x) || '(없음)'; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log('가입 방법:', JSON.stringify(cnt((x) => x.provider)), ' 이메일 확인:', JSON.stringify(cnt((x) => x.email_confirmed)), ' 마케팅 동의:', JSON.stringify(cnt((x) => x.marketing_agreed)));
  console.log('국적:', JSON.stringify(cnt((x) => x.nationality)));
} catch (e) { console.log('\n회원 목록을 읽지 못했습니다(' + e.message + ')'); }
const c = async (t, q = '') => { const r = await fetch(SUPABASE_URL + '/rest/v1/' + t + '?select=id&limit=1' + q, { headers: { ...h, Prefer: 'count=exact' } }); return r.headers.get('content-range'); };
console.log('\n공개 글:', await c('posts', '&published=eq.true'), ' 공개 자료:', await c('resources', '&status=eq.published'));
