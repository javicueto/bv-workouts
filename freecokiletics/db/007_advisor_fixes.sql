-- 007 · Clear the three Supabase advisor warnings raised by Cokiletics' own
-- objects on 12 Sep 2026 (the rest of that report belongs to Maky's tables).
--
-- 1. freeco_is_member() was in `public`, so any signed-in user could call it
--    over the web API (/rest/v1/rpc/freeco_is_member, lint 0029). It only
--    answers "am I a member?" — nothing leaked — but nothing needs to call it
--    except the policies, so it moves to a schema the API does not publish.
--    ALTER … SET SCHEMA keeps the function's identity, so nothing that calls
--    it breaks; the policies are recreated below anyway for point 3.
-- 2. freeco_plan_blocks_ok() (migration 005) had no fixed search_path (lint
--    0011). Its body uses only built-in jsonb functions, which resolve with an
--    empty search_path.
-- 3. The "members only" policies did not restate the anonymous-session
--    exclusion (lint 0012). Anonymous sessions were already refused — the
--    permissive policy they are ANDed with checks it, and the 006 probe proved
--    it — but every other Cokiletics policy states the rule itself, and a
--    policy should not rely on its neighbour for a security property.
--
-- Tested inside a transaction that rolled itself back before applying.
-- Applied 12 Sep 2026 to the Maky project.

create schema if not exists freeco_private;
revoke all on schema freeco_private from public;
grant usage on schema freeco_private to authenticated;   -- policies evaluate as the caller

alter function public.freeco_is_member() set schema freeco_private;
revoke execute on function freeco_private.freeco_is_member() from public, anon;
grant execute on function freeco_private.freeco_is_member() to authenticated;

alter function public.freeco_plan_blocks_ok(jsonb) set search_path = '';

drop policy "freeco members only" on public.freeco_workouts;
drop policy "freeco members only" on public.freeco_sets;
drop policy "freeco members only" on public.freeco_plans;

create policy "freeco members only" on public.freeco_workouts
  as restrictive for all to authenticated
  using (
    (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  with check (
    (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );
create policy "freeco members only" on public.freeco_sets
  as restrictive for all to authenticated
  using (
    (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  with check (
    (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );
create policy "freeco members only" on public.freeco_plans
  as restrictive for all to authenticated
  using (
    (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  with check (
    (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );
