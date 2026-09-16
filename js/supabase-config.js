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

window.DURU_SUPABASE_CONFIG = {
  url: 'YOUR_SUPABASE_PROJECT_URL', // e.g. https://xxxxxxxxxxxx.supabase.co
  anonKey: 'YOUR_SUPABASE_ANON_KEY',
};
