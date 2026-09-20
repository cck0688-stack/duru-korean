// DURU KOREAN — visitor counting
//
// Every page view writes one row to visitor_logs, so the same person
// coming back later the same day counts again: the numbers are visits,
// not people. The footer then shows the running total and today's count
// through get_visitor_counts(), a function that may be called by anyone
// while the rows themselves stay readable only by an admin.

(function () {
  'use strict';

  var client = window.DURU_SUPABASE_CLIENT;
  if (!client) return;

  function t(key, fallback) {
    if (!window.DURU_I18N) return fallback;
    var translated = window.DURU_I18N.t(key);
    return translated === key ? fallback : translated;
  }

  // A stable-enough id for "unique visitors" on the admin page. SHA-256
  // needs a secure context, so a plain string hash stands in elsewhere.
  function fingerprint() {
    var parts = [
      navigator.userAgent || '',
      navigator.language || '',
      new Date().getTimezoneOffset(),
      window.screen.width || '',
      window.screen.height || '',
      window.screen.colorDepth || '',
      navigator.hardwareConcurrency || ''
    ].join('|');
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('').slice(0, 16);
      });
    }
    var h = 0;
    for (var i = 0; i < parts.length; i++) h = (h * 31 + parts.charCodeAt(i)) | 0;
    return Promise.resolve('fb' + (h >>> 0).toString(16));
  }

  function recordVisit() {
    return fingerprint().then(function (fp) {
      // visited_date is left to the database, which stamps it in Korean
      // time, so "today" means the same thing to every visitor.
      return client.from('visitor_logs').insert({
        visitor_fingerprint: fp,
        page_path: window.location.pathname + window.location.search
      });
    }).then(function (res) {
      if (res && res.error) console.debug('Visitor tracking rejected:', res.error.message);
    }).catch(function (err) {
      console.debug('Visitor tracking error:', err);
    });
  }

  function showCounts() {
    var box = document.querySelector('.footer-visits');
    if (!box) return;
    client.rpc('get_visitor_counts').then(function (res) {
      var row = res.data && (Array.isArray(res.data) ? res.data[0] : res.data);
      if (res.error || !row) return;
      box.querySelector('[data-visitor-total]').textContent = Number(row.total_visits || 0).toLocaleString();
      box.querySelector('[data-visitor-today]').textContent = Number(row.today_visits || 0).toLocaleString();
      box.hidden = false;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    recordVisit().then(showCounts);
  });
  document.addEventListener('duru:langchange', function () {
    var box = document.querySelector('.footer-visits');
    if (!box || box.hidden) return;
    box.querySelector('[data-visitor-total-label]').textContent = t('footer.visitorsTotal', 'Total visitors');
    box.querySelector('[data-visitor-today-label]').textContent = t('footer.visitorsToday', 'Today');
  });
})();
