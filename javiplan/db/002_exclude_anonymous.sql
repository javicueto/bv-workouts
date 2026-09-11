-- Maky has anonymous sign-ins enabled (its event chat uses them), and anonymous
-- users still get the `authenticated` role. Javi Plan is for real accounts only,
-- so both policies now refuse any session whose JWT says is_anonymous.
-- Found by Supabase's security advisor (lint 0012) right after 001 was applied.

drop policy "javiplan own workouts" on public.javiplan_workouts;
drop policy "javiplan own sets" on public.javiplan_sets;

create policy "javiplan own workouts" on public.javiplan_workouts
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

create policy "javiplan own sets" on public.javiplan_sets
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.javiplan_workouts w
                where w.id = workout_id and w.user_id = (select auth.uid()))
  );
