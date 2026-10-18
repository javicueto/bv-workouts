-- 012 · freeco_workouts: cardio days.
--
-- Cardio days (Javier, 18 Oct 2026) are routines OUTSIDE Francesco's plan,
-- picked from the menu (freecokiletics/data/cardio.json). Three changes:
--
--   kind   'plan' (every workout so far) or 'cardio'. Points and the week
--          screen tell them apart: a cardio day never fills Day 1 / Day 2,
--          never counts toward a "full week", never earns "faster".
--   block  may be null now, for cardio only — a cardio routine belongs to no
--          block of the programme. A plan workout still needs one.
--   score  what a timed WOD scored, per part: {"A": [{"reps": 23}, …]} for
--          Steve's burpees, {"A": [{"rounds": 6, "reps": 12}]} for an AMRAP.
--          Weights stay in freeco_sets, like every other workout.
--
-- No new table, so no new grants: freeco_workouts keeps the grants and the
-- policies 006/007/011 gave it. Columns added to a table inherit them.
--
-- Applied 18 Oct 2026 to the Maky project.

alter table public.freeco_workouts
  add column kind text not null default 'plan',
  add column score jsonb;

alter table public.freeco_workouts
  add constraint freeco_workouts_kind_ok check (kind in ('plan', 'cardio')),
  add constraint freeco_workouts_score_ok check (score is null or jsonb_typeof(score) = 'object');

alter table public.freeco_workouts alter column block drop not null;
alter table public.freeco_workouts
  add constraint freeco_workouts_block_ok check (kind = 'cardio' or block is not null);
