#!/usr/bin/env python3
"""One way to write time in the programme's text (Javier, 14 Sep 2026).

    under a minute   45 sec          never 45" / 45″ / 45 s / 45 seconds
    whole minutes    2 min           never 120 sec / 2 minutes
    anything else    1:30 min        never 90 sec / 1,5 minutes / 1½ min

The app's own interface follows the same rule (App.dur in freecokiletics/
core.js). This file applies it to the coach's text — exercise names and notes —
at build time, so a programme refresh stays consistent. It runs after
scripts/casing.py.

Only units change. Every string is checked: its numbers must be exactly the
same before and after, the only allowed rewrite being "1,5" → "1:30". Anything
else stops the build.

    python3 scripts/units.py      # runs the examples below as a self-test
"""
import re

changes = []          # (before, after) for every string rewritten, for the build report

_QUOTE_SEC = re.compile(r"(\d+)\s*[\"”″]")
# Case-sensitive on purpose: "SEC" in capitals is the coach's emphasis
# ("*3 SEC HOLD") and stays whole, as in scripts/casing.py — lowering only the
# unit left "3 sec HOLD" (14 Sep 2026). "sec" is already right.
_WORD_SEC = re.compile(r"(\d+)\s*(?:[Ss]econds|[Ss]econd|[Ss]ecs|[Ss]eg|Sec)\b")
_HALF_MIN = re.compile(r"(\d+)[,.]5\s*(?:minutes|minute|mins|min)\b", re.I)
_WORD_MIN = re.compile(r"(\d+)\s*(?:minutes|minute|mins)\b", re.I)


def _numbers(s):
    return re.findall(r"\d+", re.sub(r"(\d+)[,.]5(?=\s*(?:minutes|minute|mins|min)\b)", r"\1:30", s, flags=re.I))


def text(s):
    if not s:
        return s
    out = _QUOTE_SEC.sub(r"\1 sec", s)
    out = re.sub(r"\bsec(?=[^\W\d_])", "sec ", out)                  # 3"hold → 3 sec hold
    out = _WORD_SEC.sub(r"\1 sec", out)
    out = _HALF_MIN.sub(r"\1:30 min", out)
    out = _WORD_MIN.sub(r"\1 min", out)
    if out != s:
        if _numbers(s) != re.findall(r"\d+", out):
            raise SystemExit(f"units changed a number: {s!r} -> {out!r}")
        changes.append((s, out))
    return out


if __name__ == "__main__":
    cases = [
        ('30" Front to side plank', "30 sec Front to side plank"),
        ('Band glute bridge (3" hold)', "Band glute bridge (3 sec hold)"),
        ('Tabata: 20" work - 10" rest x 8 cycles', "Tabata: 20 sec work - 10 sec rest x 8 cycles"),
        ('4 x 5" isometric deadbug', "4 x 5 sec isometric deadbug"),
        ("Rest 1,5 minutes", "Rest 1:30 min"),
        ("Rest 1,5 minute", "Rest 1:30 min"),
        ("Rest 1,5 min", "Rest 1:30 min"),
        ("Rest 1 minute", "Rest 1 min"),
        ("Rest 2 minute", "Rest 2 min"),
        ("Rest 1 min", "Rest 1 min"),
        ("30 seg", "30 sec"),
        ("3 sets of 10-8-6", "3 sets of 10-8-6"),
        ("10 floor row *3 SEC HOLD", "10 floor row *3 SEC HOLD"),
        ("30 Seconds hold", "30 sec hold"),
    ]
    bad = 0
    for src, want in cases:
        got = text(src)
        ok = got == want
        bad += not ok
        print(("ok   " if ok else "FAIL ") + repr(src) + " → " + repr(got) + ("" if ok else "   wanted " + repr(want)))
    raise SystemExit(1 if bad else 0)
