#!/usr/bin/env python3
"""Convert the TrueCoach programme (data/workouts.js) into the structured form
the Freecokiletics app runs on: freecokiletics/data/programme.js.

The site only needs to DISPLAY a block's instructions, so free text is fine
there. The app has to DRIVE a session — it needs to know how many rounds, what
reps for which movement, and how long to rest — so the text is parsed once,
here, into numbers.

Parsing is deliberately conservative. Anything it cannot read with confidence
is listed at the end and the build FAILS, so a misread never silently becomes a
wrong rest timer. Fix those in freecokiletics/data/programme_overrides.json, which is
applied last and wins.

Usage:  python3 scripts/build_freeco.py
"""
import difflib
import json
import pathlib
import hashlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "workouts.js"
OVERRIDES = ROOT / "freecokiletics" / "data" / "programme_overrides.json"
NO_WEIGHT = ROOT / "freecokiletics" / "data" / "no_weight.json"    # exercises with no weight to log
ONE_SIDE = ROOT / "freecokiletics" / "data" / "one_side.json"      # Tabata movements done one side per interval
OUT = ROOT / "freecokiletics" / "data" / "programme.js"
CARDIO = ROOT / "freecokiletics" / "data" / "cardio.json"           # cardio days, hand-written (not TrueCoach)
SPIN = ROOT / "freecokiletics" / "data" / "spin.json"               # spin rides, hand-written
SPIN_AUDIO = ROOT / "freecokiletics" / "data" / "spin_audio.json"   # their tracks, from scripts/build_spin.py

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
    # "1:30 min" is how build_site.py writes a rest now (scripts/units.py);
    # "1,5 minutes" is the coach's original, still read for safety.
    mc = re.match(r"(\d+):(\d{2})\s*min\b", tail)
    if mc:
        return int(mc.group(1)) * 60 + int(mc.group(2)), None, False
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
     |(?P<holds>\d+)\s*x\s*(?P<holdsec>\d+)\s*(?:["”″]|(?:secs?|seg)\b)  # 4 x 5" / 4 x 5 sec isometric
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


def build_cardio(ex, no_weight, plan_sessions):
    """Cardio days (Javier, 18 Oct 2026): freecokiletics/data/cardio.json →
    PROGRAMME.cardio, in the same session shape the runner already walks.

    Every timed part — the warm-up and cooldown, an AMRAP with its rests, an
    EMOM, a station circuit — becomes ONE "intervals" block: a list of phases
    (work or rest, seconds, what to do), so the runner has one clock engine for
    all of them. "rounds" blocks (Kelly, Michael, the core) stay round-by-round
    screens with Done, exactly like Francesco's.

    Returns (sessions, new_exercises). Stops the build on an unknown movement or
    a malformed block — a typo must never become a silently empty screen."""
    src = json.loads(CARDIO.read_text())
    own = src["exercises"]
    for i in own:
        if i in ex:
            sys.exit(f"cardio.json: {i} clashes with a TrueCoach exercise id")

    def move(m, where):
        i = m.get("id")
        if i in own:
            base = own[i]
            nw = bool(base.get("no_weight"))
        elif i in ex:
            base = ex[i]
            nw = i in no_weight
        else:
            sys.exit(f"cardio.json: {where} uses unknown exercise {i!r}")
        out = {"id": i, "name": base["name"]}
        for k in ("reps", "seconds", "per_side", "note", "amount", "unit"):
            if k in m:
                out[k] = m[k]
        # A movement can be weightless HERE even if Francesco's version takes a
        # weight (the rower is a machine) — cardio.json says so per use.
        if nw or m.get("no_weight"):
            out["no_weight"] = True
        return out

    def check(cond, where, msg):
        if not cond:
            sys.exit(f"cardio.json: {where}: {msg}")

    def block(b, letter, where):
        kind = b.get("kind")
        base = {"letter": letter, "name": b["name"], "zone": b.get("zone"), "note": b.get("note")}
        if kind == "rounds":
            check(isinstance(b.get("rounds"), int) and b["rounds"] >= 1, where, "rounds must be a whole number ≥ 1")
            exs = [move(m, where) for m in b["exercises"]]
            return dict(base, kind="rounds", rounds=b["rounds"], rounds_note=None,
                        rest_seconds=b.get("rest_seconds", 0), rest_note="No rest" if not b.get("rest_seconds") else None,
                        rest_assumed=False, exercises=exs, raw="")
        phases = []
        if kind == "timer":
            exs = [move(m, where) for m in b["exercises"]]
            phases.append({"kind": "work", "sec": b["seconds"], "label": b["name"], "moves": exs})
            # Starts on its own unless the block says otherwise (a machine you
            # walk to needs its own Start and 3 · 2 · 1).
            extra = {"autostart": b.get("autostart", True)}
        elif kind == "amrap":
            exs = [move(m, where) for m in b["exercises"]]
            sets, rest = b["sets"], b.get("rest_seconds", 0)
            for s in range(1, sets + 1):
                phases.append({"kind": "work", "sec": b["minutes"] * 60, "set": s, "moves": exs,
                               "label": f"Set {s} of {sets}" if sets > 1 else f"AMRAP {b['minutes']} min"})
                if s < sets and rest:
                    phases.append({"kind": "rest", "sec": rest, "after": s, "label": "Rest"})
            check(b.get("score", {}).get("kind") in ("reps", "rounds_reps"), where, "an AMRAP needs score.kind reps or rounds_reps")
            extra = {"score": b["score"], "sets": sets}
        elif kind == "emom":
            pattern = [[move(m, where) for m in minute] for minute in b["pattern"]]
            check(pattern and all(pattern), where, "an EMOM needs a non-empty pattern")
            for mnt in range(1, b["minutes"] + 1):
                phases.append({"kind": "work", "sec": 60, "minute": mnt, "label": f"Minute {mnt} of {b['minutes']}",
                               "moves": pattern[(mnt - 1) % len(pattern)]})
            seen, exs = set(), []
            for minute in pattern:
                for m in minute:
                    if m["id"] not in seen:
                        seen.add(m["id"]); exs.append(m)
            extra = {}
        elif kind == "circuit":
            # Timed holds, one after another on the clock (the cardio core):
            # a hold done per side is two phases, left then right, and a short
            # "switch" rest sits between holds — never after the very last.
            exs = [move(m, where) for m in b["exercises"]]
            check(all(m.get("seconds") for m in exs), where, "every circuit movement needs seconds")
            rounds = b["rounds"]
            for r in range(1, rounds + 1):
                for k, m in enumerate(exs, 1):
                    for side in (["left", "right"] if m.get("per_side") else [None]):
                        if phases and b.get("switch_seconds"):
                            phases.append({"kind": "rest", "sec": b["switch_seconds"], "label": "Switch"})
                        phases.append({"kind": "work", "sec": m["seconds"], "moves": [m], "round": r, "station": k,
                                       "label": f"Round {r} of {rounds}" + (f" · {side} side" if side else "")})
            extra = {"optional": bool(b.get("optional"))}
        elif kind == "stations":
            exs = [move(m, where) for m in b["exercises"]]
            rounds, n = b["rounds"], len(exs)
            for r in range(1, rounds + 1):
                for k, m in enumerate(exs, 1):
                    phases.append({"kind": "work", "sec": b["station_seconds"], "moves": [m], "round": r, "station": k,
                                   "label": f"Round {r} of {rounds} · station {k} of {n}"})
                if r < rounds and b.get("rest_seconds"):
                    phases.append({"kind": "rest", "sec": b["rest_seconds"], "label": "Rest"})
            extra = {}
        else:
            sys.exit(f"cardio.json: {where}: unknown block kind {kind!r}")
        check(all(p["sec"] > 0 for p in phases), where, "every phase needs seconds > 0")
        # rounds: how many work rounds the block has, for the runner's
        # boxing-style bells (2 bells: the round before the last; 3: the last).
        extra.setdefault("rounds", {"amrap": b.get("sets"), "stations": b.get("rounds"), "circuit": b.get("rounds")}.get(kind))
        return dict(base, kind="intervals", format=kind, phases=phases, exercises=exs,
                    seconds=sum(p["sec"] for p in phases), **extra)

    common = src["common"]
    # The usual mobility warm-up (Javier, 24 Oct 2026: "the one from block
    # 5, 6, 7…"): taken from a plan session BY KEY, never retyped, so it follows
    # a TrueCoach refresh. It is the session's own warm-up, so the runner and
    # the session screen treat it exactly like a plan session's.
    mob_key = common["mobility_from"]
    mob = next((s for s in plan_sessions if s["key"] == mob_key), None)
    check(mob and mob["warmup"]["exercises"], "common", f"mobility_from {mob_key!r} is not a plan session with a warm-up")
    mobility = {"text": mob["warmup"]["text"], "exercises": mob["warmup"]["exercises"]}
    # The band shoulder work (Javier, 27 Oct 2026): the plan's "Shoulder stability"
    # block, copied BY KEY ("3.1:A" = session 3.1, block A), never retyped. It
    # follows the mobility warm-up as part of the warm-up, so the Stairmaster is
    # shorter by about its length. Letter "S": the other letters stay put, because
    # a finished workout's weights and scores are filed under them.
    sh_key, sh_letter = common["shoulders_from"].split(":")
    sh_src = next((s for s in plan_sessions if s["key"] == sh_key), None)
    sh_blk = next((b for b in (sh_src["blocks"] if sh_src else []) if b["letter"] == sh_letter), None)
    check(sh_blk and sh_blk["kind"] == "rounds", "common", f"shoulders_from {common['shoulders_from']!r} is not a rounds block of a plan session")
    import copy
    shoulders = dict(copy.deepcopy(sh_blk), letter="S")
    sessions = []
    keys = set()
    for r in src["routines"]:
        where = r["key"]
        check(r["key"].startswith("cardio-") and r["key"] not in keys, where, "keys start with cardio- and are unique")
        keys.add(r["key"])
        # "W" is the mobility warm-up (the session's own); the blocks are A–D.
        # `wod` marks the main part, which is where scores are kept.
        # Estimated total (Javier, 27 Oct 2026): the timed parts are exact (their
        # phases), a rounds block has no clock so it says minutes_per_round (OUR
        # estimate, marked as such in the app), the mobility warm-up has no clock
        # either (common.mobility_minutes / shoulders_minutes). The optional core is counted apart.
        wb = r["block"]
        if wb["kind"] == "rounds":
            check(wb.get("minutes_per_round"), where, "a rounds WOD needs minutes_per_round for the estimate")
            wod_min = wb["rounds"] * wb["minutes_per_round"]
        else:
            wod_min = None
        blocks = [copy.deepcopy(shoulders),
                  block(common["stairmaster"], "A", where + " stairmaster"),
                  dict(block(r["block"], "B", where), wod=True),
                  block(common["cooldown"], "C", where + " cooldown"),
                  block(common["core"], "D", where + " core")]
        secs = {b["letter"]: b.get("seconds") for b in blocks if b["kind"] == "intervals"}
        main = common["mobility_minutes"] + common["shoulders_minutes"] + (secs["A"] + secs["C"]) / 60 + (wod_min if wod_min is not None else secs["B"] / 60)
        estimate = {"minutes": int(round(main / 5.0) * 5), "core_minutes": int(round(secs["D"] / 60)),
                    "wod_timed": wod_min is None}
        sessions.append({"key": r["key"], "kind": "cardio", "block": None, "variant": None,
                         "title": r["title"], "wod": r["wod"], "estimate": estimate,
                         "warmup": mobility, "blocks": blocks})
    return sessions, own


def build_spin():
    """Spin rides (Javier, 25 Oct 2026) → PROGRAMME.spin. A ride is a cardio day
    (kind "cardio", so it saves, scores and shows like one) with `spin: true`,
    its segments with their start times, and its audio track. The track must
    have been built from THIS version of the ride: its length is checked, so an
    edited ride with an old track stops the build instead of drifting."""
    src = json.loads(SPIN.read_text())
    audio = json.loads(SPIN_AUDIO.read_text()) if SPIN_AUDIO.exists() else {}
    rides = []
    for r in src["rides"]:
        t, segs = 0.0, []
        for s in r["segments"]:
            segs.append(dict(s, start=t, seconds=s["min"] * 60))
            t += s["min"] * 60
        a = audio.get(r["key"])
        if not a or abs(a["ride_seconds"] - t) > 0.5:
            sys.exit(f"spin: the track for {r['key']} is missing or out of date — run scripts/build_spin.py")
        minutes = round(t / 60)
        rides.append({"key": r["key"], "kind": "cardio", "spin": True, "block": None, "variant": None,
                      "title": r["title"],
                      "wod": {"format": f"Spin · {minutes} min · Zone {r['zone']}"},
                      "warmup": {"text": "", "exercises": []}, "blocks": [],
                      "ride": {"zone": r["zone"], "seconds": t, "segments": segs,
                               "audio": {"file": a["file"], "v": a["v"], "seconds": a["seconds"]}}})
    return rides


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

    # Exercises with no weight to log — bodyweight, bands, TRX… (Javier's
    # review, 13 Sep 2026; see the file's _about). Marked on every block
    # exercise and in the exercise index; the app hides the weight field for
    # them unless a weight was already logged.
    no_weight = set()
    if NO_WEIGHT.exists():
        no_weight = set(json.loads(NO_WEIGHT.read_text())["exercises"])
        missing = sorted(i for i in no_weight if i not in ex)
        if missing:
            print(f"  no_weight.json lists exercises this programme does not have: {', '.join(missing)}")
        for s in sessions:
            for b in s["blocks"]:
                for e in b.get("exercises", []):
                    if e.get("id") in no_weight:
                        e["no_weight"] = True

    # Tabata movements done one side per work interval — side plank (Javier,
    # 15 Sep 2026; see the file's _about). The coach's Tabata text carries no
    # "/side", so the flag comes from this list; the app alternates Left / Right.
    if ONE_SIDE.exists():
        one_side = set(json.loads(ONE_SIDE.read_text())["exercises"])
        missing = sorted(i for i in one_side if i not in ex)
        if missing:
            print(f"  one_side.json lists exercises this programme does not have: {', '.join(missing)}")
        marked = 0
        for s in sessions:
            for b in s["blocks"]:
                if b.get("kind") != "tabata":
                    continue
                for e in b["exercises"]:
                    if e.get("id") in one_side:
                        e["per_side"] = True
                        marked += 1
        print(f"  {marked} Tabata movements marked one side per interval")

    # preview_v: a short hash of the preview file. The app asks for
    # previews/<id>.webp?v=<preview_v>, so a rebuilt preview is a new address:
    # the offline copy on the phone (the freeco-previews cache) fetches it again
    # and drops the old one, and nothing unchanged downloads twice. Run this
    # build after make_previews.py (refresh.sh does).
    cardio, cardio_ex = build_cardio(ex, no_weight, sessions) if CARDIO.exists() else ([], {})
    for i, e in cardio_ex.items():
        ex[i] = {"name": e["name"], "youtube_id": e["youtube_id"],
                 "has_preview": (ROOT / "previews" / f"{i}.webp").exists()}
        if e.get("no_weight"):
            no_weight.add(i)
        if not ex[i]["has_preview"]:
            print(f"  cardio movement {i} has no preview yet (videos/{i}.mp4 → scripts/make_previews.py)")

    exercises = {}
    for i, e in ex.items():
        row = {"id": i, "name": e["name"], "youtube_id": e["youtube_id"], "has_preview": e["has_preview"]}
        if e["has_preview"]:
            f = ROOT / "previews" / f"{i}.webp"
            if not f.exists():
                sys.exit(f"  {i} is marked has_preview but previews/{i}.webp is missing")
            row["preview_v"] = hashlib.sha1(f.read_bytes()).hexdigest()[:8]
        if i in no_weight:
            row["no_weight"] = True
        exercises[i] = row
    print(f"  {sum(1 for i in ex if i in no_weight)} exercises marked no weight")
    payload = {"generated_from": "data/workouts.js", "session_count": len(sessions),
               "exercises": exercises, "sessions": sessions, "cardio": cardio,
               "spin": build_spin() if SPIN.exists() else []}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("window.PROGRAMME = " + json.dumps(payload, indent=1, ensure_ascii=False) + ";\n")

    n_blocks = sum(len(s["blocks"]) for s in sessions)
    no_timer = sum(1 for s in sessions for b in s["blocks"] if b.get("kind") == "rounds" and not b.get("rest_seconds"))
    print(f"wrote {OUT.relative_to(ROOT)} — {len(sessions)} sessions, {n_blocks} blocks, {len(cardio)} cardio routines")
    print(f"  {no_timer} blocks run with no rest timer (none written, or 'no rest')")
    if problems:
        print(f"\n  !! {len(problems)} thing(s) the parser could not read — fix in {OVERRIDES.relative_to(ROOT)}:")
        for p in problems:
            print(f"     {p}")
        sys.exit(1)
    print("  every block parsed cleanly")


if __name__ == "__main__":
    main()
