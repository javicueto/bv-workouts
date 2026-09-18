-- 008 · Social (Javier, 18 Sep 2026): the members are friends.
--
-- "A social section where, when a workout is done, the friend can see it,
-- react and comment. The workout shows times and any weight added." Every
-- member is everyone's friend (his choice: no friend requests), so:
--
--   - every member can READ every member's workouts and sets: a PERMISSIVE,
--     select-only policy, ORed with the existing "own rows" policy for
--     reading. Writing still needs "own rows", so nobody can change a
--     friend's data. The RESTRICTIVE "members only" policy (006) still
--     applies on top, and the row read must belong to a member too.
--   - freeco_set_best: each workout's heaviest weight per movement, for the
--     points (security_invoker, so the rules above decide what it returns).
--   - freeco_profiles: the name friends see, set by each person.
--   - freeco_reactions / freeco_comments on feed items. An item is a workout
--     or an achievement worked out from it: item_key names it ("w:<workout
--     id>", "a:<kind>:<workout id>"), item_owner is whose it is.
--
-- Follows 007: helpers live in freeco_private (not published by the API), and
-- every policy states the anonymous-session exclusion itself. Plans stay
-- private. Tested before applying inside a transaction that rolled back, as
-- each member and as a non-member (see CLAUDE.md "Social").

create function freeco_private.freeco_is_member_id(uid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.freeco_members m where m.user_id = uid);
$$;
revoke execute on function freeco_private.freeco_is_member_id(uuid) from public, anon;
grant execute on function freeco_private.freeco_is_member_id(uuid) to authenticated;

create policy "freeco members read members" on public.freeco_workouts
  for select to authenticated
  using ((select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false and freeco_private.freeco_is_member_id(user_id));
create policy "freeco members read members" on public.freeco_sets
  for select to authenticated
  using ((select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false and freeco_private.freeco_is_member_id(user_id));

create view public.freeco_set_best with (security_invoker = true) as
  select workout_id, user_id, exercise_id, max(weight) as weight
  from public.freeco_sets
  where weight is not null and weight > 0
  group by workout_id, user_id, exercise_id;
revoke all on public.freeco_set_best from anon;
grant select on public.freeco_set_best to authenticated;

create table public.freeco_profiles (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 30),
  updated_at   timestamptz not null default now()
);
alter table public.freeco_profiles enable row level security;
create policy "freeco members read profiles" on public.freeco_profiles
  for select to authenticated
  using ((select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false and freeco_private.freeco_is_member_id(user_id));
create policy "freeco own profile insert" on public.freeco_profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
create policy "freeco own profile update" on public.freeco_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
revoke all on public.freeco_profiles from anon;

create table public.freeco_reactions (
  id         uuid primary key default gen_random_uuid(),
  item_key   text not null check (char_length(item_key) between 3 and 120),
  item_owner uuid not null references auth.users(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji      text not null check (emoji in ('👏', '🔥', '💪', '😂')),
  created_at timestamptz not null default now(),
  unique (item_key, user_id, emoji)
);
create index freeco_reactions_owner on public.freeco_reactions (item_owner);
create index freeco_reactions_user on public.freeco_reactions (user_id);
alter table public.freeco_reactions enable row level security;
create policy "freeco members read reactions" on public.freeco_reactions
  for select to authenticated
  using ((select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false and freeco_private.freeco_is_member_id(user_id));
create policy "freeco own reaction insert" on public.freeco_reactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
              and freeco_private.freeco_is_member_id(item_owner));
create policy "freeco own reaction delete" on public.freeco_reactions
  for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.freeco_reactions from anon;

create table public.freeco_comments (
  id         uuid primary key default gen_random_uuid(),
  item_key   text not null check (char_length(item_key) between 3 and 120),
  item_owner uuid not null references auth.users(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index freeco_comments_item on public.freeco_comments (item_key);
create index freeco_comments_owner on public.freeco_comments (item_owner);
create index freeco_comments_user on public.freeco_comments (user_id);
alter table public.freeco_comments enable row level security;
create policy "freeco members read comments" on public.freeco_comments
  for select to authenticated
  using ((select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false and freeco_private.freeco_is_member_id(user_id));
create policy "freeco own comment insert" on public.freeco_comments
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select freeco_private.freeco_is_member())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
              and freeco_private.freeco_is_member_id(item_owner));
create policy "freeco own comment delete" on public.freeco_comments
  for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.freeco_comments from anon;
