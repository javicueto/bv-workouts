/* Cokiletics — one finished workout: its times and weights, editable. */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;

  /* One finished workout: read-only summary with its sets, plus the only two
     things you can change — start and end time — and "Do it again". Used for
     both the done cards on Home and History. */
  V.renderWorkout = async function renderWorkout(id) {
    var t = A.ticket();
    var back = /^#\/(history|week\/)/.test(S.prevHash) ? S.prevHash : "#/";
    app.innerHTML = topbar("Workout", back) + '<p class="dim">Loading…</p>';
    var w, sets;
    try { w = await Store.workout(id); if (w) sets = await Store.setsFor(id); }
    catch (e) {
      if (A.stale(t)) return;
      app.innerHTML = topbar("Workout", back) + A.loadError(e);
      A.bindRetry(function () { renderWorkout(id); });
      return;
    }
    if (A.stale(t)) return;
    if (!w) { app.innerHTML = topbar("Workout", back) + '<p class="dim">This workout no longer exists.</p>'; return; }
    var s = A.sessionByKey(w.session_key);
    var setKey = function (L, r, exId) { return L + "|" + r + "|" + exId; };
    var byKey = {};
    sets.forEach(function (x) { byKey[setKey(x.block_letter, x.round, x.exercise_id)] = x; });
    var blocks = s ? s.blocks.filter(function (b) { return b.kind === "rounds"; }) : [];
    var start = new Date(w.started_at), end = w.finished_at ? new Date(w.finished_at) : null;

    app.innerHTML = topbar(null, back) +
      '<div class="stack">' +
        '<div class="eyebrow">' + (w.logged_manually ? "Logged by hand" : "Done") + "</div>" +
        "<h1>" + esc(s ? s.title : "Workout " + w.session_key) + "</h1>" +
        '<p class="dim">' + A.longDate(w.started_at) + (w.duration_seconds ? " · " + Math.round(w.duration_seconds / 60) + " min" : "") + "</p>" +
        '<form id="tf" class="card stack">' +
          '<div class="field"><label for="d">Date</label><input class="input" id="d" type="date" value="' + A.dateVal(start) + '"></div>' +
          '<div class="time-row">' +
            '<div class="field"><label for="st">Start</label><input class="input" id="st" type="time" value="' + A.timeVal(start) + '"></div>' +
            '<div class="field"><label for="en">End</label><input class="input" id="en" type="time" value="' + (end ? A.timeVal(end) : "") + '"></div>' +
          "</div>" +
          '<p class="error" id="terr" hidden></p>' +
          '<button class="btn btn--ghost btn--block" type="submit" id="tsave" disabled>Save times</button>' +
        "</form>" +
        '<a class="btn btn--primary btn--big btn--block" href="#/run/' + esc(w.session_key) + '">Do it again</a>' +
        '<button class="btn btn--quiet btn--block btn--danger-text" id="del">Delete this workout</button>' +
        (blocks.length
          ? '<form id="wf" class="stack">' +
              '<div class="row"><h2 class="grow">Weights</h2><span class="faint" style="font-size:13px">kg per round</span></div>' +
              blocks.map(function (b) {
                var rounds = b.rounds || 1;
                return '<div class="card wt-block"><div class="eyebrow">' + esc(b.letter) + " · " + esc(b.name) + "</div>" +
                  b.exercises.map(function (e) {
                    // The moving preview, same as everywhere else: by name alone
                    // it is not obvious which movement a row is (Javier, 12 Sep).
                    var pv = A.previewUrl(e.id);
                    return '<div class="wt-ex"><div class="wt-ex__head">' +
                      (pv ? '<img class="wt-ex__gif" src="' + pv + '" alt="" loading="lazy">' : '<span class="wt-ex__gif"></span>') +
                      '<div class="wt-ex__name">' + esc(e.name) + "</div></div>" +
                      '<div class="wt-ex__rounds" style="grid-template-columns:repeat(' + rounds + ',1fr)">' +
                      Array.from({ length: rounds }, function (_, i) {
                        var r = i + 1, x = byKey[setKey(b.letter, r, e.id)];
                        var reps = x && x.reps != null ? "× " + x.reps : (x && x.seconds != null ? x.seconds + "″" : "");
                        return '<label class="wt-cell"><span>R' + r + "</span>" +
                          '<input class="input input--sm" inputmode="decimal" placeholder="—" data-k="' + esc(setKey(b.letter, r, e.id)) + '"' +
                          ' data-b="' + esc(b.letter) + '" data-r="' + r + '" data-e="' + esc(e.id) + '" value="' + esc(x && x.weight != null ? x.weight : "") + '">' +
                          (reps ? '<small>' + esc(reps) + "</small>" : "") + "</label>";
                      }).join("") + "</div></div>";
                  }).join("") + "</div>";
              }).join("") +
              '<button class="btn btn--primary btn--block" type="submit" id="wsave" disabled>Save weights</button>' +
            "</form>"
          : "") +
      "</div>";

    document.getElementById("del").addEventListener("click", function () {
      UI.confirm({ title: "Delete this workout?", body: "It disappears from History" + (sets.length ? ", with its " + sets.length + " logged set" + (sets.length === 1 ? "" : "s") : "") + ". This can’t be undone.",
                   confirm: "Delete", danger: true })
        .then(async function (ok) {
          if (!ok) return;
          await Store.deleteWorkout(id);
          UI.toast("Workout deleted");
          location.hash = back;
        });
    });
    var wf = document.getElementById("wf");
    if (wf) {
      var wbtn = document.getElementById("wsave");
      wf.addEventListener("input", function () { wbtn.disabled = false; wbtn.textContent = "Save weights"; });
      wf.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var changed = 0;
        wf.querySelectorAll("[data-k]").forEach(function (inp) {
          var k = inp.getAttribute("data-k"), x = byKey[k];
          var v = inp.value.trim() === "" ? null : parseFloat(inp.value.replace(",", "."));
          if (v != null && isNaN(v)) v = null;
          if (x ? x.weight === v || (x.weight != null && v != null && +x.weight === v) : v == null) return;   // unchanged
          var row;
          if (x) row = Object.assign({}, x, { weight: v });
          else {
            // A round with no set yet (hand-logged workout, or not logged live):
            // create one with the planned reps, dated to the workout.
            var b = blocks.find(function (bb) { return bb.letter === inp.getAttribute("data-b"); });
            var e = b.exercises.find(function (ee) { return ee.id === inp.getAttribute("data-e"); });
            var r = +inp.getAttribute("data-r");
            var planned = e.reps_per_round ? e.reps_per_round[r - 1] : (typeof e.reps === "number" ? e.reps : null);
            row = { id: Store.uuid(), workout_id: w.id, user_id: w.user_id, block_letter: b.letter, round: r,
                    exercise_id: e.id, exercise_name: e.name, weight: v, reps: e.seconds ? null : planned,
                    seconds: e.seconds || null, skipped: false, done_at: w.finished_at || w.started_at };
          }
          delete row.created_at;
          Store.saveSet(row);
          byKey[k] = row;                      // a second save updates, never duplicates
          changed++;
        });
        wbtn.disabled = true; wbtn.textContent = changed ? "Saved ✓" : "Nothing changed";
        if (changed) UI.toast(changed + " weight" + (changed === 1 ? "" : "s") + " saved");
      });
    }
    var f = document.getElementById("tf"), btn = document.getElementById("tsave"), err = document.getElementById("terr");
    f.addEventListener("input", function () { btn.disabled = false; });
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var r = A.timesFrom(f.d.value, f.st.value, f.en.value);
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      err.hidden = true;
      var row = Object.assign({}, w, { started_at: r.start, finished_at: r.end, duration_seconds: r.seconds });
      delete row.freeco_sets; delete row.set_count;          // view-only fields, not columns
      Store.saveWorkout(row);
      btn.disabled = true; btn.textContent = "Saved ✓";
    });
  };
})();
