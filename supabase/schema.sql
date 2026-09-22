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
-- that material now belongs; nothing is deleted.

alter table public.posts drop constraint if exists posts_category_check;

update public.posts
   set category = 'language'
 where category in ('study', 'grammar');

alter table public.posts
  add constraint posts_category_check
  check (category in ('culture', 'travel', 'food', 'trends', 'language', 'etc'));

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
