-- 009 · Clear the advisor warning 008 raised (lint 0012, 18 Sep 2026): three
-- of its policies — deleting your own reaction or comment, and updating your
-- own name — did not restate the anonymous-session exclusion. An anonymous
-- session could never have matched them (it owns no rows, and every insert
-- policy refuses it), but as 007 says: a policy should not rely on its
-- neighbour for a security property. Same condition as every other
-- Cokiletics policy.

drop policy "freeco own reaction delete" on public.freeco_reactions;
create policy "freeco own reaction delete" on public.freeco_reactions
  for delete to authenticated
  using ((select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

drop policy "freeco own comment delete" on public.freeco_comments;
create policy "freeco own comment delete" on public.freeco_comments
  for delete to authenticated
  using ((select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

drop policy "freeco own profile update" on public.freeco_profiles;
create policy "freeco own profile update" on public.freeco_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check ((select auth.uid()) = user_id and (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
