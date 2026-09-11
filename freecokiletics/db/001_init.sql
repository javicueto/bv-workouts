-- javiplan — training log.
-- Lives in the MAKY Supabase project (free plan allows two projects; decided
-- 11 Sep 2026). Every object is prefixed javiplan_ so it never collides with
-- Maky's own tables and can be moved out with a plain export.
-- One row per session done, one row per set.
-- Every row is owned by a user; RLS below means a user only ever sees their own.
-- Nacho (or anyone) can get an account later with no schema change.

create table public.javiplan_workouts (
  id               uuid primary key,                 -- generated on the phone, so offline sessions have an id
  user_id          uuid not null references auth.users(id) on delete cascade,
  session_key      text not null,                    -- "4.2"
  block            int  not null,
  week_start       date,                             -- Monday of the plan week it was done in
  started_at       timestamptz not null,
  finished_at      timestamptz,
  duration_seconds int,
  notes            text,
  created_at       timestamptz not null default now()
);

create table public.javiplan_sets (
  id            uuid primary key,
  workout_id    uuid not null references public.javiplan_workouts(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  block_letter  text not null,                       -- "C"
  round         int  not null,                       -- 1-based
  exercise_id   text not null,                       -- TrueCoach exercise id, matches previews/<id>.webp
  exercise_name text,
  reps          int,
  weight        numeric(6,2),                        -- kg; null for bodyweight / timed
  seconds       int,                                 -- timed holds
  skipped       boolean not null default false,
  done_at       timestamptz not null,
  created_at    timestamptz not null default now()
);

-- "What did I lift last time?" is the hottest query the app makes.
create index javiplan_sets_last_by_exercise on public.javiplan_sets (user_id, exercise_id, done_at desc);
create index javiplan_workouts_by_user      on public.javiplan_workouts (user_id, started_at desc);
create index javiplan_sets_by_workout       on public.javiplan_sets (workout_id);

alter table public.javiplan_workouts enable row level security;
alter table public.javiplan_sets     enable row level security;

-- (select auth.uid()) rather than auth.uid(): evaluated once per query, not
-- once per row. Supabase's performance advisor flags the bare form.
create policy "javiplan own workouts" on public.javiplan_workouts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- A set may only hang off one of YOUR workouts. Foreign-key checks ignore RLS,
-- so without the exists() a user could attach sets to someone else's workout
-- id if they ever learned it.
create policy "javiplan own sets" on public.javiplan_sets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.javiplan_workouts w
                where w.id = workout_id and w.user_id = (select auth.uid()))
  );
