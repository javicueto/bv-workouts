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
data/
  truecoach_export.json   raw export from TrueCoach (the source of truth)
  name_resolution.json    block name → exercise, for blocks the coach left unlinked
  workouts.js             generated — what the page actually reads
videos/  <id>.mp4     downloaded exercise videos
thumbs/  <id>.jpg     poster frames
scripts/
  export_truecoach.js  run in the browser tab to refresh the data
  refresh.sh           build → download → build, in one command
  download_videos.sh   fetch missing videos + poster frames
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
