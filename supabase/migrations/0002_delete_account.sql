-- Roadmap step 6b: self-service account deletion for the profile page.
-- Run once in the Supabase dashboard's SQL Editor (Database -> SQL Editor).
--
-- A browser client holds only the publishable key and cannot touch the `auth`
-- schema, so it can't delete its own auth user. This SECURITY DEFINER function
-- runs as its owner (postgres) and does the erase, but stays RLS-safe: it only
-- ever acts on `auth.uid()` -- the caller's own id, taken from their JWT, never
-- a parameter -- so an authenticated user can only ever delete themselves.
-- `search_path = ''` forces every object below to be schema-qualified, closing
-- the usual SECURITY DEFINER search-path hijack.

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
  -- The FKs are `on delete cascade`, so deleting the auth user alone would
  -- suffice; the explicit deletes make the intent obvious and self-contained.
  delete from public.picks           where user_id = uid;
  delete from public.follows         where user_id = uid;
  delete from public.favorite_venues where user_id = uid;
  delete from auth.users             where id = uid;
end;
$$;

-- Only a real authenticated session may call it; anon/public get nothing.
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
