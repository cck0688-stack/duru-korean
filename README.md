# Duru Korean

A static marketing site for Duru Korean, deployed on GitHub Pages. Plain HTML/CSS/JS — no build step.

## Structure

```
index.html            Home
start-here.html        "Learning Path" nav destination
learning-korean.html   "Learn Korean" curriculum overview
book-audio.html        "Book & Audio"
free-resources.html    Free downloadable resources
blog.html               Blog listing
about.html              About the authors
my-learning.html        Signed-in account page (linked from the account menu, not the main nav)
css/style.css            All styles
js/main.js               Nav, FAQ accordion, blog filters, scroll behavior
js/supabase-config.js    Supabase project URL + anon key (placeholders — see below)
js/auth.js                Login/signup modal + auth state handling
js/resources.js           Admin-managed file attach/delete on Free Resources & Book & Audio
js/i18n.js                 Homepage language switcher (English / Vietnamese / Korean)
js/i18n/en.json, vi.json, ko.json   Homepage translation strings
supabase/schema.sql       SQL to run once in the Supabase dashboard (admin table, resources table, RLS, storage policies)
```

## Authentication setup (Supabase Auth)

The site's "Log in" button and account menu are fully wired to
[Supabase Auth](https://supabase.com/docs/guides/auth) — email/password
signup with email verification, login, logout, password reset, resend
verification, and Google OAuth. Until you connect a real Supabase project,
the modal opens and works, but shows an honest "sign-in isn't connected
yet" notice instead of pretending to authenticate anyone. No passwords are
ever handled, stored, or hashed by this repository's own code — Supabase's
hosted service does all of that.

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account and project.
2. In your project, go to **Project Settings → API**.
3. Copy the **Project URL** and the **anon / public key**.

### 2. Add your keys to the site

Edit `js/supabase-config.js`:

```js
window.DURU_SUPABASE_CONFIG = {
  url: 'https://xxxxxxxxxxxx.supabase.co',
  anonKey: 'eyJhbGciOi...', // the anon/public key, not the service_role key
};
```

The anon key is **safe to publish** in client-side code by Supabase's own
design — it only ever grants what your Row Level Security (RLS) policies
allow (see below). **Never** put your `service_role` key here, in any
client-side file, or anywhere in this git repository. That key bypasses
RLS entirely and must only be used from a trusted server you control —
this static site has no server, so it should never hold that key at all.

### 3. Configure email templates & redirect URLs

In the Supabase dashboard, under **Authentication → URL Configuration**:

- Set **Site URL** to your deployed GitHub Pages URL, e.g.
  `https://<your-username>.github.io/<repo-name>/`
- Add the same URL (and `.../my-learning.html`) to **Redirect URLs**.

This site sends users to `my-learning.html` after email confirmation,
password reset, and Google OAuth — that page reads the Supabase session
and shows a signed-in view.

### 4. Enable email confirmation (on by default)

Under **Authentication → Providers → Email**, "Confirm email" is on by
default — new accounts must verify their email before they can log in.
Leave this on.

### 5. (Optional) Enable Google sign-in

Under **Authentication → Providers → Google**, follow Supabase's guide to
add your Google OAuth client ID/secret. The "Continue with Google" buttons
in the modal will work automatically once this is enabled — no code
changes needed.

### 6. Row Level Security (RLS)

If you add tables for user data later (progress, bookmarks, etc.), enable
RLS on every such table and write policies so a user can only read/write
their own rows, e.g.:

```sql
alter table public.progress enable row level security;

create policy "Users can view their own progress"
  on public.progress for select
  using (auth.uid() = user_id);

create policy "Users can update their own progress"
  on public.progress for all
  using (auth.uid() = user_id);
```

### 7. Rate limiting & abuse protection

Supabase Auth applies its own rate limits to signup, login, and password
reset by default. For additional bot protection, enable
**Authentication → Attack Protection → CAPTCHA** in the dashboard and add
the corresponding `captchaToken` option to the `signUp` /
`signInWithPassword` calls in `js/auth.js` if you turn this on.

### Known limitations on GitHub Pages

- GitHub Pages serves static files only and does not let this repository
  set custom HTTP response headers (like a strict `Content-Security-Policy`).
  The security boundary here is Supabase's own API (RLS + rate limiting +
  hashed passwords), not response headers from this host.
- This setup cannot guarantee that no account will ever be compromised —
  no system can promise that. It avoids the common static-site mistakes
  (plaintext passwords, secrets in the repo, custom token logic) by
  delegating all of that to Supabase's audited auth service.

## Language switcher (homepage)

`index.html` has a globe-icon dropdown in the header for English, Tiếng
Việt, and 한국어. It's scoped to the homepage only for now. The chosen
language is saved in `localStorage` (`duru_lang`) and re-applied on
reload; there's no IP- or browser-locale-based auto-switching, so every
new visitor sees English until they choose otherwise. Hangul/Korean
example text (anything with `class="kr"`), the logo, and the brand name
are intentionally never translated. To extend translation to another
page: add the same `data-i18n="key"` attributes used in `index.html`,
add matching keys to `js/i18n/en.json`, `vi.json`, and `ko.json`, and
include `js/i18n.js` (after `js/main.js`) plus a
`<div class="lang-switcher" id="langSwitcher"></div>` in that page's
header actions.

## Admin setup (attach/delete files on Free Resources & Book & Audio)

Both the Free Resources and Book & Audio pages have a "Downloadable Files"
section backed by Supabase Storage + a database table. Everyone — including
anonymous visitors — can see and download what's there. Only a specific,
server-verified admin account can attach or delete a file; this is enforced
by Row Level Security (RLS) policies, never by anything in the browser, so
no one can grant themselves admin by editing localStorage or the page's
JavaScript.

### 1. Run the schema

In the Supabase dashboard, go to **SQL Editor → New query**, paste the
contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This
creates:

- `admin_users` — a table listing which signed-in users are admins. RLS
  lets a user check only their own row; there's no way to write to this
  table from the website at all — only from the dashboard, acting as you
  (the project owner).
- `resources` — one row per attached file (title, description, learning
  level, linked unit, storage key, size, etc.), with RLS restricting
  insert/delete to rows in `admin_users` and allowing public read.

### 2. Create the Storage bucket

**Storage → New bucket** → name it exactly `resources` → toggle **Public
bucket: ON** (so download links work for anonymous visitors without a
signed URL — the RLS policies from step 1 still gate who can *upload* or
*delete*, public only affects reads).

### 3. Add yourself as admin

After you've logged into the live site at least once with the account you
want to be admin (email/password or Google — either works), go to
**Table Editor → admin_users → Insert row** and add your account's `user_id`.
You can find your `user_id` in **Authentication → Users** in the dashboard —
copy the UUID next to your email. This manual step is intentional: no code
in this repository can grant admin to anyone, on purpose.

Once added, log out and back in on the live site — the "+ Attach Resource"
button will appear on Free Resources and Book & Audio, and a "Manage
Resources" link will appear in your account menu.

### What's validated, and where

- **Client-side** (`js/resources.js`): file extension (PDF, PNG, JPG, JPEG,
  MP3, M4A only) and size (20MB for documents/images, 50MB for audio)
  before any upload starts, so people get instant feedback.
- **Server-side**: the `resources` table's `file_type` column has a SQL
  `check` constraint limited to the same extensions, and the RLS insert
  policy blocks anyone not in `admin_users` regardless of what the client
  sends. Consider also setting a bucket-level file size limit in
  **Storage → resources → Configuration** as defense in depth.

### Known limitation

If someone had a direct link to a file before it was deleted, that link
will 404 rather than showing a friendly message — GitHub Pages can't run
server code to intercept a broken Supabase Storage URL. Links surfaced
*through the site itself* handle this correctly (a deleted resource's
"Download" button is replaced with "No longer available" rather than a
dead link).

## Local development

No build step — just serve the folder statically, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html`.
