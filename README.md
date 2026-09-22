# Duru Korean

A static marketing site for Duru Korean, live at https://www.durukorean.com
and deployed on Vercel. Plain HTML/CSS/JS — no build step.

This file is the technical reference. `PROJECT-NOTES.ko.md` is the
handover document in Korean: what the site owner can do without a
developer, the accounts and addresses involved, the traps this project
has already hit, and what is still outstanding. Read both before
picking the work up.

## Structure

```
index.html            Home
faq.html               FAQ (linked from the footer)
learning-korean.html   "Learn Korean" curriculum overview
book-resources.html    "Book Resources": the textbooks with their audio and printables
free-resources.html    "Free Downloads": one card per resource, filtered by type and language
resource.html          One download: pick the PDF language, preview or download; admin editor
blog.html               Blog listing
about.html              About the authors
my-learning.html        Signed-in account page (linked from the account menu, not the main nav)
css/style.css            All styles
js/main.js               Nav, FAQ accordion, blog filters, scroll behavior
js/supabase-config.js    Supabase project URL + anon key (placeholders — see below)
js/auth.js                Login/signup modal + auth state handling
js/resources.js           Admin-managed file attach/delete on Free Resources & Book & Audio
js/i18n.js                 Site-wide language switcher; LANGS sets the order
js/i18n/<code>.json        Translation strings, one file per language
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

- Set **Site URL** to the site's canonical address. In production that
  is `https://www.durukorean.com`.
- Add a wildcard for it to **Redirect URLs**:
  `https://www.durukorean.com/**`. Add the apex form
  (`https://durukorean.com/**`) too — the apex 308-redirects to `www`,
  but a browser that started at the apex can hand back either, and an
  address that is not on this list makes the sign-in fail.

This site sends users to `my-learning.html` after email confirmation,
password reset, and Google OAuth — that page reads the Supabase session
and shows a signed-in view.

### 4. Email confirmation

Under **Authentication → Sign In / Providers → Email**, "Confirm email"
is on by default, and new accounts must click a link before they can
log in. That link is only as good as the **Site URL** above: a project
still pointing at the default `http://localhost:3000` sends every new
account a dead link, and the free tier's built-in mailer is rate
limited and often only delivers to the project owner. If sign-ups are
stalling with no error, that is the first thing to check.

Turning "Confirm email" off lets people in immediately, which is what
this project runs with. Turn it back on once a real SMTP sender is
configured.

### 5. Google sign-in

Enabled in production. The site needs no code change for it; what
follows is the configuration, written down because several steps fail
silently if skipped.

In the Google Cloud console, under **Google Auth Platform**:

- **Branding** — app name, support email, homepage, and links to
  `/privacy.html` and `/terms.html`. The publish button stays disabled
  until this is complete, and nothing says which field is missing.
- **Clients** → the web client's **Authorized JavaScript origins** are
  the site's own addresses (`https://www.durukorean.com` and the apex).
  The **Authorized redirect URI** is Supabase's callback,
  `https://<project>.supabase.co/auth/v1/callback` — a Supabase address,
  not a site one, and it does not change when the domain does.
- **Audience** → **Publish app**. While the app is in testing only
  listed test users can sign in; the project owner always can, so
  testing with your own account proves nothing. Use a second account.

Then paste the client ID and secret into **Authentication → Sign In /
Providers → Google** in Supabase and press Save. The panel scrolls;
the Save button is below the fold and closing without it loses
everything.

Two failure modes worth recognising:

- **"Unable to exchange external code"** on returning from Google means
  the secret Supabase holds does not match the one Google has. The
  consent screen appearing proves only that the client ID is right.
- **A silent return to a logged-out page** used to mean the flow
  started on one host and came back on another; PKCE keeps its verifier
  per origin. `siteUrl` in `js/supabase-config.js` now moves visitors to
  the canonical host before sign-in starts, and `my-learning.html`
  reports what came back instead of just showing a logged-out view.

Google shows the Supabase project domain rather than the app name on
the consent screen, because the app is unverified. It is cosmetic;
removing it needs either Google's verification review or a Supabase
custom domain.

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

### Known limitations of static hosting

- The host serves static files only and does not let this repository
  set custom HTTP response headers (like a strict `Content-Security-Policy`).
  The security boundary here is Supabase's own API (RLS + rate limiting +
  hashed passwords), not response headers from this host.
- This setup cannot guarantee that no account will ever be compromised —
  no system can promise that. It avoids the common static-site mistakes
  (plaintext passwords, secrets in the repo, custom token logic) by
  delegating all of that to Supabase's audited auth service.

## Downloads (Free Downloads, Book Resources)

A *resource* is one piece of material; its *files* are the same PDF in
each language it has been made in (`resources` and `resource_files` in
`supabase/schema.sql`, section 20). The list shows one card per
resource whatever languages it comes in — a 64px square holding the
cover or the category's glyph, then title, short description,
type · level · format, and EN · VI · ES chips (three, then "+N"). The
cards are compact rows, three to a row on a wide screen, so a page of
twenty downloads stays a page. Title and description come from `resources.i18n[lang]` when the
admin has written that language, otherwise from the resource's default
text. The type chips (Hangul Starter / Pronunciation / Vocabulary /
Grammar Cheat Sheets / Real-Life Korean) and the "Pick a language"
dropdown filter together, and both are remembered — with the scroll
position — for the trip back from a resource page. The dropdown lists
all eight languages in the picker's order, English first and selected
by default, whether or not a download exists in each one yet. When the
chosen language has nothing in the chosen category, the empty state
names the languages that do, as buttons. A card is a single link:
the title's anchor is stretched over the card in CSS, so clicking
anywhere on it opens the resource while there is still one tab stop
and one focus ring per card.

`resource.html?id=…` is the resource's own page. The short description
leads the main column with the longer text under it — the banner
carries the title alone, and the section is dropped only when neither
has been written. Beside it: a PDF language dropdown
(published files only; an admin also sees hidden ones), pages and size
of the chosen file, Preview and Download through signed links. The list
passes `&pl=<lang>` for the language chosen there; when that file does
not exist the page says so and falls back to the first available. Choosing a PDF language
never changes the site language. Downloads still need a signed-in
session (storage policy); a Google sign-in from a resource page comes
back to that page.

Admins add one from the list ("+ Add a download"): title, short
description, category, level, and the files themselves — several at
once, each file's language guessed from its name (`hangul-vi.pdf`) and
correctable before uploading — then publish, which is on by default.
The resource's own page then carries a published / not-published banner
with the button to flip it, and an editor whose first section is the
files (add, replace, remove, publish one at a time). The longer
description and the per-language translations are folded away there,
since most downloads never need them; a PDF's page count is read from
the file and can be corrected by hand. Uploads are capped at 50 MB,
which is also a Supabase project's own default ceiling — raising it
further means raising it under Storage → Settings first.

## Language switcher (site-wide)

Every page has a globe-icon dropdown in the header, listing English,
Tiếng Việt, Español, Bahasa Indonesia, Português (BR), 한국어, 日本語 and
中文 in that order — nav, footer, every page's own content, the
login/signup modal, and the admin resource-attach/delete UI are all
covered (`js/i18n/en.json`, `vi.json`, `es.json`, `id.json`,
`pt-BR.json`, `ko.json`, `ja.json`, `zh.json`; 535 keys each, kept in
sync by construction — every file is validated against the English key
set, so a missing or stray key fails loudly rather than silently
rendering a raw key on the page).

Adding another language is three steps: copy `en.json` to
`js/i18n/<code>.json` and translate the values, add
`{ code: '<code>', label: '<native name>' }` to the `LANGS` array at the
top of `js/i18n.js` (its order is the order of the dropdown), and re-run
the sweep to confirm the longer or shorter labels don't break the
header. Languages whose menu labels run long enough to need the
two-row header sooner are listed in the `:is([lang=…])` selector in
`css/style.css`.

- **Persistence & scope**: the chosen language is saved in
  `localStorage` (`duru_lang`) and re-applied on every page load,
  reload, and after returning from Google OAuth — switching language
  never resets a signed-in session or in-progress form. Switching also
  never navigates you away from the page you're on.
- **Shareable links**: a URL with `?lang=vi` (or `en`/`ko`) forces that
  language for that visit and then persists it, without needing
  per-language paths — deliberately, since the host serves static
  files with no server-side routing to fall back on for something like
  `/vi/about.html`.
- **No forced switching**: there's no IP- or browser-locale-based
  auto-switching. Every new visitor sees English until they choose
  otherwise, regardless of browser language.
- **What's intentionally never translated**: Korean text that is
  itself the thing being taught or a brand mark — the Hangul jamo in
  the homepage ring and 두·루 build-up, the blog category glyphs
  (앎/말/삶/길), the 가/나/다 and 학 card icons, the 두루 한국어
  wordmark, and the two authors' personal names on the About page.
  `class="kr"` only selects the Korean webfont; it is **not** a
  "don't translate" marker. Descriptive copy that happens to be
  written in Korean — step descriptions, page sub-headings, level
  labels — carries a `data-i18n` key and switches like everything
  else.
- **Admin-uploaded files**: a file's own description carries a
  separate "written in {language}" label (its `description_language`
  column) — the site's UI language and a given file's actual language
  are two different things, and the UI says so rather than implying
  a file was auto-translated.

To extend translation to a new element: add `data-i18n="key"` (or
`data-i18n-html`/`data-i18n-placeholder`/`data-i18n-aria-label` where
the target isn't plain text content), then add the same key to all
five JSON files — the engine (`js/i18n.js`) falls back to the English
value for a missing key rather than showing the raw key, but every
page ships with all five files fully populated. For text assembled at
runtime in JavaScript (`js/auth.js`, `js/resources.js`), call
`window.DURU_I18N.t('key', 'English fallback')` instead.

**Translation review status**: the English copy is the original source
text; Vietnamese, Korean, Japanese, and Chinese (Simplified) were
translated directly rather than through a raw machine-translation
pass, with attention to natural phrasing for the site's actual UI
strings and error messages. Every file is complete — nothing is a
placeholder. A native-speaker review before wide release is still
worth doing for tone, the way it would be for any new copy.

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
will 404 rather than showing a friendly message — static hosting can't run
server code to intercept a broken Supabase Storage URL. Links surfaced
*through the site itself* handle this correctly (a deleted resource's
"Download" button is replaced with "No longer available" rather than a
dead link).


### How a change reaches the site

Two branches, on purpose.

- `claude/duru-korean-homepage-raysf6` is the production branch. Vercel
  serves `www.durukorean.com` from it. Nothing lands here until it has
  been looked at.
- `preview` is where changes go first. Vercel builds every non-production
  branch as a preview deployment, so pushing here produces a working copy
  of the whole site at a separate address, with its own isolated build
  but the same Supabase project behind it.

The loop is: push to `preview`, look at the preview URL, and merge into
the production branch once it is approved.

Worth knowing: the preview shares the live database. Writing a blog post
or deleting a story from a preview changes the real data, because
`js/supabase-config.js` names one project and previews get the same file.
Previews are for looking at the site, not for trying things out on
throwaway data.

## Blog posts and learner stories

Two Supabase-backed tables, both written from the site rather than the
dashboard.

**`posts`** are articles by the Duru team. An admin gets a "Write a
post" button on `blog.html`; everyone else does not, and more to the
point the RLS policies only accept writes from a user in `admin_users`.
A post has a `published` flag, and the public select policy filters on
it, so a draft is genuinely invisible rather than merely unlinked — an
admin sees drafts because a second select policy grants it.

Single posts live at `blog.html?post=<slug>`. A static host has no
routing, so the query string is the only option, the same approach the
language switcher uses. Slugs are generated from the title plus a short
random suffix; a title with no Latin characters reduces to the suffix
alone rather than a percent-encoded mess.

A post is one piece of writing however many languages it is written in,
the same shape the downloads use. `posts.lang` names the language its
own `title`/`excerpt`/`body` columns are in; `posts.i18n` holds
`{"<lang>": {"title", "excerpt", "body"}}` for the rest. A language
counts as available only when it is `lang` or its entry has a body, so
a half-finished translation is never offered.

The list works like the downloads list: compact cards three to a row,
the whole card a single stretched link, category chips and a "Pick a
language" dropdown of all eight languages (English selected by default)
filtering together, both remembered with the scroll position for the
trip back. The category counts follow the chosen language. When that
language has nothing, the empty state names the languages that do, as
buttons.

`blog.html?post=<slug>&pl=<lang>` opens a post in a language. The post
carries its own "Read in" picker listing only the languages it is
written in; the language is taken from `pl`, else the site language,
and a notice says so when neither exists and it falls back. Choosing
one there never changes the language of the site. An admin sees the
published / not-published banner on the post itself, with Publish now /
Unpublish beside Edit and Delete — the cards carry no admin buttons,
since a stretched link would swallow them. The editor holds the eight
languages in a collapsed "Other languages" section, each marked written
or empty, and the language the post itself is in is hidden from that
list.

**`stories`** are written by learners. Anyone signed in can post; the
insert policy's `with check (auth.uid() = user_id)` is what stops one
account posting as another. Authors may edit or delete their own story
and no one else's, and an admin may delete any. Stories appear
immediately — there is no approval queue — so removing a bad one is the
moderation model.

A learner picks a display name per story. The table has no column for
an email address and `user_id` is only ever compared against
`auth.uid()`, never rendered, so signing up does not put an address on
a public page.

Both bodies are stored and rendered as **plain text**: blank lines
become paragraphs and everything else is escaped. Accepting HTML from
one visitor would let them run code in another visitor's browser, so it
is never interpreted. `escapeHTML` in `js/blog.js` and `js/stories.js`
is the only thing standing between a pasted `<script>` and every reader
of that page — do not replace it with `innerHTML` of raw input.

### Automatic translation, sentence by sentence

A post written in Korean is read by people who do not read Korean. When
the reader's language is one the post is not written in, the post is
shown bilingually: each source sentence, and directly beneath it the
same sentence in their language.

The translation is made **once, by an admin**, and stored on the post in
`posts.mt`. Readers never call a translation service, so a post costs
one translation rather than one per visitor, and a reader on a slow
connection waits for nothing.

```
admin's browser ──▶ /api/translate ──▶ Claude API
   splits the body       verifies the caller is an admin,
   into sentences        translates one batch into every
                         target language at once
        ◀──────────────── sentences back, one per source sentence
   writes posts.mt

reader's browser ──▶ posts.mt ──▶ source sentence + translation
```

**Why the pieces are where they are.** A translation API key cannot go
in the browser, so the call lives in `api/translate.js`, a Vercel
serverless function. That function is not open to the world either: the
caller's Supabase access token is verified against Supabase and checked
against `admin_users` before a single token is spent, and the batch size
is capped server-side so a bug in the page cannot turn one save into an
unbounded bill.

**No company is baked in.** `api/_providers.js` holds one small adapter
per provider, each with the same two-line shape — sentences in, one
translation per sentence out. Everything around it (the endpoint, the
admin check, the alignment check, the browser) is provider-neutral, so
moving from one translation company to another is an environment
variable, not a rewrite. Four ship with the site:

| Provider | Key | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | the default; uses the Anthropic SDK |
| OpenAI | `OPENAI_API_KEY` | plain HTTP, chat-completions shape; defaults to `gpt-5-mini` |
| Google Gemini | `GOOGLE_API_KEY` | or `GEMINI_API_KEY` |
| DeepL | `DEEPL_API_KEY` | a translation service, not a model — alignment is free, and a free-tier `…:fx` key is routed to the free host automatically |

Anything else that speaks the OpenAI chat-completions shape — Azure
OpenAI, Groq, Together, OpenRouter, Fireworks, a self-hosted vLLM or
Ollama — needs no new code: set `TRANSLATE_PROVIDER=openai` and point
`TRANSLATE_BASE_URL` at it. A provider with its own shape is one entry
in `PROVIDERS`.

**Why the sentences stay aligned.** One splitter (`js/auto-translate.js`)
is used three times: the admin's browser splits the body to send it, the
function returns exactly one translation per sentence — a reply whose
count does not match is rejected, not stored — and the reader's browser
splits the same body again to pair them up. A fingerprint of the body is
stored alongside; edit the post and it no longer matches, so the page
treats the translation as missing rather than showing sentence 4 under
sentence 3. The admin's banner says so and offers "Translate again".

A hand-written translation always wins: a language with a body in
`posts.i18n` is skipped by the translator and shown on its own, with no
original above it.

**The endpoint's contract** is deliberately ordinary, so it is useful
for more than this blog:

```
POST /api/translate
Authorization: Bearer <the caller's Supabase access token>
{ "from": "ko", "to": ["en", "zh"], "sentences": ["…", "…"] }

200 { "provider": "anthropic", "model": "claude-opus-5",
      "translations": { "en": ["…", "…"], "zh": ["…", "…"] } }
```

Every target language comes back with exactly as many sentences as were
sent, in the same order. That is the whole guarantee, and a provider
that breaks it gets a 502 rather than a stored answer.

**Setting it up.** One environment variable, in Vercel → Project →
Settings → Environment Variables: whichever company's key you have, from
the table above. The provider is chosen from the key that is present, so
nothing else is needed.

Optional: `TRANSLATE_PROVIDER` (needed only when more than one key is
set), `TRANSLATE_API_KEY` (the key under a neutral name),
`TRANSLATE_MODEL` (every provider renames and retires models, so a name
the endpoint does not know comes back as an error listing the ones your
key can actually use — that is the answer, not a dead end),
`TRANSLATE_BASE_URL`, `TRANSLATE_EFFORT`
(`low` / `medium` / `high`, default `medium`, for providers that have
it), and `SUPABASE_URL` / `SUPABASE_ANON_KEY` (default to the same
public values `js/supabase-config.js` already serves).

Without any key the site works exactly as before; the translate button
answers that translation is not set up, and names the variables it would
accept, rather than failing obscurely.

`package.json` exists only for this function, and its one dependency is
the Anthropic SDK used by the default provider — the OpenAI, Google and
DeepL adapters speak plain HTTP and need nothing. The pages are still
plain HTML, CSS and browser JavaScript with no build step.

### Social sign-in

The modal offers Google, Facebook, X and KakaoTalk beside the email
form. Each is a provider Supabase Auth speaks natively, so the site code
is one list in `js/auth.js` and one call to `signInWithOAuth`; turning a
provider on is a switch in the Supabase dashboard (Authentication →
Providers) plus that service's own app keys and a redirect URL of
`https://<project>.supabase.co/auth/v1/callback`. A provider left off
still shows its button and answers that it is not switched on yet, which
is the truth and points at where to fix it, rather than hiding a button
whose absence explains nothing.

**Naver is deliberately absent.** Supabase has no Naver provider, and
the only ways to add one are to run the OAuth dance in our own
serverless function and mint a Supabase session with the `service_role`
key, or to stand up a separate identity service. Both put a key that
bypasses every Row Level Security policy on this site into a request
path a visitor can reach. That is a worse thing to own than the gap. If
Naver becomes necessary, the honest route is Supabase adding it — the
list in `js/auth.js` is one line per provider, so the day it exists the
change is that line.

### Self-study under a Korean post

A reader working through a Korean article in their own language learns
more from five words explained than from a whole post translated. Under
a post written in Korean, `js/blog.js` renders a **Self-study** corner:
five words a learner would stumble on, each with its romanization, part
of speech, the meaning **this post uses**, a sentence or two on how to
use it, and the sentence it came from.

The sense matters more than the gloss, and it is what the instruction in
`api/_providers.js` spends its words on: 발효 beside kimchi is food
fermentation, not a law taking effect. The list is built once, by an
admin, in the same run as the translation, and stored in `posts.study`
with the same body fingerprint the translation carries — edit the post
and the corner reads as missing rather than as words that are no longer
there.

**"Written in" follows what is typed.** The corner only exists under a
post filed as Korean, and the select used to default to whatever
language the site was being read in — so writing Korean while browsing
in English filed the post as English and the corner silently never
appeared. The editor now sets the select from the script of the text as
it is typed (`DURU_MT.detectLang`, a share of Hangul against the other
letters, so an English post quoting 발효 is left alone), and stops the
moment the author picks for themselves. A post already filed wrongly is
named in the admin banner rather than left to be puzzled over.

The same five words serve every language; only the `by[<lang>]`
explanations differ. A reader who switches language keeps their place in
the list. A reader reading the post in Korean sees no corner — they have
the words already — and a post not written in Korean has none to build.

`api/translate.js` grew a `mode: "vocab"` for this rather than a second
endpoint, because the auth check, the provider resolution and the limits
are the same; only the prompt, the schema and the ceiling on how much
text may be sent differ. Inside `api/_providers.js`, each adapter now
supplies one `chat(cfg, system, user, schema)` and both jobs are written
once on top of it — DeepL is the exception, since it translates and
does nothing else, so it brings its own `translate` and answers the
study list with a clear "use another provider for this".

### Likes and comments

Two different things, priced differently. A heart costs a reader nothing
and says little, so it is open to everyone. A comment carries a name and
sits under the article for everyone to read, so it needs an account.

**The heart works signed out, and cannot be taken back.** "Signed out"
still means *someone*: the browser keeps a random id in `localStorage`
under `duru_anon_id` (`window.DURU_ANON`, in `js/main.js`) and sends it
along. That id can be trusted for exactly one claim — "this reader
already liked it" — which is enough to stop one person liking the same
post twenty times. It cannot be trusted for "this reader wants it
undone", which anyone who guessed an id could say about someone else's
like, so `toggle_content_like` only ever *adds* an anonymous like.
Undoing needs an account. The button says so rather than quietly doing
nothing: once a signed-out like is in, it stays filled, stops responding
and carries "Sign in to take a like back".

**Why the likes go through SQL functions.** A Row Level Security policy
permissive enough to let a signed-out visitor write their own like row
would also let them rewrite everyone else's, because RLS has no way to
know which anonymous id the caller really is. `toggle_content_like` and
`content_like_state` are `security definer` functions instead: each only
ever touches the row matching the id it was handed, and `content_likes`
keeps no insert policy for anonymous callers at all.
`content_likes.user_id` is nullable, with a check constraint saying a
row carries exactly one of `user_id` or `anon_id`, and a partial unique
index giving anonymous readers one like per item the way the old
`unique(user_id, …)` does for accounts.

**Comments need an account.** They live in `post_comments` and are
rendered by `js/comments.js`, mounted under a post by `js/blog.js`. A
signed-out reader sees the thread and a line inviting them to sign in —
which opens the same modal the header button does — not a form that
would fail. A signed-in one writes under their account name; there is no
name field to fill in or to put someone else's name in. That also gives
every commenter a way to come back and delete what they wrote, which the
anonymous route never really did.

A comment with a `parent_id` is a reply, and a reply may itself be
replied to, so a thread nests as deep as the talk goes — the same shape
the guestbook uses. Deleting cascades to the replies, which is what
moderation wants: removing the comment that started a bad thread should
not leave the thread behind. The indent stops at four levels; deeper
replies join at that level rather than squeezing the text off a phone.

Who may delete what is RLS, not a hidden button: an admin may delete any
comment and an author their own. The insert policy does not care who you
are beyond requiring an account, but it does care who you *claim* to be
— the row must carry that account's id and no browser id, so nobody can
post under another account's name.

A comment body is **plain text**, escaped and split on blank lines, for
the same reason story and post bodies are: accepting HTML from one
visitor would let them run code in another visitor's browser.

### Header width

The nav carries seven items. That does not fit in the 1180px column the
body uses, so the header bar has its own 1560px measure. Vietnamese
labels are long enough to need the full width and collapse to the menu
button below 1532px; the other four languages collapse at 1310px. Those
numbers are measured, not guessed — adding another nav item means
measuring again.


## Local development

No build step — just serve the folder statically, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html`.

## Deployment

Vercel serves this repository as-is from the root — there is no build
step and no framework preset to choose. Pushing to the production
branch deploys it; every other branch gets its own preview URL.

`vercel.json` sets two things:

- **Security headers** on every response (`nosniff`, a referrer policy,
  and `SAMEORIGIN` framing), which matter here because the site signs
  people in.
- **Revalidation on HTML, CSS, and JS.** None of the asset filenames
  carry a content hash, so a long cache lifetime would leave visitors
  on an old `style.css` or `i18n.js` after a deploy, with no way to
  know. `must-revalidate` costs one conditional request per file and
  removes the class of bug where a fix is live but nobody sees it.

Files under `assets/` are left on Vercel's defaults, since images and
the favicon change rarely and are safe to cache.

