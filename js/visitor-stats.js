// DURU KOREAN — visitor statistics panel
//
// Renders total / cumulative / today visitor counts for admins. The
// visitor_logs RLS policy already restricts SELECT to admin_users, so
// the aggregation runs client-side against rows only an admin can see;
// no extra database function or privilege is needed.

(function () {
  'use strict';

  // visitor_logs holds one row per visit, so distinct fingerprints have
  // to be counted over the fetched column. This caps
  // how many are pulled, since the figure is a headline, not a ledger.
  var DISTINCT_SCAN_LIMIT = 50000;

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  function setValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.getElementById('visitorStats');
    if (!panel) return;

    var client = window.DURU_SUPABASE_CLIENT;
    if (!client) return;

    // The database stamps visited_date in Korean time; ask for the same day.
    function today() {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    }

    function loadStats() {
      var todayDate = today();

      var cumulative = client
        .from('visitor_logs')
        .select('id', { count: 'exact', head: true });

      var todayCount = client
        .from('visitor_logs')
        .select('id', { count: 'exact', head: true })
        .eq('visited_date', todayDate);

      var distinct = client
        .from('visitor_logs')
        .select('visitor_fingerprint')
        .limit(DISTINCT_SCAN_LIMIT);

      return Promise.all([cumulative, todayCount, distinct]).then(function (res) {
        var cumRes = res[0], todayRes = res[1], distinctRes = res[2];

        if (cumRes.error || todayRes.error || distinctRes.error) {
          panel.hidden = true;
          return;
        }

        var seen = Object.create(null);
        (distinctRes.data || []).forEach(function (row) {
          seen[row.visitor_fingerprint] = true;
        });

        panel.hidden = false;
        setValue('statTotal', Object.keys(seen).length.toLocaleString());
        setValue('statCumulative', (cumRes.count || 0).toLocaleString());
        setValue('statToday', (todayRes.count || 0).toLocaleString());
      });
    }

    function onUser(user) {
      if (!user) { panel.hidden = true; return; }
      client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
        .then(function (res) {
          if (res.data) loadStats();
          else panel.hidden = true;
        });
    }

    client.auth.getSession().then(function (res) {
      onUser(res.data && res.data.session && res.data.session.user);
    });

    client.auth.onAuthStateChange(function (_event, session) {
      onUser(session && session.user);
    });

    document.addEventListener('duru:langchange', function () {
      var label = document.getElementById('statScanNote');
      if (label) {
        label.textContent = t('admin.statsNote', 'Unique visitors are counted from the most recent {n} records.')
          .replace('{n}', DISTINCT_SCAN_LIMIT.toLocaleString());
      }
    });
  });
})();
