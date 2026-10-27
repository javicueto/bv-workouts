/* Cokiletics — Sound check (Javier, 27 Oct 2026: "Spotify stops as soon as
 * I click start a workout", in the home-screen app only, even with the exact
 * pre-spin version). The Mac cannot see inside the home-screen app, so the
 * app measures itself: each button does ONE of the things a workout start
 * does, separately, and logs what the phone reports after it. With Spotify
 * playing, tap one step at a time and mark whether the music kept playing;
 * "Copy the log" gives the whole run as text to send back.
 *
 * Reached from the menu (☰ → Sound check) at #/soundcheck. It never touches
 * the app's own Sound engine (timer.js): it builds its own AudioContext, so a
 * test can't leave a workout's sound in a strange state, and leaving the
 * screen closes whatever it opened. */
(function () {
  "use strict";
  var A = window.App, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;
  var ctx = null, audioEl = null, lock = null, lines = [];

  function stamp() { var d = new Date(); return A.hhmm(d) + ":" + String(d.getSeconds()).padStart(2, "0"); }
  function sessionType() { var s = navigator.audioSession; return s ? s.type : "not available"; }
  function state() { return "audio mode " + sessionType() + " · engine " + (ctx ? ctx.state : "none"); }
  function log(text) {
    lines.push(stamp() + "  " + text);
    var el = document.getElementById("sclog");
    if (el) { el.textContent = lines.join("\n"); el.scrollTop = el.scrollHeight; }
  }
  function standalone() {
    return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  async function version() {
    try { return (await caches.keys()).filter(function (k) { return /^freeco-v\d+$/.test(k); }).join(", ") || "unknown"; }
    catch (e) { return "unknown"; }
  }
  // A short 880 Hz beep as a WAV file, for the <audio> element test.
  function beepWav() {
    var rate = 22050, n = Math.round(rate * 0.15), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 880 * i / rate) * 0.3 * 32767 * Math.exp(-6 * i / n), true);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  /* One button = one step. Each runs inside its own tap (iPhone only lets
     sound start inside one) and logs what the phone says afterwards. */
  var STEPS = [
    { id: "ambient", label: "1 · Ask to mix (ambient)", run: function () {
        if (!navigator.audioSession) return "this phone has no audio mode setting";
        navigator.audioSession.type = "ambient"; return "asked for ambient";
      } },
    { id: "engine", label: "2 · Build the sound engine", run: function () {
        if (ctx) return "already built";
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        return "built, nothing played yet";
      } },
    { id: "silent", label: "3 · Play silence (as a workout start does)", run: function () {
        if (!ctx) return "build the engine first (2)";
        var b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource();
        src.buffer = b; src.connect(ctx.destination); src.start(0);
        return "silent buffer started";
      } },
    { id: "resume", label: "4 · Resume the engine", run: function () {
        if (!ctx) return "build the engine first (2)";
        ctx.resume().then(function () { log("   resume finished · " + state()); }, function (e) { log("   resume refused: " + e.message); });
        return "resume asked";
      } },
    { id: "beep", label: "5 · Play a beep", run: function () {
        if (!ctx) return "build the engine first (2)";
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
        o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.2);
        return "beep played";
      } },
    { id: "close", label: "6 · Close the sound engine", run: function () {
        if (!ctx) return "no engine";
        var c = ctx; ctx = null; c.close().catch(function () {});
        return "engine closed";
      } },
    { id: "auto", label: "7 · Set audio mode back to auto", run: function () {
        if (!navigator.audioSession) return "this phone has no audio mode setting";
        navigator.audioSession.type = "auto"; return "asked for auto";
      } },
    { id: "element", label: "8 · Beep through an audio file instead", run: function () {
        if (!audioEl) { audioEl = new Audio(beepWav()); }
        audioEl.currentTime = 0;
        audioEl.play().then(function () { log("   file playing · " + state()); }, function (e) { log("   file refused: " + e.message); });
        return "file asked to play";
      } },
    { id: "wake", label: "9 · Keep the screen on", run: function () {
        if (!("wakeLock" in navigator)) return "this phone can't keep the screen on from here";
        navigator.wakeLock.request("screen").then(function (l) { lock = l; log("   screen stays on · " + state()); },
          function (e) { log("   screen-on refused: " + e.message); });
        return "screen-on asked";
      } },
  ];

  function cleanup() {
    if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
    if (audioEl) { try { audioEl.pause(); URL.revokeObjectURL(audioEl.src); audioEl.removeAttribute("src"); audioEl.load(); } catch (e) {} audioEl = null; }
    if (lock) { try { lock.release(); } catch (e) {} lock = null; }
  }
  window.addEventListener("hashchange", function () { if (location.hash !== "#/soundcheck") cleanup(); });

  V.renderSoundcheck = async function () {
    var t = A.ticket();
    Sound.want(false);                     // the app's own engine stays out of the test
    var ver = await version();
    if (A.stale(t)) return;
    cleanup(); lines = [];
    app.innerHTML = topbar("Sound check", "#/") +
      '<div class="stack">' +
        '<p class="dim">Play Spotify first. Then tap the steps one at a time, in order, and after each one tap whether Spotify is still playing. When Spotify stops, that step is the answer: copy the log and send it.</p>' +
        '<div class="scheck__steps">' + STEPS.map(function (s) {
          return '<button class="btn btn--block scheck__step" type="button" data-step="' + s.id + '">' + esc(s.label) + "</button>";
        }).join("") + "</div>" +
        '<div class="scheck__mark">' +
          '<button class="btn btn--block" type="button" data-mark="playing">' + ICONS.check + "Spotify playing</button>" +
          '<button class="btn btn--block" type="button" data-mark="stopped">' + ICONS.xmark + "Spotify stopped</button>" +
        "</div>" +
        '<pre class="scheck__log" id="sclog" aria-live="polite"></pre>' +
        '<button class="btn btn--primary btn--block" type="button" id="sccopy">Copy the log</button>' +
      "</div>";
    log("Sound check · app " + ver + " · " + (standalone() ? "home-screen app" : "browser tab"));
    log("   " + navigator.userAgent);
    log("   start · " + state());
    app.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = STEPS.find(function (x) { return x.id === b.dataset.step; }), out;
        try { out = s.run(); } catch (e) { out = "error: " + e.message; }
        log(s.label + " → " + out + " · " + state());
      });
    });
    app.querySelectorAll("[data-mark]").forEach(function (b) {
      b.addEventListener("click", function () { log(b.dataset.mark === "playing" ? "   ✓ Spotify still playing" : "   ✗ SPOTIFY STOPPED"); });
    });
    document.getElementById("sccopy").addEventListener("click", function () {
      var text = lines.join("\n");
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(function () { UI.toast("Log copied"); }, function () { UI.toast("Couldn’t copy: take a screenshot instead"); });
    });
    A.syncBadge();
  };
})();
