-- Roadmap: real promoter follows. `follows` originally held only artist ids;
-- add a `kind` so the same table tracks both artists and promoters.
-- Run once in the Supabase dashboard's SQL Editor.
--
-- The NOT NULL DEFAULT 'artist' backfills every existing row as an artist follow
-- in place. The primary key is repointed to include `kind` so an artist and a
-- promoter that happen to share a numeric id can both be followed. RLS is scoped
-- to `user_id`, so the existing "own rows" policy is unaffected.

alter table follows
  add column if not exists kind text not null default 'artist'
  check (kind in ('artist', 'promoter'));

alter table follows drop constraint if exists follows_pkey;
alter table follows add primary key (user_id, kind, artist_id);
