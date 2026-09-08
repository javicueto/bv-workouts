#!/usr/bin/env python3
"""Receives the TrueCoach export straight from the browser tab.

Why this exists: the export used to trigger a browser download that then had to
be moved out of ~/Downloads by hand. This listens on localhost instead, so
scripts/export_truecoach.js can POST the payload directly into data/ and the
refresh runs without touching Finder.

http://localhost counts as a "potentially trustworthy" origin, so Chrome allows
the fetch from the https page; the CORS and Private Network headers below are
what make that preflight pass.

Run it, then run the export in the tab:
    python3 scripts/receive_export.py
Exits on its own once the export lands (or after --timeout seconds).
"""
import argparse
import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "truecoach_export.json"
PORT = 8787

received = False


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        # Chrome refuses a public https page -> localhost request without this.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        global received
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            self.send_response(400)
            self._cors()
            self.end_headers()
            print(f"rejected: not JSON ({exc})", flush=True)
            return
        # Refuse to overwrite a good export with something empty or malformed.
        if not data.get("workouts") or not data.get("exercises"):
            self.send_response(400)
            self._cors()
            self.end_headers()
            print("rejected: payload has no workouts/exercises", flush=True)
            return

        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"ok")
        self.wfile.flush()
        received = True
        print(f"wrote {OUT.relative_to(ROOT)} — "
              f"{data['workout_count']} workouts, {data['exercise_count']} exercises", flush=True)

    def log_message(self, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=int, default=180, help="seconds to wait")
    args = ap.parse_args()

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    server.timeout = 1
    print(f"listening on http://127.0.0.1:{PORT} — run the export in the TrueCoach tab", flush=True)
    waited = 0
    while not received and waited < args.timeout:
        server.handle_request()
        waited += 1
    if not received:
        sys.exit("timed out waiting for the export")


if __name__ == "__main__":
    main()
