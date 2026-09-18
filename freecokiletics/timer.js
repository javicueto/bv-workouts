/* Timers and sound for the session runner.
 *
 * Sound is synthesised with the Web Audio API — no audio files to load or
 * cache. iOS only lets a page make sound after a user gesture, so Sound.unlock()
 * runs on every tap (see the bottom of this file), which also resumes the
 * context after iOS has suspended it. There is no keep-alive loop: nothing
 * can make a locked iPhone play a cue, which is what WakeLock is for. A cue
 * that falls due while the phone is locked or the app is behind another is
 * dropped — never queued to play later (Sound.tone).
 *
 * Cues the rest timer gives, as agreed:
 *   - one low "dong" at the halfway point
 *   - a double beep at 10 seconds left
 *   - three short beeps at 3, 2, 1 and a longer rising "go"
 * The session intro (3 · 2 · 1 · Go!) has its own, much softer pair.
 * Tabata (Javier, 18 Sep 2026) adds a light chime halfway through each work
 * interval (not the rest's low dong, so the two can't be confused) and a
 * boxing-style triple bell when the last round starts, in place of "go".
 *
 * Mute (Javier, 13 Sep 2026): a switch in the menu, remembered on this phone —
 * once off it stays off, session after session, until switched back on. It
 * silences every tone; vibration is not sound and still works.
 */
window.Sound = (function () {
  var ctx = null, master = null;
  var createdAt = 0, closeTimer = null;
  var MUTE_KEY = "freeco.sound";              // "off" = muted; nothing stored = on
  function muted() { try { return localStorage.getItem(MUTE_KEY) === "off"; } catch (e) { return false; } }
  function setMuted(on) {
    try { if (on) localStorage.setItem(MUTE_KEY, "off"); else localStorage.removeItem(MUTE_KEY); } catch (e) {}
  }

  /* Sound is only WANTED while a session is on screen (Runner.mount / unmount,
     and the tap that starts one). Outside it, and whenever sound is muted,
     unlock() does nothing — the app never touches the phone's audio. Leaving a
     session CLOSES the context (a moment later, so the "done" jingle can end)
     rather than suspending it: a suspended context kept every tone fired
     while it was suspended and played them all at once when the next session
     resumed it. */
  var wanted = false;
  function want(on) {
    wanted = !!on;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (!wanted && ctx) closeTimer = setTimeout(closeCtx, 1500);
  }
  function closeCtx() {
    closeTimer = null;
    var c = ctx; ctx = null; master = null;
    if (c) { try { c.close(); } catch (e) {} }
  }
  function createCtx() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    createdAt = Date.now();
    /* Every tone goes through one chain: a master level, a low-pass that
       takes the piercing top off the square / sawtooth cues (Javier, 16 Sep
       2026: "a super high sound" in headphones), and a limiter so that two
       cues landing together can never be louder than one. */
    master = ctx.createGain(); master.gain.value = 0.8;
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3000; lp.Q.value = 0.7;
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    master.connect(lp).connect(lim).connect(ctx.destination);
    // Playing a silent buffer inside the gesture is what grants audio on iOS.
    var b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource();
    src.buffer = b; src.connect(ctx.destination); src.start(0);
  }
  function resume() {
    if (!ctx || ctx.state === "running") return;
    try { ctx.resume().catch(function () {}); } catch (e) {}
  }

  /* MUST run inside a user gesture (a tap) — iPhone refuses to start audio at
     any other moment. It runs on every tap anywhere in the app (listeners at
     the bottom of this file). Locking the phone or switching app puts the
     context in "interrupted"; coming back, onVisible() below resumes it. A
     tap that finds it not running builds a NEW one on the spot (Javier,
     18 Sep 2026: sound came back only after a trip to the background): iOS
     can refuse to resume an interrupted context for as long as it likes, and
     a tap is the one moment a fresh one is always allowed. A context under a
     second old is left to finish starting. */
  function unlock() {
    if (!wanted || muted()) return;
    /* "ambient", NEVER "playback" (Javier, 14 Sep 2026): "playback" makes iOS
       treat the app as a music player, and only one plays at a time — opening
       Cokiletics stopped Spotify and YouTube. "ambient" mixes the cues over
       whatever is playing. The cost: iOS then obeys the ring/silent switch, so
       with the phone on silent the cues are silent (iPhone web apps cannot
       vibrate either), and iOS cuts ambient sound while the phone is locked.
       Music that keeps playing matters more. */
    try { if (navigator.audioSession && navigator.audioSession.type !== "ambient") navigator.audioSession.type = "ambient"; } catch (e) {}
    if (ctx && ctx.state !== "running" && Date.now() - createdAt > 1000) closeCtx();
    if (!ctx) createCtx();
    resume();
  }
  function onVisible() {
    if (document.visibilityState === "visible" && wanted && !muted()) resume();
  }
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);

  /* The pause screen's Test (Javier, 16 Sep 2026: "a button to restart the
     sounds in case they are not working"). It runs inside that tap, the one
     moment iPhone always lets audio start: throws the audio away, builds it
     fresh and plays one short beep, so the same tap repairs and proves it.
     Does nothing when muted or outside a session. */
  function repair() {
    if (!refresh()) return false;
    tone(880, 0.14, 0.45, "sine");
    return true;
  }
  /* Refresh (Javier, 18 Sep 2026: "the action of marking an exercise as done
     also triggers a sort of refresh for sound"). After a lock, or another
     app's audio, iOS can leave the audio interrupted — or claiming to run
     while making no sound, which no check can see. The session's key taps
     (Done, Start Tabata, Resume) rebuild it inside the tap, so the next cue
     is heard. Skipped when the audio was built under a second ago: the same
     tap's unlock() just did it. */
  function refresh() {
    if (!wanted || muted()) return false;
    if (ctx && ctx.state === "running" && Date.now() - createdAt < 1000) return true;
    closeCtx();
    unlock();
    return true;
  }
  /* Sound should be playing and can't: wanted, not muted, but the audio has
     not been running for over 2 seconds, so every cue is being dropped. The
     session's Pause button shows a dot while this is true (runner.js). */
  function stuck() {
    return wanted && !muted() && !!ctx && ctx.state !== "running" && Date.now() - createdAt > 2000;
  }

  function tone(freq, seconds, gain, type, when) {
    if (!ctx || muted()) return;             // every cue goes through here, so mute covers them all
    /* A cue fired while the context is not running is DROPPED, not queued.
       While the phone is locked or the app is in the background iOS freezes
       the audio clock: every tone scheduled then lands on the same instant
       and all play together, stacked, the moment the context runs again —
       the loud burst on coming back (Javier, 16 Sep 2026). A context made in
       the last two seconds is the exception: it is still starting up, and its
       first cue (the session's 3 · 2 · 1) must not be lost. Nothing fired
       while hidden can be heard anyway. */
    if (ctx.state !== "running" && Date.now() - createdAt > 2000) return;
    if (document.visibilityState === "hidden") return;
    var t = Math.max(when || 0, ctx.currentTime);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain == null ? 0.5 : gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + seconds + 0.02);
  }

  // A struck bell: a few inharmonic partials that ring and fade (the master
  // low-pass keeps the top soft in headphones).
  function bell(when) {
    tone(988, 0.9, 0.34, "sine", when);
    tone(988 * 2, 0.6, 0.12, "sine", when);
    tone(988 * 2.76, 0.4, 0.08, "sine", when);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  return {
    unlock: unlock,
    want: want,
    state: function () { return ctx ? ctx.state : "not started"; },
    repair: repair,
    refresh: refresh,
    stuck: stuck,
    muted: muted,
    toggleMuted: function () { setMuted(!muted()); return muted(); },
    // The session intro: soft sine blips, a fraction of the timer cues' volume
    // (Javier: "subtle"), and no vibration.
    introCount: function () { tone(880, 0.09, 0.12, "sine"); },
    introGo: function () {
      if (!ctx) return;
      tone(1175, 0.22, 0.14, "sine");
      tone(1568, 0.32, 0.11, "sine", ctx.currentTime + 0.1);
    },
    halfway: function () { tone(330, 0.9, 0.5, "sine"); vibrate(80); },
    midway: function () { tone(660, 0.22, 0.32, "sine"); vibrate(30); },             // Tabata: half a work interval gone
    lastRound: function () {                                                           // Tabata: the last round starts
      if (!ctx) return;
      for (var k = 0; k < 3; k++) bell(ctx.currentTime + k * 0.3);
      vibrate([90, 60, 90, 60, 90]);
    },
    tenLeft: function () {
      if (!ctx) return;
      tone(880, 0.12, 0.5, "square");
      tone(880, 0.12, 0.5, "square", ctx.currentTime + 0.18);
      vibrate([60, 60, 60]);
    },
    count: function () { tone(1046, 0.1, 0.5, "square"); vibrate(40); },        // 3, 2, 1
    go: function () {
      if (!ctx) return;
      tone(1318, 0.5, 0.6, "sawtooth");
      tone(1760, 0.45, 0.4, "sawtooth", ctx.currentTime + 0.12);
      vibrate([120, 40, 200]);
    },
    tick: function () { tone(660, 0.06, 0.25, "square"); },
    done: function () {
      if (!ctx) return;
      tone(784, 0.15, 0.5); tone(988, 0.15, 0.5, "sine", ctx.currentTime + 0.15);
      tone(1318, 0.4, 0.5, "sine", ctx.currentTime + 0.3);
      vibrate([80, 40, 80, 40, 160]);
    },
    // For tests only: whether a cue would be scheduled right now.
    _live: function () { return !!ctx && !muted() && (ctx.state === "running" || Date.now() - createdAt <= 2000) && document.visibilityState !== "hidden"; },
  };
})();

/* Countdown built on the wall clock, not on accumulated setTimeout drift, so
   it stays honest if the tab is throttled. onTick(secondsLeft) fires once per
   second; onDone when it hits zero. Cues fire from inside the tick.

   A phone that locks, or switches app, freezes timers entirely; the deadline
   does not move. On coming back the countdown re-reads the clock at once, so
   the display is right and — if the rest ended meanwhile — the end cue and
   onDone fire immediately instead of up to 100ms plus whatever iOS held back.
   No timer can make a locked iPhone play a sound; that is what WakeLock is
   for. Mid-way cues that were missed while frozen are skipped, not replayed. */
window.Countdown = function (totalSeconds, opts) {
  var o = opts || {};
  var end = Date.now() + totalSeconds * 1000;
  var left = totalSeconds;
  var fired = {};
  var handle = null;
  var self = this;

  function fire(name, fn) { if (!fired[name]) { fired[name] = true; fn && fn(); } }

  function tick() {
    if (handle) { clearTimeout(handle); handle = null; }
    var now = Date.now();
    var l = Math.max(0, Math.ceil((end - now) / 1000));
    if (l !== left) {
      left = l;
      if (o.cues !== false) {
        var half = Math.round(totalSeconds / 2);
        if (totalSeconds >= 20 && l === half) fire("half", Sound.halfway);
        if (totalSeconds > 13 && l === 10) fire("ten", Sound.tenLeft);
        if (l === 3 || l === 2 || l === 1) fire("c" + l, Sound.count);
      }
      o.onTick && o.onTick(l, totalSeconds);
      if (l === 0) { self.stop(); if (o.cues !== false) (o.endSound || Sound.go)(); o.onDone && o.onDone(); return; }
    }
    handle = setTimeout(tick, 100);
  }
  function onVisible() { if (document.visibilityState === "visible" && handle) tick(); }

  this.stop = function () {
    if (handle) { clearTimeout(handle); handle = null; }
    document.removeEventListener("visibilitychange", onVisible);
  };
  this.extend = function (seconds) { end += seconds * 1000; totalSeconds += seconds; fired = {}; };
  this.left = function () { return left; };
  /* Pause holds the time left; resume moves the deadline by however long the
     pause lasted, so a paused rest picks up exactly where it stopped (the
     session's Pause, runner.js, 15 Sep 2026). */
  var heldMs = null;
  this.pause = function () {
    if (heldMs !== null) return;
    heldMs = Math.max(0, end - Date.now());
    if (handle) { clearTimeout(handle); handle = null; }
  };
  this.resume = function () {
    if (heldMs === null) return;
    end = Date.now() + heldMs; heldMs = null;
    handle = setTimeout(tick, 100);
  };
  o.onTick && o.onTick(left, totalSeconds);
  document.addEventListener("visibilitychange", onVisible);
  handle = setTimeout(tick, 100);
};

/* Keep the screen on for the length of a session. If the phone locks, no timer
   can make a sound, so this is what makes the rest cues reliable in practice.
   Re-acquired when the app comes back to the foreground. */
window.WakeLock = (function () {
  var lock = null;
  var wanted = false;
  async function acquire() {
    if (!wanted || !("wakeLock" in navigator)) return;
    try { lock = await navigator.wakeLock.request("screen"); } catch (e) { lock = null; }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") acquire();
  });
  return {
    on:  function () { wanted = true; acquire(); },
    off: function () { wanted = false; if (lock) { lock.release().catch(function () {}); lock = null; } },
  };
})();

/* Every tap keeps audio alive DURING a session — see Sound.unlock, which does
   nothing outside one. iOS only lets audio start inside a tap, and the tap that
   starts a session (Start, Do it again, Resume) lands before the session screen
   exists, so that tap itself asks for sound. Capture phase, so it runs before
   any handler that might navigate away. */
["touchend", "click", "keydown"].forEach(function (type) {
  document.addEventListener(type, function (e) {
    var t = e.target && e.target.closest ? e.target.closest('a[href^="#/run/"], #resume-go') : null;
    if (t) Sound.want(true);
    Sound.unlock();
  }, { capture: true, passive: true });
});
