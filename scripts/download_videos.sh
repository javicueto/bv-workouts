#!/bin/bash
# Download every exercise video referenced by the export into videos/<exercise_id>.mp4
# and a poster frame into thumbs/<exercise_id>.jpg, so the site works fully offline.
#
# Safe to re-run: yt-dlp skips anything already downloaded, so after a refresh this
# only fetches the new exercises. Failures are logged, never fatal.
#
# Absolute paths: this must also work from a non-interactive shell (see CLAUDE.md).
set -uo pipefail
cd "$(dirname "$0")/.."

YTDLP=/opt/homebrew/bin/yt-dlp
FFMPEG=/opt/homebrew/bin/ffmpeg
LOG="logs/download_$(date +%Y-%m-%d_%H%M).log"
mkdir -p videos thumbs logs

# id<TAB>youtube_id<TAB>name, one per line.
# Read the BUILT data (data/workouts.js), not the raw export: the build resolves
# blocks that have no linked exercise, and those movements need videos too.
# Falls back to the raw export if the site has not been built yet.
python3 - > /tmp/tc_dl_list.tsv <<'PY'
import json, pathlib

def load(path):
    p = pathlib.Path(path)
    if not p.exists():
        return {}
    text = p.read_text()
    if 'window.WORKOUTS = ' in text:
        text = text.split('window.WORKOUTS = ', 1)[1].rsplit(';', 1)[0]
    return json.loads(text).get('exercises', {})

# Both sites draw from the same videos/ folder, so collect from each built data
# file. Falls back to the raw export if Javier's site has not been built yet.
wanted = {}
sources = ['data/workouts.js', 'data/nacho.js']
if not pathlib.Path('data/workouts.js').exists():
    sources[0] = 'data/truecoach_export.json'
for src in sources:
    wanted.update(load(src))

for e in wanted.values():
    if e['youtube_id']:
        print(f"{e['id']}\t{e['youtube_id']}\t{e['name']}")
PY

total=$(wc -l < /tmp/tc_dl_list.tsv | tr -d ' ')
echo "Downloading $total videos → videos/  (log: $LOG)" | tee -a "$LOG"
i=0; ok=0; skip=0; fail=0
while IFS=$'\t' read -r id yt name; do
  i=$((i+1))
  if [ -f "videos/$id.mp4" ]; then skip=$((skip+1)); continue; fi
  printf '[%3d/%3d] %s — %s\n' "$i" "$total" "$id" "$name" | tee -a "$LOG"
  # Prefer DASH (separate video+audio streams) over progressive: YouTube's
  # progressive format 18 returns HTTP 403 for some videos while the DASH
  # streams for the SAME video download fine. Do not "simplify" this back to
  # a progressive-first selector.
  if "$YTDLP" --quiet --no-warnings --no-playlist \
       -f 'bv*[height<=720]+ba/bv*+ba/b[height<=720]/b' \
       --merge-output-format mp4 \
       -o "videos/$id.%(ext)s" "https://www.youtube.com/watch?v=$yt" >>"$LOG" 2>&1; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "  FAILED $id ($yt) $name" | tee -a "$LOG"
  fi
done < /tmp/tc_dl_list.tsv

# poster frames for anything that lacks one
for f in videos/*.mp4; do
  [ -e "$f" ] || continue
  id=$(basename "$f" .mp4)
  [ -f "thumbs/$id.jpg" ] && continue
  "$FFMPEG" -loglevel error -y -ss 1 -i "$f" -frames:v 1 -vf "scale=480:-2" "thumbs/$id.jpg" >>"$LOG" 2>&1
done

echo "done: $ok downloaded, $skip already present, $fail failed" | tee -a "$LOG"
