-- 005 · freeco_plans: constrain the shape the app depends on, drop what it never read.
--
-- `blocks` is the whole calendar: [{"block": 1, "weeks": 2}, …]. Nothing checked
-- it — a malformed row would have built an empty calendar and left the app on an
-- empty week with no error. `days_per_week` was written as 2 by every client and
-- read by none (two sessions a week is a rule of the programme, not a setting).
--
-- A CHECK cannot hold a subquery, so the walk over the array lives in an
-- immutable function the constraint calls.
--
-- Applied 12 Sep 2026 to the Maky project.

create or replace function public.freeco_plan_blocks_ok(blocks jsonb)
returns boolean
language sql immutable strict
as $$
  select jsonb_typeof(blocks) = 'array'
     and jsonb_array_length(blocks) between 1 and 40
     and not exists (
       select 1 from jsonb_array_elements(blocks) b
       where jsonb_typeof(b->'block') <> 'number'
          or jsonb_typeof(b->'weeks') <> 'number'
          or (b->>'block')::numeric < 1
          or (b->>'weeks')::numeric not between 1 and 12
     );
$$;

alter table public.freeco_plans
  add constraint freeco_plans_blocks_shape check (public.freeco_plan_blocks_ok(blocks));

alter table public.freeco_plans drop column if exists days_per_week;
