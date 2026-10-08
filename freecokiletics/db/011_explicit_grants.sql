-- 011 · Explicit Data API grants for every freeco_ table.
--
-- From 30 Oct 2026 Supabase stops granting API access to NEW public tables
-- automatically (supabase.com email 23 Sep 2026). The live tables keep their
-- grants, but replaying 001–010 on a fresh project would leave every table with
-- none: 006/007/008/009 only REVOKE from anon and rely on the old automatic
-- grants for authenticated, which will no longer exist.
--
-- This writes down, verbatim, what each table had live on 5 Oct 2026, so a
-- rebuild behaves exactly like today. It changes nothing on the live project.
-- Revokes are included so a replay can't end up broader than live.
--
-- RULE for every future file here: any `create table` / `create view` in public
-- carries its own grants in the same file (see CLAUDE.md → "Data API grants").
-- A `create or replace view` that changes columns drops and recreates it —
-- re-grant after it.
--
-- Applied 5 Oct 2026 to the Maky project.

-- Open to anon + authenticated (RLS restricts rows).
grant all on table public.freeco_plans, public.freeco_sets, public.freeco_workouts
  to anon, authenticated, service_role;

-- Signed-in only — no anon access at all (008 social tables, 007 view).
revoke all on table public.freeco_profiles, public.freeco_reactions,
                    public.freeco_comments, public.freeco_set_best from anon;
grant all on table public.freeco_profiles, public.freeco_reactions,
                   public.freeco_comments, public.freeco_set_best
  to authenticated, service_role;

-- Members: read-only for anon + authenticated (006 members_only); writes go
-- through service_role / definer functions only.
revoke all on table public.freeco_members from anon, authenticated;
grant select, references, trigger on table public.freeco_members to anon, authenticated;
grant all on table public.freeco_members to service_role;
