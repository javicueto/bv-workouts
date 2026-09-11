#!/usr/bin/env python3
"""Convert the TrueCoach programme (data/workouts.js) into the structured form
the /javiplan app runs on: javiplan/data/programme.js.

The site only needs to DISPLAY a block's instructions, so free text is fine
there. The app has to DRIVE a session — it needs to know how many rounds, what
reps for which movement, and how long to rest — so the text is parsed once,
here, into numbers.

Parsing is deliberately conservative. Anything it cannot read with confidence
is listed at the end and the build FAILS, so a misread never silently becomes a
wrong rest timer. Fix those in javiplan/data/programme_overrides.json, which is
applied last and wins.

Usage:  python3 scripts/build_javiplan.py
"""
import difflib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "workouts.js"
OVERRIDES = ROOT / "javiplan" / "data" / "programme_overrides.json"
OUT = ROOT / "javiplan" / "data" / "programme.js"

# Blocks with no rest written are the prehab/core circuits. Javier's call
# (11 Sep 2026): no rest written means no timer — he swipes straight into the
# next round. So the default is 0, not a guessed number.
DEFAULT_REST_SECONDS = 0

problems = []


def warn(key, letter, msg):
    problems.append(f"{key} [{letter}] {msg}")


def parse_rest(info):
    """-> (seconds or None, note or None, assumed: bool)"""
    m = re.search(r"^\s*rest\b(.*)$", info, re.I | re.M)
    if not m:
        return DEFAULT_REST_SECONDS, "No rest", False
    tail = m.group(1).strip().lower()
    if "little" in tail or "ittle" in tail:
        return 0, "Rest as little as possible", False
    if tail == "" or tail.startswith("no"):
        return 0, "No rest", False
    mm = re.match(r"(\d+)(?:[.,](\d))?\s*(min|minute|minutes|seg|sec|s)\b", tail)
    if not mm:
        return None, tail, False
    whole, frac, unit = int(mm.group(1)), mm.group(2), mm.group(3)
    value = whole + (int(frac) / 10 if frac else 0)
    return int(round(value * (60 if unit.startswith("min") else 1))), None, False


def parse_rounds(info):
    m = re.search(r"(\d+)(?:/(\d+))?\s*(rounds?|sets?)\b", info, re.I)
    if not m:
        return None, None
    note = f"{m.group(1)}/{m.group(2)} sets — take the lower" if m.group(2) else None
    return int(m.group(1)), note


REPS_LINE = re.compile(
    r"""^\s*
    (?:
      (?P<pyr>\d+-\d+-\d+)                 # 10-8-6 across rounds
     |(?P<holds>\d+)\s*x\s*(?P<holdsec>\d+)\s*["”]  # 4 x 5" isometric
     # 30" / 30 sec. The \b applies to the WORD units only: after a quote sign
     # it never matches before a space, which silently turned every 30" plank
     # into "30 reps" (found 11 Sep 2026).
     |(?P<secs>\d+)\s*(?:["”″]|(?:secs?|seg)\b)
     |(?P<n>\d+)                           # plain count
     |(?P<max>max(?:\s+reps)?)             # MAX
    )
    \s*(?P<side>/\s*side)?\s*
    (?P<name>.*?)\s*$""",
    re.I | re.X,
)


def parse_movement(line):
    """One movement line -> dict, or None if it is not a movement line."""
    s = line.strip()
    if not s:
        return None
    if re.match(r"^\d+(?:/\d+)?\s*(rounds?|sets?)\b", s, re.I):
        return None
    if re.match(r"^(no\s+)?rest\b", s, re.I):
        return None
    note = None
    if "*" in s:
        s, note = s.split("*", 1)
        s, note = s.strip(), note.strip()
    par = re.search(r"\(([^)]*)\)\s*$", s)
    if par:
        note = (note + " · " if note else "") + par.group(1).strip()
        s = s[: par.start()].strip()
    m = REPS_LINE.match(s)
    if not m:
        return {"name": s, "reps": None, "note": note, "unparsed": True}
    d = {"name": m.group("name").strip(), "note": note, "per_side": bool(m.group("side"))}
    if m.group("pyr"):
        d["reps_per_round"] = [int(x) for x in m.group("pyr").split("-")]
    elif m.group("holds"):
        d["holds"] = int(m.group("holds")); d["seconds"] = int(m.group("holdsec"))
    elif m.group("secs"):
        d["seconds"] = int(m.group("secs"))
    elif m.group("n"):
        d["reps"] = int(m.group("n"))
    elif m.group("max"):
        d["reps"] = "MAX"
    return d


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def match_lines_to_videos(lines, videos, key, letter):
    """Pair each movement line with the exercise video it describes.

    Usually 1:1 in order. When the counts differ (a block named after a single
    lift, or a duplicated video), fall back to name similarity and say so."""
    if len(lines) == len(videos):
        return list(zip(lines, videos))
    pairs, used = [], set()
    for ln in lines:
        best, score = None, 0.0
        for i, v in enumerate(videos):
            if i in used:
                continue
            sc = difflib.SequenceMatcher(None, norm(ln["name"]), norm(v["name"])).ratio()
            if sc > score:
                best, score = i, sc
        if best is None or score < 0.45:
            warn(key, letter, f"could not match movement line “{ln['name']}” to a video")
            pairs.append((ln, None))
        else:
            used.add(best)
            pairs.append((ln, videos[best]))
    if len(videos) != len(used):
        warn(key, letter, f"{len(videos) - len(used)} video(s) not used by any movement line")
    return pairs


def main():
    d = json.loads(SRC.read_text().split("window.WORKOUTS = ", 1)[1].rsplit(";", 1)[0])
    ex = d["exercises"]
    sessions = []

    for w in d["workouts"]:
        key = w["key"]
        blocks = []
        for it in w["items"]:
            letter, name, info = it["letter"], it["name"], it["info"]
            videos = [ex[i] for i in it["exercises"] if i in ex]

            if "tabata" in name.lower():
                movs = [ln for ln in (parse_movement(l) for l in info.split("\n")) if ln]
                pairs = match_lines_to_videos(movs, videos, key, letter)
                blocks.append({
                    "letter": letter, "name": name, "kind": "tabata",
                    "work_seconds": 20, "rest_seconds": 10, "cycles": 8,
                    "exercises": [{"id": v["id"] if v else None, "name": v["name"] if v else ln["name"]}
                                  for ln, v in pairs],
                    "raw": info,
                })
                continue

            rounds, rounds_note = parse_rounds(info)
            rest, rest_note, rest_assumed = parse_rest(info)
            if rounds is None:
                warn(key, letter, "no rounds/sets count found")
            if rest is None:
                warn(key, letter, f"could not read rest: “{rest_note}”")

            movs = [ln for ln in (parse_movement(l) for l in info.split("\n")) if ln]
            for ln in movs:
                if ln.get("unparsed"):
                    warn(key, letter, f"could not read reps in “{ln['name']}”")

            if not movs and len(videos) == 1:
                # "BB Bench press — 3 sets of 10-8-6": the block name is the lift.
                m = re.search(r"sets?\s+of\s+([\d\-]+(?:/side)?|max)", info, re.I)
                if m:
                    spec = parse_movement(m.group(1) + " " + name)
                elif re.search(r"\bmax\b", info, re.I):
                    # "3 sets *MAX REPS - RIR 0": MAX with the cue after the star.
                    star = info.split("*", 1)[1].split("\n")[0].strip() if "*" in info else None
                    spec = {"name": name, "reps": "MAX", "note": star}
                else:
                    spec = None
                if not spec or spec.get("unparsed"):
                    warn(key, letter, f"single-lift block but could not read its reps from “{info.strip()}”")
                    spec = {"name": name, "reps": None}
                movs = [spec]
            pairs = match_lines_to_videos(movs, videos, key, letter)

            exercises = []
            for ln, v in pairs:
                e = {k: ln[k] for k in ("reps", "reps_per_round", "seconds", "holds", "per_side", "note")
                     if k in ln and ln[k] not in (None, False)}
                e["id"] = v["id"] if v else None
                e["name"] = v["name"] if v else ln["name"]
                exercises.append(e)

            blocks.append({
                "letter": letter, "name": name, "kind": "rounds",
                "rounds": rounds, "rounds_note": rounds_note,
                "rest_seconds": rest, "rest_note": rest_note, "rest_assumed": rest_assumed,
                "exercises": exercises, "raw": info,
            })

        sessions.append({
            "key": key, "block": w["block"], "variant": w["variant"], "title": w["title"],
            "warmup": {"text": w["warmup"], "exercises": [
                {"id": i, "name": ex[i]["name"]} for i in w["warmup_exercises"] if i in ex]},
            "blocks": blocks,
        })

    # Manual fixes win over anything parsed.
    if OVERRIDES.exists():
        ov = json.loads(OVERRIDES.read_text())
        by_key = {s["key"]: s for s in sessions}
        for fix in ov.get("blocks", []):
            s = by_key.get(fix["session"])
            b = next((b for b in s["blocks"] if b["letter"] == fix["letter"]), None) if s else None
            if b is None:
                sys.exit(f"override targets a block that does not exist: {fix}")
            b.update({k: v for k, v in fix.items() if k not in ("session", "letter")})
            b["overridden"] = True
        # Name-based rules apply to every matching block, including future ones
        # from a refresh — used for decisions Javier makes about a KIND of block
        # (e.g. "core never gets a rest timer") rather than one specific block.
        for rule in ov.get("rules", []):
            pat = re.compile(rule["match_name"], re.I)
            for s in sessions:
                for b in s["blocks"]:
                    if b.get("kind") != "rounds" or not pat.search(b["name"]):
                        continue
                    had_timer = bool(b.get("rest_seconds"))
                    if "rest_seconds" in rule:
                        b["rest_seconds"] = rule["rest_seconds"]
                    # Only replace the badge where a timer was removed; keep the
                    # coach's own cue ("Rest as little as possible") elsewhere.
                    if had_timer and "rest_note" in rule:
                        b["rest_note"] = rule["rest_note"]
                    b["overridden"] = True
        # An override can also silence a specific warning it has dealt with.
        silenced = set(ov.get("silence", []))
        problems[:] = [p for p in problems if not any(p.startswith(s) for s in silenced)]

    exercises = {i: {"id": i, "name": e["name"], "youtube_id": e["youtube_id"],
                     "has_preview": e["has_preview"]} for i, e in ex.items()}
    payload = {"generated_from": "data/workouts.js", "session_count": len(sessions),
               "exercises": exercises, "sessions": sessions}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("window.PROGRAMME = " + json.dumps(payload, indent=1, ensure_ascii=False) + ";\n")

    # The schedule is authored as JSON; the app loads it as a script so it also
    # works from file:// and inside the service-worker cache without a fetch.
    sched = ROOT / "javiplan" / "data" / "schedule.json"
    if sched.exists():
        (ROOT / "javiplan" / "data" / "schedule.js").write_text(
            "window.SCHEDULE = " + sched.read_text().strip() + ";\n")

    n_blocks = sum(len(s["blocks"]) for s in sessions)
    no_timer = sum(1 for s in sessions for b in s["blocks"] if b.get("kind") == "rounds" and not b.get("rest_seconds"))
    print(f"wrote {OUT.relative_to(ROOT)} — {len(sessions)} sessions, {n_blocks} blocks")
    print(f"  {no_timer} blocks run with no rest timer (none written, or 'no rest')")
    if problems:
        print(f"\n  !! {len(problems)} thing(s) the parser could not read — fix in {OVERRIDES.relative_to(ROOT)}:")
        for p in problems:
            print(f"     {p}")
        sys.exit(1)
    print("  every block parsed cleanly")


if __name__ == "__main__":
    main()
