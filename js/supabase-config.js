// DURU KOREAN — Supabase configuration
//
// These two values are safe to publish in client-side code: the "anon" key
// is a public, RLS-restricted key by Supabase's design, not a secret. Your
// actual data stays protected by Row Level Security (RLS) policies you set
// in the Supabase dashboard, not by hiding this key.
//
// Never put your Supabase "service_role" key here or anywhere in this
// repository — that key bypasses RLS and must only ever be used from a
// trusted server, never a browser.
//
// See README.md ("Authentication setup") for step-by-step instructions.

// siteUrl is the one address this site is meant to be reached at. Sign-in
// uses PKCE, which keeps a one-time verifier in the browser's storage for
// the exact origin that started the flow; coming back on a different
// origin leaves that verifier unreachable and the sign-in fails with
// nothing to show for it. The apex redirects to www at the CDN, so a
// visitor who starts on the apex would hit exactly that. auth.js uses
// this value to move them to the canonical host first.
window.DURU_SUPABASE_CONFIG = {
  url: 'https://ejiwgvlinlffkyycuyym.supabase.co',
  anonKey: 'sb_publishable__OrrC8MkIV5w5f5uhv622A_6E9OhGl2',
  siteUrl: 'https://www.durukorean.com',
};

// KakaoTalk sharing. Paste the JavaScript key from your app at
// developers.kakao.com (My Application → App Keys). Like the Supabase
// anon key this one is public by design and safe to commit; Kakao
// restricts it to the domains you register under Platform → Web.
// While it is empty the KakaoTalk share button is simply not rendered.
window.DURU_KAKAO_CONFIG = {
  jsKey: '',
};
