-- Workouts can now be marked done by hand ("I forgot my phone"), with a start
-- and end time but no sets. The flag keeps them distinguishable in History.
alter table public.javiplan_workouts
  add column logged_manually boolean not null default false;
