#!/usr/bin/env python3
"""Dead-CSS check for both sites. There is no build step to catch a rule
nobody emits, so this does: every class selector in a stylesheet must be
written by at least one file that produces markup for that site.

    python3 scripts/check_css.py            # exit 1 on any dead class

A class is "emitted" if its name appears anywhere in the site's HTML/JS —
including inside a string concatenation, so `"logbtn__v" + …` counts. That is
deliberately loose (a false "alive" is cheap; a false "dead" would get a live
rule deleted). Classes that only JS toggles by name (swiping, is-edited…) are
found the same way, since the name has to be in the source.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

SITES = {
    "reference": {
        "css": [ROOT / "styles.css", ROOT / "shared" / "tokens.css"],
        "emitters": [ROOT / "index.html", ROOT / "app.js", ROOT / "auth.js"],
    },
    "cokiletics": {
        "css": [ROOT / "freecokiletics" / "styles.css", ROOT / "shared" / "tokens.css"],
        "emitters": [ROOT / "freecokiletics" / p for p in
                     ("index.html", "app.js", "core.js", "runner.js", "ui.js", "icons.js", "store.js", "timer.js", "theme.js")]
                    + sorted((ROOT / "freecokiletics" / "views").glob("*.js")),
    },
}

CLASS_RE = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")
STRING_ONLY = re.compile(r"/\*.*?\*/", re.S)


def classes_in(css_path):
    text = STRING_ONLY.sub("", css_path.read_text())
    # selectors only: drop declaration blocks so `.5s` and `1.5` inside values do not count
    selectors = re.sub(r"\{[^{}]*\}", "{}", text)
    return set(CLASS_RE.findall(selectors))


def main():
    dead_total = 0
    # shared/tokens.css serves both sites: a class in it is alive if EITHER emits it.
    everything = "\n".join(p.read_text() for s in SITES.values() for p in s["emitters"] if p.exists())
    for site, spec in SITES.items():
        own = "\n".join(p.read_text() for p in spec["emitters"] if p.exists())
        for css in spec["css"]:
            emitted = everything if css.parent.name == "shared" else own
            dead = sorted(c for c in classes_in(css) if not re.search(r"\b" + re.escape(c) + r"\b", emitted))
            rel = css.relative_to(ROOT)
            if dead:
                dead_total += len(dead)
                print(f"{site}: {rel} — {len(dead)} class(es) nothing emits:")
                for c in dead:
                    print(f"    .{c}")
            else:
                print(f"{site}: {rel} — clean")
    sys.exit(1 if dead_total else 0)


if __name__ == "__main__":
    main()
