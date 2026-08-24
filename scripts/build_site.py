#!/usr/bin/env python3
"""Turn data/truecoach_export.json into data/workouts.js, the file the site reads.

Emitted as `window.WORKOUTS = {...}` rather than a .json fetched at runtime so the
site opens straight from Finder (file:// blocks fetch of local JSON — a plain
double-click has to work, that is the whole point of this build).

Run after every refresh:  python3 scripts/build_site.py
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
export = json.loads((ROOT / "data" / "truecoach_export.json").read_text())

# --- blocks with no linked exercise ------------------------------------------
# The coach links exercises only on circuit blocks; a single-movement block
# ("BB Bench press", 3 sets of 8-6-6) has nothing linked and carries the movement
# in its NAME. Without this, ~a quarter of the programme would show no video.
# export_truecoach.js resolves these in the browser against the full library;
# this applies the recorded mapping so it also works from an older export.
# Idempotent: anything already resolved is left alone.
res_path = ROOT / "data" / "name_resolution.json"
resolution = json.loads(res_path.read_text())["map"] if res_path.exists() else {}


def norm(s):
    return "".join(c if c.isalnum() else " " for c in str(s or "").lower()).split()


resolved, unresolved = 0, []
by_norm = {tuple(norm(k)): v for k, v in resolution.items()}
for w in export["workouts"]:
    for item in w["items"]:
        if item["exercises"]:
            continue
        hit = by_norm.get(tuple(norm(item["name"])))
        if not hit:
            unresolved.append(f"{w['key']} {item['letter']}: {item['name']}")
            continue
        item["exercises"] = [hit["id"]]
        item["matched_by_name"] = True
        export["exercises"].setdefault(hit["id"], {
            "id": hit["id"], "name": hit["name"], "url": hit["url"],
            "youtube_id": hit["url"].rsplit("/", 1)[-1].split("?")[0],
        })
        resolved += 1
export["exercise_count"] = len(export["exercises"])

# --- corrections to the coach's source data ----------------------------------
# TrueCoach occasionally has a mistake (a missing rep count, a typo). Fixing it in
# data/workouts.js would be undone by the next build, and fixing it in the export
# would be undone by the next refresh — so corrections live in their own file and
# are re-applied here every time.
#
# A correction that no longer matches is an ERROR, not a shrug: it means the text
# moved and the fix is silently doing nothing. See CLAUDE.md, "verify the edit
# landed".
corr_path = ROOT / "data" / "corrections.json"
corrections = json.loads(corr_path.read_text())["lines"] if corr_path.exists() else []

applied, redundant, failed = 0, [], []
for c in corrections:
    workout = next((w for w in export["workouts"] if w["key"] == c["workout"]), None)
    item = next((i for i in workout["items"] if i["letter"] == c["block"]), None) if workout else None
    if item is None:
        failed.append(f"{c['workout']} {c['block']}: no such workout/block")
        continue
    lines = item["info"].split("\n")
    hit = False
    for n, line in enumerate(lines):
        if line.strip() == c["line"].strip():
            lines[n] = line.replace(c["line"].strip(), c["to"])
            hit = True
            break
    if hit:
        item["info"] = "\n".join(lines)
        item["corrected"] = True
        applied += 1
    elif any(l.strip() == c["to"].strip() for l in lines):
        redundant.append(f"{c['workout']} {c['block']}: \"{c['to']}\" — TrueCoach now matches; delete this correction")
    else:
        failed.append(f"{c['workout']} {c['block']}: no line matching \"{c['line']}\"")

videos = ROOT / "videos"
thumbs = ROOT / "thumbs"
previews = ROOT / "previews"

# The looping WebP previews are what the site actually shows on every card, and
# unlike videos/ they ARE published — so a missing one is a real gap, not a
# local-only detail.
missing_video, missing_thumb, missing_preview = [], [], []
for ex in export["exercises"].values():
    ex["has_local_video"] = (videos / f"{ex['id']}.mp4").exists()
    ex["has_local_thumb"] = (thumbs / f"{ex['id']}.jpg").exists()
    ex["has_preview"] = (previews / f"{ex['id']}.webp").exists()
    if not ex["has_preview"]:
        missing_preview.append(ex["name"])
    if not ex["has_local_video"]:
        missing_video.append(ex["name"])
    elif not ex["has_local_thumb"]:
        missing_thumb.append(ex["name"])

# Which workouts use each exercise — powers the exercise index.
used_in = {}
for w in export["workouts"]:
    ids = set(w["warmup_exercises"]) | set(w["cooldown_exercises"])
    for item in w["items"]:
        ids.update(item["exercises"])
    for i in ids:
        used_in.setdefault(i, []).append(w["key"])
for i, keys in used_in.items():
    if i in export["exercises"]:
        export["exercises"][i]["used_in"] = sorted(
            keys, key=lambda k: (int(k.split(".")[0]), int(k.split(".")[1]))
        )
for ex in export["exercises"].values():
    ex.setdefault("used_in", [])

out = ROOT / "data" / "workouts.js"
out.write_text(
    "/* Generated by scripts/build_site.py — do not edit by hand.\n"
    "   Regenerate after a TrueCoach refresh. */\n"
    "window.WORKOUTS = "
    + json.dumps(export, ensure_ascii=False, indent=1)
    + ";\n"
)

print(f"wrote {out.relative_to(ROOT)}")
if applied:
    print(f"  corrections applied to the coach's data: {applied}")
for r in redundant:
    print(f"  correction no longer needed — {r}")
if failed:
    print("  !! CORRECTIONS THAT DID NOT APPLY:")
    for f in failed:
        print(f"       {f}")
    raise SystemExit("a correction in data/corrections.json no longer matches — fix or remove it")
if resolved:
    print(f"  unlinked blocks matched to a library exercise by name: {resolved}")
if unresolved:
    print(f"  !! BLOCKS WITH NO VIDEO ({len(unresolved)}):")
    for u in unresolved:
        print(f"       {u}")
    print("     → add them to data/name_resolution.json")
print(f"  {export['workout_count']} workouts, {export['exercise_count']} exercises")
print(f"  local videos: {export['exercise_count'] - len(missing_video)}/{export['exercise_count']}")
print(f"  published previews: {export['exercise_count'] - len(missing_preview)}/{export['exercise_count']}")
if missing_preview:
    print(f"  !! {len(missing_preview)} exercises have no preview — run scripts/make_previews.py")
    for n in missing_preview[:5]:
        print(f"       {n}")
if missing_video:
    print(f"  NO LOCAL VIDEO ({len(missing_video)}): " + ", ".join(missing_video[:12]))
    print("  → these fall back to YouTube in the site. Re-run scripts/download_videos.sh")
if missing_thumb:
    print(f"  no poster frame ({len(missing_thumb)}): " + ", ".join(missing_thumb[:8]))
