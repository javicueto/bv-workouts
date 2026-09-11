-- The app became "Freecokiletics" (Javier, 12 Sep 2026). Tables renamed while
-- they held one workout — rows, indexes and policies are kept, nothing copied.
alter table public.javiplan_workouts rename to freeco_workouts;
alter table public.javiplan_sets     rename to freeco_sets;

alter index javiplan_sets_last_by_exercise rename to freeco_sets_last_by_exercise;
alter index javiplan_workouts_by_user      rename to freeco_workouts_by_user;
alter index javiplan_sets_by_workout       rename to freeco_sets_by_workout;

alter policy "javiplan own workouts" on public.freeco_workouts rename to "freeco own workouts";
alter policy "javiplan own sets"     on public.freeco_sets     rename to "freeco own sets";

-- One training plan per person: when they start, and how many weeks each block
-- runs. Replaces the schedule that used to be baked into the app, so Javier and
-- Nacho can each have their own. Earlier migrations keep their javiplan_ names
-- on purpose — they record what was actually applied at the time.
create table public.freeco_plans (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  name          text,
  start_date    date not null,
  days_per_week int  not null default 2,
  blocks        jsonb not null,        -- [{"block":1,"weeks":2}, …] in order
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.freeco_plans enable row level security;

create policy "freeco own plan" on public.freeco_plans
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );
