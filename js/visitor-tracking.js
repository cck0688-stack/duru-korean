// DURU KOREAN — visitor analytics tracking
// Records one entry per unique visitor per day for admin analytics

(function () {
  'use strict';

  const client = window.DURU_SUPABASE_CLIENT;
  if (!client) return;

  // Generate a fingerprint from browser characteristics
  async function generateFingerprint() {
    const components = [
      navigator.userAgent || '',
      navigator.language || '',
      new Date().getTimezoneOffset() || '',
      window.screen.width || '',
      window.screen.height || '',
      window.screen.colorDepth || '',
      navigator.hardwareConcurrency || '',
    ].join('|');

    const encoder = new TextEncoder();
    const data = encoder.encode(components);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  // Record the visit.
  //
  // Every page view is written, not one row per fingerprint per day. The
  // old version first asked whether this visitor already had a row for
  // today, which could not work as intended: visitor_logs only grants
  // SELECT to admins, so for an ordinary visitor that lookup always came
  // back empty and the insert ran anyway — while for an admin it
  // suppressed their own repeat visits. Same person, different answer.
  //
  // Counting every view also matches what the numbers are read as:
  // cumulative visits is now a true total, and unique visitors still
  // comes from counting distinct fingerprints.
  async function trackVisit() {
    try {
      const fingerprint = await generateFingerprint();
      const today = new Date().toISOString().split('T')[0];
      const pagePath = window.location.pathname + window.location.search;

      const { error } = await client
        .from('visitor_logs')
        .insert({
          visitor_fingerprint: fingerprint,
          visited_date: today,
          page_path: pagePath
        });

      if (error) console.debug('Visitor tracking rejected:', error.message);
    } catch (err) {
      // Analytics must never break the page.
      console.debug('Visitor tracking error:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', trackVisit);
})();
