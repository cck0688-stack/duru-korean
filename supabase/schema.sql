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
-- name it exactly "resources" → Public bucket: OFF. Then run the
-- policies below (Storage → Policies, or straight from SQL Editor —
-- both write to storage.objects).
--
-- The bucket is private because downloads are for signed-in visitors
-- only. A public bucket serves every object to anyone holding the URL,
-- so hiding the download button would have changed nothing: the link is
-- in the page source either way. Private plus a signed URL means the
-- link is minted per request, only for a session that has one, and it
-- expires. This line flips a bucket that was already created as public.

update storage.buckets set public = false where id = 'resources';

drop policy if exists "resources bucket: public read" on storage.objects;
drop policy if exists "resources bucket: authenticated read" on storage.objects;
create policy "resources bucket: authenticated read"
  on storage.objects for select
  to authenticated
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
  category text not null,
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
-- Records one row per visit, not per page view: the site writes here
-- once when someone arrives and not again as they move between pages.
-- A returning visitor counts again, signed in or not.
-- Uses a hashed fingerprint instead of IP addresses to avoid privacy
-- concerns. visited_date is stamped here in Korean time so "today" is
-- the same day for every visitor, whatever their own clock says.

create table if not exists public.visitor_logs (
  id uuid primary key default gen_random_uuid(),
  visitor_fingerprint text not null,
  visited_date date not null default (now() at time zone 'Asia/Seoul')::date,
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

alter table public.visitor_logs
  alter column visited_date set default (now() at time zone 'Asia/Seoul')::date;

-- The footer shows the running total and today's visits to everyone.
-- The rows stay admin-only; this hands out just the two numbers.
create or replace function public.get_visitor_counts()
returns table (total_visits bigint, today_visits bigint)
language sql stable security definer set search_path = public as $$
  select count(*)::bigint,
         count(*) filter (where visited_date = (now() at time zone 'Asia/Seoul')::date)::bigint
  from public.visitor_logs;
$$;
grant execute on function public.get_visitor_counts() to anon, authenticated;

-- ------------------------------------------------------------------
-- 9. content_likes — tracks likes on posts and stories
-- ------------------------------------------------------------------
-- Allows signed-in users to like/unlike posts and stories. One row per
-- user per content item. Likes are soft-deleted (has_liked = false) to
-- preserve history. Most-liked content can be ranked for recommendations.

create table if not exists public.content_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content_type text not null check (content_type in ('post', 'story')),
  content_id uuid not null,
  has_liked boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, content_type, content_id)
);

alter table public.content_likes enable row level security;

-- Users can see all likes (for rendering like counts)
drop policy if exists "content_likes: public read" on public.content_likes;
create policy "content_likes: public read"
  on public.content_likes for select
  using (has_liked = true);

-- Signed-in users can insert/update their own likes
drop policy if exists "content_likes: user insert" on public.content_likes;
create policy "content_likes: user insert"
  on public.content_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "content_likes: user update" on public.content_likes;
create policy "content_likes: user update"
  on public.content_likes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists content_likes_content_idx
  on public.content_likes (content_type, content_id, has_liked);
create index if not exists content_likes_user_idx
  on public.content_likes (user_id, content_type, has_liked);

-- ------------------------------------------------------------------
-- 10. SQL functions for recommendations
-- ------------------------------------------------------------------
-- Stored procedures to fetch most-liked posts and stories.

create or replace function public.get_most_liked_posts(p_limit int default 3)
returns table (
  id uuid,
  slug text,
  title text,
  excerpt text,
  category text,
  published boolean,
  created_at timestamptz,
  like_count bigint
) as $$
  select
    p.id,
    p.slug,
    p.title,
    p.excerpt,
    p.category,
    p.published,
    p.created_at,
    count(l.id) as like_count
  from public.posts p
  left join public.content_likes l on l.content_id = p.id
    and l.content_type = 'post'
    and l.has_liked = true
  where p.published = true
  group by p.id
  order by like_count desc, p.created_at desc
  limit p_limit;
$$ language sql stable;

create or replace function public.get_most_liked_stories(p_limit int default 3)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  body text,
  created_at timestamptz,
  like_count bigint
) as $$
  select
    s.id,
    s.user_id,
    s.display_name,
    s.body,
    s.created_at,
    count(l.id) as like_count
  from public.stories s
  left join public.content_likes l on l.content_id = s.id
    and l.content_type = 'story'
    and l.has_liked = true
  group by s.id
  order by like_count desc, s.created_at desc
  limit p_limit;
$$ language sql stable;

-- ------------------------------------------------------------------
-- 11. post tags
-- ------------------------------------------------------------------
-- Tags sit alongside the existing single category: a post has exactly
-- one category but any number of tags. Stored on the row rather than in
-- a join table, since tags are only ever read with their post and are
-- edited as one field in the post editor.

alter table public.posts
  add column if not exists tags text[] not null default '{}';

create index if not exists posts_tags_idx
  on public.posts using gin (tags);

-- ------------------------------------------------------------------
-- 12. user_roles — instructor / contributor / learner
-- ------------------------------------------------------------------
-- admin_users stays the top tier and keeps every policy already written
-- against it. This table only describes the tiers below it, so granting
-- someone a role here can never take admin away or hand it out.
--
-- Everyone without a row is a learner; no row has to be created at
-- signup for the default to hold.

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'learner'
    check (role in ('instructor', 'contributor', 'learner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- security definer: these are called from inside policies on other
-- tables, so they must not be re-filtered by this table's own RLS.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

-- Named duru_role rather than current_role, which Postgres reserves.
create or replace function public.duru_role()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 'admin'
    else coalesce(
      (select r.role from public.user_roles r where r.user_id = auth.uid()),
      'learner')
  end;
$$;

drop policy if exists "user_roles: self read" on public.user_roles;
create policy "user_roles: self read"
  on public.user_roles for select
  using (auth.uid() = user_id);

drop policy if exists "user_roles: admin read" on public.user_roles;
create policy "user_roles: admin read"
  on public.user_roles for select
  using (public.is_admin());

drop policy if exists "user_roles: admin write" on public.user_roles;
create policy "user_roles: admin write"
  on public.user_roles for insert
  with check (public.is_admin());

drop policy if exists "user_roles: admin update" on public.user_roles;
create policy "user_roles: admin update"
  on public.user_roles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "user_roles: admin delete" on public.user_roles;
create policy "user_roles: admin delete"
  on public.user_roles for delete
  using (public.is_admin());

-- Authoring rights for the two tiers that can write posts. These are
-- additional permissive policies, OR'd with the admin ones above:
-- an instructor may publish, a contributor may only leave drafts.

drop policy if exists "posts: author read own" on public.posts;
create policy "posts: author read own"
  on public.posts for select
  using (created_by = auth.uid());

drop policy if exists "posts: author insert" on public.posts;
create policy "posts: author insert"
  on public.posts for insert
  with check (
    created_by = auth.uid()
    and public.duru_role() in ('instructor', 'contributor')
    and (published = false or public.duru_role() = 'instructor')
  );

drop policy if exists "posts: author update own" on public.posts;
create policy "posts: author update own"
  on public.posts for update
  using (
    created_by = auth.uid()
    and public.duru_role() in ('instructor', 'contributor')
  )
  with check (
    created_by = auth.uid()
    and (published = false or public.duru_role() = 'instructor')
  );

-- ------------------------------------------------------------------
-- 13. follows — who hears about whose new work
-- ------------------------------------------------------------------

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.follows enable row level security;

-- Follower counts are public; who you follow is written only by you.
drop policy if exists "follows: public read" on public.follows;
create policy "follows: public read"
  on public.follows for select
  using (true);

drop policy if exists "follows: self insert" on public.follows;
create policy "follows: self insert"
  on public.follows for insert
  with check (auth.uid() = follower_id);

drop policy if exists "follows: self delete" on public.follows;
create policy "follows: self delete"
  on public.follows for delete
  using (auth.uid() = follower_id);

create index if not exists follows_following_idx
  on public.follows (following_id);
create index if not exists follows_follower_idx
  on public.follows (follower_id);

-- ------------------------------------------------------------------
-- 14. notifications — delivered when a followed author publishes
-- ------------------------------------------------------------------
-- Rows are written only by the triggers below, never by a client: there
-- is no insert policy, so a signed-in user cannot post a notification
-- into someone else's feed.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('post', 'story')),
  title text not null,
  link text not null,
  content_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "notifications: self read" on public.notifications;
create policy "notifications: self read"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "notifications: self update" on public.notifications;
create policy "notifications: self update"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notifications: self delete" on public.notifications;
create policy "notifications: self delete"
  on public.notifications for delete
  using (auth.uid() = user_id);

create index if not exists notifications_user_idx
  on public.notifications (user_id, is_read, created_at desc);

-- A post notifies on the transition into published, not on every save,
-- so editing a live post does not re-notify everyone.
create or replace function public.notify_followers_of_post()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.published and (tg_op = 'INSERT' or not coalesce(old.published, false)) then
    insert into public.notifications (user_id, kind, title, link, content_id)
    select f.follower_id, 'post', new.title,
           'blog.html?post=' || new.slug, new.id
    from public.follows f
    where f.following_id = new.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_notify_followers on public.posts;
create trigger posts_notify_followers
  after insert or update of published on public.posts
  for each row execute function public.notify_followers_of_post();

create or replace function public.notify_followers_of_story()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, kind, title, link, content_id)
  select f.follower_id, 'story',
         coalesce(nullif(trim(new.display_name), ''), 'A learner'),
         'stories.html', new.id
  from public.follows f
  where f.following_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists stories_notify_followers on public.stories;
create trigger stories_notify_followers
  after insert on public.stories
  for each row execute function public.notify_followers_of_story();

-- ------------------------------------------------------------------
-- 15. admin lookup of a user id by email
-- ------------------------------------------------------------------
-- The admin screens need to turn a typed email into a user id. A browser
-- holding the anon key cannot read auth.users and cannot call
-- auth.admin.listUsers(), which needs the service_role key and must
-- never be shipped to a page. This runs the lookup server-side instead,
-- and refuses anyone who is not already an admin, so it cannot be used
-- to test whether an address has an account.

create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select id into v_id
  from auth.users
  where lower(email) = lower(trim(p_email));
  return v_id;
end;
$$;

revoke all on function public.find_user_id_by_email(text) from public, anon;
grant execute on function public.find_user_id_by_email(text) to authenticated;

-- ------------------------------------------------------------------
-- 16. blog categories
-- ------------------------------------------------------------------
-- The vocabulary changed, so the constraint is rebuilt rather than
-- declared inline: an inline check on an existing table is never
-- re-evaluated by `create table if not exists`. Posts written under the
-- old "study" and "grammar" labels move to "language", which is where
-- that material belonged at the time; nothing is deleted.

alter table public.posts drop constraint if exists posts_category_check;

update public.posts
   set category = 'language'
 where category in ('study', 'grammar');

-- The list of categories, and the check that enforces it, now live in
-- section 27, which moves these values across again. Declaring the old
-- list here as well would reject those moved rows on a re-run — the
-- same reason section 17 leaves the resource list to section 20.

-- ------------------------------------------------------------------
-- 17. resource categories
-- ------------------------------------------------------------------
-- Resources were only ever filed by learning level. A category says what
-- kind of material a file is, which is what a visitor actually browses
-- by. Anything uploaded before this lands in 'printables', the broadest
-- of the five, rather than being left null.

alter table public.resources
  add column if not exists category text not null default 'printables';

-- The list of categories, and the check that enforces it, now live in
-- section 20, which also moves older values across. Defining the old
-- list here as well would reject those moved rows on a re-run.

create index if not exists resources_category_idx
  on public.resources (category, created_at desc);

-- ------------------------------------------------------------------
-- 18. guestbook replies
-- ------------------------------------------------------------------
-- A reply is a story row that points at its parent. Reusing the table
-- means every existing policy already applies: anyone may read, the
-- author may edit or delete their own, an admin may delete any. A reply
-- may itself be replied to, so a thread nests as deep as the talk goes.

alter table public.stories
  add column if not exists parent_id uuid references public.stories (id) on delete cascade;

create index if not exists stories_parent_idx
  on public.stories (parent_id, created_at);

-- The author of an entry hears about replies to it. Followers are told
-- about new top-level entries only — a reply is a conversation, not a
-- publication.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('post', 'story', 'reply'));

create or replace function public.notify_followers_of_story()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then
    insert into public.notifications (user_id, kind, title, link, content_id)
    select s.user_id, 'reply',
           coalesce(nullif(trim(new.display_name), ''), 'Someone'),
           'stories.html', new.id
    from public.stories s
    where s.id = new.parent_id
      and s.user_id <> new.user_id;
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, link, content_id)
  select f.follower_id, 'story',
         coalesce(nullif(trim(new.display_name), ''), 'A learner'),
         'stories.html', new.id
  from public.follows f
  where f.following_id = new.user_id;
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- 19. newsletter subscribers
-- ------------------------------------------------------------------
-- The "get lessons in your inbox" forms write here. Anyone may add an
-- address; only an admin may read the list. Sending the actual mail
-- needs a mail provider wired to an Edge Function — this table is the
-- list that provider would read, and the admin page shows it meanwhile.

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source text,
  created_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists "newsletter: public insert" on public.newsletter_subscribers;
create policy "newsletter: public insert"
  on public.newsletter_subscribers for insert
  with check (true);

drop policy if exists "newsletter: admin read" on public.newsletter_subscribers;
create policy "newsletter: admin read"
  on public.newsletter_subscribers for select
  using (public.is_admin());

drop policy if exists "newsletter: admin delete" on public.newsletter_subscribers;
create policy "newsletter: admin delete"
  on public.newsletter_subscribers for delete
  using (public.is_admin());

-- ------------------------------------------------------------------
-- 20. downloads in several languages
-- ------------------------------------------------------------------
-- A resource is one piece of material — "Hangul writing practice" —
-- and its files are the same PDF in each language it has been made
-- in. The list shows one card per resource; the language is chosen on
-- the resource's own page. Rows uploaded before this each held a
-- single file, which becomes that resource's first file below.
--
-- The old "book-audio" page is now "book-resources"; the location
-- value follows it. Categories are the five kinds of material the
-- Free Downloads page files things under; what was there before is
-- moved to the nearest of them.

alter table public.resources drop constraint if exists resources_publish_location_check;
update public.resources set publish_location = 'book-resources' where publish_location = 'book-audio';
alter table public.resources
  add constraint resources_publish_location_check
  check (publish_location in ('free-resources', 'book-resources'));

alter table public.resources
  add column if not exists body text,
  add column if not exists cover_key text,
  add column if not exists published boolean not null default true,
  add column if not exists i18n jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- The file itself now lives in resource_files; these stay only so old
-- rows keep their values until the copy below has run.
alter table public.resources alter column storage_key drop not null;
alter table public.resources alter column file_size drop not null;
alter table public.resources alter column file_type drop not null;

alter table public.resources drop constraint if exists resources_category_check;
update public.resources set category = case category
  when 'audio' then 'pronunciation'
  when 'printables' then 'hangul'
  when 'worksheets' then 'reallife'
  when 'cheatsheets' then 'grammar'
  else category end
where category in ('audio', 'printables', 'worksheets', 'cheatsheets');
alter table public.resources alter column category set default 'hangul';
alter table public.resources
  add constraint resources_category_check
  check (category in ('hangul', 'pronunciation', 'vocab', 'grammar', 'reallife'));

-- Resources are edited in place now, and a draft is seen by its admins only.
drop policy if exists "resources: public read" on public.resources;
create policy "resources: public read"
  on public.resources for select
  using (published or exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "resources: admin update" on public.resources;
create policy "resources: admin update"
  on public.resources for update
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create table if not exists public.resource_files (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete cascade,
  lang text not null,
  storage_key text not null unique,
  file_type text not null check (file_type in ('pdf', 'png', 'jpg', 'jpeg', 'mp3', 'm4a')),
  file_size bigint not null,
  mime_type text,
  page_count integer check (page_count is null or page_count > 0),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (resource_id, lang)
);

alter table public.resource_files enable row level security;

drop policy if exists "resource_files: public read" on public.resource_files;
create policy "resource_files: public read"
  on public.resource_files for select
  using (published or exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "resource_files: admin insert" on public.resource_files;
create policy "resource_files: admin insert"
  on public.resource_files for insert
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "resource_files: admin update" on public.resource_files;
create policy "resource_files: admin update"
  on public.resource_files for update
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "resource_files: admin delete" on public.resource_files;
create policy "resource_files: admin delete"
  on public.resource_files for delete
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create index if not exists resource_files_resource_idx
  on public.resource_files (resource_id, lang);

-- Each old single-file row becomes that resource's file in the language
-- its description was written in. Safe to re-run: a key already copied
-- is skipped.
insert into public.resource_files (resource_id, lang, storage_key, file_type, file_size, mime_type, created_by)
select r.id, r.description_language, r.storage_key, r.file_type, r.file_size, r.mime_type, r.created_by
from public.resources r
where r.storage_key is not null
  and not exists (select 1 from public.resource_files f where f.storage_key = r.storage_key);

-- Cover pictures are shown on the list to everyone, signed in or not,
-- so they live in a bucket of their own that is public. Only an admin
-- may put one there.
insert into storage.buckets (id, name, public)
values ('resource-covers', 'resource-covers', true)
on conflict (id) do update set public = true;

drop policy if exists "covers bucket: public read" on storage.objects;
create policy "covers bucket: public read"
  on storage.objects for select
  using (bucket_id = 'resource-covers');

drop policy if exists "covers bucket: admin upload" on storage.objects;
create policy "covers bucket: admin upload"
  on storage.objects for insert
  with check (
    bucket_id = 'resource-covers'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

drop policy if exists "covers bucket: admin update" on storage.objects;
create policy "covers bucket: admin update"
  on storage.objects for update
  using (
    bucket_id = 'resource-covers'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

drop policy if exists "covers bucket: admin delete" on storage.objects;
create policy "covers bucket: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'resource-covers'
    and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

-- ------------------------------------------------------------------
-- 21. Word files as downloads
-- ------------------------------------------------------------------
-- A worksheet is sometimes handed out as a .doc or .docx so a teacher
-- can edit it. The list of accepted file types is widened here, on the
-- per-language files table; the old single-file column on resources is
-- left as it was, since nothing writes there any more.

alter table public.resource_files drop constraint if exists resource_files_file_type_check;
alter table public.resource_files
  add constraint resource_files_file_type_check
  check (file_type in ('pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'mp3', 'm4a'));

-- A textbook chapter with its audio runs past the 20 MB a new bucket
-- allows, so both buckets are raised to the 50 MB a project permits per
-- upload. Nothing in the site offers a file larger than that.

update storage.buckets
   set file_size_limit = 52428800
 where id in ('resources', 'resource-covers');

-- ------------------------------------------------------------------
-- 22. blog posts in several languages
-- ------------------------------------------------------------------
-- A post is one piece of writing, however many languages it is written
-- in — the same shape the downloads use. `lang` names the language the
-- title/excerpt/body columns are written in, and `i18n` holds a
-- translation per language:
--
--   {"ko": {"title": "...", "excerpt": "...", "body": "..."}}
--
-- A language counts as available when it is `lang` or its entry has a
-- body, so a half-written translation never shows up as a choice.

alter table public.posts
  add column if not exists lang text not null default 'en',
  add column if not exists i18n jsonb not null default '{}'::jsonb;

alter table public.posts drop constraint if exists posts_lang_check;
alter table public.posts
  add constraint posts_lang_check
  check (lang in ('en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh'));

create index if not exists posts_lang_idx on public.posts (lang);

-- ------------------------------------------------------------------
-- 23. machine translation of a post, sentence by sentence
-- ------------------------------------------------------------------
-- A post written in one language is shown to a reader in another with
-- each source sentence followed by its translation. The translation is
-- made once, by an admin, and stored here — readers never call a
-- translation service, so a post costs one translation rather than one
-- per visitor.
--
--   {"zh": {"from": "ko",
--           "hash": "<fingerprint of the body that was translated>",
--           "at":   "2026-09-22T00:00:00.000Z",
--           "sentences": ["我今天去了…", "人真的很多！"]}}
--
-- `hash` is what keeps the two columns honest: edit the body and it no
-- longer matches, so the page treats the translation as missing instead
-- of pairing sentences with the wrong lines.

alter table public.posts
  add column if not exists mt jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------------
-- 24. likes without an account, and comments on a post
-- ------------------------------------------------------------------
-- A reader who has just finished an article should be able to react to
-- it there and then. Requiring an account first loses almost all of
-- them, so a like and a comment both work signed out.
--
-- "Signed out" still means *someone*: the browser keeps a random id in
-- localStorage (duru_anon_id) and sends it along. It proves nothing —
-- clearing site data makes a new person — but it is enough to stop one
-- reader liking the same post twenty times, and enough to let them
-- delete a comment they just wrote.

alter table public.content_likes alter column user_id drop not null;
alter table public.content_likes
  add column if not exists anon_id text;

alter table public.content_likes drop constraint if exists content_likes_who_check;
alter table public.content_likes
  add constraint content_likes_who_check
  check ((user_id is not null and anon_id is null)
      or (user_id is null and anon_id is not null and char_length(anon_id) between 8 and 64));

-- One like per person per item, for both kinds of person. The old
-- unique(user_id, …) constraint no longer covers anonymous rows, since
-- every one of those has user_id null.
create unique index if not exists content_likes_anon_uidx
  on public.content_likes (anon_id, content_type, content_id)
  where anon_id is not null;

-- Anonymous likes go through these two functions rather than through a
-- table policy. A policy permissive enough to let a signed-out visitor
-- write their own row would also let them rewrite everyone else's,
-- because RLS has no way to know which anonymous id the caller really
-- is. A security definer function does: it only ever touches the row
-- matching the id it was handed.

create or replace function public.content_like_state(
  p_type text, p_id uuid, p_anon text default null
) returns table (liked boolean, total bigint)
language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.content_likes l
      where l.content_type = p_type and l.content_id = p_id and l.has_liked
        and ((auth.uid() is not null and l.user_id = auth.uid())
          or (auth.uid() is null and p_anon is not null and l.anon_id = p_anon))
    ),
    (select count(*) from public.content_likes l
      where l.content_type = p_type and l.content_id = p_id and l.has_liked)::bigint;
$$;

create or replace function public.toggle_content_like(
  p_type text, p_id uuid, p_anon text default null
) returns table (liked boolean, total bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row public.content_likes;
begin
  if p_type not in ('post', 'story') then
    raise exception 'unknown content type';
  end if;

  if v_user is not null then
    select * into v_row from public.content_likes l
      where l.user_id = v_user and l.content_type = p_type and l.content_id = p_id;
  else
    if p_anon is null or char_length(p_anon) not between 8 and 64 then
      raise exception 'a reader id is required';
    end if;
    select * into v_row from public.content_likes l
      where l.anon_id = p_anon and l.content_type = p_type and l.content_id = p_id;
  end if;

  if v_row.id is null then
    insert into public.content_likes (user_id, anon_id, content_type, content_id, has_liked)
    values (v_user, case when v_user is null then p_anon end, p_type, p_id, true);
  else
    update public.content_likes
      set has_liked = not v_row.has_liked, updated_at = now()
      where id = v_row.id;
  end if;

  return query select * from public.content_like_state(p_type, p_id, p_anon);
end;
$$;

grant execute on function public.content_like_state(text, uuid, text) to anon, authenticated;
grant execute on function public.toggle_content_like(text, uuid, text) to anon, authenticated;

-- ------------------------------------------------------------------
-- post_comments — a conversation under an article
-- ------------------------------------------------------------------
-- A comment with a parent is a reply, and a reply may itself be replied
-- to, so a thread nests as deep as the talk goes — the same shape the
-- guestbook uses. Deleting a comment takes its replies with it, which
-- is what moderation wants: removing the comment that started a bad
-- thread should not leave the thread behind.

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  parent_id uuid references public.post_comments (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  anon_id text,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.post_comments enable row level security;

create index if not exists post_comments_post_idx
  on public.post_comments (post_id, created_at);
create index if not exists post_comments_parent_idx
  on public.post_comments (parent_id, created_at);

drop policy if exists "post_comments: public read" on public.post_comments;
create policy "post_comments: public read"
  on public.post_comments for select
  using (true);

-- Anyone may write one. The check is not about who they are but about
-- who they claim to be: a signed-in commenter's row must carry their own
-- id, and a signed-out one must carry none, so nobody can post under
-- another account's name.
drop policy if exists "post_comments: anyone insert" on public.post_comments;
create policy "post_comments: anyone insert"
  on public.post_comments for insert
  with check (
    (auth.uid() is not null and user_id = auth.uid())
    or (auth.uid() is null and user_id is null and anon_id is not null
        and char_length(anon_id) between 8 and 64)
  );

-- A signed-in author may remove their own; an admin may remove any.
drop policy if exists "post_comments: author or admin delete" on public.post_comments;
create policy "post_comments: author or admin delete"
  on public.post_comments for delete
  using (
    (user_id is not null and user_id = auth.uid())
    or exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

-- A signed-out author deletes through this instead, for the same reason
-- the likes do: only the function can check an anonymous id safely.
create or replace function public.delete_anon_comment(p_id uuid, p_anon text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_deleted int;
begin
  if p_anon is null or char_length(p_anon) not between 8 and 64 then
    return false;
  end if;
  delete from public.post_comments
    where id = p_id and user_id is null and anon_id = p_anon;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

grant execute on function public.delete_anon_comment(uuid, text) to anon, authenticated;

-- ------------------------------------------------------------------
-- 25. a heart is free, a comment needs an account
-- ------------------------------------------------------------------
-- Two different things were being traded for two different prices, and
-- section 24 priced them the same.
--
-- A heart costs a reader nothing and says little, so it stays open to
-- everyone — but a signed-out one cannot be taken back. Undoing needs
-- an account, because "this reader already liked it" is the only thing
-- a browser id can be trusted for; "this reader wants it undone" would
-- let anyone who guessed an id undo someone else's.
--
-- A comment carries a name and sits under the article for everyone to
-- read, so it needs an account. That also gives every commenter a way
-- to delete what they wrote, which the anonymous route never really
-- did.

-- Anonymous callers may now only add a like, never remove one. The
-- signed-in half is unchanged: their own like still toggles.
create or replace function public.toggle_content_like(
  p_type text, p_id uuid, p_anon text default null
) returns table (liked boolean, total bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row public.content_likes;
begin
  if p_type not in ('post', 'story') then
    raise exception 'unknown content type';
  end if;

  if v_user is not null then
    select * into v_row from public.content_likes l
      where l.user_id = v_user and l.content_type = p_type and l.content_id = p_id;
    if v_row.id is null then
      insert into public.content_likes (user_id, content_type, content_id, has_liked)
      values (v_user, p_type, p_id, true);
    else
      update public.content_likes
        set has_liked = not v_row.has_liked, updated_at = now()
        where id = v_row.id;
    end if;
  else
    if p_anon is null or char_length(p_anon) not between 8 and 64 then
      raise exception 'a reader id is required';
    end if;
    select * into v_row from public.content_likes l
      where l.anon_id = p_anon and l.content_type = p_type and l.content_id = p_id;
    -- Add only. An existing like stays; a signed-out reader who wants
    -- it back has to sign in, and nothing here can be used to undo
    -- someone else's.
    if v_row.id is null then
      insert into public.content_likes (anon_id, content_type, content_id, has_liked)
      values (p_anon, p_type, p_id, true);
    elsif not v_row.has_liked then
      update public.content_likes
        set has_liked = true, updated_at = now()
        where id = v_row.id;
    end if;
  end if;

  return query select * from public.content_like_state(p_type, p_id, p_anon);
end;
$$;

-- Writing a comment now needs an account, and a row must carry that
-- account's id and no browser id. Comments already written without one
-- stay where they are and stay readable; an admin can still remove any.
drop policy if exists "post_comments: anyone insert" on public.post_comments;
drop policy if exists "post_comments: signed in insert" on public.post_comments;
create policy "post_comments: signed in insert"
  on public.post_comments for insert
  with check (auth.uid() is not null and user_id = auth.uid() and anon_id is null);

-- Nothing can create an anonymous comment any more, so nothing needs a
-- way to delete one by browser id.
drop function if exists public.delete_anon_comment(uuid, text);

-- ------------------------------------------------------------------
-- 26. the self-study list under a Korean post
-- ------------------------------------------------------------------
-- A reader working through a Korean article in their own language
-- learns more from five words explained than from a whole post
-- translated. The list is built once, by an admin, alongside the
-- translation, and stored here:
--
--   {"hash": "<fingerprint of the body it was built from>",
--    "from": "ko", "at": "2026-09-22T…", "model": "…",
--    "words": [{"word": "발효", "romanization": "balhyo",
--               "pos": "noun", "sentence": "한식 맛의 핵심은 …",
--               "by": {"en": {"meaning": "fermentation",
--                             "explanation": "…"}}}]}
--
-- The same five words serve every language — only the explanations
-- differ — so a reader who switches language keeps their place. `hash`
-- does the same job it does for the translation: edit the post and the
-- list reads as missing rather than as words that are no longer there.

alter table public.posts
  add column if not exists study jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------------
-- 27. the blog's seven topics, and who a post is for
-- ------------------------------------------------------------------
-- The blog is written for people living in or visiting Korea from
-- somewhere else, and the six old categories were shaped around the
-- language course rather than around them. Seven now, and nothing under
-- them: a reader picks a topic and sees one sentence saying what is on
-- it. Sub-topics were tried and taken out again — a menu of twenty-four
-- things is a wall, not a way in — so `subtopic` is dropped below if an
-- earlier run of this file added it.
--
-- The ids are what a URL carries and what a link shared last year still
-- points at, so they are fixed here and everything a reader sees is
-- translated from them (js/blog-categories.js).
--
-- Old posts are re-filed by hand below, not dropped. Where the old
-- category has no obvious new home the post lands in 'community', which
-- is the explicit catch-all, rather than somewhere that merely sounds
-- close — an admin can move it in one click and a wrong topic is harder
-- to notice than an unsorted one.

alter table public.posts drop constraint if exists posts_category_check;

update public.posts set category = case category
  when 'travel'   then 'travel'      -- places to go, how to get there
  when 'food'     then 'dining'      -- the same subject, renamed
  when 'culture'  then 'explore'     -- everyday life and what to see
  when 'trends'   then 'explore'     -- pop culture sits with exploring
  when 'language' then 'community'   -- study material lives elsewhere on the site now
  when 'etc'      then 'community'
  else category
end
where category in ('travel', 'food', 'culture', 'trends', 'language', 'etc');

alter table public.posts
  add constraint posts_category_check
  check (category in ('travel', 'dining', 'style', 'explore', 'campus', 'career', 'community'));

-- Who the post is for: a badge on its card, so nobody opens something
-- written for somebody else. A post may be for several, or for none —
-- an empty list means "everyone", which is the honest default for a
-- post nobody has filed yet. There is no filter on it; narrowing the
-- list by topic is enough to browse by.
alter table public.posts
  add column if not exists audiences text[] not null default '{}'::text[];

alter table public.posts drop constraint if exists posts_audiences_check;
alter table public.posts
  add constraint posts_audiences_check
  check (audiences <@ array['tourists', 'students', 'expats']::text[]);

create index if not exists posts_audiences_idx
  on public.posts using gin (audiences);

-- Left over from the version of this section that had sub-topics. Safe
-- either way: nothing was ever filed under one.
drop index if exists public.posts_subtopic_idx;
alter table public.posts drop column if exists subtopic;

-- ------------------------------------------------------------------
-- 28. the date a post carries, and the drafts a generator will leave
-- ------------------------------------------------------------------
-- A post now has four dates, and they mean four different things. The
-- one a reader sees is `post_date`, and it is the day the draft was
-- first written — not the day an admin got round to approving it. A
-- piece written on Tuesday and approved on Friday is still Tuesday's
-- piece, and the list is ordered by that.
--
--   draft_created_at  when the draft first landed in the database
--   post_date         the day shown to readers, and what the list sorts on
--   approved_at       when an admin said yes
--   published_at      when it actually went public
--
-- Approving must never write post_date. The only thing that may change
-- it is an admin editing it by hand, and `post_date_source` records
-- that so a later migration can tell the two apart.
--
-- post_date is a plain `date`, not a timestamp: it is a day in Seoul,
-- and its default is computed there rather than in whatever timezone
-- the database happens to be set to.

alter table public.posts
  add column if not exists draft_created_at timestamptz not null default now();

alter table public.posts
  add column if not exists post_date date not null
  default ((now() at time zone 'Asia/Seoul')::date);

alter table public.posts add column if not exists approved_at timestamptz;
alter table public.posts add column if not exists published_at timestamptz;

alter table public.posts
  add column if not exists post_date_source text not null default 'DRAFT_DATE';

alter table public.posts drop constraint if exists posts_post_date_source_check;
alter table public.posts
  add constraint posts_post_date_source_check
  check (post_date_source in ('DRAFT_DATE', 'ADMIN'));

-- Posts written before this section existed keep the day they were
-- created, read in Seoul, so nothing moves in the list.
update public.posts
   set draft_created_at = created_at,
       post_date = (created_at at time zone 'Asia/Seoul')::date
 where draft_created_at > created_at;

-- What section 43 of the spec asks the public list to sort by.
create index if not exists posts_post_date_idx
  on public.posts (post_date desc, draft_created_at desc);

-- The topic a post was written to answer, and the titles that were
-- considered before one was picked. Both are for the admin screen: a
-- title can be swapped for one of its alternatives in a click.
alter table public.posts add column if not exists topic text;
alter table public.posts
  add column if not exists title_candidates text[] not null default '{}'::text[];

-- One picture per post. `image_status` is separate from the URL because
-- a failed image must not fail the post: the writing is what matters,
-- and an admin can ask for the picture again.
alter table public.posts add column if not exists image_url text;
alter table public.posts add column if not exists image_prompt text;
alter table public.posts add column if not exists image_status text;

alter table public.posts drop constraint if exists posts_image_status_check;
alter table public.posts
  add constraint posts_image_status_check
  check (image_status is null or image_status in ('PENDING', 'READY', 'FAILED'));

-- ------------------------------------------------------------------
-- One row per day the generator runs, so a morning that went wrong can
-- be seen rather than guessed at. Admins only: nothing here is for a
-- reader, and the public select policy the posts table has is exactly
-- what this table must not have.
create table if not exists public.blog_batches (
  id uuid primary key default gen_random_uuid(),
  batch_date date not null,
  status text not null default 'RUNNING',
  total int not null default 0,
  succeeded int not null default 0,
  failed int not null default 0,
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.blog_batches drop constraint if exists blog_batches_status_check;
alter table public.blog_batches
  add constraint blog_batches_status_check
  check (status in ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'));

-- One batch per day. The generator claims the day by inserting this
-- row, so a second run — a retried cron, a double click — finds the
-- day already taken instead of writing seven more drafts.
create unique index if not exists blog_batches_date_key
  on public.blog_batches (batch_date);

alter table public.blog_batches enable row level security;

drop policy if exists "blog_batches: admin read" on public.blog_batches;
create policy "blog_batches: admin read"
  on public.blog_batches for select
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "blog_batches: admin write" on public.blog_batches;
create policy "blog_batches: admin write"
  on public.blog_batches for all
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- The generator writes as one category per day, so the same category
-- cannot be filled twice in one batch either.
alter table public.posts add column if not exists batch_date date;
create unique index if not exists posts_batch_category_key
  on public.posts (batch_date, category) where batch_date is not null;

-- ------------------------------------------------------------------
-- 29. the photograph on a post, and who took it
-- ------------------------------------------------------------------
-- Real photographs from Unsplash and Pexels rather than generated
-- pictures: this blog tells people what a Korean convenience store
-- actually looks like, and a rendering of a convenience store that does
-- not exist — with signage in Hangul that is not quite Hangul — would
-- undo the point of the post.
--
-- The image is not copied into Supabase Storage. Both services serve
-- their photos from a CDN and ask to be hotlinked; storing them here
-- would fill the free gigabyte in a few months and give nothing back.
-- `image_url` is therefore a remote address, and the credit travels
-- with it.
--
-- Attribution is stored even where the licence does not demand it. It
-- costs one line under the picture and it is what both services' API
-- terms ask for.

alter table public.posts add column if not exists image_credit text;
alter table public.posts add column if not exists image_credit_url text;
alter table public.posts add column if not exists image_source text;
alter table public.posts add column if not exists image_alt text;

alter table public.posts drop constraint if exists posts_image_source_check;
alter table public.posts
  add constraint posts_image_source_check
  check (image_source is null or image_source in ('unsplash', 'pexels', 'upload'));

-- ------------------------------------------------------------------
-- 30. the seventh topic is called etc again
-- ------------------------------------------------------------------
-- Section 27 folded the old 'etc' shelf into 'community'. The header
-- menu now calls the guestbook Community, and two things on one site
-- called Community is one too many — so the blog's catch-all goes back
-- to 'etc' and the guestbook keeps the name readers will look for.
--
-- The id is what a URL carries, so /blog/community stops working. That
-- is survivable today, while the shelf is empty; it would not have
-- been in a year.

alter table public.posts drop constraint if exists posts_category_check;

update public.posts set category = 'etc' where category = 'community';

alter table public.posts
  add constraint posts_category_check
  check (category in ('travel', 'dining', 'style', 'explore', 'campus', 'career', 'etc'));

-- ------------------------------------------------------------------
-- 31. the community's three shelves
-- ------------------------------------------------------------------
-- The community page is filed the way the blog is: four cards at the
-- top, All and then three, and picking one narrows the list. Three,
-- because what people actually come here to do is ask something, say
-- something, or meet somebody — and a fourth shelf would be one nobody
-- could tell apart from the others.
--
--   ask    a question, and the answers to it
--   share  an experience, an opinion, a day in Korea
--   meet   introducing yourself, looking for a study partner
--
-- Everything written before this shelf existed was somebody telling a
-- story, so it lands on `share`. A reply carries whatever its parent
-- carries — it is part of that thread, not a post of its own, and the
-- page only ever counts and filters top-level rows.

alter table public.stories
  add column if not exists category text not null default 'share';

alter table public.stories drop constraint if exists stories_category_check;
alter table public.stories
  add constraint stories_category_check
  check (category in ('ask', 'share', 'meet'));

create index if not exists stories_category_idx
  on public.stories (category, created_at desc);

-- ------------------------------------------------------------------
-- 32. Korean Language Tips comes back as a shelf of its own
-- ------------------------------------------------------------------
-- Section 27 folded 'language' into the catch-all on the grounds that
-- study material lives elsewhere on the site. That was true of lessons
-- and worksheets; it was not true of the small things — why a stranger
-- asks your age before choosing a verb ending, which of two words for
-- "you" is safe. Those are blog posts, and they had nowhere to go.
--
-- Eight shelves now. Anything filed under 'etc' stays there; this only
-- widens what is allowed.

alter table public.posts drop constraint if exists posts_category_check;

alter table public.posts
  add constraint posts_category_check
  check (category in ('travel', 'dining', 'style', 'explore',
                      'campus', 'career', 'language', 'etc'));

-- ------------------------------------------------------------------
-- 33. one community, many languages
-- ------------------------------------------------------------------
-- A member writes in whatever language they are comfortable in, and a
-- reader reads it in whatever language they chose in the header. That
-- is one post, not eight: there is no Vietnamese board, and a
-- translation is never a second row with its own id, its own likes and
-- its own comment thread.
--
-- So each row gains two things.
--
--   lang  the language it was actually written in. Guessed from the
--         text while it is being typed and shown in the composer, so
--         the writer can correct it before posting. Null on everything
--         written before this existed — the page treats that as "we
--         don't know", shows no badge, and offers a translation anyway.
--
--   mt    the translations made so far, one entry per target language:
--
--           { "en": { "body": "…", "hash": "7f3a9c21",
--                     "engine": "openai:gpt-5",
--                     "at": "2026-09-23T04:11:02Z" } }
--
--         `hash` is of the body that was translated. When the author
--         edits their post the hash stops matching and the entry is
--         ignored — a stale translation is worse than none, because
--         nothing on screen would say it is out of date.
--
-- Translations ride along with the row the page already reads, so a
-- post someone has read before costs no request at all.

alter table public.stories
  add column if not exists lang text;

alter table public.stories drop constraint if exists stories_lang_check;
alter table public.stories
  add constraint stories_lang_check
  check (lang is null or lang in ('en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh'));

alter table public.stories
  add column if not exists mt jsonb not null default '{}'::jsonb;

create index if not exists stories_lang_idx
  on public.stories (lang) where lang is not null;

-- ------------------------------------------------------------------
-- 33a. who is allowed to write a translation into somebody else's row
-- ------------------------------------------------------------------
-- This is the part that needs care. The translation is triggered by a
-- reader, who may not be signed in and who certainly does not own the
-- post — so the write cannot go through the author's update policy.
--
-- Nor can it be thrown open. A function that lets anyone store any text
-- as the English version of anyone's post is a defacement tool: the
-- post would still be the author's, with the author's name on it, and
-- every English reader would see words the author never wrote.
--
-- The service_role key would solve it and is not used here, for the
-- same reason it is not used by the daily generator: it reads every row
-- of every table, and it would then live in a function a visitor can
-- reach. If that ever leaked, the whole database goes with it.
--
-- What is used instead is a secret that can do exactly one thing. The
-- API function holds it (Vercel → TRANSLATE_CACHE_SECRET); this
-- function compares it against the copy below and refuses everything
-- else. Leaking it costs the ability to write translation caches, and
-- nothing else at all.
--
-- Until a secret is set, nothing breaks: translations still work, they
-- are just re-fetched instead of remembered. So the feature can be
-- deployed first and the secret added afterwards.

create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

-- No policies, ever. With row level security on and nothing granted,
-- the table is unreachable from the API by any role except through the
-- security definer function below.
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create or replace function public.cache_story_translation(
  p_secret text,
  p_id uuid,
  p_lang text,
  p_body text,
  p_hash text,
  p_engine text
) returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from public.app_secrets where name = 'translate_cache';
  -- No secret configured, or the wrong one: say no and write nothing.
  -- The answer is the same either way, so a caller cannot tell a site
  -- that has no secret from one whose secret they guessed wrong.
  if v_secret is null or p_secret is null or v_secret <> p_secret then
    return false;
  end if;

  if p_lang not in ('en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh') then
    return false;
  end if;
  if p_body is null or char_length(p_body) > 20000 then
    return false;
  end if;

  update public.stories
     set mt = coalesce(mt, '{}'::jsonb) || jsonb_build_object(
           p_lang,
           jsonb_build_object(
             'body', p_body,
             'hash', coalesce(p_hash, ''),
             'engine', left(coalesce(p_engine, ''), 80),
             'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           )
         )
   where id = p_id;

  return found;
end;
$$;

revoke all on function public.cache_story_translation(text, uuid, text, text, text, text) from public;
grant execute on function public.cache_story_translation(text, uuid, text, text, text, text)
  to anon, authenticated;

-- ------------------------------------------------------------------
-- 34. downloads get a catch-all shelf too
-- ------------------------------------------------------------------
-- Five shelves and a sixth kind of file. Everything that is plainly a
-- Hangul chart or a grammar sheet already has somewhere to go, and
-- everything that is not — a calendar, a song sheet, a form somebody
-- needs filled in — had to be filed under a shelf it did not belong on.
--
-- The blog learned this the hard way in section 30: a catch-all is not
-- an admission of failure, it is what stops the five honest shelves
-- being quietly stretched to cover things they do not describe. It also
-- makes the row of shelves six, which sits as two rows of three rather
-- than five and an awkward gap.
--
-- Nothing moves. This only widens what is allowed.

alter table public.resources drop constraint if exists resources_category_check;

alter table public.resources
  add constraint resources_category_check
  check (category in ('hangul', 'pronunciation', 'vocab', 'grammar', 'reallife', 'etc'));

-- ------------------------------------------------------------------
-- 35. reading takes pronunciation's place on the shelf
-- ------------------------------------------------------------------
-- Pronunciation is a real subject and this is not a judgement on it.
-- It is that the valuable part of a pronunciation sheet is the sound,
-- and a silent PDF about sound is half a thing. Nothing here can make
-- the audio, so the shelf would have stayed empty while five others
-- filled up.
--
-- Reading takes the slot because it is the one gap nothing else covers.
-- Free word lists are everywhere; a short Korean passage at a level a
-- learner can actually read is genuinely hard to find. It is also the
-- only shelf that is connected text rather than words (vocab), rules
-- (grammar), phrases (reallife) or letters (hangul) — and the glossary
-- beside it is worth eight times as much once it is translated, which
-- is a thing this site can do and a person with a word processor
-- cannot.
--
-- Anything already filed under pronunciation moves to the catch-all
-- rather than being deleted or left pointing at a shelf that no longer
-- exists. `etc` is exactly what a catch-all is for, and re-filing one
-- of them by hand afterwards is a dropdown.
--
-- If pronunciation should come back later — with audio attached — it
-- is this constraint plus a line in js/resource-common.js.

update public.resources set category = 'etc' where category = 'pronunciation';

alter table public.resources drop constraint if exists resources_category_check;

alter table public.resources
  add constraint resources_category_check
  check (category in ('hangul', 'reading', 'vocab', 'grammar', 'reallife', 'etc'));

-- ------------------------------------------------------------------
-- 36. drafts, versions, sources and approvals for the downloads
-- ------------------------------------------------------------------
-- The blog's daily run writes an unpublished row and waits to be
-- approved. A download is the same idea with two differences that make
-- it a good deal more careful.
--
-- First, a download is a file. A blog post that turns out to be wrong
-- is edited in place and the old one is gone; a PDF has been
-- downloaded, printed and put in somebody's folder. So a file is a
-- version: editing makes a new one, approval is of a particular
-- version, and an edited version is approved again from scratch. The
-- old approval never carries over.
--
-- Second, a download is a thing this site hands out. Where the material
-- came from therefore has to be written down and checked by a person
-- before it goes anywhere. That is what resource_sources is for, and
-- the important column in it is rights_status, which is never set to
-- 'cleared' by anything automatic. A machine can record what a page
-- said its licence was. It cannot decide that the licence covers what
-- this site wants to do, and it must not be able to unblock itself.
--
-- Nothing here relaxes an existing rule. Reading is still public,
-- writing is still admin-only, and the draft file is not in the public
-- bucket at all.

-- 36a. a resource gets the fields the review screen needs ----------
alter table public.resources add column if not exists slug text;
alter table public.resources add column if not exists summary text;
alter table public.resources add column if not exists tags text[] not null default '{}';
alter table public.resources add column if not exists objective text;
alter table public.resources add column if not exists minutes integer;
alter table public.resources add column if not exists first_published_at timestamptz;
alter table public.resources add column if not exists updated_at timestamptz not null default now();
alter table public.resources add column if not exists origin text not null default 'hand';

-- Where a resource is in the pipeline. The order in section 7 of the
-- brief, with 'published' at the end.
alter table public.resources drop constraint if exists resources_status_check;
alter table public.resources add column if not exists status text not null default 'published';
alter table public.resources
  add constraint resources_status_check
  check (status in ('idea', 'researching', 'drafting', 'rendering',
                    'checking', 'review', 'changes', 'rejected', 'published'));

-- 'hand' is a resource somebody uploaded; 'auto' is one the daily run
-- wrote. Only the second needs the rights trail below.
alter table public.resources drop constraint if exists resources_origin_check;
alter table public.resources
  add constraint resources_origin_check check (origin in ('hand', 'auto'));

create unique index if not exists resources_slug_idx
  on public.resources (slug) where slug is not null;
create index if not exists resources_status_idx
  on public.resources (status, created_at desc);

-- 36b. a file becomes a version -------------------------------------
-- resource_files already held one file per language with its own
-- published flag, which is most of what the brief calls a
-- resource_version. What it could not do is hold two of them: the
-- unique key was (resource_id, lang), so an edit overwrote the file
-- somebody had already approved. Now the key includes the version, and
-- approving is approving one row.

alter table public.resource_files add column if not exists version integer not null default 1;
alter table public.resource_files add column if not exists file_hash text;
alter table public.resource_files add column if not exists draft_key text;
alter table public.resource_files add column if not exists check_result jsonb not null default '{}'::jsonb;
alter table public.resource_files add column if not exists approved_by uuid references auth.users (id);
alter table public.resource_files add column if not exists approved_at timestamptz;
alter table public.resource_files add column if not exists published_at timestamptz;

-- storage_key is where the public file lives, and a draft has not got
-- one yet, so it can no longer be required.
alter table public.resource_files alter column storage_key drop not null;
alter table public.resource_files alter column file_size drop not null;

-- The old key allowed one row per language. Replaced rather than
-- dropped, so two versions of the same language cannot collide either.
alter table public.resource_files drop constraint if exists resource_files_resource_id_lang_key;
create unique index if not exists resource_files_version_idx
  on public.resource_files (resource_id, lang, version);

create index if not exists resource_files_pending_idx
  on public.resource_files (resource_id, lang, version desc) where approved_at is null;

-- Everything already on the shelf was put there by a person, which is
-- the strongest approval there is. Without this the policy below would
-- hide every file uploaded before any of this existed — the whole
-- downloads page would go blank on the day this migration ran.
update public.resource_files
   set approved_at = coalesce(approved_at, created_at),
       published_at = coalesce(published_at, created_at)
 where published and approved_at is null;

-- A draft must not be readable by a visitor who guesses the row. The
-- old policy already hid unpublished rows from anyone but an admin;
-- this restates it so that the rule is in one place after the change.
drop policy if exists "resource_files: public read" on public.resource_files;
create policy "resource_files: public read"
  on public.resource_files for select
  using (
    (published and approved_at is not null)
    or exists (select 1 from public.admin_users a where a.user_id = auth.uid())
  );

-- 36c. where the material came from ---------------------------------
-- One row per source consulted, per version. The brief's source_record.
--
-- The column that matters is rights_status, and the point of it is that
-- nothing automatic ever writes 'cleared'. A generator can read a page
-- and write down what the page claimed; it cannot decide that the claim
-- covers what this site wants to do with it, and it must not be able to
-- clear its own block. The check constraint says so, the default says
-- so, and public.clear_resource_source() below is the only way to move
-- a row to 'cleared' — it requires an admin and records who.

create table if not exists public.resource_sources (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete cascade,
  file_id uuid references public.resource_files (id) on delete cascade,

  source_url text not null,
  source_title text,
  creator text,
  publisher text,
  checked_at timestamptz not null default now(),
  published_at timestamptz,

  license_name text,
  license_url text,
  -- fact, text, question, table, image, font …
  asset_type text not null default 'fact',
  -- what it was used for: checking a fact, quoting, adapting, inserting …
  intended_use text not null default 'fact-check',

  commercial_allowed text not null default 'unclear',
  adaptation_allowed text not null default 'unclear',
  redistribution_allowed text not null default 'unclear',

  permission_evidence text,
  credit_text text,
  review_note text,

  rights_status text not null default 'unchecked',
  cleared_by uuid references auth.users (id),
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.resource_sources drop constraint if exists resource_sources_rights_check;
alter table public.resource_sources
  add constraint resource_sources_rights_check
  check (rights_status in ('unchecked', 'needs-human', 'cleared', 'forbidden'));

alter table public.resource_sources drop constraint if exists resource_sources_allowed_check;
alter table public.resource_sources
  add constraint resource_sources_allowed_check
  check (commercial_allowed in ('yes', 'no', 'unclear')
     and adaptation_allowed in ('yes', 'no', 'unclear')
     and redistribution_allowed in ('yes', 'no', 'unclear'));

-- 'cleared' is a person's word, so it carries that person's name.
alter table public.resource_sources drop constraint if exists resource_sources_cleared_check;
alter table public.resource_sources
  add constraint resource_sources_cleared_check
  check (rights_status <> 'cleared' or (cleared_by is not null and cleared_at is not null));

create index if not exists resource_sources_resource_idx
  on public.resource_sources (resource_id);

alter table public.resource_sources enable row level security;

-- Sources are shown on the public detail page, so they are readable.
drop policy if exists "resource_sources: public read" on public.resource_sources;
create policy "resource_sources: public read"
  on public.resource_sources for select using (true);

drop policy if exists "resource_sources: admin write" on public.resource_sources;
create policy "resource_sources: admin write"
  on public.resource_sources for all
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- 36d. what a person decided ----------------------------------------
create table if not exists public.resource_reviews (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete cascade,
  file_id uuid references public.resource_files (id) on delete set null,
  actor_id uuid references auth.users (id),
  action text not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.resource_reviews drop constraint if exists resource_reviews_action_check;
alter table public.resource_reviews
  add constraint resource_reviews_action_check
  check (action in ('generated', 'checked', 'approved', 'changes', 'rejected',
                    'published', 'unpublished', 'rights-cleared'));

create index if not exists resource_reviews_resource_idx
  on public.resource_reviews (resource_id, created_at desc);

alter table public.resource_reviews enable row level security;

drop policy if exists "resource_reviews: admin read" on public.resource_reviews;
create policy "resource_reviews: admin read"
  on public.resource_reviews for select
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "resource_reviews: admin write" on public.resource_reviews;
create policy "resource_reviews: admin write"
  on public.resource_reviews for insert
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- 36e. the drafts bucket --------------------------------------------
-- A draft PDF does not go in the public bucket at all. The brief is
-- blunt about why: a file that is only unreachable because nobody has
-- guessed its URL is not private. So drafts live in their own bucket
-- that no policy lets a visitor read, and the approved copy is written
-- to the ordinary bucket at the moment of approval.

insert into storage.buckets (id, name, public)
values ('resource-drafts', 'resource-drafts', false)
on conflict (id) do update set public = false;

drop policy if exists "drafts bucket: admin read" on storage.objects;
create policy "drafts bucket: admin read"
  on storage.objects for select
  using (bucket_id = 'resource-drafts'
         and exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "drafts bucket: admin write" on storage.objects;
create policy "drafts bucket: admin write"
  on storage.objects for insert
  with check (bucket_id = 'resource-drafts'
              and exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

drop policy if exists "drafts bucket: admin delete" on storage.objects;
create policy "drafts bucket: admin delete"
  on storage.objects for delete
  using (bucket_id = 'resource-drafts'
         and exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- 36f. nothing is published except by a person ----------------------
-- The brief asks for this to be checked on the server rather than by
-- hiding a button, and for the reasons a draft is blocked to be
-- reasons a machine cannot argue its way out of.
--
-- publish_resource_file() is the only door. It refuses unless an admin
-- is asking, and it refuses while any of the blocking conditions in
-- section 6 still holds: a source that has not been cleared by a
-- person, a failed technical check, a missing file. It writes the
-- approval down — who, when, which version, which hash — and leaves a
-- review_event behind.

create or replace function public.resource_blocks(p_file_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(reason), '{}')
  from (
    -- the file itself
    select 'no-file' as reason
     where not exists (select 1 from public.resource_files f
                        where f.id = p_file_id and f.draft_key is not null)
    union all
    -- every technical check has to have passed
    select 'failed-check'
     where exists (select 1 from public.resource_files f
                    where f.id = p_file_id
                      and coalesce(f.check_result ->> 'ok', 'false') <> 'true')
    union all
    -- a source a person has not looked at is not a cleared source
    select 'rights-unchecked'
     where exists (
       select 1 from public.resource_files f
        join public.resource_sources s on s.resource_id = f.resource_id
       where f.id = p_file_id and s.rights_status in ('unchecked', 'needs-human'))
    union all
    select 'rights-forbidden'
     where exists (
       select 1 from public.resource_files f
        join public.resource_sources s on s.resource_id = f.resource_id
       where f.id = p_file_id and s.rights_status = 'forbidden')
  ) reasons;
$$;

grant execute on function public.resource_blocks(uuid) to authenticated;

-- publish_resource_file() itself is defined in §37 below, where it
-- gained one more line.

-- Clearing a source is a person's decision and is recorded as one.
create or replace function public.clear_resource_source(p_source_id uuid, p_note text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_resource uuid;
begin
  if not exists (select 1 from public.admin_users a where a.user_id = auth.uid()) then
    raise exception 'Only an admin can clear a source.';
  end if;

  update public.resource_sources
     set rights_status = 'cleared',
         cleared_by = auth.uid(),
         cleared_at = now(),
         review_note = coalesce(p_note, review_note)
   where id = p_source_id
   returning resource_id into v_resource;

  if v_resource is null then return false; end if;

  insert into public.resource_reviews (resource_id, actor_id, action, note)
  values (v_resource, auth.uid(), 'rights-cleared', p_note);
  return true;
end;
$$;

revoke all on function public.clear_resource_source(uuid, text) from public;
grant execute on function public.clear_resource_source(uuid, text) to authenticated;

-- 37. a draft is not published because a column says so ------------
-- resources.published dates from before the review queue and defaults
-- to true, so a sheet the run had just written — status 'review', no
-- approved file — showed on the public list and told its admin
-- "Published — everyone can see this download" while its files were
-- still drafts. The approval function now sets the column, the run
-- clears it, the rows already there are corrected, and the read policy
-- stops trusting it on its own: a row is public when it says published
-- AND its status is published.

update public.resources
   set published = false
 where origin = 'auto' and status <> 'published';

drop policy if exists "resources: public read" on public.resources;
create policy "resources: public read"
  on public.resources for select
  using ((published and status = 'published')
         or exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create or replace function public.publish_resource_file(
  p_file_id uuid,
  p_storage_key text,
  p_file_size bigint
) returns text[]
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_blocks text[];
  v_resource uuid;
begin
  if not exists (select 1 from public.admin_users a where a.user_id = auth.uid()) then
    raise exception 'Only an admin can publish a download.';
  end if;

  v_blocks := public.resource_blocks(p_file_id);
  if array_length(v_blocks, 1) is not null then
    return v_blocks;                      -- nothing is changed
  end if;

  update public.resource_files
     set storage_key = p_storage_key,
         file_size = p_file_size,
         published = true,
         approved_by = auth.uid(),
         approved_at = coalesce(approved_at, now()),
         published_at = coalesce(published_at, now())
   where id = p_file_id
   returning resource_id into v_resource;

  update public.resources
     set status = 'published',
         published = true,
         first_published_at = coalesce(first_published_at, now()),
         updated_at = now()
   where id = v_resource;

  insert into public.resource_reviews (resource_id, file_id, actor_id, action)
  values (v_resource, p_file_id, auth.uid(), 'approved');

  return '{}'::text[];
end;
$$;

revoke all on function public.publish_resource_file(uuid, text, bigint) from public;
grant execute on function public.publish_resource_file(uuid, text, bigint) to authenticated;
