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
