// DURU KOREAN — visitor counting
//
// One row per visit, not per page view: opening the site counts once,
// and walking around the menus after that does not count again. The
// same person coming back later counts again, signed in or not — the
// numbers are visits, not people. The header shows the running total
// and today's count beside the wordmark, through get_visitor_counts(),
// a function anyone may call while the rows stay readable only by an
// admin.

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

  // The visit marker lives in sessionStorage, so it goes when the tab
  // does and a return trip counts as a new visit. A tab left open and
  // picked up again much later is a new visit too, hence the window.
  // Where storage is unavailable (private mode) every page view counts,
  // the old behaviour: there is no way to tell one visit from the next.
  var VISIT_KEY = 'duru_visit_at';
  var VISIT_WINDOW_MS = 30 * 60 * 1000;

  function startsNewVisit() {
    var now = Date.now();
    var last = 0;
    try { last = Number(sessionStorage.getItem(VISIT_KEY)) || 0; } catch (e) {}
    try { sessionStorage.setItem(VISIT_KEY, String(now)); } catch (e) {}
    return !last || now - last > VISIT_WINDOW_MS;
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
    var box = document.querySelector('.site-visits');
    if (!box) return;
    client.rpc('get_visitor_counts').then(function (res) {
      var row = res.data && (Array.isArray(res.data) ? res.data[0] : res.data);
      if (res.error || !row) return;
      box.querySelector('[data-visits-total]').textContent = Number(row.total_visits || 0).toLocaleString();
      box.querySelector('[data-visits-today]').textContent = Number(row.today_visits || 0).toLocaleString();
      box.hidden = false;
    });
  }

  // Owner, 2026-11-14: from 9 November the count jumped from ~100 a day to 3,000-5,000, nearly every one a different
  // "visitor", round the clock, on tag-filtered blog lists in every language: robots that run JavaScript. A browser
  // that says it is automated, or names itself a robot, is not counted (a robot that hides its name still is).
  var ROBOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|bingpreview|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|perplexity|ccbot|python|curl\/|wget|httpclient|okhttp|monitor|uptime|check_http|phantomjs|playwright|puppeteer/i;
  function isRobot() {
    try {
      if (navigator.webdriver) return true;
      if (ROBOT.test(navigator.userAgent || '')) return true;
      if (!navigator.languages || !navigator.languages.length) return true;
    } catch (e) { /* a browser that cannot be asked is counted */ }
    return false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (isRobot()) { showCounts(); return; }
    if (startsNewVisit()) recordVisit().then(showCounts);
    else showCounts();
  });
  document.addEventListener('duru:langchange', function () {
    var box = document.querySelector('.site-visits');
    if (!box || box.hidden) return;
    box.querySelector('[data-visits-total-label]').textContent = t('visits.total', 'Visits');
    box.querySelector('[data-visits-today-label]').textContent = t('visits.today', 'Today');
  });
})();
