-- DURU KOREAN — admin resource management schema
--
-- Run this once in the Supabase dashboard: Project → SQL Editor → New query.
-- It creates two tables and their Row Level Security (RLS) policies. RLS is
-- what actually protects this data — the anon/publishable key used by the
-- website is public by design, so every rule that decides who can read,
-- upload, or delete something has to live here, never in front-end code.
--
-- After running this file, see README.md ("Admin setup") for the one
-- remaining manual step: adding yourself to admin_users.

-- ------------------------------------------------------------------
-- 1. admin_users — who is allowed to manage resources
-- ------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- A signed-in user may check ONLY their own row (so the site can ask
-- "am I an admin?"), never list who else is an admin.
drop policy if exists "admin_users: self read only" on public.admin_users;
create policy "admin_users: self read only"
  on public.admin_users for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy is defined for admin_users on purpose.
-- That means the anon/authenticated roles can never write to this table
-- through the website, no matter what the client-side code sends. The
-- only way to add an admin is from the Supabase dashboard (Table Editor
-- or SQL Editor), acting as the project owner — see README.md.

-- ------------------------------------------------------------------
-- 2. resources — the actual attached files (metadata; the file bytes
--    live in Supabase Storage, bucket "resources")
-- ------------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  publish_location text not null check (publish_location in ('free-resources', 'book-audio')),
  file_type text not null check (file_type in ('pdf', 'png', 'jpg', 'jpeg', 'mp3', 'm4a')),
  description_language text not null default 'en',
  learning_level text,
  linked_unit text,
  storage_key text not null unique,
  file_size bigint not null,
  mime_type text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

alter table public.resources enable row level security;

-- Anyone — including anonymous visitors — can see the resource list.
drop policy if exists "resources: public read" on public.resources;
create policy "resources: public read"
  on public.resources for select
  using (true);

-- Only a verified admin (present in admin_users) can add a row.
drop policy if exists "resources: admin insert" on public.resources;
create policy "resources: admin insert"
  on public.resources for insert
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- Only a verified admin can remove a row.
drop policy if exists "resources: admin delete" on public.resources;
create policy "resources: admin delete"
  on public.resources for delete
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- Resources are never edited in place in this app (delete + re-upload
-- instead), so there is intentionally no update policy.

create index if not exists resources_publish_location_idx
  on public.resources (publish_location, created_at desc);

-- ------------------------------------------------------------------
-- 3. Storage bucket + policies
-- ------------------------------------------------------------------
-- Create the bucket first from the dashboard: Storage → New bucket →
-- name it exactly "resources" → Public bucket: ON (so download links
-- work for anonymous visitors without a signed URL). Then run the
-- policies below (Storage → Policies, or straight from SQL Editor —
-- both write to storage.objects).

drop policy if exists "resources bucket: public read" on storage.objects;
create policy "resources bucket: public read"
  on storage.objects for select
  using (bucket_id = 'resources');

drop policy if exists "resources bucket: admin upload" on storage.objects;
create policy "resources bucket: admin upload"
  on storage.objects for insert
  with check (
    bucket_id = 'resources'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

drop policy if exists "resources bucket: admin delete" on storage.objects;
create policy "resources bucket: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'resources'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

-- ------------------------------------------------------------------
-- 4. keep_alive — supports .github/workflows/keep-alive.yml
-- ------------------------------------------------------------------
-- A free-tier Supabase project pauses after a stretch of inactivity.
-- The scheduled workflow pings this table every three days to keep it
-- awake. The table exists only to be selected from; it never needs a
-- row, because PostgREST answers an empty table with 200 and [], and
-- the workflow's `curl -f` only fails on an error status. Without the
-- table that same request 404s and the workflow reports failure.

create table if not exists public.keep_alive (
  id bigserial primary key,
  pinged_at timestamptz not null default now()
);

alter table public.keep_alive enable row level security;

drop policy if exists "keep_alive: public read" on public.keep_alive;
create policy "keep_alive: public read"
  on public.keep_alive for select
  using (true);

-- ------------------------------------------------------------------
-- 5. posts — blog articles written by the Duru team
-- ------------------------------------------------------------------
-- Written and edited from the site itself, not the dashboard. A post is
-- invisible to visitors until published, so a half-finished draft can be
-- saved without anyone seeing it.

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category text not null check (category in ('study', 'grammar', 'culture', 'travel')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  excerpt text check (excerpt is null or char_length(excerpt) <= 400),
  body text not null check (char_length(trim(body)) between 1 and 40000),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

alter table public.posts enable row level security;

-- Visitors see published posts only. Two separate select policies are
-- OR'd together by Postgres, so an admin additionally sees drafts.
drop policy if exists "posts: public read published" on public.posts;
create policy "posts: public read published"
  on public.posts for select
  using (published);

drop policy if exists "posts: admin read all" on public.posts;
create policy "posts: admin read all"
  on public.posts for select
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "posts: admin insert" on public.posts;
create policy "posts: admin insert"
  on public.posts for insert
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "posts: admin update" on public.posts;
create policy "posts: admin update"
  on public.posts for update
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "posts: admin delete" on public.posts;
create policy "posts: admin delete"
  on public.posts for delete
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create index if not exists posts_published_idx
  on public.posts (published, created_at desc);

-- ------------------------------------------------------------------
-- 6. stories — short pieces written by learners
-- ------------------------------------------------------------------
-- Anyone signed in may post. Stories appear immediately; an admin can
-- remove any of them. A learner picks a display name per story, so the
-- email address they signed up with is never exposed — the table has no
-- column for it, and user_id is only ever compared against auth.uid(),
-- never shown.

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stories enable row level security;

drop policy if exists "stories: public read" on public.stories;
create policy "stories: public read"
  on public.stories for select
  using (true);

-- The with check is what stops someone posting under another person's
-- account: the row's user_id has to be the caller's own id.
drop policy if exists "stories: author insert" on public.stories;
create policy "stories: author insert"
  on public.stories for insert
  with check (auth.uid() = user_id);

drop policy if exists "stories: author update" on public.stories;
create policy "stories: author update"
  on public.stories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "stories: author delete" on public.stories;
create policy "stories: author delete"
  on public.stories for delete
  using (auth.uid() = user_id);

drop policy if exists "stories: admin delete" on public.stories;
create policy "stories: admin delete"
  on public.stories for delete
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create index if not exists stories_created_idx
  on public.stories (created_at desc);

-- ------------------------------------------------------------------
-- 7. user_profiles — extended profile information for all users
-- ------------------------------------------------------------------
-- Stores user's profile data like nickname, birth date, and consent status.
-- Each user has at most one profile row, created on first signup.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text check (nickname is null or char_length(trim(nickname)) between 1 and 40),
  birth_date date,
  tos_agreed boolean not null default false,
  privacy_agreed boolean not null default false,
  marketing_agreed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- Users can see only their own profile
drop policy if exists "user_profiles: self read" on public.user_profiles;
create policy "user_profiles: self read"
  on public.user_profiles for select
  using (auth.uid() = user_id);

-- Users can insert their own profile
drop policy if exists "user_profiles: self insert" on public.user_profiles;
create policy "user_profiles: self insert"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

-- Users can update their own profile
drop policy if exists "user_profiles: self update" on public.user_profiles;
create policy "user_profiles: self update"
  on public.user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 8. visitor_logs — track daily visitors for analytics
-- ------------------------------------------------------------------
-- Records one entry per unique visitor per day. Uses hashed fingerprint
-- instead of IP addresses to avoid privacy/GDPR issues. Entries auto-delete
-- after 90 days via a scheduled job (Supabase Functions + pg_cron).

create table if not exists public.visitor_logs (
  id uuid primary key default gen_random_uuid(),
  visitor_fingerprint text not null,
  visited_date date not null,
  page_path text,
  created_at timestamptz not null default now()
);

alter table public.visitor_logs enable row level security;

-- Admin can read visitor stats, everyone else cannot
drop policy if exists "visitor_logs: admin read" on public.visitor_logs;
create policy "visitor_logs: admin read"
  on public.visitor_logs for select
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- Anyone can insert a visitor log entry (for anonymous tracking)
drop policy if exists "visitor_logs: public insert" on public.visitor_logs;
create policy "visitor_logs: public insert"
  on public.visitor_logs for insert
  with check (true);

create index if not exists visitor_logs_date_idx
  on public.visitor_logs (visited_date desc);
create index if not exists visitor_logs_fingerprint_date_idx
  on public.visitor_logs (visitor_fingerprint, visited_date);
