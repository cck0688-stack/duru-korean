-- DURU KOREAN — Community simulation: TEST PROJECT ONLY
-- ==================================================================
--
-- Run this in a SEPARATE Supabase project made for testing, after
-- supabase/schema.sql. Never in the live project.
--
-- It adds three tables the simulation needs and nothing else. The
-- first one, sim_environment, is also the simulation's second lock:
-- scripts/sim/run.mjs refuses to write anything to a database that
-- does not have it, and the live database never will. (The first lock
-- is that it refuses the live project's address outright.)
--
-- None of this holds real people's data. The personas are invented;
-- their emails are on example.com, a domain reserved so that no
-- message sent there can reach anyone.

create table if not exists public.sim_environment (
  name text primary key,
  created_at timestamptz not null default now()
);
insert into public.sim_environment (name) values ('duru-community-sim')
on conflict (name) do nothing;
alter table public.sim_environment enable row level security;
drop policy if exists "sim_environment: read" on public.sim_environment;
create policy "sim_environment: read" on public.sim_environment for select using (true);

-- Who the invented members are. No nationality column, on purpose: a
-- persona has a language it writes in and nothing is inferred from it.
create table if not exists public.sim_personas (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  nickname text not null check (char_length(trim(nickname)) between 1 and 40),
  lang text not null check (lang in ('en', 'vi', 'es', 'id', 'pt-BR', 'ko', 'ja', 'zh')),
  topic text not null check (topic in ('ask', 'share', 'meet')),
  voice text not null default '',
  joined_on date not null,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sim_personas enable row level security;
drop policy if exists "sim_personas: read" on public.sim_personas;
create policy "sim_personas: read" on public.sim_personas for select using (true);
drop policy if exists "sim_personas: self insert" on public.sim_personas;
create policy "sim_personas: self insert" on public.sim_personas for insert
  with check (auth.uid() = user_id);
drop policy if exists "sim_personas: self update" on public.sim_personas;
create policy "sim_personas: self update" on public.sim_personas for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- What the simulation meant to write, so the verifier can tell whether
-- the site kept it: the language the persona wrote in, the language
-- the composer's detector chose, and a fingerprint of the exact text.
create table if not exists public.sim_log (
  story_id uuid primary key references public.stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('post', 'reply')),
  intended_lang text not null,
  detected_lang text,
  body_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.sim_log enable row level security;
drop policy if exists "sim_log: read" on public.sim_log;
create policy "sim_log: read" on public.sim_log for select using (true);
drop policy if exists "sim_log: self insert" on public.sim_log;
create policy "sim_log: self insert" on public.sim_log for insert
  with check (auth.uid() = user_id);

create index if not exists sim_personas_joined_idx on public.sim_personas (joined_on);
create index if not exists sim_log_created_idx on public.sim_log (created_at desc);
