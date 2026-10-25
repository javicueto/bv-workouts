#!/usr/bin/env python3
"""Build each spin ride's audio track (Javier, 25 Oct 2026).

Reads freecokiletics/data/spin.json and writes, per ride, ONE track to
freecokiletics/audio/<key>.mp3: the coach's voice at every change, a bell on
the change itself, three short beeps before it, and silence in between. The app
plays that track and its screen follows the track's clock, so on an iPhone the
cues keep their timing with the WHOOP app in front or the phone locked (when the
rider picks "background" — see views/spin.js). Also writes
freecokiletics/data/spin_audio.json ({key: {file, v, seconds}}), which
build_freeco.py folds into PROGRAMME.spin.

Voice clips come from ElevenLabs and are cached in data/spin_voice/ by a hash of
voice + model + text, so a rebuild only pays for words that changed. The API key
is read from ~/.claude/tokens.json (elevenlabs_api_key, the secret that starts
with sk_); it is never written anywhere else.

Usage:  python3 scripts/build_spin.py      then  python3 scripts/build_freeco.py
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import urllib.request

FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "freecokiletics" / "data" / "spin.json"
CLIPS = ROOT / "data" / "spin_voice"
OUT_DIR = ROOT / "freecokiletics" / "audio"
OUT_JSON = ROOT / "freecokiletics" / "data" / "spin_audio.json"

HEADS_UP = 10          # seconds before a change: "Coming up: …"
BEEPS = (3, 2, 1)      # seconds before a change: one short beep each
VOICE_AFTER_BELL = 0.45

TERRAIN = {"warm-up": "Warm-up", "flat": "Flat road", "climb": "Climb", "recovery": "Recovery",
           "fast flat": "Fast flat", "cool-down": "Cool-down"}


def die(msg):
    sys.exit(f"build_spin: {msg}")


def duration(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout.strip()
    if not out:
        die(f"cannot read the length of {path}")
    return float(out)


def tts(text, voice):
    """The clip for `text`, from the cache or from ElevenLabs."""
    CLIPS.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha1(f"{voice['id']}|{voice['model']}|{text}".encode()).hexdigest()[:16]
    path = CLIPS / f"{h}.mp3"
    if path.exists():
        return path
    key = json.loads((pathlib.Path.home() / ".claude" / "tokens.json").read_text()).get("elevenlabs_api_key", "")
    if not key.startswith("sk_"):
        die("elevenlabs_api_key in ~/.claude/tokens.json is missing or is not the sk_ secret")
    body = json.dumps({"text": text, "model_id": voice["model"],
                       "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.35,
                                          "use_speaker_boost": True}}).encode()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice['id']}?output_format=mp3_44100_128",
        data=body, headers={"xi-api-key": key, "Content-Type": "application/json"})
    try:
        audio = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        # A refused key is a STOP (CLAUDE.md: a failing credential is never routed around).
        die(f"ElevenLabs refused the request ({e.code}): {e.read()[:200]!r}")
    path.write_bytes(audio)
    index = CLIPS / "index.json"
    idx = json.loads(index.read_text()) if index.exists() else {}
    idx[path.name] = text
    index.write_text(json.dumps(idx, indent=1, ensure_ascii=False) + "\n")
    print(f"  voice: {text}")
    return path


def say_change(seg, prev):
    pos = "Stand up" if seg["position"] == "standing" else ("Sit down" if prev and prev["position"] == "standing" else "Seated")
    lo, hi = seg["rpm"]
    words = f"{pos}. {TERRAIN[seg['terrain']]}. Resistance {seg['resistance']}. Cadence {lo} to {hi}."
    return words + (" " + seg["say"] if seg.get("say") else "")


def say_heads_up(seg):
    pos = "stand up" if seg["position"] == "standing" else "seated"
    return f"Coming up: {pos}, {TERRAIN[seg['terrain']].lower()}."


def tone(tmp, name, expr, seconds):
    path = pathlib.Path(tmp) / f"{name}.wav"
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc={expr}:s=44100:d={seconds}", str(path)],
                   check=True)
    return path


def build(ride, voice, tmp, bell, beep):
    segs = ride["segments"]
    for s in segs:
        if s["terrain"] not in TERRAIN or s["position"] not in ("seated", "standing"):
            die(f"{ride['key']}: unknown terrain/position in {s}")
        if not (1 <= s["resistance"] <= 100):
            die(f"{ride['key']}: resistance {s['resistance']} is outside the IC8's 1–100")
    starts, t = [], 0.0
    for s in segs:
        starts.append(t)
        t += s["min"] * 60
    total = t
    events = []                                      # (seconds, file)
    intro = tts(ride["intro"], voice)
    events.append((0.3, intro))
    first = tts(say_change(segs[0], None), voice)
    events.append((0.3 + duration(intro) + 0.6, first))
    for i in range(1, len(segs)):
        at, s, prev = starts[i], segs[i], segs[i - 1]
        events.append((at - HEADS_UP, tts(say_heads_up(s), voice)))
        for b in BEEPS:
            events.append((at - b, beep))
        events.append((at, bell))
        events.append((at + VOICE_AFTER_BELL, tts(say_change(s, prev), voice)))
    if ride.get("halfway"):
        half = total / 2
        if min(abs(half - st) for st in starts) < 20:
            die(f"{ride['key']}: halfway lands within 20 sec of a change — move a segment")
        events.append((half, tts(ride["halfway"], voice)))
    outro = tts(ride["outro"], voice)
    for b in BEEPS:
        events.append((total - b, beep))
    events.append((total, bell))
    events.append((total + VOICE_AFTER_BELL, outro))
    length = total + VOICE_AFTER_BELL + duration(outro) + 1.0

    # Nothing may overlap a spoken cue — a heads-up running into the bell would be unreadable.
    spoken = sorted((t0, t0 + duration(f)) for t0, f in events if f not in (bell, beep))
    for (a0, a1), (b0, _) in zip(spoken, spoken[1:]):
        if b0 < a1 + 0.2:
            die(f"{ride['key']}: two spoken cues overlap at {a0:.1f}s / {b0:.1f}s — shorten a line")

    inputs, chains = [], []
    for n, (t0, f) in enumerate(events):
        inputs += ["-i", str(f)]
        ms = int(round(t0 * 1000))
        chains.append(f"[{n}:a]aresample=44100,aformat=channel_layouts=mono,adelay={ms}|{ms}[e{n}]")
    mix = "".join(f"[e{n}]" for n in range(len(events)))
    graph = ";".join(chains) + f";{mix}amix=inputs={len(events)}:normalize=0:dropout_transition=0," \
            f"apad=whole_dur={length},atrim=0:{length},alimiter=limit=0.9[out]"
    out = OUT_DIR / f"{ride['key']}.mp3"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # VBR mono at 22.05 kHz: at 44.1 kHz an MP3 frame can't drop below 32 kbps,
    # so 45 min of mostly silence came to 11 MB; at 22.05 kHz silence costs
    # 8 kbps and the voice stays clear (it is speech, not music).
    subprocess.run([FFMPEG, "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]",
                    "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-q:a", "6", str(out)], check=True)
    v = hashlib.sha1(out.read_bytes()).hexdigest()[:8]
    print(f"  {ride['key']}: {out.relative_to(ROOT)} — {length / 60:.1f} min, {out.stat().st_size / 1e6:.1f} MB, {len(events)} cues")
    return {"file": f"audio/{ride['key']}.mp3", "v": v, "seconds": round(length, 2), "ride_seconds": total}


def main():
    src = json.loads(SRC.read_text())
    voice = src["voice"]
    with tempfile.TemporaryDirectory(prefix="spin-") as tmp:
        bell = tone(tmp, "bell", "0.5*sin(2*PI*988*t)*exp(-3*t)+0.18*sin(2*PI*1976*t)*exp(-5*t)+0.1*sin(2*PI*2727*t)*exp(-7*t)", 1.4)
        beep = tone(tmp, "beep", "0.35*sin(2*PI*1046*t)*exp(-14*t)", 0.18)
        out = {r["key"]: build(r, voice, tmp, bell, beep) for r in src["rides"]}
    OUT_JSON.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
