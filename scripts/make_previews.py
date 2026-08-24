#!/usr/bin/env python3
"""Turn each downloaded exercise video into a small looping animated WebP.

These previews are what the site shows on every card: they autoplay and loop by
themselves (no JavaScript, no <video> element), so a glance tells you what the
movement is. Tapping one swaps in the YouTube player.

The previews ARE published; the source .mp4 files are NOT — they stay in Google
Drive as a backup. See CLAUDE.md.

Why frames + img2webp rather than ffmpeg alone: this Mac's ffmpeg is built
without libwebp, so it can mux WebP but not encode it. Google's img2webp does
the encoding, which is the reference implementation anyway.

Usage:  python3 scripts/make_previews.py [--force]
"""
import concurrent.futures
import os
import pathlib
import subprocess
import sys
import tempfile
import threading

FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
IMG2WEBP = "/opt/homebrew/bin/img2webp"

ROOT = pathlib.Path(__file__).resolve().parent.parent
VIDEOS = ROOT / "videos"
PREVIEWS = ROOT / "previews"

# Chosen with Javier on 24 Aug 2026 against real samples. Bigger or longer looks
# barely better and costs roughly double the bytes on every card.
WIDTH = 360          # px on the long edge; cards render ~300px, so crisp on 2x screens
FPS = 12
SECONDS = 4
QUALITY = 50         # img2webp lossy quality
# Start a third of the way in: exercise clips open with the setup and someone
# walking into frame, and the actual reps are in the middle.
START_FRACTION = 0.35

force = "--force" in sys.argv


def duration(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0


def build(src, dest):
    dur = duration(src)
    if dur <= 0:
        return False, "unreadable"
    # Short clips: take them whole rather than starting past the end.
    start = 0.0 if dur < SECONDS + 0.5 else min(dur * START_FRACTION, dur - SECONDS)

    # Frames are transient and numerous — keep them out of the synced Drive folder.
    with tempfile.TemporaryDirectory(prefix="preview-frames-") as tmp:
        tmp = pathlib.Path(tmp)
        subprocess.run(
            [FFMPEG, "-v", "error", "-ss", f"{start:.2f}", "-t", str(SECONDS), "-i", str(src),
             "-vf", f"fps={FPS},scale=w={WIDTH}:h={WIDTH}"
                    ":force_original_aspect_ratio=decrease:flags=lanczos",
             "-an", str(tmp / "f_%04d.png")],
            check=True)
        frames = sorted(str(p) for p in tmp.glob("*.png"))
        if not frames:
            return False, "no frames"
        subprocess.run(
            [IMG2WEBP, "-loop", "0", "-min_size", "-kmin", "0", "-kmax", "0",
             "-lossy", "-q", str(QUALITY), "-m", "6", "-d", str(int(1000 / FPS))]
            + frames + ["-o", str(dest)],
            check=True, capture_output=True)
    return True, None


def main():
    for tool in (FFMPEG, FFPROBE, IMG2WEBP):
        if not pathlib.Path(tool).exists():
            sys.exit(f"missing tool: {tool}")

    PREVIEWS.mkdir(exist_ok=True)
    sources = sorted(VIDEOS.glob("*.mp4"))
    if not sources:
        sys.exit("no videos found — run scripts/download_videos.sh first")

    todo = []
    skipped = 0
    for src in sources:
        dest = PREVIEWS / (src.stem + ".webp")
        if dest.exists() and not force and dest.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
        else:
            todo.append((src, dest))

    # Each clip is an independent ffmpeg + img2webp run, and img2webp at -m 6 is
    # CPU-bound, so this scales almost linearly with cores. Serially it was ~20s
    # per clip — about an hour for the full set.
    workers = max(1, min(8, (os.cpu_count() or 4) - 2))
    made = 0
    failures = []
    done = 0
    lock = threading.Lock()

    def work(job):
        src, dest = job
        try:
            return src, build(src, dest)
        except subprocess.CalledProcessError as exc:
            return src, (False, f"{exc.cmd[0].rsplit('/', 1)[-1]} failed")

    if todo:
        print(f"  building {len(todo)} previews on {workers} workers "
              f"({skipped} already current)", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for src, (ok, why) in pool.map(work, todo):
            with lock:
                done += 1
                if ok:
                    made += 1
                else:
                    failures.append(f"{src.name}: {why}")
                if done % 20 == 0 or done == len(todo):
                    print(f"  {done}/{len(todo)} built", flush=True)

    total = sum(p.stat().st_size for p in PREVIEWS.glob("*.webp"))
    count = len(list(PREVIEWS.glob("*.webp")))
    print(f"previews: {count} files, {total / 1024 / 1024:.1f} MB "
          f"(avg {total / max(count, 1) / 1024:.0f} KB) — {made} built, {skipped} already current")
    if failures:
        print("  !! failed:")
        for f in failures:
            print(f"       {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
