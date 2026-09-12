# Francesco’s Beach Volleyball Workouts — local copy of the TrueCoach programme

A single static page listing the training programme (workouts 1.1 → 8.2) with every
exercise video stored locally. Opens straight from Finder, works with no internet.

**On this Mac:** double-click `index.html` — opens instantly, works offline, plays the
downloaded videos.

**On your phone:** <https://javicueto.github.io/bv-workouts/> — password protected.
The published version streams the videos from YouTube instead of shipping them.

## What is in it

- 16 workouts, two per block (1.1, 1.2 … 8.1, 8.2), newest block first
- Each workout: warm-up, then blocks A–F with the coach's instructions as written
- 161 exercise videos, downloaded to `videos/` — no signal needed in the gym
- An exercise index with search, showing which workouts each movement appears in

The prevention routine and the volley warm-up are deliberately excluded — the site
only carries the numbered programme.

Each numbered workout is assigned six to eight times with identical content, so the
site shows one entry per number, keeping the most recent version plus the date range
it was active.

## Refreshing it when the coach adds new workouts

Roughly every five weeks a new block appears (9.1, 9.2 …). To pull it in:

1. Open <https://app.truecoach.co/client/workouts> in Chrome and log in.
2. Run `scripts/export_truecoach.js` in that tab — paste it into the DevTools console,
   or ask Claude to run it. It saves `truecoach_export.json` to Downloads.
3. Move that file to `data/truecoach_export.json`.
4. `./scripts/refresh.sh` — resolves the workouts, downloads only the new videos,
   and rebuilds the page.

If `refresh.sh` reports **blocks with no video**, the coach used a movement name
that is not in the exercise library under that spelling. Add it to
`data/name_resolution.json` and run the refresh again.

If it reports a **FAILED download with `HTTP Error 403`**, that is YouTube
throttling, not a broken video — just run `./scripts/refresh.sh` again and it
usually succeeds on the second try. It only retries what is missing.

## Fixing a mistake in the coach's data

TrueCoach sometimes has an error — a missing rep count, a typo. Do not edit
`data/workouts.js`: it is regenerated on every build and your change would vanish.
Add the fix to `data/corrections.json` instead, and it is re-applied every time:

```json
{ "workout": "8.2", "block": "B",
  "line": "Plyometric depth jump",
  "to": "8 Plyometric depth jump",
  "why": "TrueCoach omits the rep count; it is 8 reps." }
```

`line` must match an existing line exactly. If it stops matching — because the
coach edited that block — **the build fails** rather than quietly doing nothing.
If the coach fixes the mistake upstream, the build tells you the correction is
redundant so you can delete it.

Currently one correction is in place: the plyometric depth jump reps in 8.2.

Nothing is stored between runs and no TrueCoach password or token is ever written to
disk: the export script borrows the logged-in tab's own session.

## Layout

```
index.html            the site
app.js  styles.css    viewer and design
auth.js               password gate for the published site only
data/
  truecoach_export.json   raw export from TrueCoach (the source of truth)
  name_resolution.json    block name → exercise, for blocks the coach left unlinked
  corrections.json        fixes for mistakes in the coach's own data
  workouts.js             generated — what the page actually reads
previews/ <id>.webp   looping previews shown on every card — THESE are published
videos/  <id>.mp4     downloaded exercise videos — backup only, never published
thumbs/  <id>.jpg     poster frames — local only
scripts/
  export_truecoach.js  run in the browser tab to refresh the data
  receive_export.py    optional: catches the export instead of using Downloads
  refresh.sh           export → download → previews → rebuild, in one command
  download_videos.sh   fetch missing videos + poster frames
  make_previews.py     turn new videos into looping previews
  build_site.py        export → data/workouts.js
logs/                 download logs
```

## One quirk worth knowing

The coach links exercise videos only on **circuit** blocks. A single-movement block
("BB Bench press · 3 sets of 8-6-6") has nothing linked — the movement is the block's
name. Roughly a quarter of the programme is like this, so the build matches those
names against the coach's exercise library to find the video. All 24 currently match.

One name, *heels elevated back squat*, exists three times in the library; the newest
was used. If that video ever looks like the wrong variation, change the id in
`data/name_resolution.json`.

## How it looks

Both the reference site and the app use the same look, picked on 12 Sep 2026
from two directions mocked up in `tests/`: dark warm ground, a condensed
industrial face for anything you glance at, one signal orange. The fonts live in
`fonts/` rather than being loaded from Google — the app has to work in a gym
with no signal, and a CDN font is the one thing that would still need the
network. Two files, 76 KB, one per family.

## Cokiletics — the training app (/freecokiletics)

A phone app for actually doing the sessions: <https://javicueto.github.io/bv-workouts/freecokiletics/>

On screen it is **Cokiletics**; the folder, the URL and the database tables are
all still `freecokiletics` / `freeco_`, on purpose — renaming those would strand
home-screen icons and buy nothing.

It was called Javi Plan and lived at `/javiplan/` until 12 Sep 2026. That address
still works: it unregisters the old service worker, clears its caches and forwards
here, so a phone that had the old app installed doesn't get stuck on a dead copy.
Keep that page — deleting it strands any home-screen icon created before the rename.
On iPhone, add it to the home screen — in Chrome: Share (top right of the address
bar) → Add to Home Screen; in Safari: Share → Add to Home Screen. Open it from that
icon: it runs full-screen and keeps working with no signal. A normal Chrome tab on
iPhone cannot work offline.

**Forgot password** is on the sign-in screen. The email link opens in the phone’s
browser, not the installed app: set the new password there, then sign in from the
home-screen icon.

**How a session runs.** This week’s Day 1 / Day 2 are on the home screen. Tap one:
the warm-up is a grid of moving thumbnails; after that, each screen is one round
with every movement of that round on it (A1 + A2 together). Type the weight,
swipe left (or tap Done) and the rest timer starts — halfway “dong”, a double
beep at 10 seconds, then 3-2-1-go. Skip or +30″ if needed. Blocks with no rest
written (core, shoulder) go straight to the next round with no timer. Tabata runs
itself: 8 × 20″ work / 10″ rest.

**What is saved.** Every set’s weight and reps, per session. Next time, last
time’s weight is pre-filled. If the gym has no signal, sets queue on the phone
and upload the next time it is online.

**The plan is per person.** Everyone who signs in builds their own: a start date
and a number of weeks for each of the nine blocks, edited in the app (Plan →
Edit). Two sessions a week, and the app works out the calendar from there. Javier's
is 7 Sep 2026 → 7 Feb 2027, peaking on block 9 in the first week of February;
block 1 starts again on 8 Feb to build for May. Nacho has his own account and
picks his own lengths. Nobody sees anybody else's plan or logs.

The fixed schedule that shipped first (`schedule.json`) is gone — the last copy
is kept as `_archive/schedule_before_plans.json` for reference.

**Where the data lives.** Three tables, `freeco_workouts`, `freeco_sets` and
`freeco_plans`, in the **Maky** Supabase project (the free plan allows only two
projects). Row-level security means each account only ever sees its own data;
anonymous sessions are refused. Schema history is in `freecokiletics/db/` —
migrations 001–003 still say `javiplan_` because that is what they did at the
time; 004 renames the tables. Never rewrite an applied migration.

**Rebuilding after the programme changes** (e.g. a new block from TrueCoach):

```bash
python3 scripts/build_freeco.py
```

It turns the coach’s free-text blocks into rounds, reps and rest times, and
**fails loudly** on anything it cannot read — fix those in
`freecokiletics/data/programme_overrides.json`. Then bump `CACHE` in
`freecokiletics/sw.js` and push, or phones keep the old version.

## Nacho's programme — archived

A separate hand-authored programme for Nacho lived at `/nacho/` from 8 to
12 Sep 2026. It didn't suit him and is archived in `_archive/nacho/` (not
published — see its README). He follows the same programme as Javier instead,
through his own Freecokiletics account, with his own start date and block lengths.

## The published site

The same page is on GitHub Pages so it can be opened on a phone. Two differences
from the local copy, both deliberate:

- **The videos are not published.** They are the coach's, the repo is public, and
  they are already on YouTube — so tapping a card opens the YouTube player.
  `videos/` and `thumbs/` are in `.gitignore` and never leave this machine; they
  are the backup copy.
- **It asks for a password** (`auth.js`). The local `file://` copy never does.

### What the password actually protects

It is a curtain, not a lock. The repo is public, so anyone who reads the page
source can find `auth.js`, and `data/workouts.js` can be fetched directly. The
password is stored as a SHA-256 hash, so the plain word is not in the source, but
that only slows someone down — it does not stop them.

What it does do, which is what was wanted: someone who stumbles on the URL cannot
browse the workouts, and the site stays out of Google (`robots.txt` plus a
`noindex` meta tag).

If it ever needs to be genuinely private, the answer is a private repo with a host
that does real server-side auth — not more JavaScript.

### Changing the password

Hash the new one and replace `HASH` at the top of `auth.js`:

```bash
printf 'thenewpassword' | shasum -a 256
```

## The looping previews

Every card shows a short animated WebP of the exercise instead of a still frame,
so a glance tells you what the movement is without tapping anything. They loop
forever on their own — plain `<img>` tags, no video element and no JavaScript,
which is why they work everywhere including on a phone with autoplay locked down.

`scripts/make_previews.py` builds them from `videos/*.mp4` into `previews/*.webp`:
360px wide, 4 seconds at 12fps, taken from a third of the way into each clip
(exercise videos open with the setup; the reps are in the middle). About 120 KB
each, roughly 19 MB for all 161.

Unlike the videos, **previews are published** — they are the whole point of the
card. Tapping one swaps in the YouTube player, and the × closes it again.

```bash
python3 scripts/make_previews.py          # only builds what is missing or stale
python3 scripts/make_previews.py --force  # rebuild everything
```

Run it after downloading new videos, then re-run `scripts/build_site.py` so the
site knows the previews exist. `refresh.sh` does the whole chain.
