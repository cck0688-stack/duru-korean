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
all eight languages in the picker's order, whether or not a download
exists in each one yet, and starts on **the language chosen at the top
of the page**: picking 中文 in the header is a statement about what the
visitor wants to read, so the downloads list and the blog list both
follow it. A choice made in the dropdown itself is remembered instead —
but only against the site language it was made under, so changing the
header language moves the list again rather than leaving it on a
decision from before. `R.preferredLang()` answers with the language `js/i18n.js` has
actually applied once it has one (`DURU_I18N.ready`), and before that
with the same chain the engine itself uses — `?lang=`, then the saved
choice. A `?lang=` still sitting in the address bar is how the visitor
arrived, not what they want now, so it bootstraps the first render and
stops mattering the moment they touch the switcher. When the
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

Single posts live at `/blog/post/<slug>` and a topic at `/blog/travel`.
Those are rewrites in `vercel.json` onto `blog.html?post=` and `?cat=`,
so nothing in the page has to know about routing; `blog.html?post=<slug>`
still works and is what `search.js` and `profile.js` link to. A rewrite
happens on the server, though, so the browser is still sitting on
`/blog/travel` with nothing in its query string — `DURU_BLOG.route()`
reads the path rather than trusting a query string the browser never
sees. Because blog.html is served from three different depths, it
carries `<base href="/">` — every relative script, stylesheet and
`fetch('js/i18n/…')` on it resolves from the site root rather than from
whichever path the reader arrived on. Paths are built in one place,
`DURU_BLOG.href()` and `DURU_BLOG.postHref()`. Slugs are generated from the title plus a short
random suffix; a title with no Latin characters reduces to the suffix
alone rather than a percent-encoded mess.

### Seven topics, and who a post is for

The blog is written for people who came to Korea from somewhere else —
a tourist here for five days, a student on a D-2, a family six years
in — so it is filed the way they look for things rather than by subject
matter:

| id | nav | what belongs on it |
|----|-----|--------------------|
| `travel` | Travel | apps, transport, money, safety and etiquette |
| `dining` | Dining | how to order and eat, street food, convenience stores, dietary needs |
| `style` | Style | skincare, clinics, brands, shopping and tax refunds |
| `explore` | Explore | neighbourhoods, K-pop and drama locations, day trips |
| `campus` | Campus & Life | visas, housing, healthcare, multicultural support |
| `career` | Career | part-time permits, job hunting, resumes, internships |
| `language` | Korean Language Tips | useful expressions, common mistakes, everyday Korean made simple |
| `etc` | ETC | cultural nuance, news for foreigners, and whatever fits nowhere else |

The way in is the same on Blog and on Community, so the two read as one
site: a wide "All posts" button alone above a thin rule, then a grid of
cards under a small "Browse by topic" heading.

"All posts" is deliberately not one of the cards. It is how a reader
gets back out of a topic, so it is bigger than a card, sits on its own,
and is filled in while everything is showing and outlined while a topic
is. The language picker is lifted out of the flow beside it, because
otherwise the button would centre on what is left of the row rather
than on the column.

Each card is an icon, a name and one sentence — no count. A shelf with
nothing on it yet should read as a place to go, not as a zero, and the
number a reader actually wants is the one over the list. The sentence is
never clipped: the card grows, and the row grows with the tallest card.

`aria-pressed` is both what the CSS styles and what a screen reader is
told, so the two cannot disagree about which topic is open. Pressing the
open topic steps back out of it. Four columns, two on a tablet, one on a
phone.

Sub-topics were built and taken out again: twenty-four of them behind
hover menus made a wall where a way in was wanted, and the menus covered
the topics on the row below. The dropdown that hung the same seven names
off "Blog" in the site header went the same way, for the same reason:
the cards are the navigation, and a second copy of them in the header
was a second thing to read before getting anywhere.

The catch-all is `etc`, not `community` — "Community" is what the header
calls the guestbook, and one site cannot have two of them.

"Pick a language" above the list sets the site's language, exactly as
the globe in the header does. It used to change only which posts were
listed, which left a reader with Korean articles under English headings,
English topic cards and an English menu — the page half-translated, with
nothing to tell it that was not what was meant.

A `##` sub-heading in a body is drawn as a highlighter stroke rather
than as a bigger, bolder line: shrink-to-fit, so the colour ends where
the words do. The paired translation view gets the same stroke on both
sides, and strips the hashes — they are Markdown's marks, not the
writer's words, and printing them was the one thing they are not for. A
heading with text on the very next line, no blank line between, is a
heading too; it used to come out as a paragraph beginning "##".

## Offering the site in the visitor's language

The language switcher is the one control someone has to use while the
page is in a language they cannot read: recognise a globe, guess what
it does, open it, find their language in a list, with no word of help
they can read. They should not have to. `navigator.languages` already
says which languages the visitor reads, because they typed it into
their own settings.

So a bar above the header offers first, and the offer is written in
their language rather than the page's — which is why those sentences
live as a fixed table in `js/langbar.js` rather than going through the
site dictionary. The dictionary translates into the language on screen,
which is precisely the one they cannot read.

It offers, never imposes: a Korean-American with a Korean phone may
want the English site, and switching under them takes that choice away.
Any answer — yes, no, or the close button — is remembered and it never
returns. It stays away entirely from anyone who has already chosen a
language, arrived on a `?lang=` link, reads a language the site does
not publish, or is already reading the one they would be offered.

This is not the country guess `js/i18n.js` rules out, and the
distinction matters: an IP address says where a request came from,
which a VPN, a holiday or an expatriate life makes meaningless.
`navigator.languages` is not a guess at all. `pt-PT` is offered the
Brazilian edition and `zh-Hant` the simplified one — not the same
thing, but nearer than English.

## What the posts are about

The first week of generated posts read like a guidebook: how to order
when the menu has no pictures, how to use the subway, how to get from
the airport. All correct, all useful, and none of it worth a reader's
time — there is nothing in it to be surprised by.

So the topic step now scores each candidate on how startling it is to
someone who did not grow up here, refuses anything under six out of
ten on that scale, and weights it double. What it is looking for is the
thing a Korean does without thinking that a foreigner finds strange —
and which has a reason behind it. Side dishes arriving unasked and
refilled for free. A laptop left on a cafe table while its owner goes
to the toilet. A stranger asking your age, which is not rudeness but a
question about which verb endings to use.

A practical topic is still allowed, but it has to enter through the
surprising door: "how to hail a taxi" is a guidebook, "why an empty
Korean taxi shows a red light" carries the same information and gets
read. The body rules now require the post to say *why*, not only what,
and cap a numbered list at five items — two explained properly beats
seven listed.

Each draft also arrives with its "words to know" list: five words an
intermediate learner would be stopped by, explained in all eight
languages. That used to wait for an admin to press a button.

## Thirty shapes, and a photograph on every post

Seven posts a morning written to one template read as a machine however
good each is: a hook, three numbered things, a closing line. The shape
is chosen before the post is written, from thirty in
`scripts/lib/voices.mjs` that are genuinely different — a single scene,
a myth corrected, three whys in a row, a short dialogue unpacked, one
object examined, a walk through a space, a letter from someone who
arrived six months earlier.

Chosen by walking, not by drawing. With thirty shapes and eight posts a
day, random would put two of a morning on the same shape about half the
time. The index is day number times shelves plus shelf, so every post
in a morning differs, a shelf waits fifteen days to see a shape again,
all thirty get used, and the choice is reproducible — which matters
when a draft comes out badly and the question is what produced it.

Every post now gets a photograph. It used to be allowed to end with
none, on the grounds that a post about visa paperwork is worse off
beside a beach. That still holds; what was wrong was treating "nothing
specific enough" as the end of the search rather than its middle. Five
queries: three the model writes, then the shelf's own two, which cannot
be off-topic because the shelf is what the post is about. The first
four are judged as strictly as before. On the fifth the best of what
came back is taken — a Korean street under a post about Korean streets
is not a mismatch, and no picture reads as unfinished. A photo service
that is down still ends with none, because there is nothing to take.

## One run a day, and only what is missing

The morning job writes the categories that do not yet have a post for
that day. Nothing on the shelf, and it writes seven; three there, and it
writes the other four; all seven there, and it says so and stops.

That makes the job safe to run again. It used to claim the day and exit
the moment it found the day claimed, which meant a day that had stopped
part-way stayed short for good — the only way back was writing SQL by
hand. The unique index on `(batch_date, category)` is what actually
stops a duplicate; the batch row only says whether the day has been
started.

## The community

`stories.html`, served at `/community`, is filed the same way the blog
is: four cards across the top — All on the left, then three shelves —
and picking one narrows the list in place rather than loading a page.

| id | name | what belongs on it |
|----|------|--------------------|
| `ask` | Ask & Help | questions about Korean or life in Korea, and the answers |
| `share` | Share & Talk | experiences, opinions, everyday life in Korea |
| `meet` | Meet & Connect | introductions, looking for a friend or a study partner |

Three, because there are three things people come here to do. A fourth
would be one nobody could tell apart from the others, and an empty
shelf reads as a dead page.

A reply has no shelf of its own — it belongs to the thread it answers,
so the picker is hidden for one and the parent's value is sent instead.

The name on an entry starts as the nickname the writer chose when they
signed up (`user_profiles.nickname`, then the copy in the account's
metadata, then whatever they last typed on this device). It is still a
text box: what is in it when they press Post is what gets saved.

The site deploys in one place and the database is migrated in another,
by hand, so there is always a window where the code knows about columns
the database has not got yet. `send()` in `js/stories.js` handles that
window: when PostgREST answers "Could not find the 'category' column of
'stories' in the schema cache", the column is dropped and the post goes
in without it. Those columns are improvements — a shelf label, a
language badge — and an improvement that cannot be saved should not cost
somebody the paragraph they just typed. Only the extras are ever
dropped; if the database says it has never heard of `body`, the error is
shown and the editor stays open with their words still in it. What a
database is missing is remembered for the rest of the page's life, and
read off the first loaded row on arrival, so it costs at most one
rejected round trip.
The counts and the filter only ever look at top-level rows. An entry
written before section 31 ran has no `category` at all; the page reads
it as `share`, which is what the column's default says too, so a
half-migrated database shows every row rather than losing some.

`js/community-categories.js` is the one place those ids live, the same
shape `js/blog-categories.js` has.

### Writing in one language, reading in another

The community is one community in eight languages, not eight
communities. A member writes in whatever language they are comfortable
in; a reader reads in whatever language they picked in the header; and
the post is stored once, in the words its author typed.

The composer has a **language** field, filled in from the text while it
is being typed (`js/lang-detect.js`) and left alone the moment the
writer corrects it. Writing systems settle most cases outright — Hangul,
kana, Han — and the Latin languages are separated first by the letters
only one of them uses (ệ, ñ, ã) and then, failing that, by a short list
of words common to almost any paragraph. When it cannot tell, it says
so and the language being read is used instead, which is the better
guess anyway.

Picking a language in the header is the whole request. From then on,
what is not in that language is translated into it — no button to find
on each post, because a reader who cannot read Korean cannot read the
button either. Each card still names the language it was written in
(`VI · Tiếng Việt`), a translated body always carries `Auto-translated ·
from Tiếng Việt` and a **Show original** one press away, and the
author's language stays on the card throughout: which words are whose
does not change when the page is translated. The `lang` attribute
follows the text, so a screen reader reads a translation in the right
voice.

**Only what somebody looks at is paid for.** A card is translated when
it comes near the viewport, with 800px of runway so the words are
already there by the time it is on screen. A reader who opens the
community, reads three posts and leaves pays for three posts — not for
the three hundred on the shelf behind them. That is the difference
between a bill that tracks how much this place is read and one that
tracks how much has ever been written in it, and at three hundred posts
those are not the same number.

Behind that, two more limits. Anything translated before comes down
with the row and costs nothing at all, so a busy thread is paid for
once, by whoever got there first. And one page view translates at most
`AUTO_MAX` (60) entries however far it is scrolled, so no single visit
can run away; past that the **Read in …** button comes back, which is
also what a failed translation falls back to.

`watchCards()` waits for `DURU_I18N.ready`: until the first dictionary
lands `lang` is a placeholder, and working against it would translate
the page into the wrong language and then again into the right one —
twice the wait and twice the bill, on every page load. And a card that
is already translated, already in the reader's language, or deliberately
put back to the original is not watched at all, so the redraw after a
translation lands cannot start another round.

A row with no stored language has one read off its text locally
(`srcOf`). The guess is used to decide things — is there anything to
translate here? — but never displayed: a badge saying "Tiếng Việt" is a
claim about what somebody wrote and needs better evidence than a look
at the letters, while deciding not to send a Korean post to be
translated into Korean needs none at all, because being wrong costs one
round trip.

Held to, deliberately:

- **One post, one id.** No per-language board, no translation saved as a
  second entry. No new URLs; `/community/ask` means what it always did,
  and search still searches what people actually wrote.
- **On demand, not in bulk.** A post is translated into a language when
  somebody asks to read it in that language, not into all eight when it
  is written.
- **Translated once.** The result is stored on the row (`stories.mt`) and
  comes down with the row, so the second reader of a thread makes no
  request at all.
- **Edited means re-translated.** Each stored translation carries a
  fingerprint of the body it was made from. When they stop matching the
  entry is ignored, and `js/stories.js` clears `mt` outright when an
  author changes the text — a stale translation is worse than none,
  because nothing on screen would say it is out of date.
- **A failure shows the original.** It never shows a blank, and it never
  shows a body the site cannot vouch for.
- A **language** filter sits above the list, defaults to all, combines
  with the topic filter, and hides itself when there is only one
  language to choose between.

`api/community-translate.js` does the work. It takes **ids, never
text**: the endpoint is open, because asking someone to sign in before
they can read would defeat the whole point, and an open endpoint that
translates whatever it is handed is somebody else's free translation
service billed to this site. Taking ids caps the bill at what it costs
to translate the posts that exist into the languages the site
publishes — a number that shrinks as translations accumulate and that a
visitor cannot grow except by writing posts, which they could do anyway.

It runs the provider on a **fast profile** (`asFast()` in
`api/_providers.js`), which is the difference between a feature people
use and one they wait through. Three things, each of which was most of
the wait at some point:

- **The model is told not to reason first.** The gpt-5 family thinks
  before answering, and thinks by default; so does Claude. That is
  right for a hard question and wrong for "translate these two lines",
  where it was the bulk of the delay. `reasoning_effort: minimal` on
  OpenAI, `effort: low` on Anthropic. A model that has never heard of
  the setting answers 400 and is simply asked again without it.
- **A smaller model.** `fastModel` per provider — Haiku rather than
  Opus, deliberately *not* `TRANSLATE_MODEL`: a site that points the
  blog at a large model for its once-a-day run should not make every
  visitor wait for that model to translate a greeting.
  `TRANSLATE_FAST_MODEL` overrides it.
- **A short instruction.** The blog's is five hundred tokens about
  markdown and headings, every one of them read before the first word
  comes back. The community's is a fifth of that and keeps the only
  guarantee that matters: n lines in, n lines out.

Two more things are off the reader's clock. The Anthropic SDK is
imported the first time that provider is actually used rather than when
`_providers.js` loads, which is about 100ms of every cold start on a
site running on somebody else's key. And the answer is sent before the
translation is written to the cache: remembering it is this site's
bookkeeping, and there is no reason for a reader to watch a spinner
through a database write that does nothing for them.

The provider is the one `api/translate.js` already uses; no new key.
The new variables are both optional:

| variable | what it does |
|---|---|
| `TRANSLATE_CACHE_SECRET` | lets the endpoint remember translations. Put the same string in the database: `insert into public.app_secrets (name, value) values ('translate_cache', '…') on conflict (name) do update set value = excluded.value;` |
| `TRANSLATE_FAST_MODEL` | the model used where somebody is waiting. Defaults to the provider's own small model, which is usually right. |

Without it the site still translates; it simply re-fetches each time
instead of remembering, so it can be deployed first and configured
after.

The secret exists because the write is the delicate part: the reader who
triggers a translation does not own the post, so it cannot go through
the author's update policy — and a function that lets anyone store any
text as the English version of anyone's post is a defacement tool, since
the post would still carry its author's name. `service_role` would solve
it and is not used, for the same reason the daily generator does not use
it: that key reads every row of every table, and it has no business in a
function a visitor can reach. `public.cache_story_translation`
(`supabase/schema.sql` §33a) compares the secret against its own copy
and writes nothing otherwise. Leaking it costs the ability to write
translation caches, and nothing else.

Everything here degrades cleanly: on a database that has not had §33
run, the page is exactly the community it was before — no badges, no
offer, no filter — so the deploy and the migration do not have to happen
in the same minute. Degrading quietly has its own failure mode, though,
which is that the one person who can fix it cannot tell the feature is
off from it having nothing to do. So the reason goes to the console for
whoever is looking, and on screen for a signed-in admin only; a visitor
is never shown a migration notice.

One thing the schema does not have: `stories` has no title column, only
`display_name` and `body`. There is no title to translate, and the
author's name is left alone.

Every post may carry any of three audiences: `tourists` (green),
`students` (blue), `expats` (purple), shown as badges on the card and on
the post. It is a label, not a filter — it saves someone opening a post
written for somebody else, and narrowing by topic is enough to browse
by.

`js/blog-categories.js` is the one place the ids, the descriptions and
the English notes the model files against live. Nothing else holds a
list of topics: `js/blog.js` reads `window.DURU_BLOG`, the editor's
select is built from it, the outline endpoint is told what to file
against by `DURU_BLOG.forOutline()`. It builds no navigation of its own.
Adding a topic means adding it there, adding its `blog.cat.*` keys to
the eight dictionaries, and widening `posts_category_check` in
`supabase/schema.sql`. The ids never change: they are what the database
stores and what a link someone shared last year still points at.

Under the cards, on the unfiltered list and once there are more than six
posts to pick from, sit three worth starting on — the newest from
Travel, Dining and Campus & Life. Below that the list itself, under a
heading that names where the reader is. The topic lives in the address
bar, so any view is a link someone can send.

### The morning's seven drafts

`scripts/generate-drafts.mjs` writes seven drafts a day, one per topic,
and stops. It publishes nothing: an admin reads them at `blog.html` and
approves what is worth approving.

**Where it runs.** GitHub Actions, not Vercel — writing seven articles
takes minutes and a Vercel Hobby function is cut off at sixty seconds.
`.github/workflows/daily-drafts.yml` fires at 20:30 UTC, which is 05:30
the next morning in Seoul, so the drafts are ready well before seven.

**How it signs in.** As an ordinary Supabase account that is listed in
`admin_users` — `DURU_BOT_EMAIL` and `DURU_BOT_PASSWORD` — and *not*
with the `service_role` key. That distinction is the point: if this
job's secrets leak, what leaks is an account that can write blog drafts.
Row Level Security applies to every write it makes, exactly as it does
to a person.

**Three calls per post, in this order**, because section 8.1 of the spec
is the whole idea — the title is written from the body, not the other
way round:

1. `pickTopic` — four candidates, each scored on six axes, one chosen.
   It is given the month's calendar (`scripts/lib/season.mjs`), the
   questions foreigners actually ask in that topic, and every title the
   site already carries, so it can avoid repeating itself.
2. `writeBody` — the body alone, 500–800 characters, two or three
   subheadings, no title.
3. `wrapUp` — five title candidates, the chosen title, the summary, the
   tags, the slug and an image prompt, all read off the finished body.

**Then the gate.** `scripts/lib/quality.mjs` counts and matches; it
never asks the model whether its own work is good enough, because a
model that has just written 430 characters will tell you it wrote 600.
Body length, summary length, title length, tag count, duplicate titles
and slugs, banned clickbait, the stock openings that make every
generated post read alike. A draft that fails is handed back with the
list and asked to fix those things — twice. Still failing, it is not
saved, and the batch records which category and why.

**The photograph.** Real ones, from Unsplash or Pexels, not generated:
a blog that tells people what a Korean convenience store actually looks
like is worse off with a rendering of one that does not exist, its
signage in Hangul that is not quite Hangul. `api/_photos.js` holds both
services behind one interface, the same shape as the translation
providers — set `UNSPLASH_ACCESS_KEY` or `PEXELS_API_KEY`, both free,
and `PHOTO_PROVIDER` when both are present.

Finding one takes two more calls: the model turns the post into two
English search queries (concrete nouns — "Seoul subway gate" finds a
subway gate, "how to use the subway in Korea" finds nothing), and then
looks at what came back and either picks one or says none of them fit.
Saying none is a real answer: a post with no picture beats a post about
visa paperwork with a photograph of a beach. If the first query finds
nothing, the second, broader one is tried.

Both licences allow commercial use with no payment and no permission,
and neither requires attribution — but both services' API terms ask for
it, so the photographer's name and link are stored with the photo and
shown under it, and Unsplash's "this was used" endpoint is called when
one is chosen. Read the licences yourself before launch:
unsplash.com/license and pexels.com/license; this environment cannot
reach them to quote the current text.

The picture is **hotlinked from the service's CDN**, not copied into
Supabase Storage. Unsplash asks to be hotlinked, it keeps the free
gigabyte free, and a photo is never orphaned from its credit.

A failed photo never fails a post (spec section 30): the whole of it is
inside its own `try`, and the post is saved with `image_status` of
`FAILED` and nothing where the picture would be.

**What it still cannot do.** There is no web search, so "what is
trending on Reddit this week" is out of reach; the seasonal calendar and
the gap analysis stand in for it, and both are honest about being a
substitute.

**Running it by hand.** The workflow has a `workflow_dispatch` with a
dry-run switch and a category filter, and the script takes the same two
flags:

```
node scripts/generate-drafts.mjs --dry-run --only=travel,dining
```

**Twice in one day is harmless.** The script claims the day by inserting
a `blog_batches` row, and `batch_date` is unique; a second run finds the
day taken and exits without writing. `posts (batch_date, category)` is
unique too, so a category cannot be filled twice either.

**When one category fails**, it fails alone: the loop catches it,
records the stage (`TOPIC_SELECTION_FAILED`, `TEXT_GENERATION_FAILED`,
`CONTENT_VALIDATION_FAILED`, `DB_SAVE_FAILED`) and carries on with the
next. The batch ends `PARTIAL` rather than `FAILED`, and the summary at
the end of the job says which one went wrong.

A generated draft carries `topic` and `title_candidates`, and the editor
shows both: the topic it was written to answer, and the other titles it
considered as chips under the title field. Clicking one swaps the title.

The editor also has a photo panel — what is on the post now, with its
credit, and a search box for finding another. The search goes through
`api/photo.js`, admin-gated exactly like `api/translate.js`, because the
service's key lives on the server and must never reach a browser.

That endpoint also relays Unsplash's "this photo was used" ping, and the
address for it comes from the caller — so `isUnsplashUrl` checks it
against `https://api.unsplash.com` before the key travels with it.
Without that check an admin could name any host and have the server hand
them the key.

### The date a post carries

A post has four dates, and they mean four different things.

| column | what it is |
|---|---|
| `draft_created_at` | when the draft first landed in the database |
| `post_date` | the day shown to readers, and what the list sorts on |
| `approved_at` | when an admin said yes |
| `published_at` | when it actually went public |

The one a reader sees is `post_date`, and it is the day the draft was
written — **not** the day it was approved. A piece drafted on Tuesday
and approved on Friday is still Tuesday's piece. Approving writes
`approved_at` and `published_at` and touches nothing else; the only
thing that may move `post_date` is an admin editing the date field in
the editor, and `post_date_source` flips to `ADMIN` when they do, so a
hand-set date can be told from a default one later.

`post_date` is a plain `date`, not a timestamp, and its default is
`(now() at time zone 'Asia/Seoul')::date` — a day in Seoul, whatever
timezone the database or the browser happens to be in. On the way out,
`formatDate` in `js/blog.js` takes `2026-09-22` apart and builds a local
`Date` from the parts: `new Date("2026-09-22")` is midnight UTC, which
is the day before for a reader in Los Angeles.

The list is ordered `post_date desc, draft_created_at desc` — newest day
first, and within a day the draft written last.

A post is one piece of writing however many languages it is written in,
the same shape the downloads use. `posts.lang` names the language its
own `title`/`excerpt`/`body` columns are in; `posts.i18n` holds
`{"<lang>": {"title", "excerpt", "body"}}` for the rest. A language
counts as available only when it is `lang` or its entry has a body, so
a half-finished translation is never offered.

The list works like the downloads list: compact cards three to a row,
the whole card a single stretched link, the topic cards and a "Pick a
language" dropdown of all eight languages (English selected by default)
filtering together. A blog card carries no glyph square — a Hangul
character on the corner of an English post means nothing to the person
reading it; the downloads keep theirs, where the glyph stands for a kind
of material. When the language has nothing, the empty state names the
languages that do, as buttons.

The same rule runs on a resource's own page: `?pl=` from the list sets
the file language on arrival, and changing the header language moves it,
naming any language the file does not come in rather than switching
silently.

`blog.html?post=<slug>&pl=<lang>` opens a post in a language. The post
carries its own "Read in" picker listing only the languages it is
written in; the language is taken from `pl`, else the site language,
and a notice says so when neither exists and it falls back. Choosing
one there never changes the language of the site — but changing the
site language does move the post, and the `?pl=` with it: that is the
reader saying what they want to read now, and a parameter the previous
page put in the address bar should not outrank it. An admin sees the
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

**The summary, the category and the tags write themselves.** A moment
after the body stops changing, `api/translate.js` in `mode: "outline"`
reads the post once and fills in all three — one request rather than
three, and one reading rather than three that might disagree about what
the post is. The tags field sits under the body, because there is
nothing to suggest until something is written.

They come back in the language the post is written in: a summary sits
on the card under the title and a tag is the author's own label, so both
belong to the writing rather than to whoever is reading. Readers in
another language get them translated with everything else — the head of
each translation batch carries the title, the summary **and the tags**,
so `mt[lang].tags` lines up one for one with `posts.tags`. A tag is
then shown in the reading language but still links by the original,
because the filter runs on `posts.tags` and a translated label that
filtered on itself would find nothing.

None of it overwrites: each field stops being offered the moment the
author touches it, and "Read the post again" is how to ask for a fresh
answer to all three. A category the page did not offer is dropped rather
than saved, since it would fail the database's check constraint;
duplicate tags, hash marks and anything over 32 characters are stripped
on the way back; and a body under 80 characters asks for nothing.

**Naver is deliberately absent.** Supabase has no Naver provider, and
the only ways to add one are to run the OAuth dance in our own
serverless function and mint a Supabase session with the `service_role`
key, or to stand up a separate identity service. Both put a key that
bypasses every Row Level Security policy on this site into a request
path a visitor can reach. That is a worse thing to own than the gap. If
Naver becomes necessary, the honest route is Supabase adding it — the
list in `js/auth.js` is one line per provider, so the day it exists the
change is that line.

### Words to know, under a Korean post

A reader working through a Korean article in their own language learns
more from five words explained than from a whole post translated. Under
a post written in Korean, `js/blog.js` renders a **Words to know**
corner: five words a learner would stumble on, each with its
romanization, part of speech, the meaning **this post uses**, a sentence
or two on how to use it, and the sentence it came from.

It sits directly under the writing, before the share buttons — while
the sentences are still in mind, rather than after the reader has been
invited to leave. (The heading was "Self-study" at first; that names a
way of studying rather than what is in the box, and a reader scanning
the page wants the second.)

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

