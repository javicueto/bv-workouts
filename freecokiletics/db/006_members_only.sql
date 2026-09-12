-- 006 · Cokiletics is members-only (Javier, 12 Sep 2026).
--
-- Accounts live in Maky's auth, which Maky's own users share, so sign-up
-- cannot be switched off there without closing Maky too. And the app's
-- "Create an account" button is only a button: the publishable key is public,
-- so anyone can make an account through the API.
--
-- So the gate is here, on Cokiletics' own tables: one RESTRICTIVE policy per
-- table, ANDed with the existing "own rows" policy, that only lets an account
-- listed in freeco_members through. The existing policies are untouched. An
-- account that is not listed can still sign in, but every read comes back empty
-- and every write is refused — and the app tells it so (views/auth.js).
--
-- Adding someone later (as the project owner — Supabase SQL editor or MCP):
--   insert into public.freeco_members (user_id, note)
--   select id, '<why>' from auth.users where email = '<their email>';
--
-- Tested before applying inside a transaction that rolled itself back
-- (see git history for the probe). Applied 12 Sep 2026 to the Maky project.

create table public.freeco_members (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

alter table public.freeco_members enable row level security;

-- A member may read their OWN row (the app checks it to explain a refusal),
-- and nothing else. No insert/update/delete policy: nobody adds themselves.
create policy "freeco own membership" on public.freeco_members
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );
revoke insert, update, delete, truncate on public.freeco_members from anon, authenticated;

-- security definer: the policies below must consult the members list without
-- granting anyone read access to it. search_path '' so nothing in a caller's
-- schema can stand in for the objects named here (advisor lint 0011).
create function public.freeco_is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.freeco_members m where m.user_id = (select auth.uid()));
$$;
revoke execute on function public.freeco_is_member() from public, anon;
grant execute on function public.freeco_is_member() to authenticated;

-- (select …) so it is evaluated once per query, not once per row.
create policy "freeco members only" on public.freeco_workouts
  as restrictive for all to authenticated
  using ((select public.freeco_is_member())) with check ((select public.freeco_is_member()));
create policy "freeco members only" on public.freeco_sets
  as restrictive for all to authenticated
  using ((select public.freeco_is_member())) with check ((select public.freeco_is_member()));
create policy "freeco members only" on public.freeco_plans
  as restrictive for all to authenticated
  using ((select public.freeco_is_member())) with check ((select public.freeco_is_member()));

-- Everyone already using Cokiletics when this was applied: Javier and Nacho.
-- Taken from the data rather than typed in, so no account id is hard-coded.
insert into public.freeco_members (user_id, note)
select user_id, 'using Cokiletics when members were introduced'
from (select user_id from public.freeco_plans
      union
      select user_id from public.freeco_workouts) u
on conflict (user_id) do nothing;
