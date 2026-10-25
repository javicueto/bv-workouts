-- 013 · freeco_plans: the rider's own heart-rate zones.
--
-- Spin rides (views/spin.js, 25 Oct 2026) say which zone to ride in; Javier's
-- WHOOP gives him a beats-per-minute range for each, so the ride shows it beside
-- the zone ("Zone 2 · 138–150 bpm"). Heart-rate zones are personal health data:
-- they live on the person's own plan row — private to them by the policies
-- freeco_plans already has (RLS, members only, no anonymous sessions; db/006,
-- 007) — and never in the public repo. Shape: {"1": [111, 137], "2": [138, 150], …}.
--
-- No new table, so no new grants or policies: a column inherits the table's.
--
-- Applied 25 Oct 2026 to the Maky project.

alter table public.freeco_plans add column hr_zones jsonb;

alter table public.freeco_plans
  add constraint freeco_plans_hr_zones_ok check (hr_zones is null or jsonb_typeof(hr_zones) = 'object');
