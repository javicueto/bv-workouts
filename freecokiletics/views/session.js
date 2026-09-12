/* Cokiletics — a programme session: view it read-only, mark it done by hand,
 * or run it (hands over to runner.js). */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;

  /* A session, read only. Reached from the day card, and the one place to look
     something up mid-week without starting a workout — starting one used to be
     the only way in, which meant discarding it afterwards just to have looked. */
  V.renderView = function (key, weekStart) {
    A.ticket();
    var s = A.sessionByKey(key);
    if (!s) { location.hash = "#/"; return; }
    var wq = weekStart ? "?w=" + encodeURIComponent(weekStart) : "";
    var back = weekStart ? "#/week/" + weekStart : "#/";
    var html = topbar(null, back) +
      '<div class="stack">' +
        '<div class="eyebrow">Block ' + s.block + " · session " + s.variant + "</div>" +
        "<h1>" + esc(s.title) + "</h1>" +
      "</div>";

    if (s.warmup) {
      /* The coach's warm-up text is a heading plus the list of movements, and
         the movements are already named under their own previews below — so
         only the lines that are NOT an exercise name are kept. Matching on the
         real names means nothing is dropped if the coach writes it differently. */
      var wNames = (s.warmup.exercises || []).map(function (e) { return (e.name || "").trim().toLowerCase(); });
      var wText = (s.warmup.text || "").split("\n").filter(function (line) {
        var t = line.trim().toLowerCase().replace(/[.;:,]+$/, "");
        return t !== "" && wNames.indexOf(t) === -1;
      }).join("\n");
      html += '<section class="vsec"><h2 class="vsec__h">Warm-up</h2>' +
        (wText ? '<p class="note">' + esc(wText) + "</p>" : "") +
        '<div class="vgrid">' + (s.warmup.exercises || []).map(function (e) {
          var u = A.previewUrl(e.id);
          return '<figure class="vthumb">' + (u ? '<img src="' + u + '" alt="" loading="lazy">' : '<div class="vthumb__none"></div>') +
            "<figcaption>" + esc(e.name) + "</figcaption></figure>";
        }).join("") + "</div></section>";
    }

    s.blocks.forEach(function (b) {
      html += '<section class="vsec"><div class="vsec__head">' +
        '<span class="letter">' + esc(b.letter) + "</span>" +
        '<h2 class="vsec__h grow">' + esc(b.name) + "</h2>" +
        '<span class="badge">' + esc(A.blockCount(b)) + "</span></div>" +
        (b.kind === "tabata"
          ? '<p class="dim">' + b.work_seconds + '" work · ' + b.rest_seconds + '" rest · ' + b.cycles + " cycles</p>"
          : '<p class="dim">' + esc(b.rest_seconds ? A.restLabel(b.rest_seconds) + " between rounds"
                                                   : (b.rest_note || "No rest")) + "</p>") +
        '<div class="vgrid">' + (b.exercises || []).map(function (e) {
          var u = A.previewUrl(e.id), reps = A.repsLabel(e);
          return '<figure class="vthumb">' + (u ? '<img src="' + u + '" alt="" loading="lazy">' : '<div class="vthumb__none"></div>') +
            "<figcaption>" + (reps ? "<b>" + esc(reps) + "</b> " : "") + esc(e.name) + "</figcaption></figure>";
        }).join("") + "</div></section>";
    });

    html += '<div class="stack" style="margin-top:var(--space-6)">' +
      '<a class="btn btn--primary btn--big btn--block" href="#/run/' + esc(key) + wq + '">Start this session</a>' +
      '<a class="btn btn--quiet btn--block" href="#/log/' + esc(key) + wq + '">Did it without the phone? Mark as done</a>' +
      "</div>";
    app.innerHTML = html;
    A.syncBadge();
  };

  V.renderLog = function (key, weekStart) {
    A.ticket();
    var s = A.sessionByKey(key);
    if (!s) { location.hash = "#/"; return; }
    var now = new Date(), from = new Date(now.getTime() - 75 * 60000);
    app.innerHTML = topbar(null, "#/") +
      '<div class="stack">' +
        '<div class="eyebrow">Mark as done</div><h1>' + esc(s.title) + "</h1>" +
        '<p class="dim">For a session done without the phone. It’s saved with its times, no weights.</p>' +
        '<form id="lf" class="card stack">' +
          '<div class="field"><label for="d">Date</label><input class="input" id="d" type="date" value="' + A.dateVal(now) + '"></div>' +
          '<div class="time-row">' +
            '<div class="field"><label for="st">Start</label><input class="input" id="st" type="time" value="' + A.timeVal(from) + '"></div>' +
            '<div class="field"><label for="en">End</label><input class="input" id="en" type="time" value="' + A.timeVal(now) + '"></div>' +
          "</div>" +
          '<p class="error" id="lerr" hidden></p>' +
          '<button class="btn btn--primary btn--big btn--block" type="submit">Save as done</button>' +
        "</form></div>";
    var f = document.getElementById("lf"), err = document.getElementById("lerr");
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var r = A.timesFrom(f.d.value, f.st.value, f.en.value);
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      var wf = A.weekFor(new Date(f.d.value + "T12:00"));
      Store.saveWorkout({ id: Store.uuid(), user_id: S.me.id, session_key: s.key, block: s.block,
        week_start: weekStart || (wf.week ? wf.week.start : null), started_at: r.start, finished_at: r.end,
        duration_seconds: r.seconds, logged_manually: true });
      f.querySelector("button[type=submit]").disabled = true;
      // Wait for the upload (if online) so Home shows the day as done at once.
      Promise.race([Store.flush(), new Promise(function (ok) { setTimeout(ok, 4000); })])
        .then(function () { location.hash = weekStart ? "#/week/" + weekStart : "#/"; });
    });
  };

  V.renderRun = async function (key, resume, weekStart) {
    var t = A.ticket();
    var s = A.sessionByKey(key);
    if (!s) { location.hash = "#/"; return; }
    if (resume && Runner.resume()) { /* state restored */ }
    else {
      var wf = A.weekFor(A.today());
      var ids = []; s.warmup.exercises.forEach(function (e) { ids.push(e.id); });
      s.blocks.forEach(function (b) { b.exercises.forEach(function (e) { if (e.id) ids.push(e.id); }); });
      var last = await Store.lastForExercises(ids, S.me.id);
      if (A.stale(t)) return;
      Runner.start(key, { userId: S.me.id, weekStart: weekStart || (wf.week ? wf.week.start : null), last: last });
    }
    app.innerHTML = '<div class="runner" id="runner"></div>';
    Runner.mount(document.getElementById("runner"), function (result) {
      location.hash = "#/";
      if (result && result.finished) {
        UI.toast("Saved · " + Math.round(result.duration / 60) + " min · " + result.sets + " sets");
      }
    });
  };
})();
