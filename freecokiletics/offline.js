/* Cokiletics — offline by default (Javier, 16 Sep 2026: option A, automatic).
 *
 * Once the app is open and signed in, two things are saved on this phone in
 * the background, with no button to press:
 *
 *   1. Every exercise preview (~35 MB, once) into the "freeco-previews" cache,
 *      which app updates never clear (sw.js keeps it apart from the app's own
 *      versioned cache). Each preview is asked for as previews/<id>.webp?v=
 *      <content hash> (App.previewUrl; build_freeco.py preview_v), so a rebuilt
 *      preview is a new address: it downloads again and its old copy is
 *      deleted, and nothing unchanged downloads twice.
 *   2. What the server last said about History and the latest finished
 *      workouts (Store.warmOffline). Home keeps its own copy of done weeks on
 *      every visit.
 *
 * iPhone can't tell Wi-Fi from mobile data, so the download simply runs, three
 * files at a time. It stops when the network goes and carries on from where it
 * was when it comes back. YouTube videos stay online-only. The menu shows the
 * progress (Offline.label, in core.js menuPanel).
 */
window.Offline = (function () {
  "use strict";
  var PREVIEWS = "freeco-previews";            // the same name as in sw.js
  var total = 0, saved = 0, busy = false, lastComplete = 0;

  function urls() {
    var out = [];
    Object.keys(window.PROGRAMME.exercises).forEach(function (id) {
      var u = window.App.previewUrl(id);
      if (u) out.push(new URL(u, location.href).href);
    });
    return out;
  }

  function label() {
    if (!total) return "";
    if (saved >= total) return "Ready offline · all " + total + " previews saved";
    return (navigator.onLine ? "Saving for offline · " : "Offline · ") + saved + " of " + total + " previews saved";
  }
  function paint() {
    var el = document.getElementById("offline-note");
    if (!el) return;
    var t = label();
    el.textContent = t;
    el.hidden = !t;
  }

  async function previews() {
    if (!("caches" in window)) return;
    var list = urls(), want = {}, have = {};
    list.forEach(function (u) { want[u] = true; });
    total = list.length;
    var cache = await caches.open(PREVIEWS);
    var keys = await cache.keys();
    // Old versions of a preview, and previews the programme no longer has.
    await Promise.all(keys.map(function (req) {
      if (want[req.url]) { have[req.url] = true; return null; }
      return cache.delete(req);
    }));
    var todo = list.filter(function (u) { return !have[u]; });
    saved = total - todo.length;
    paint();
    var next = 0;
    async function worker() {
      while (next < todo.length && navigator.onLine) {
        var u = todo[next++];
        try {
          var res = await fetch(u, { cache: "no-cache" });
          if (res.ok) { await cache.put(u, res); saved++; paint(); }
        } catch (e) { /* this one is picked up by the next run */ }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }

  /* app.js calls this on every screen change. It waits a few seconds so the
     screen just opened draws first, and once everything is saved it checks
     again at most every ten minutes. */
  function start() {
    if (busy || !window.App || !window.App.S.me) return;
    if (total && saved >= total && Date.now() - lastComplete < 10 * 60000) return;
    busy = true;
    setTimeout(async function () {
      try {
        // Ask the phone not to clear this storage when space runs low.
        if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) {} }
        if (navigator.onLine) { try { await Store.warmOffline(window.App.S.me.id); } catch (e) {} }
        await previews();
        if (total && saved >= total) lastComplete = Date.now();
      } catch (e) {
        /* nothing saved this time; the next screen change tries again */
      } finally { busy = false; paint(); }
    }, 3000);
  }
  window.addEventListener("online", start);
  window.addEventListener("offline", paint);

  return { start: start, label: label, status: function () { return { saved: saved, total: total }; } };
})();
