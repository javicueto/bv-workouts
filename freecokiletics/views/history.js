/* Cokiletics — History: every workout, newest first. */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;

  V.renderHistory = async function renderHistory() {
    var t = A.ticket();
    app.innerHTML = topbar("History", "#/") + '<p class="dim">Loading…</p>';
    var rows;
    try { rows = await Store.history(S.me.id, 120); }
    catch (e) {
      if (A.stale(t)) return;
      app.innerHTML = topbar("History", "#/") + A.loadError(e);
      A.bindRetry(renderHistory);
      return;
    }
    if (A.stale(t)) return;
    // Opened and left without logging anything: noise from before sessions
    // were only saved on the first logged round. Offered for one-tap removal.
    var empty = rows.filter(function (w) { return !w.finished_at && !w.set_count; });
    var real = rows.filter(function (w) { return empty.indexOf(w) === -1; });
    app.innerHTML = topbar("History", "#/") +
      (empty.length
        ? '<div class="card stack"><p><b>' + empty.length + " empty session" + (empty.length > 1 ? "s" : "") + "</b> — opened but nothing logged.</p>" +
          '<button class="btn btn--ghost btn--block" id="clr">Remove ' + (empty.length > 1 ? "them" : "it") + "</button></div>"
        : "") +
      (real.length ? '<div class="list" style="margin-top:var(--space-4)">' + real.map(function (w) {
        var d = new Date(w.started_at);
        var detail = w.finished_at
          // A hand-logged workout can still have sets — weights typed in
          // afterwards — so the count shows whenever there is one.
          ? (w.duration_seconds ? Math.round(w.duration_seconds / 60) + " min" : "") +
            (w.logged_manually ? " · logged by hand" : "") +
            (w.set_count || !w.logged_manually ? " · " + w.set_count + " sets" : "")
          : "stopped early · " + w.set_count + " sets";
        return '<a class="card card--tap" href="#/h/' + esc(w.id) + '"><div class="row"><div class="grow"><h2>Workout ' + esc(w.session_key) + "</h2>" +
          '<p class="dim">' + d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + " · " + detail + "</p></div>" +
          (w.finished_at ? '<span class="badge badge--good">done</span>' : '<span class="badge">partial</span>') + "</div></a>";
      }).join("") + "</div>" : (empty.length ? "" : '<p class="dim">Nothing logged yet.</p>'));

    var clr = document.getElementById("clr");
    if (clr) clr.addEventListener("click", function () {
      UI.confirm({ title: "Remove " + empty.length + " empty session" + (empty.length > 1 ? "s" : "") + "?",
                   body: "They have nothing logged in them. Finished and partial workouts are not touched.",
                   confirm: "Remove", danger: true })
        .then(async function (ok) {
          if (!ok) return;
          clr.disabled = true;
          for (var i = 0; i < empty.length; i++) await Store.deleteWorkout(empty[i].id);
          UI.toast("Removed " + empty.length);
          renderHistory();
        });
    });
  };
})();
