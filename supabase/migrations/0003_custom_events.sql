-- Roadmap step 6b (cont.): past-party diary — user-authored custom events.
-- Run once in the Supabase dashboard's SQL Editor (Database -> SQL Editor).
--
-- Private by design: these rows are the owner's diary entries for parties that
-- aren't in RA's data. They never appear on the public map or lists -- only on
-- the owner's own profile -- which RLS "own rows" enforces (same pattern as
-- 0001_init.sql). Names may carry an optional RA id so the frontend can link
-- them; free-text names just render as plain text.

create table if not exists custom_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  venue_name text,
  venue_id text,
  lineup jsonb not null default '[]',        -- [{name, id?}]
  organizer_name text,
  organizer_id text,
  note text,
  created_at timestamptz not null default now()
);
alter table custom_events enable row level security;
create policy "own rows" on custom_events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Fold the new table into self-service deletion (0002_delete_account.sql). The
-- FK is on delete cascade, so removing the auth user would clear it anyway; the
-- explicit delete keeps the function's intent complete and self-contained.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.picks           where user_id = uid;
  delete from public.follows         where user_id = uid;
  delete from public.favorite_venues where user_id = uid;
  delete from public.custom_events   where user_id = uid;
  delete from auth.users             where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
