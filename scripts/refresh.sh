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

# The app reads its own generated programme, built FROM data/workouts.js. It
# was left out of this chain once, and the reference site gained a block the
# app never saw. It fails loudly on anything it cannot parse — see
# freecokiletics/data/programme_overrides.json.
echo
echo "== rebuilding the Cokiletics programme"
before=$(shasum -a 256 freecokiletics/data/programme.js 2>/dev/null | cut -c1-16 || true)
python3 scripts/build_freeco.py
after=$(shasum -a 256 freecokiletics/data/programme.js | cut -c1-16)

# The programme is part of the app's precached shell: a phone keeps the old
# one until CACHE changes. Bump it here so that cannot be forgotten, and
# check the bump actually landed (a silent no-op is how it gets missed).
if [ "$before" != "$after" ]; then
  python3 - <<'PY'
import pathlib, re, sys
p = pathlib.Path("freecokiletics/sw.js"); s = p.read_text()
m = re.search(r'const CACHE = "freeco-v(\d+)";', s)
if not m: sys.exit("sw.js: CACHE line not found — bump it by hand")
new = f'const CACHE = "freeco-v{int(m.group(1)) + 1}";'
p.write_text(s.replace(m.group(0), new, 1))
if new not in p.read_text(): sys.exit("sw.js: CACHE bump did not land")
print(f"  programme changed → {new}")
PY
else
  echo "  programme unchanged — CACHE left as is"
fi

echo
echo "Done — open index.html"
echo "New previews or a new block? Commit and push so the phone gets them:"
echo "  git add -A && git commit -m 'Refresh workouts' && git push"
