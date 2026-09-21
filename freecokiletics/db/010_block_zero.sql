-- 010 · freeco_plans: allow block 0.
--
-- Francesco's block 9 is a reset, not a full-power block. It opens the cycle,
-- so the app renumbers it to block 0 (Javier, 21 Sep 2026; see
-- data/programme_overrides.json → renumber_blocks). 005 required block >= 1,
-- which would reject every plan that starts with the reset. Same function,
-- same constraint; only the lower bound moves.
--
-- Applied 21 Sep 2026 to the Maky project.

create or replace function public.freeco_plan_blocks_ok(blocks jsonb)
returns boolean
language sql immutable strict
set search_path = ''          -- as 007 set it; a replace would drop it
as $$
  select jsonb_typeof(blocks) = 'array'
     and jsonb_array_length(blocks) between 1 and 40
     and not exists (
       select 1 from jsonb_array_elements(blocks) b
       where jsonb_typeof(b->'block') <> 'number'
          or jsonb_typeof(b->'weeks') <> 'number'
          or (b->>'block')::numeric < 0
          or (b->>'weeks')::numeric not between 1 and 12
     );
$$;
