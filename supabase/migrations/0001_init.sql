-- Roadmap step 6a: accounts (follows, picks, favorite venues).
-- Run this once in the Supabase dashboard's SQL Editor (Database -> SQL Editor).
-- Every table gets Row Level Security enabled and policied in this same first
-- migration -- no table ships without a policy. Policies are scoped `to
-- authenticated`, so the publishable-key/anon role gets zero access without a
-- real session; `auth.uid()` is wrapped in `select` so Postgres caches it once
-- per statement instead of re-evaluating per row.

create table if not exists follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, artist_id)
);
alter table follows enable row level security;
create policy "own rows" on follows for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- One row per (user, event): status is mutually exclusive (went XOR
-- want_to_go), so "switch status" and "clear" are a plain upsert/delete.
create table if not exists picks (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  status text not null check (status in ('went', 'want_to_go')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table picks enable row level security;
create policy "own rows" on picks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists favorite_venues (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_name)
);
alter table favorite_venues enable row level security;
create policy "own rows" on favorite_venues for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
