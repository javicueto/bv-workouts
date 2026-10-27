/* Cokiletics — spin rides (Javier, 25 Oct 2026) for his home Schwinn IC8.
 *
 * A ride is a list of parts — seated or standing, flat or climb, an IC8
 * resistance level (1–100), a cadence range and a heart-rate zone — written in
 * data/spin.json. scripts/build_spin.py turns each ride into ONE audio track:
 * the coach's voice (ElevenLabs) at every change, a bell on the change, three
 * beeps before it, a heads-up ten seconds earlier. That track is the ride's
 * clock: the screen reads the track's time, so the cues can never drift from
 * the screen, and the screen catches up the moment the app comes back.
 *
 * Sound, chosen at each start (Javier's choice):
 *   background  audio session "playback": iOS keeps the track playing with the
 *               WHOOP app in front or the phone locked (lock-screen play/pause
 *               through Media Session). It pauses Spotify or YouTube.
 *   mix         audio session "ambient", as in every other session: music keeps
 *               playing, but iOS silences the app when it is not on screen.
 *
 * The track is kept on the phone (cache "freeco-media", which sw.js never
 * deletes) and played from a blob, so a ride works with no signal and no
 * range-request trouble in the service worker. Progress is saved every few
 * seconds; reopening the ride offers to resume. The workout is written once,
 * at the end, as a cardio day (kind "cardio"), so it scores and shows like one.
 */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;
  var MEDIA = "freeco-media";                // same name in sw.js (kept across CACHE bumps)
  var SAVE = "freeco.ride", MODE = "freeco.rideMode";
  var TERRAIN = { "warm-up": "Warm-up", "flat": "Flat road", "climb": "Climb", "recovery": "Recovery",
                  "fast flat": "Fast flat", "cool-down": "Cool-down" };

  // ------------------------------------------------------------ the track
  function trackUrl(s) { var a = s.ride.audio; return new URL(a.file + "?v=" + a.v, location.href).href; }
  async function trackBlob(s) {
    var url = trackUrl(s), cache = "caches" in window ? await caches.open(MEDIA) : null;
    var hit = cache ? await cache.match(url) : null;
    if (hit) return hit.blob();
    var res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("ride track " + res.status);
    if (cache) { try { await cache.put(url, res.clone()); } catch (e) { /* full: it still plays */ } }
    return res.blob();
  }
  /* Offline by default (offline.js): every ride's current track is kept on the
     phone, and an old version of a track is dropped. */
  async function cacheTracks() {
    if (!("caches" in window) || !navigator.onLine) return;
    var cache = await caches.open(MEDIA), want = {};
    (A.P.spin || []).forEach(function (s) { want[trackUrl(s)] = true; });
    (await cache.keys()).forEach(function (req) { if (!want[req.url]) cache.delete(req); });
    for (var u in want) {
      if (await cache.match(u)) continue;
      try { var r = await fetch(u, { cache: "no-cache" }); if (r.ok) await cache.put(u, r); } catch (e) {}
    }
  }

  // ------------------------------------------------------------ helpers
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  function segAt(s, t) {
    var segs = s.ride.segments;
    for (var i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start) return i;
    return 0;
  }
  function posWord(seg) { return seg.position === "standing" ? "Standing" : "Seated"; }
  function rpm(seg) { return seg.rpm[0] + "–" + seg.rpm[1]; }
  /* "Zone 2 · 138–150 bpm" with the rider's own WHOOP zones, kept on their
     private plan row (db/013 hr_zones — health data, never in the repo);
     just "Zone 2" for someone who has not set them. */
  function bpm(z) {
    var hz = S.PLAN && S.PLAN.hr_zones && S.PLAN.hr_zones[String(z)];
    return hz && hz.length === 2 ? hz[0] + "–" + hz[1] + " bpm" : "";
  }
  function zoneText(z) { var b = bpm(z); return "Zone " + z + (b ? " · " + b : ""); }
  function partLine(seg) {
    return posWord(seg) + " · " + TERRAIN[seg.terrain] + " · resistance " + seg.resistance + " · " + rpm(seg) + " RPM";
  }

  /* The ride's shape: one bar per part, as wide as it is long and as tall as
     its resistance; standing parts in the accent. The list under it (or the
     player's big numbers) carries every value, so the chart is the overview,
     not the only place a number lives. */
  function profileHTML(s) {
    var segs = s.ride.segments, max = Math.max.apply(null, segs.map(function (g) { return g.resistance; }));
    return '<div class="ride__profile" aria-hidden="true">' + segs.map(function (g, i) {
      return '<i class="' + (g.position === "standing" ? "ride__bar is-standing" : "ride__bar") + '" data-i="' + i + '" style="flex-grow:' +
        g.seconds + ";height:" + Math.round(28 + 72 * g.resistance / max) + '%"></i>';
    }).join("") + '<span class="ride__marker" id="rmark"></span></div>';
  }
  /* The ride on its own screen (#/view/<key>, session.js draw): the shape, then
     every part with when it starts. */
  A.spinSectionsHTML = function (s) {
    return '<section class="vsec"><h2 class="vsec__h">The ride</h2>' +
      '<p class="dim">Schwinn IC8: resistance is the console’s level (1–100), cadence in RPM. Stay in zone ' + s.ride.zone +
        (bpm(s.ride.zone) ? " (" + bpm(s.ride.zone) + ")" : "") +
        ' — if you can’t talk in full sentences, drop the resistance by five.</p>' +
      profileHTML(s) +
      '<ol class="ride-list">' + s.ride.segments.map(function (g) {
        return "<li><span class=\"ride-list__t\">" + mmss(g.start) + "</span>" +
          '<span class="grow"><b>' + posWord(g) + "</b> · " + esc(TERRAIN[g.terrain]) +
            '<span class="ride-list__sub">Resistance ' + g.resistance + " · " + rpm(g) + " RPM · " + zoneText(g.zone).toLowerCase() + "</span></span>" +
          '<span class="faint">' + A.dur(g.seconds) + "</span></li>";
      }).join("") + "</ol></section>";
  };

  // ------------------------------------------------------------ saved progress
  function readSaved(key) {
    try {
      var x = JSON.parse(localStorage.getItem(SAVE) || "null");
      return x && x.key === key && Date.now() - x.at < 6 * 3600 * 1000 && x.t > 5 ? x : null;
    } catch (e) { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(SAVE); } catch (e) {} }
  function persist() {
    if (!cur || cur.finished) return;
    var t = cur.audio.currentTime || 0;
    if (t < 5) return;
    try {
      localStorage.setItem(SAVE, JSON.stringify({ key: cur.s.key, t: t, at: Date.now(), startedAt: cur.startedAt,
                                                  workoutId: cur.workoutId, mode: cur.mode }));
    } catch (e) {}
  }
  function readMode() { try { return localStorage.getItem(MODE) === "mix" ? "mix" : "background"; } catch (e) { return "background"; } }
  function setSession(type) { Sound.setSession(type); }      // timer.js owns the audio category

  // ------------------------------------------------------------ before the start
  var pending = null;      // { audio, url } loaded but not started
  var cur = null;          // the ride playing

  V.renderRide = async function (key) {
    var t = A.ticket();
    var s = A.sessionByKey(key);
    if (!s || !s.spin) { location.hash = "#/cardio"; return; }
    var saved = readSaved(key), mode = saved ? saved.mode : readMode();
    function modeOption(value, title, body) {
      return '<label class="ride-mode"><input type="radio" name="rmode" value="' + value + '"' + (mode === value ? " checked" : "") + ">" +
        '<span class="ride-mode__text"><b>' + title + "</b><span>" + body + "</span></span></label>";
    }
    app.innerHTML = topbar(null, "#/view/" + key) +
      '<div class="stack">' +
        '<div class="eyebrow">' + esc(s.wod.format) + "</div><h1>" + esc(s.title) + "</h1>" +
        profileHTML(s) +
        '<fieldset class="ride-modes"><legend class="eyebrow">Sound</legend>' +
          modeOption("background", "Keep going in the background", "Works with the WHOOP app open or the phone locked. Pauses your music.") +
          modeOption("mix", "Mix with my music", "Your music keeps playing. Keep Cokiletics on screen.") +
        "</fieldset>" +
        '<p class="dim ride-load" id="rload" role="status">Loading the ride…</p>' +
        (saved ? '<button class="btn btn--primary btn--big btn--block" type="button" id="rresume" disabled>Resume at ' + mmss(saved.t) + "</button>" : "") +
        '<button class="btn ' + (saved ? "btn--ghost" : "btn--primary btn--big") + ' btn--block" type="button" id="rstart" disabled>' +
          (saved ? "Start from the beginning" : "Start ride") + "</button>" +
      "</div>";
    var blob;
    try { blob = await trackBlob(s); }
    catch (e) {
      if (A.stale(t)) return;
      document.getElementById("rload").textContent = navigator.onLine
        ? "Couldn’t load the ride. Go back and try again."
        : "No signal, and this ride isn’t saved on the phone yet. It is saved the first time it loads with a signal.";
      return;
    }
    if (A.stale(t)) return;
    var url = URL.createObjectURL(blob), audio = new Audio();
    audio.preload = "auto"; audio.src = url;
    pending = { audio: audio, url: url };
    document.getElementById("rload").hidden = true;
    var start = document.getElementById("rstart"), resume = document.getElementById("rresume");
    function chosen() { var r = app.querySelector('input[name="rmode"]:checked'); return r ? r.value : "background"; }
    start.disabled = false;
    // play() runs INSIDE the tap — the one moment iOS lets sound start.
    start.addEventListener("click", function () { begin(s, { mode: chosen(), at: 0 }); });
    if (resume) {
      resume.disabled = false;
      resume.addEventListener("click", function () {
        begin(s, { mode: chosen(), at: saved.t, startedAt: saved.startedAt, workoutId: saved.workoutId });
      });
    }
  };

  // ------------------------------------------------------------ the ride
  function begin(s, o) {
    if (!pending) return;
    var audio = pending.audio, url = pending.url; pending = null;
    setSession(o.mode === "background" ? "playback" : "ambient");
    try { localStorage.setItem(MODE, o.mode); } catch (e) {}
    if (o.at) { try { audio.currentTime = o.at; } catch (e) {} }
    var playing = audio.play();
    cur = { s: s, audio: audio, url: url, mode: o.mode, lastIx: -1, finished: false,
            startedAt: o.startedAt || new Date().toISOString(), workoutId: o.workoutId || Store.uuid() };
    drawPlayer();
    mediaSession(s);
    WakeLock.on();
    audio.addEventListener("ended", done);
    audio.addEventListener("play", paint);
    audio.addEventListener("pause", function () { persist(); paint(); });
    cur.tick = setInterval(paint, 250);
    cur.save = setInterval(persist, 5000);
    cur.onVis = function () { if (document.visibilityState === "visible") paint(); else persist(); };
    document.addEventListener("visibilitychange", cur.onVis);
    if (playing && playing.catch) playing.catch(function () { paint(); });   // refused: shows Resume
    paint();
  }

  function drawPlayer() {
    var s = cur.s, R = 44, C = 2 * Math.PI * R;
    app.innerHTML = '<div class="ride" id="ride">' +
      '<div class="row ride__head">' +
        '<button class="btn btn--ghost btn--pause" type="button" id="rpause"></button>' +
        '<div class="grow ride__title"><div class="eyebrow">' + esc(s.title) + '</div><div class="dim" id="rpart"></div></div>' +
        '<span class="head-clock" id="rclock" role="timer" aria-label="Time in this ride">0:00</span>' +
      "</div>" +
      profileHTML(s) +
      '<section class="ride__now">' +
        '<div class="ride__pos" id="rpos"></div>' +
        '<div class="ride__terrain" id="rter"></div>' +
        '<div class="ride__nums">' +
          '<div class="ride__num"><span class="ride__k">Resistance</span><b id="rres"></b></div>' +
          '<div class="ride__num"><span class="ride__k">Cadence</span><b id="rrpm"></b><small>RPM</small></div>' +
        "</div>" +
        '<div class="ride__zone" id="rzone"></div>' +
        '<div class="rest__ring ride__ring"><svg viewBox="0 0 100 100" aria-hidden="true">' +
          '<circle class="track" cx="50" cy="50" r="' + R + '"/>' +
          '<circle class="arc" id="rarc" cx="50" cy="50" r="' + R + '" stroke-dasharray="' + C + '" stroke-dashoffset="0"/></svg>' +
          '<div class="rest__time" id="rleft" role="timer" aria-label="Time left in this part"></div></div>' +
      "</section>" +
      '<p class="ride__next" id="rnext"></p>' +
      '<p class="ride__note faint">' + (cur.mode === "background"
        ? "Background sound: keeps going with WHOOP open or the phone locked."
        : "Mixing with your music: keep Cokiletics on screen.") + "</p>" +
      '<button class="btn btn--quiet btn--block" type="button" id="rend">End ride</button>' +
    "</div>";
    cur.C = C;
    document.getElementById("rpause").addEventListener("click", function () {
      if (!cur) return;
      if (cur.audio.paused) cur.audio.play().catch(function () {}); else cur.audio.pause();
    });
    document.getElementById("rend").addEventListener("click", function () {
      if (!cur) return;
      UI.confirm({ title: "End the ride now?", body: "It’s saved with the time you’ve ridden so far.",
                   confirm: "End and save", cancel: "Keep riding" })
        .then(function (ok) { if (ok && cur) save(); });
    });
  }

  function paint() {
    if (!cur) return;
    var s = cur.s, t = cur.audio.currentTime || 0, rideT = Math.min(t, s.ride.seconds);
    if (cur.finished) return;
    if (t >= s.ride.seconds && cur.audio.ended) { done(); return; }
    var ix = segAt(s, rideT), seg = s.ride.segments[ix], next = s.ride.segments[ix + 1];
    var left = seg.start + seg.seconds - rideT;
    var el = function (id) { return document.getElementById(id); };
    if (!el("ride")) return;
    if (ix !== cur.lastIx) {
      el("ride").classList.toggle("is-standing", seg.position === "standing");
      el("rpos").textContent = posWord(seg);
      el("rter").textContent = TERRAIN[seg.terrain];
      el("rres").textContent = seg.resistance;
      el("rrpm").textContent = rpm(seg);
      el("rzone").textContent = zoneText(seg.zone);
      el("rpart").textContent = "Part " + (ix + 1) + " of " + s.ride.segments.length;
      app.querySelectorAll(".ride__bar").forEach(function (b) {
        var i = +b.getAttribute("data-i");
        b.classList.toggle("is-done", i < ix); b.classList.toggle("is-now", i === ix);
      });
      if (cur.lastIx !== -1) { UI.bump(el("rres")); UI.bump(el("rpos")); }
      UI.announce(partLine(seg));
      cur.lastIx = ix;
    }
    el("rleft").textContent = mmss(left);
    el("rarc").style.strokeDashoffset = String(cur.C * (1 - left / seg.seconds));
    el("rclock").textContent = mmss(rideT);
    el("rmark").style.left = (100 * rideT / s.ride.seconds) + "%";
    el("rnext").textContent = next ? "Next in " + mmss(left) + " · " + posWord(next) + " · " + TERRAIN[next.terrain] +
      " · " + next.resistance + " · " + rpm(next) + " RPM" : "Last part — cool-down to the end.";
    var paused = cur.audio.paused;
    var pb = el("rpause");
    var want = paused ? "resume" : "pause";
    if (pb.getAttribute("data-state") !== want) {
      pb.setAttribute("data-state", want);
      pb.innerHTML = (paused ? ICONS.play : ICONS.pause) + '<span class="pause-label">' + (paused ? "Resume" : "Pause") + "</span>";
    }
    if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: cur.audio.duration || s.ride.audio.seconds, position: Math.min(t, cur.audio.duration || t), playbackRate: 1 }); } catch (e) {}
    }
  }

  function mediaSession(s) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: "Cokiletics", album: s.wod.format,
        artwork: [{ src: new URL("icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }] });
      navigator.mediaSession.setActionHandler("play", function () { if (cur) cur.audio.play().catch(function () {}); });
      navigator.mediaSession.setActionHandler("pause", function () { if (cur) cur.audio.pause(); });
    } catch (e) {}
  }
  function clearMediaSession() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    } catch (e) {}
  }

  /* The track has reached its end (possibly while the app was behind another):
     the ride is done. One tap saves it — the same as a session's Save & finish. */
  function done() {
    if (!cur || cur.finished) return;
    var s = cur.s;
    clearInterval(cur.tick);
    app.innerHTML = '<div class="ride ride--done"><section class="rest">' +
      '<div class="eyebrow">Ride done</div><h1>' + esc(s.title) + "</h1>" +
      '<p class="dim">' + Math.round(s.ride.seconds / 60) + " min · " + zoneText(s.ride.zone).toLowerCase() + "</p>" +
      '<button class="btn btn--primary btn--big btn--block" type="button" id="rsave">Save & finish</button>' +
      "</section></div>";
    document.getElementById("rsave").addEventListener("click", save);
  }

  function save() {
    if (!cur || cur.finished) return;
    var s = cur.s, dur = Math.round(Math.min(cur.audio.currentTime || 0, s.ride.seconds));
    Store.saveWorkout({ id: cur.workoutId, user_id: S.me.id, session_key: s.key, block: null, kind: "cardio",
      week_start: A.cardioWeek(new Date(cur.startedAt)), started_at: cur.startedAt,
      finished_at: new Date().toISOString(), duration_seconds: dur });
    var result = { finished: true, duration: dur, sets: 0, workoutId: cur.workoutId, key: s.key };
    cur.finished = true;
    clearSaved();
    stop();
    location.hash = "#/";
    V.celebrate(result);
  }

  /* Leaving the ride's screen inside the app (Back, another screen) stops it
     and keeps the progress for "Resume at …". Leaving the APP does not come
     through here — that is the background case, and the track keeps playing. */
  /* Let go of an <audio> completely: paused is not enough — a loaded
     element can keep iOS treating the page as a music player. */
  function release(audio) {
    try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (e) {}
  }
  function stop() {
    if (pending) { release(pending.audio); URL.revokeObjectURL(pending.url); pending = null; }
    if (!cur) { setSession("ambient"); return; }
    persist();
    clearInterval(cur.tick); clearInterval(cur.save);
    document.removeEventListener("visibilitychange", cur.onVis);
    release(cur.audio);
    URL.revokeObjectURL(cur.url);
    clearMediaSession();
    WakeLock.off();
    setSession("ambient");                   // back to the app's default: never stop the user's music
    cur = null;
  }

  window.Ride = { stop: stop, cacheTracks: cacheTracks, active: function () { return !!cur; } };
})();
