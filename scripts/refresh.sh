#!/bin/bash
# One-command refresh after a new export.
#
#   1. Run scripts/export_truecoach.js in a logged-in TrueCoach tab
#   2. Move the downloaded truecoach_export.json to data/
#   3. ./scripts/refresh.sh
#
# Build runs twice on purpose: the first pass resolves block names to exercises
# so the downloader knows the full list; the second records which videos are
# now on disk.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== resolving workouts"
python3 scripts/build_site.py

echo
echo "== fetching any missing videos"
./scripts/download_videos.sh

echo
echo "== building looping previews for any new videos"
python3 scripts/make_previews.py

echo
echo "== rebuilding with the new videos and previews"
python3 scripts/build_site.py

echo
echo "Done — open index.html"
echo "New previews? Commit and push so the phone gets them:"
echo "  git add -A && git commit -m 'Refresh workouts' && git push"
