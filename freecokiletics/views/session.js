/* Cokiletics — a programme session. ONE screen for looking at a workout,
 * whether or not it has been done (Javier, 13 Sep 2026); marking it done by
 * hand; and running it (hands over to runner.js).
 *
 *   #/view/<key>  the session as written: warm-up, blocks, reps, rest.
 *   #/h/<id>      the SAME screen for one finished workout, with its record
 *                 folded in — when it was done at the top, what was lifted
 *                 under each block — each behind its own Edit.
 *
 * There used to be a separate edit screen for a finished workout, and a done
 * day card offered both it and View workout: the same workout twice, once as
 * the plan and once as the record. Don't split them again. */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;

  /* One movement tile. With a preview it is a button that opens it big
     (Javier, 13 Sep 2026 — the tiles are small so the whole session scans at
     once); without one it is an empty tile, not a dead button. `caption` is
     trusted markup built here. */
  function thumb(e, caption) {
    var u = A.previewUrl(e.id);
    return '<figure class="vthumb">' +
      (u ? '<button class="vthumb__open" type="button" data-zoom="' + esc(e.id) + '" aria-label="Show ' + esc(e.name) + ' larger">' +
             '<img src="' + u + '" alt="" loading="lazy"></button>'
         : '<div class="vthumb__none"></div>') +
      "<figcaption>" + caption + "</figcaption></figure>";
  }

  function setKey(letter, round, exId) { return letter + "|" + round + "|" + exId; }

  /* What was lifted, round by round: "16 · 16 · 18 kg", "– · 16 · 18 kg" when
     a round has no weight, "—" when nothing was. */
  function weightsLine(b, e, byKey) {
    var rounds = b.rounds || 1, vals = [], any = false;
    for (var r = 1; r <= rounds; r++) {
      var x = byKey[setKey(b.letter, r, e.id)];
      var v = x && x.weight != null ? +x.weight : null;
      if (v != null) any = true;
      vals.push(v != null ? String(v) : "–");
    }
    return any ? vals.join(" · ") + " kg" : "—";
  }

  /* When it was done, and an Edit that unfolds the date and times. */
  function recordStrip(w) {
    var start = new Date(w.started_at), end = w.finished_at ? new Date(w.finished_at) : null;
    var mins = w.duration_seconds ? " · " + Math.round(w.duration_seconds / 60) + " min" : "";
    return '<div class="record">' +
      '<div class="record__row">' +
        '<div class="grow">' +
          '<div class="record__label">' + (w.logged_manually ? "Done ✓ · logged by hand" : "Done ✓") + "</div>" +
          // Date on one line, times on the next — as on the done day card. On
          // one line it wrapped at 375px and left "min" on a line of its own.
          '<div class="record__when"><span>' + esc(A.dayDate(w.started_at)) + "</span><span>" + esc(A.hhmm(w.started_at)) +
            (end ? "–" + esc(A.hhmm(w.finished_at)) : "") + mins + "</span></div>" +
        "</div>" +
        '<button class="btn btn--quiet record__edit" type="button" data-edit="times" aria-expanded="false" aria-controls="times">' + ICONS.pen + "Edit</button>" +
      "</div>" +
      '<form class="record__form" id="times" hidden>' +
        '<div class="field"><label for="d">Date</label><input class="input" id="d" type="date" value="' + A.dateVal(start) + '"></div>' +
        '<div class="time-row">' +
          '<div class="field"><label for="st">Start</label><input class="input" id="st" type="time" value="' + A.timeVal(start) + '"></div>' +
          '<div class="field"><label for="en">End</label><input class="input" id="en" type="time" value="' + (end ? A.timeVal(end) : "") + '"></div>' +
        "</div>" +
        '<p class="error" hidden></p>' +
        '<div class="record__actions"><button class="btn btn--ghost" type="button" data-cancel="times">Cancel</button>' +
          '<button class="btn btn--primary" type="submit">Save</button></div>' +
      "</form></div>";
  }

  /* Under a rounds block: what was lifted per movement, and an Edit that
     unfolds one box per round. Tabata blocks have no weights. */
  function weightsBox(b, byKey) {
    var rounds = b.rounds || 1, id = "wt-" + b.letter;
    return '<div class="vweights">' +
      // The app's icon language: dumbbell = weight, arrows-repeat = reps or
      // seconds, pen = edit, ✓ = done — the same marks as in a session.
      '<div class="vweights__head"><span class="vweights__title">' + ICONS.dumbbell + "Your weights</span>" +
        '<button class="btn btn--quiet" type="button" data-edit="' + esc(id) + '" aria-expanded="false" aria-controls="' + esc(id) + '">' + ICONS.pen + "Edit</button></div>" +
      '<ul class="vweights__list" data-list="' + esc(id) + '">' + b.exercises.map(function (e) {
        return '<li><span class="vweights__ex">' + esc(e.name) + '</span><span class="vweights__v">' + esc(weightsLine(b, e, byKey)) + "</span></li>";
      }).join("") + "</ul>" +
      '<form class="vweights__form" id="' + esc(id) + '" hidden>' +
        '<p class="vweights__hint">kg per round</p>' +          // the unit, as the session's "kg" field says it
        b.exercises.map(function (e) {
          return '<div class="vweights__exrow"><div class="vweights__ex">' + esc(e.name) + "</div>" +
            '<div class="wt-ex__rounds" style="grid-template-columns:repeat(' + rounds + ',1fr)">' +
            Array.from({ length: rounds }, function (_, i) {
              var r = i + 1, x = byKey[setKey(b.letter, r, e.id)];
              var reps = x && x.reps != null ? String(x.reps) : (x && x.seconds != null ? x.seconds + "″" : "");
              return '<label class="wt-cell"><span>R' + r + "</span>" +
                '<input class="input input--sm" inputmode="decimal" placeholder="—" data-k="' + esc(setKey(b.letter, r, e.id)) + '"' +
                ' data-b="' + esc(b.letter) + '" data-r="' + r + '" data-e="' + esc(e.id) + '" value="' + esc(x && x.weight != null ? +x.weight : "") + '">' +
                (reps ? '<small><span class="sr-only">' + (x.seconds != null && x.reps == null ? "seconds" : "reps") + " </span>" + ICONS.arrowsRepeat + esc(reps) + "</small>" : "") + "</label>";
            }).join("") + "</div></div>";
        }).join("") +
        '<div class="record__actions"><button class="btn btn--ghost" type="button" data-cancel="' + esc(id) + '">Cancel</button>' +
          '<button class="btn btn--primary" type="submit">Save</button></div>' +
      "</form></div>";
  }

  /* The screen. ctx = { s, key, weekStart, back, record } — record is null for
     the session as written, or { id, w, sets, byKey } for a finished workout. */
  function draw(ctx) {
    var s = ctx.s, rec = ctx.record, w = rec && rec.w;
    var wq = ctx.weekStart ? "?w=" + encodeURIComponent(ctx.weekStart) : "";
    var html = topbar(null, ctx.back) +
      '<div class="stack">' +
        '<div class="eyebrow">' + (s ? "Block " + s.block + " · session " + s.variant : "Workout") + "</div>" +
        "<h1>" + esc(s ? s.title : "Workout " + ctx.key) + "</h1>" +
      "</div>" +
      (rec ? recordStrip(w) : "");

    if (s && s.warmup) {
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
          return thumb(e, esc(e.name));
        }).join("") + "</div></section>";
    }

    (s ? s.blocks : []).forEach(function (b) {
      html += '<section class="vsec"><div class="vsec__head">' +
        '<span class="letter">' + esc(b.letter) + "</span>" +
        '<h2 class="vsec__h grow">' + esc(b.name) + "</h2>" +
        '<span class="badge">' + esc(A.blockCount(b)) + "</span></div>" +
        (b.kind === "tabata"
          ? '<p class="dim">' + b.work_seconds + '" work · ' + b.rest_seconds + '" rest · ' + b.cycles + " cycles</p>"
          : '<p class="dim">' + esc(b.rest_seconds ? A.restLabel(b.rest_seconds) + " between rounds"
                                                   : (b.rest_note || "No rest")) + "</p>") +
        '<div class="vgrid">' + (b.exercises || []).map(function (e) {
          var reps = A.repsLabel(e);
          return thumb(e, (reps ? "<b>" + esc(reps) + "</b> " : "") + esc(e.name));
        }).join("") + "</div>" +
        (rec && b.kind === "rounds" ? weightsBox(b, rec.byKey) : "") +
        "</section>";
    });

    if (rec && !s) {
      html += '<p class="dim" style="margin-top:var(--space-6)">This session is no longer in the programme, so only its times are shown.</p>';
    }

    html += '<div class="stack" style="margin-top:var(--space-6)">' +
      (rec
        ? (s ? '<a class="btn btn--primary btn--big btn--block" href="#/run/' + esc(s.key) + wq + '">Do it again</a>' : "") +
          '<button class="btn btn--quiet btn--block btn--danger-text" type="button" id="del">Delete this workout</button>'
        : '<a class="btn btn--primary btn--big btn--block" href="#/run/' + esc(ctx.key) + wq + '">Start this session</a>' +
          '<a class="btn btn--quiet btn--block" href="#/log/' + esc(ctx.key) + wq + '">Did it without the phone? Mark as done</a>') +
      "</div>";

    app.innerHTML = html;
    A.syncBadge();

    // Bound on the elements themselves, which go away with the screen — a
    // listener on #app would pile up one per visit.
    app.querySelectorAll("[data-zoom]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-zoom");
        UI.zoomImage(A.previewUrl(id), (A.P.exercises[id] || {}).name || "");
      });
    });
    if (rec) bindRecord(ctx);
  }

  /* After a save: the same screen with the new values, where you were. */
  function redraw(ctx) { var y = window.scrollY; draw(ctx); window.scrollTo(0, y); }

  function bindRecord(ctx) {
    var rec = ctx.record, w = rec.w;

    // Edit unfolds a form in place of what it edits; Cancel folds it back
    // and throws the typing away.
    function fold(id, open) {
      var form = document.getElementById(id);
      var btn = app.querySelector('[data-edit="' + id + '"]');
      var list = app.querySelector('[data-list="' + id + '"]');
      form.hidden = !open;
      if (list) list.hidden = open;
      btn.hidden = open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) { var first = form.querySelector("input"); if (first) first.focus(); }
      else {
        form.reset();
        var er = form.querySelector(".error"); if (er) er.hidden = true;
        btn.focus();
      }
    }
    app.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { fold(b.getAttribute("data-edit"), true); });
    });
    app.querySelectorAll("[data-cancel]").forEach(function (b) {
      b.addEventListener("click", function () { fold(b.getAttribute("data-cancel"), false); });
    });

    var tf = document.getElementById("times");
    tf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var err = tf.querySelector(".error");
      var r = A.timesFrom(tf.querySelector("#d").value, tf.querySelector("#st").value, tf.querySelector("#en").value);
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      var row = Object.assign({}, w, { started_at: r.start, finished_at: r.end, duration_seconds: r.seconds });
      delete row.freeco_sets; delete row.set_count; delete row.times; delete row.runs;   // view-only, not columns
      Store.saveWorkout(row);
      rec.w = row;
      UI.toast("Times saved");
      redraw(ctx);
    });

    app.querySelectorAll(".vweights__form").forEach(function (wf) {
      wf.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var changed = 0;
        wf.querySelectorAll("[data-k]").forEach(function (inp) {
          var k = inp.getAttribute("data-k"), x = rec.byKey[k];
          var v = inp.value.trim() === "" ? null : parseFloat(inp.value.replace(",", "."));
          if (v != null && isNaN(v)) v = null;
          if (x ? x.weight === v || (x.weight != null && v != null && +x.weight === v) : v == null) return;   // unchanged
          var row;
          if (x) row = Object.assign({}, x, { weight: v });
          else {
            // A round with no set yet (hand-logged workout, or not logged live):
            // create one with the planned reps, dated to the workout.
            var b = ctx.s.blocks.find(function (bb) { return bb.letter === inp.getAttribute("data-b"); });
            var e = b.exercises.find(function (ee) { return String(ee.id) === inp.getAttribute("data-e"); });
            var r = +inp.getAttribute("data-r");
            var planned = e.reps_per_round ? e.reps_per_round[r - 1] : (typeof e.reps === "number" ? e.reps : null);
            row = { id: Store.uuid(), workout_id: w.id, user_id: w.user_id, block_letter: b.letter, round: r,
                    exercise_id: e.id, exercise_name: e.name, weight: v, reps: e.seconds ? null : planned,
                    seconds: e.seconds || null, skipped: false, done_at: w.finished_at || w.started_at };
          }
          delete row.created_at;
          Store.saveSet(row);
          rec.byKey[k] = row;                  // a second save updates, never duplicates
          changed++;
        });
        UI.toast(changed ? changed + " weight" + (changed === 1 ? "" : "s") + " saved" : "Nothing changed");
        redraw(ctx);
      });
    });

    document.getElementById("del").addEventListener("click", function () {
      var n = Object.keys(rec.byKey).length;
      UI.confirm({ title: "Delete this workout?",
                   body: "It disappears from History" + (n ? ", with its " + n + " logged set" + (n === 1 ? "" : "s") : "") + ". This can’t be undone.",
                   confirm: "Delete", danger: true })
        .then(async function (ok) {
          if (!ok) return;
          await Store.deleteWorkout(rec.id);
          UI.toast("Workout deleted");
          location.hash = ctx.back;
        });
    });
  }

  /* The session as written. Reached from a day card that is not done yet, and
     the one place to look something up without starting a workout. */
  V.renderView = function (key, weekStart) {
    A.ticket();
    var s = A.sessionByKey(key);
    if (!s) { location.hash = "#/"; return; }
    draw({ s: s, key: key, weekStart: weekStart, back: weekStart ? "#/week/" + weekStart : "#/", record: null });
  };

  /* One finished workout — from a done day card, one of its runs, or History. */
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
    var byKey = {};
    sets.forEach(function (x) { byKey[setKey(x.block_letter, x.round, x.exercise_id)] = x; });
    draw({ s: A.sessionByKey(w.session_key), key: w.session_key, weekStart: w.week_start, back: back,
           record: { id: id, w: w, sets: sets, byKey: byKey } });
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
