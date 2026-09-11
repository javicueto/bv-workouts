/* Timers and sound for the session runner.
 *
 * Sound is synthesised with the Web Audio API — no audio files to load or
 * cache. iOS only lets a page make sound after a user gesture, so Sound.unlock()
 * must be called from the tap that starts the session; it also keeps a short
 * silent loop alive so the context is not suspended mid-rest.
 *
 * Cues the rest timer gives, as agreed:
 *   - one low "dong" at the halfway point
 *   - a double beep at 10 seconds left
 *   - three short beeps at 3, 2, 1 and a longer rising "go"
 */
window.Sound = (function () {
  var ctx = null;
  var unlocked = false;

  function unlock() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    if (!unlocked) {
      // A near-silent tick from inside the gesture is what grants audio on iOS.
      tone(440, 0.01, 0.0001);
      unlocked = true;
    }
  }

  function tone(freq, seconds, gain, type, when) {
    if (!ctx) return;
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain == null ? 0.5 : gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + seconds + 0.02);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  return {
    unlock: unlock,
    halfway: function () { tone(330, 0.9, 0.5, "sine"); vibrate(80); },
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
  };
})();

/* Countdown built on the wall clock, not on accumulated setTimeout drift, so
   it stays honest if the tab is throttled. onTick(secondsLeft) fires once per
   second; onDone when it hits zero. Cues fire from inside the tick. */
window.Countdown = function (totalSeconds, opts) {
  var o = opts || {};
  var end = Date.now() + totalSeconds * 1000;
  var left = totalSeconds;
  var fired = {};
  var handle = null;
  var self = this;

  function fire(name, fn) { if (!fired[name]) { fired[name] = true; fn && fn(); } }

  function tick() {
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
      if (l === 0) { self.stop(); if (o.cues !== false) Sound.go(); o.onDone && o.onDone(); return; }
    }
    handle = setTimeout(tick, 100);
  }

  this.stop = function () { if (handle) { clearTimeout(handle); handle = null; } };
  this.extend = function (seconds) { end += seconds * 1000; totalSeconds += seconds; fired = {}; };
  this.left = function () { return left; };
  o.onTick && o.onTick(left, totalSeconds);
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
