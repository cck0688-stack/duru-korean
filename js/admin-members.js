// DURU KOREAN — the members who really signed up, in the admin window (owner, 2026-11-14).
// Reads public.admin_list_members() (supabase/schema.sql): admins only, no birth date. Until the owner has run that
// SQL once, the tab says so and offers the SQL to copy.
(function () {
  'use strict';
  var PAGE = 50;
  // The same SQL as in supabase/schema.sql (that folder is not served by the site).
  var MEMBERS_SQL = [
    '-- A function whose returned columns change must be dropped first (it is safe: it only reads).',
    'drop function if exists public.admin_list_members();',
    '',
    'create or replace function public.admin_list_members()',
    'returns table (',
    '  member_id uuid,',
    '  member_email text,',
    '  nickname text,',
    '  nationality text,',
    '  provider text,',
    '  joined_at timestamptz,',
    '  last_seen_at timestamptz,',
    '  email_confirmed boolean,',
    '  marketing_agreed boolean,',
    '  is_admin_member boolean',
    ')',
    'language plpgsql stable security definer set search_path = public, auth as $$',
    'begin',
    '  if not public.is_admin() then',
    '    raise exception \'not authorized\';',
    '  end if;',
    '  return query',
    '  select u.id,',
    '         u.email::text,',
    '         p.nickname,',
    '         u.raw_user_meta_data->>\'nationality\',',
    '         coalesce(u.raw_app_meta_data->>\'provider\', \'email\'),',
    '         u.created_at,',
    '         u.last_sign_in_at,',
    '         (u.email_confirmed_at is not null),',
    '         coalesce(p.marketing_agreed, false),',
    '         exists (select 1 from public.admin_users a where a.user_id = u.id)',
    '  from auth.users u',
    '  left join public.user_profiles p on p.user_id = u.id',
    '  order by u.created_at desc;',
    'end;',
    '$$;',
    '',
    'revoke all on function public.admin_list_members() from public, anon;',
    'grant execute on function public.admin_list_members() to authenticated;'
  ].join('\n');


  function t(key, fallback) {
    var v = window.DURU_I18N && window.DURU_I18N.t ? window.DURU_I18N.t(key) : key;
    return v && v !== key ? v : fallback;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function country(code) {
    if (!code) return '–';
    if (code === 'ZZ') return t('auth.nationalityOther', 'Other');
    try { return new Intl.DisplayNames([(window.DURU_I18N && window.DURU_I18N.lang) || 'en', 'en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
  }
  function day(iso) { return iso ? String(iso).slice(0, 10) : '–'; }

  document.addEventListener('DOMContentLoaded', function () {
    var client = window.DURU_SUPABASE_CLIENT;
    var panel = document.getElementById('membersPanel');
    var tabBtn = document.querySelector('.inbox-tab[data-tab="members"]');
    if (!client || !panel || !tabBtn) return;

    var rows = null, shown = PAGE, query = '', loading = false;
    var body = document.getElementById('membersBody');
    var summary = document.getElementById('membersSummary');
    var notice = document.getElementById('membersNotice');
    var search = document.getElementById('membersSearch');
    var more = document.getElementById('membersMore');
    var countEl = document.getElementById('membersCount');
    function fillSql() { return Promise.resolve(MEMBERS_SQL); }

    function render() {
      if (!rows) return;
      var q = query.trim().toLowerCase();
      var list = q ? rows.filter(function (r) {
        return (r.member_email || '').toLowerCase().indexOf(q) >= 0 || (r.nickname || '').toLowerCase().indexOf(q) >= 0;
      }) : rows;
      var now = Date.now(), d7 = now - 7 * 864e5, today = new Date().toISOString().slice(0, 10);
      summary.textContent = t('members.total', 'Members') + ' ' + rows.length + ' · ' + t('members.today', 'joined today') + ' ' +
        rows.filter(function (r) { return day(r.joined_at) === today; }).length + ' · ' + t('members.week', 'last 7 days') + ' ' +
        rows.filter(function (r) { return Date.parse(r.joined_at) >= d7; }).length;
      if (countEl) countEl.textContent = rows.length;
      body.innerHTML = list.slice(0, shown).map(function (r) {
        return '<tr>' +
          '<td>' + esc(day(r.joined_at)) + '</td>' +
          '<td>' + esc(r.nickname || '–') + (r.is_admin_member ? ' <span class="members-admin">' + esc(t('members.admin', 'admin')) + '</span>' : '') + '</td>' +
          '<td>' + esc(country(r.nationality)) + '</td>' +
          '<td class="members-mail">' + esc(r.member_email || '–') + (r.email_confirmed ? '' : ' <span class="members-warn" title="' + esc(t('members.unconfirmed', 'Email not confirmed')) + '">!</span>') + '</td>' +
          '<td>' + esc(r.provider || 'email') + '</td>' +
          '<td>' + esc(day(r.last_seen_at)) + '</td>' +
          '<td>' + (r.marketing_agreed ? '✓' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="members-empty">' + esc(t('members.empty', 'No members found.')) + '</td></tr>';
      more.hidden = list.length <= shown;
    }

    function load() {
      if (loading) return; loading = true;
      client.rpc('admin_list_members').then(function (res) {
        loading = false;
        if (res.error) {
          // The function is not in the database yet (42883 / PGRST202), or the caller is not an admin.
          var missing = /admin_list_members|PGRST202|42883|schema cache|could not find/i.test(res.error.message + ' ' + (res.error.code || ''));
          notice.hidden = false;
          document.getElementById('membersTable').hidden = true;
          document.getElementById('membersTools').hidden = true;
          notice.querySelector('p').textContent = missing
            ? t('members.needSql', 'To list the members the database needs one function, once. Open Supabase → SQL Editor, paste this and run it:')
            : (t('members.failed', 'Could not load the members') + ': ' + res.error.message);
          notice.querySelector('pre').hidden = !missing;
          notice.querySelector('button').hidden = !missing;
          if (missing) fillSql().then(function (sql) { notice.querySelector('pre').textContent = sql; });
          return;
        }
        notice.hidden = true;
        document.getElementById('membersTable').hidden = false;
        document.getElementById('membersTools').hidden = false;
        rows = res.data || [];
        // A function made before the nationality was added has no such column: say how to update it.
        if (rows.length && !('nationality' in rows[0])) {
          notice.hidden = false;
          notice.querySelector('p').textContent = t('members.updateSql', 'To show the nationality, run this once more in Supabase → SQL Editor (it only reads data):');
          notice.querySelector('pre').hidden = false; notice.querySelector('button').hidden = false;
          fillSql().then(function (sql) { notice.querySelector('pre').textContent = sql; });
        }
        render();
      });
    }

    tabBtn.addEventListener('click', function () { if (!rows) load(); });
    document.getElementById('membersRefresh').addEventListener('click', function () { rows = null; load(); });
    search.addEventListener('input', function () { query = search.value; shown = PAGE; render(); });
    more.addEventListener('click', function () { shown += PAGE; render(); });
    notice.querySelector('button').addEventListener('click', function () {
      var b = this; fillSql().then(function (sql) {
        if (navigator.clipboard) navigator.clipboard.writeText(sql).then(function () { b.textContent = t('adminInbox.copied', 'Copied'); });
      });
    });
    // The members are counted on the tab as soon as the page is ready, not only when it is opened.
    setTimeout(function () { if (!rows) load(); }, 1200);
  });
})();
