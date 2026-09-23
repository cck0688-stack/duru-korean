-- DURU KOREAN — post-migration check
--
-- Paste this into the Supabase SQL editor after running schema.sql.
-- Every row (20 of them) should read OK. Any FAIL means schema.sql did not finish —
-- scroll up in the editor to the first red error and fix that one.

with checks(item, ok) as (
  values
    ('posts.tags column',
     to_regclass('public.posts') is not null and exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='posts' and column_name='tags')),

    ('resources.category column',
     to_regclass('public.resources') is not null and exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='resources' and column_name='category')),

    ('the community has three shelves',
     exists (select 1 from pg_constraint
             where conname='stories_category_check'
               and pg_get_constraintdef(oid) like '%meet%')),

    ('stories.parent_id column (guestbook replies)',
     to_regclass('public.stories') is not null and exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='stories' and column_name='parent_id')),

    ('user_roles table',           to_regclass('public.user_roles') is not null),
    ('visitor_logs table',         to_regclass('public.visitor_logs') is not null),

    ('visitor counts function (footer)',
     to_regprocedure('public.get_visitor_counts()') is not null),

    ('follows table',              to_regclass('public.follows') is not null),
    ('notifications table',        to_regclass('public.notifications') is not null),
    ('newsletter_subscribers table', to_regclass('public.newsletter_subscribers') is not null),

    ('blog topics for people in Korea',
     exists (select 1 from pg_constraint
             where conname='posts_category_check'
               and pg_get_constraintdef(oid) like '%campus%')),

    -- The catch-all is 'etc'; 'community' is the guestbook now. And
    -- 'language' is a shelf again — section 32.
    ('the catch-all topic is etc, not community',
     exists (select 1 from pg_constraint
             where conname='posts_category_check'
               and pg_get_constraintdef(oid) like '%etc%'
               and pg_get_constraintdef(oid) not like '%community%')),

    ('Korean Language Tips is a topic of its own',
     exists (select 1 from pg_constraint
             where conname='posts_category_check'
               and pg_get_constraintdef(oid) like '%language%')),

    ('posts carries its own date (post_date, draft_created_at, …)',
     (select count(*) from information_schema.columns
      where table_schema='public' and table_name='posts'
        and column_name in ('post_date', 'draft_created_at', 'approved_at',
                            'published_at', 'post_date_source')) = 5),

    ('post_date defaults to today in Seoul',
     (select column_default from information_schema.columns
      where table_schema='public' and table_name='posts'
        and column_name='post_date') like '%Asia/Seoul%'),

    ('posts carries a photo and its credit',
     (select count(*) from information_schema.columns
      where table_schema='public' and table_name='posts'
        and column_name in ('image_url', 'image_alt', 'image_credit',
                            'image_credit_url', 'image_source')) = 5),

    ('only the three photo sources are accepted',
     exists (select 1 from pg_constraint
             where conname='posts_image_source_check'
               and pg_get_constraintdef(oid) like '%unsplash%')),

    ('blog_batches table (one row per generated day)',
     to_regclass('public.blog_batches') is not null),

    ('one batch per day, one post per category per batch',
     exists (select 1 from pg_indexes
             where schemaname='public' and indexname='blog_batches_date_key')
     and exists (select 1 from pg_indexes
             where schemaname='public' and indexname='posts_batch_category_key')),

    ('posts.audiences exists, posts.subtopic gone',
     exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='posts' and column_name='audiences')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='posts' and column_name='subtopic')),

    ('notifications accept replies',
     exists (select 1 from pg_constraint
             where conname='notifications_kind_check'
               and pg_get_constraintdef(oid) like '%reply%')),

    ('find_user_id_by_email function',
     to_regprocedure('public.find_user_id_by_email(text)') is not null),

    ('reply notification trigger',
     exists (select 1 from pg_trigger where tgname='stories_notify_followers')),

    ('resources bucket is private',
     exists (select 1 from storage.buckets where id='resources' and public = false)),

    ('resource_files table (downloads by language)',
     to_regclass('public.resource_files') is not null),

    ('resources.i18n column',
     to_regclass('public.resources') is not null and exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='resources' and column_name='i18n')),

    ('download categories updated',
     exists (select 1 from pg_constraint
             where conname='resources_category_check'
               and pg_get_constraintdef(oid) like '%reallife%')),

    ('book-resources location accepted',
     exists (select 1 from pg_constraint
             where conname='resources_publish_location_check'
               and pg_get_constraintdef(oid) like '%book-resources%')),

    ('Word files accepted as downloads',
     exists (select 1 from pg_constraint
             where conname='resource_files_file_type_check'
               and pg_get_constraintdef(oid) like '%docx%')),

    ('resource-covers bucket is public',
     exists (select 1 from storage.buckets where id='resource-covers' and public = true)),

    ('posts.i18n exists (blog in several languages)',
     exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='posts' and column_name='i18n')),

    ('posts.lang exists',
     exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='posts' and column_name='lang')),

    ('posts.mt exists (sentence-by-sentence translation)',
     exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='posts' and column_name='mt')),

    ('post_comments table (comments and replies)',
     exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='post_comments')),

    ('likes work without an account',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='public' and p.proname='toggle_content_like')
     and (select is_nullable from information_schema.columns
          where table_schema='public' and table_name='content_likes'
            and column_name='user_id') = 'YES'),

    ('commenting needs an account',
     exists (select 1 from pg_policies
             where schemaname='public' and tablename='post_comments'
               and policyname='post_comments: signed in insert')
     and not exists (select 1 from pg_policies
             where schemaname='public' and tablename='post_comments'
               and policyname='post_comments: anyone insert')),

    ('posts.study exists (self-study word list)',
     exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='posts' and column_name='study')),

    ('stories.lang exists (which language a post was written in)',
     exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='stories' and column_name='lang')),

    ('stories.mt exists (translations kept on the post itself)',
     exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='stories' and column_name='mt')),

    ('translation caching is a locked function, not a table write',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='public' and p.proname='cache_story_translation'
               and p.prosecdef)
     and not exists (select 1 from pg_policies
             where schemaname='public' and tablename='stories'
               and cmd in ('UPDATE', 'ALL') and policyname not like '%author%')),

    ('app_secrets is unreachable from the API',
     exists (select 1 from pg_tables
             where schemaname='public' and tablename='app_secrets' and rowsecurity)
     and not exists (select 1 from pg_policies
             where schemaname='public' and tablename='app_secrets')),

    ('downloads have a catch-all shelf, and a reading shelf',
     exists (select 1 from pg_constraint
             where conname = 'resources_category_check'
               and pg_get_constraintdef(oid) like '%etc%'
               and pg_get_constraintdef(oid) like '%reading%')),

    ('nothing is left filed under a shelf that no longer exists',
     not exists (select 1 from public.resources where category = 'pronunciation')),

    ('uploads allowed up to 50 MB',
     not exists (select 1 from storage.buckets
                 where id in ('resources', 'resource-covers')
                   and coalesce(file_size_limit, 52428800) < 52428800))
)
select
  case when ok then 'OK   ' else 'FAIL ' end || item as result
from checks
order by ok, item;

-- The bucket line is the one exception worth reading twice: it says FAIL
-- both when the bucket is still public and when no bucket named
-- "resources" exists yet. Create it under Storage → New bucket with
-- Public bucket OFF, then run schema.sql again.
