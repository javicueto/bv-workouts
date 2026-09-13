#!/usr/bin/env python3
"""Sentence case for the programme's names and the coach's notes.

Javier, 13 Sep 2026: one consistent case across both sites — "Calf release",
"10 / side Medball contralateral deadbug" — where the TrueCoach data mixed
"calf release", "BB Bench press + DB Lower row" and "Barbell Bench Press".

Only CAPITALS ever change, never wording: build_site.py checks that every
string lower-cases to exactly what it was, and fails the build otherwise.

    python3 scripts/casing.py      # runs the examples below as a self-test

Rules
- A NAME (exercise or block) is one or more movements joined by " + ". Each
  movement starts with a capital; every other word is lower case — unless the
  movement starts with a number ("2 in 2 out"), which is left to start with it.
- A NOTE line (the coach's instructions) gets the same word rules and a first
  capital, but a line starting with a number keeps it ("8/side band …"), and
  the first word after his "*" starts his cue, so it gets a capital.
- Always kept:
    ACRONYMS  gym shorthand, always upper case — "db row" becomes "DB row"
    PROPER    names inside exercise names — Bulgarian squat, Tabata
  Lowered like any other word (14 Sep 2026):
    CUES      what the coach wrote in capitals after a "*" — "TAP THE BENCH",
              "EXPLOSIVO", "3 SEC HOLD" → "Tap the bench", "Explosivo",
              "3 sec hold". He wrote the same cue both ways, so capitals were
              not his system; the app gives cues their own colour instead.

A capitalised word that gets lowered is recorded in `lowered`, and the build
prints the list: a proper noun a future refresh brings in ("Romanian") shows up
there and goes into PROPER.
"""
import re

ACRONYMS = {"DB", "BB", "KB", "TRX", "TK", "RIR", "RPE", "EMOM", "AMRAP"}
PROPER = {
    "Australian", "Bulgarian", "Cossack", "Tabata",
    # not in the programme yet, but exercise names that carry a proper noun
    "Arnold", "Bosu", "Copenhagen", "Jefferson", "Nordic", "Pallof", "Romanian",
    "Russian", "Superman", "Swiss", "Turkish", "Zottman",
}
_PROPER = {p.lower(): p for p in PROPER}
# Letters in any alphabet (the coach writes Spanish too: "rápida"), with an
# apostrophe inside a word. Hyphens split words, so "t-spine" → "T-spine".
WORD = re.compile(r"[^\W\d_][^\W\d_'’]*")

lowered = set()


def _word(w, first, after=""):
    if w.upper() in ACRONYMS:
        return w.upper()
    if w.lower() in _PROPER:
        return _PROPER[w.lower()]
    if w == "X" and re.match(r"\s*\d", after):
        return "x"                                 # "rest X 8 cycles" is "times"
    if len(w) == 1 and w.isupper():
        return w                                   # a shape: L-sit, T-bar, Y raise
    # No "emphasis" exception any more (Javier, 14 Sep 2026): the coach wrote
    # the same cue as CONTROL in one workout and Control in another, so his
    # capitals weren't a system. Cues are sentence case like everything else;
    # the app shows them in their own colour instead.
    low = w.lower()
    if first:
        return low[:1].upper() + low[1:]
    if w != low:
        lowered.add(w)
    return low


def _case(text, first):
    state = {"first": first}

    def sub(m):
        f = state["first"]
        state["first"] = False
        if text[:m.start()].rstrip().endswith("*"):   # the start of a cue
            f = True
        return _word(m.group(0), f, text[m.end():])

    return WORD.sub(sub, text)


def name(s):
    """An exercise or block name: each ' + ' movement starts with a capital."""
    if not s:
        return s
    parts = re.split(r"(\s*\+\s*)", s)
    return "".join(p if re.fullmatch(r"\s*\+\s*", p)
                   else _case(p, bool(re.match(r"\s*[^\W\d_]", p)))
                   for p in parts)


# The count in front of a movement: 8, 10, 30", 8/side, 8 / side, 8/10.
QTY = re.compile(r"""^\s*\d[\d\s/"'’.,×\-–]*(?:side\b\s*)?(?=[^\W\d_])""", re.I)
# Words after a count that are NOT a movement: "3 rounds", "3 sets of 10-8-6",
# "4 x 5" deadbug", "2 in 2 out". Every other line after a count is one.
UNITS = {"round", "rounds", "set", "sets", "rep", "reps", "x", "in", "min", "mins",
         "minute", "minutes", "sec", "secs", "second", "seconds", "cycle", "cycles",
         "times", "each", "per", "of", "more", "work", "rest", "kg", "m"}


def notes(text):
    """The coach's instructions, line by line. A line that is a count and a
    movement ("8/side leg extension") starts the movement with a capital, as
    the app's own captions do ("8 / side Leg extension")."""
    if not text:
        return text
    out = []
    for line in text.split("\n"):
        line = _case(line, bool(re.match(r"\s*[^\W\d_]", line)))
        m = QTY.match(line)
        if m and re.match(r"[^\W\d_]+", line[m.end():]).group(0).lower() not in UNITS:
            line = line[:m.end()] + line[m.end()].upper() + line[m.end() + 1:]
        out.append(line)
    return "\n".join(out)


if __name__ == "__main__":
    cases = [
        (name, "calf release", "Calf release"),
        (name, "medball contralateral deadbug", "Medball contralateral deadbug"),
        (name, "Barbell Bench Press", "Barbell bench press"),
        (name, "BB Bench press + DB Lower row", "BB bench press + DB lower row"),
        (name, "floor db shoulder blade depression", "Floor DB shoulder blade depression"),
        (name, "Heels elevated goblet squat + Trx scapular row", "Heels elevated goblet squat + TRX scapular row"),
        (name, "DB Bulgarian squat", "DB Bulgarian squat"),
        (name, "BB Squat *TAP THE BENCH", "BB squat *Tap the bench"),
        (name, "2 In 2 Out", "2 in 2 out"),
        (name, "Leg Extension 2 Up 1 Down", "Leg extension 2 up 1 down"),
        (name, 'Tabata: 20" work - 10" rest X 8 cycles', 'Tabata: 20" work - 10" rest x 8 cycles'),
        (name, "t-spine rotation with reach", "T-spine rotation with reach"),
        (name, "Hollow Hold L-sit", "Hollow hold L-sit"),
        (notes, '10 BB rack Deadlift (3" hold)', '10 BB rack deadlift (3" hold)'),
        (notes, "8/side band internal rotation", "8/side Band internal rotation"),
        (notes, "2 round\nRest 1 min", "2 round\nRest 1 min"),
        (notes, "10 DB Swing *controlado en bajada, pero subida rápida",
                "10 DB swing *Controlado en bajada, pero subida rápida"),
        (notes, "10 Floor row *3 SEC HOLD", "10 Floor row *3 sec hold"),
        (notes, "3 sets *MAX REPS - RIR 0", "3 sets *Max reps - RIR 0"),
        (notes, "10 BB bench press *EXPLOSIVO", "10 BB bench press *Explosivo"),
        (notes, "16 Pass simulation reverse lunges *CONTROL RODILLA", "16 Pass simulation reverse lunges *Control rodilla"),
        (notes, "mobility routine", "Mobility routine"),
    ]
    cases += [
        (notes, "3 rounds:\n8/side leg extension 2 up 1 down\n10 floor row *3 SEC HOLD",
                "3 rounds:\n8/side Leg extension 2 up 1 down\n10 Floor row *3 sec hold"),
        (notes, "8 / side db bulgarian squat", "8 / side DB Bulgarian squat"),
        (notes, '30" isometric dead bug', '30" Isometric dead bug'),
        (notes, "8/side L-sit shoulder press rotation", "8/side L-sit shoulder press rotation"),
        (notes, "3 sets of 10-8-6", "3 sets of 10-8-6"),
        (notes, '4 x 5" isometric deadbug', '4 x 5" isometric deadbug'),
        (notes, "1 round, 8/10 reps each exercise:", "1 round, 8/10 reps each exercise:"),
    ]
    bad = 0
    for fn, src, want in cases:
        got = fn(src)
        ok = got == want and got.lower() == src.lower()
        bad += not ok
        print(("ok   " if ok else "FAIL ") + repr(src) + " → " + repr(got) + ("" if ok else "   wanted " + repr(want)))
    raise SystemExit(1 if bad else 0)
