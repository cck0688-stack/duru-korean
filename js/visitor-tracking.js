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

  // Log visit to analytics
  async function trackVisit() {
    try {
      const fingerprint = await generateFingerprint();
      const today = new Date().toISOString().split('T')[0];
      const pagePath = window.location.pathname + window.location.search;

      // Check if this visitor is already logged for today
      const { data: existing } = await client
        .from('visitor_logs')
        .select('id')
        .eq('visitor_fingerprint', fingerprint)
        .eq('visited_date', today)
        .maybeSingle();

      // Only insert if not already logged today
      if (!existing) {
        await client
          .from('visitor_logs')
          .insert({
            visitor_fingerprint: fingerprint,
            visited_date: today,
            page_path: pagePath
          });
      }
    } catch (err) {
      // Fail silently — analytics should never break the site
      console.debug('Visitor tracking error:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', trackVisit);
})();
