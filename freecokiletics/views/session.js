/* Cokiletics — a programme session. ONE screen for looking at a workout,
 * whether or not it has been done (Javier, 13 Sep 2026); marking it done by
 * hand; and running it (hands over to runner.js).
 *
 *   #/view/<key>  the session as written: warm-up, blocks, reps, rest.
 *   #/h/<id>      the SAME screen for one finished workout, with its record
 *                 in it — when it was done at the top, what was lifted under
 *                 each block.
 *
 * Editing is LIVE (Javier, 13 Sep 2026): Edit turns the values already on the
 * screen into boxes in the same place, and Save or Cancel turns them back. No
 * separate form — the first version unfolded one below the values, in a
 * different layout, and it read like a modal. There also used to be a whole
 * separate edit screen, and a done day card offered both it and View workout:
 * the same workout twice. Don't split them again. */
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
      (u ? '<button class="vthumb__open" type="button" data-zoom="' + esc(e.id) + '" aria-label="Show ' + esc(A.cueText(e.name)) + ' larger">' +
             '<img src="' + u + '" alt="" loading="lazy"></button>'
         : '<div class="vthumb__none"></div>') +
      "<figcaption>" + caption + "</figcaption></figure>";
  }

  function setKey(letter, round, exId) { return letter + "|" + round + "|" + exId; }

  /* One movement's weights, round by round — null where a round has none. */
  function roundWeights(b, e, byKey) {
    return Array.from({ length: b.rounds || 1 }, function (_, i) {
      var x = byKey[setKey(b.letter, i + 1, e.id)];
      return x && x.weight != null ? +x.weight : null;
    });
  }
  /* The movements "Your weights" lists: those that take a weight, plus any
     no-weight one (data/no_weight.json) that has one logged anyway — a weight
     already typed is never hidden. */
  function weighable(b, byKey) {
    return (b.exercises || []).filter(function (e) {
      return !e.no_weight || roundWeights(b, e, byKey).some(function (v) { return v != null; });
    });
  }
  function distinct(vals) { return vals.filter(function (v, i) { return v != null && vals.indexOf(v) === i; }); }
  function heaviest(vals) { var d = distinct(vals); return d.length ? Math.max.apply(null, d) : null; }
  function kg(s) { s = String(s).trim(); if (s === "") return null; var v = parseFloat(s.replace(",", ".")); return isNaN(v) ? null : v; }

  /* What was lifted. One weight shows ONCE — "20 kg" — even when only some
     rounds have it: Javier logs his heaviest as the reference for the whole
     movement (13 Sep 2026). Different weights show round by round,
     "16 · 18 · 20 kg", "–" for a round with none; "—" when nothing was logged. */
  function weightsLine(vals) {
    var d = distinct(vals);
    if (!d.length) return "—";
    if (d.length === 1) return d[0] + " kg";
    return vals.map(function (v) { return v != null ? String(v) : "–"; }).join(" · ") + " kg";
  }
  A.weightsLine = weightsLine;             // the Social feed writes weights the same way
  var BY_ROUND = "Weights by round";
  function minutesLabel(seconds) { return seconds ? Math.round(seconds / 60) + " min" : ""; }

  /* The three buttons every editable piece has, in one place: Edit while
     reading; Cancel and Save while editing (the app's icon language — pen =
     edit, check = confirm). Which ones show is CSS, from .is-editing. */
  function editActs(what) {
    return '<div class="edit-acts">' +
      '<button class="btn btn--quiet" type="button" data-edit aria-label="Edit ' + what + '">' + ICONS.pen + "Edit</button>" +
      '<button class="btn btn--ghost btn--icon edit-cancel" type="button" data-cancel aria-label="Cancel">' + ICONS.xmark + "</button>" +
      '<button class="btn btn--primary edit-save" type="submit">' + ICONS.check + "Save</button>" +
      "</div>";
  }

  /* When it was done. Each value is there twice — as text (.rv) and as a box
     (.re) in the same spot — and editing only swaps which one shows. */
  function recordStrip(w) {
    var start = new Date(w.started_at), end = w.finished_at ? new Date(w.finished_at) : null;
    var mins = minutesLabel(w.duration_seconds);
    return '<form class="record editable" id="times" novalidate>' +
      '<div class="record__row">' +
        '<div class="record__body">' +
          '<div class="record__label">' + (w.logged_manually ? "Done ✓ · logged by hand" : "Done ✓") + "</div>" +
          // Date on one line, times on the next — as on the done day card.
          '<div class="record__when">' +
            '<span class="rv">' + esc(A.dayDate(w.started_at)) + "</span>" +
            '<span class="re"><input class="input input--inline" name="d" type="date" aria-label="Date" value="' + A.dateVal(start) + '"></span>' +
            '<span class="rv">' + esc(A.hhmm(w.started_at)) + (end ? "–" + esc(A.hhmm(w.finished_at)) : "") +
              (mins ? " · " + mins : "") + "</span>" +
            '<span class="re">' +
              '<input class="input input--inline" name="st" type="time" aria-label="Start" value="' + A.timeVal(start) + '">' +
              "<span>–</span>" +
              '<input class="input input--inline" name="en" type="time" aria-label="End" value="' + (end ? A.timeVal(end) : "") + '">' +
              '<span data-dur>' + (mins ? "· " + mins : "") + "</span>" +
            "</span>" +
          "</div>" +
          '<p class="error" role="alert" hidden></p>' +
        "</div>" +
        editActs("date and times") +
      "</div></form>";
  }

  /* Under a rounds block: each movement's weights. Edit opens ONE box per
     movement holding the heaviest, and saving it sets every round (Javier,
     13 Sep 2026: “I usually add the heaviest weight … that’s my reference”).
     “Weights by round” swaps it for a box per round — one way only: there is
     no “same weight all rounds” back (dropped, 13 Sep 2026 — typing one number
     is already that, and Cancel undoes a wrong tap). A movement whose rounds
     already differ opens by round, so nothing typed before is flattened
     unseen. Tabata blocks have no weights. */
  function weightsBox(b, byKey) {
    var rounds = b.rounds || 1;
    function box(e, attr, label, v) {
      return '<input class="input input--inline input--kg" inputmode="decimal" placeholder="–" ' + attr +
        ' aria-label="' + esc(A.cueText(e.name)) + label + ', kg" value="' + (v != null ? esc(v) : "") + '">';
    }
    return '<form class="vweights editable" id="wt-' + esc(b.letter) + '" data-b="' + esc(b.letter) + '" novalidate>' +
      '<div class="vweights__head"><span class="vweights__title">' + ICONS.dumbbell + "Your weights</span>" +
        editActs("weights") + "</div>" +
      '<ul class="vweights__list">' + weighable(b, byKey).map(function (e) {
        var vals = roundWeights(b, e, byKey);
        var byRound = rounds > 1 && distinct(vals).length > 1;
        var unit = '<span class="vweights__unit">kg</span>';
        return '<li data-e="' + esc(e.id) + '" data-by-round="' + byRound + '"' + (byRound ? ' class="is-by-round"' : "") + ">" +
          '<span class="vweights__ex">' + A.cueHTML(e.name) + "</span>" +
          '<span class="vweights__v rv">' + esc(weightsLine(vals)) + "</span>" +
          '<span class="vweights__v re">' +
            '<span class="vw-one">' + box(e, "data-one", rounds > 1 ? ", all rounds" : "", heaviest(vals)) + unit + "</span>" +
            (rounds > 1
              ? '<span class="vw-rounds">' + vals.map(function (v, i) {
                  var b1 = box(e, 'data-round="' + (i + 1) + '"', ", round " + (i + 1), v);
                  // No "·" between boxes — the boxes already separate them, and a
                  // dot left hanging at the end of a wrapped line (4 rounds at
                  // 320px). The last box carries "kg", so the unit never sits alone.
                  return i === vals.length - 1 ? '<span class="vw-last">' + b1 + unit + "</span>" : b1;
                }).join("") + "</span>"
              : "") +
          "</span>" +
          (rounds > 1 && !byRound
            ? '<span class="vweights__more re"><button class="vweights__toggle" type="button" data-toggle>' + BY_ROUND + "</button></span>"
            : "") +
          "</li>";
      }).join("") + "</ul></form>";
  }

  /* The session as written — warm-up and every block — as markup. Shared by
     this screen and the runner's whole-workout view (runner.js showOverview,
     15 Sep 2026), which passes `status(letter)` → a line saying done / now /
     to do ("W" is the warm-up). `rec` adds what was lifted under each block. */
  function sectionsHTML(s, o) {
    var rec = o.rec, status = o.status || function () { return ""; }, html = "";
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
      html += '<section class="vsec"><h2 class="vsec__h">Warm-up</h2>' + status("W") +
        (wText ? '<p class="note">' + esc(wText) + "</p>" : "") +
        '<div class="vgrid">' + (s.warmup.exercises || []).map(function (e) {
          return thumb(e, A.cueHTML(e.name));
        }).join("") + "</div></section>";
    }

    (s ? s.blocks : []).forEach(function (b) {
      html += '<section class="vsec"><div class="vsec__head">' +
        '<span class="letter">' + esc(b.letter) + "</span>" +
        '<h2 class="vsec__h grow">' + A.cueHTML(b.name) + "</h2>" +
        '<span class="badge">' + esc(A.blockCount(b)) + "</span></div>" + status(b.letter) +
        (b.kind === "tabata"
          ? '<p class="dim">' + A.durHTML(b.work_seconds) + " work · " + A.durHTML(b.rest_seconds) + " rest · " + b.cycles + " cycles</p>"
          : '<p class="dim">' + (b.rest_seconds ? A.restHTML(b.rest_seconds) + " between rounds"
                                                : esc(b.rest_note || "No rest")) + "</p>") +
        '<div class="vgrid">' + (b.exercises || []).map(function (e) {
          var reps = A.repsLabel(e);
          return thumb(e, (reps ? "<b>" + esc(reps) + "</b> " : "") + A.cueHTML(e.name));
        }).join("") + "</div>" +
        // No box at all when nothing in the block takes a weight (a core circuit).
        (rec && b.kind === "rounds" && weighable(b, rec.byKey).length ? weightsBox(b, rec.byKey) : "") +
        "</section>";
    });

    return html;
  }
  A.sessionSections = sectionsHTML;

  /* The screen. ctx = { s, key, weekStart, back, record } — record is null for
     the session as written, or { id, w, sets, byKey } for a finished workout. */
  function draw(ctx) {
    var s = ctx.s, rec = ctx.record, w = rec && rec.w;
    var wq = ctx.weekStart ? "?w=" + encodeURIComponent(ctx.weekStart) : "";
    var html = topbar(null, ctx.back) + A.savedNotice(ctx.savedAt) +
      '<div class="stack">' +
        '<div class="eyebrow">' + (s ? "Block " + s.block + " · session " + s.variant : "Workout") + "</div>" +
        "<h1>" + esc(s ? s.title : "Workout " + ctx.key) + "</h1>" +
      "</div>" +
      (rec ? recordStrip(w) : "");

    html += sectionsHTML(s, { rec: rec });

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
        var ex = A.P.exercises[id] || {};
        UI.zoomImage(A.previewUrl(id), A.cueText(ex.name || ""), ex.youtube_id);
      });
    });
    if (rec) bindRecord(ctx);
  }

  /* After a save: the same screen with the new values, where you were. */
  function redraw(ctx) { var y = window.scrollY; draw(ctx); window.scrollTo(0, y); }

  /* Edit → the boxes show in place, focus goes to the first one showing.
     Cancel or Escape → the typing is thrown away, and onReset puts back
     anything else the editing changed. Save (or Enter) → onSave(form). */
  function editable(form, onSave, onReset) {
    var editBtn = form.querySelector("[data-edit]");
    function setEditing(on) {
      form.classList.toggle("is-editing", on);
      editBtn.setAttribute("aria-expanded", String(on));
      if (on) {
        var first = Array.from(form.querySelectorAll(".re input")).find(function (i) { return i.offsetParent !== null; });
        if (first) first.focus();
        return;
      }
      form.reset();
      if (onReset) onReset(form);
      var er = form.querySelector(".error"); if (er) er.hidden = true;
      form.dispatchEvent(new Event("input"));     // puts live text (the duration) back
      editBtn.focus();
    }
    editBtn.addEventListener("click", function () { setEditing(true); });
    form.querySelector("[data-cancel]").addEventListener("click", function () { setEditing(false); });
    form.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && form.classList.contains("is-editing")) { e.preventDefault(); e.stopPropagation(); setEditing(false); }
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (form.classList.contains("is-editing")) onSave(form);
    });
  }

  function bindRecord(ctx) {
    var rec = ctx.record, w = rec.w;

    var tf = document.getElementById("times");
    // The duration follows the boxes as you type, so what you see is what saves.
    tf.addEventListener("input", function () {
      var r = A.timesFrom(tf.elements.d.value, tf.elements.st.value, tf.elements.en.value);
      tf.querySelector("[data-dur]").textContent = r.error ? "" : "· " + minutesLabel(r.seconds);
    });
    editable(tf, function (form) {
      var err = form.querySelector(".error");
      var r = A.timesFrom(form.elements.d.value, form.elements.st.value, form.elements.en.value);
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      // Minute precision: a live session's start has seconds the boxes can't
      // show, so an untouched Save must not count as a change.
      var minute = function (iso) { return iso ? Math.floor(new Date(iso).getTime() / 60000) : null; };
      if (minute(r.start) === minute(w.started_at) && minute(r.end) === minute(w.finished_at)) {
        UI.toast("Nothing changed"); redraw(ctx); return;
      }
      var row = Object.assign({}, w, { started_at: r.start, finished_at: r.end, duration_seconds: r.seconds });
      delete row.freeco_sets; delete row.set_count; delete row.times; delete row.runs;   // view-only, not columns
      Store.saveWorkout(row);
      rec.w = row;
      UI.toast("Times saved");
      redraw(ctx);
    });

    /* One round's weight → a saved set, when it differs from what is there. A
       round with no set yet (hand-logged, or not logged live) gets one with the
       planned reps, dated to the workout. */
    function writeRound(b, e, r, v) {
      var k = setKey(b.letter, r, e.id), x = rec.byKey[k];
      if (x ? (x.weight == null ? v == null : v != null && +x.weight === v) : v == null) return false;
      var row;
      if (x) row = Object.assign({}, x, { weight: v });
      else {
        var planned = e.reps_per_round ? e.reps_per_round[r - 1] : (typeof e.reps === "number" ? e.reps : null);
        row = { id: Store.uuid(), workout_id: w.id, user_id: w.user_id, block_letter: b.letter, round: r,
                exercise_id: e.id, exercise_name: e.name, weight: v, reps: e.seconds ? null : planned,
                seconds: e.seconds || null, skipped: false, done_at: w.finished_at || w.started_at };
      }
      delete row.created_at;
      Store.saveSet(row);
      rec.byKey[k] = row;                      // a second save updates, never duplicates
      return true;
    }

    app.querySelectorAll(".vweights").forEach(function (wf) {
      var b = ctx.s.blocks.find(function (bb) { return bb.letter === wf.getAttribute("data-b"); });
      wf.querySelectorAll("[data-toggle]").forEach(function (t) {
        t.addEventListener("click", function () {
          var li = t.closest("li"), one = li.querySelector("[data-one]"), each = li.querySelectorAll("[data-round]");
          // Every round box starts from the one weight, so only the rounds that
          // differ need typing. The link hides once used (CSS).
          each.forEach(function (i) { i.value = one.value; });
          li.classList.add("is-by-round");
          each[0].focus();
        });
      });
      editable(wf, function () {
        var changed = 0;
        wf.querySelectorAll("li[data-e]").forEach(function (li) {
          var e = b.exercises.find(function (ee) { return String(ee.id) === li.getAttribute("data-e"); });
          var want;
          if (li.classList.contains("is-by-round")) {
            want = Array.from(li.querySelectorAll("[data-round]"), function (i) { return kg(i.value); });
          } else {
            var one = li.querySelector("[data-one]");
            // Untouched, the box changes nothing: it shows the heaviest, and a
            // plain Save must not quietly fill rounds that were left empty.
            if (one.value === one.defaultValue) return;
            want = Array.from({ length: b.rounds || 1 }, function () { return kg(one.value); });
          }
          want.forEach(function (v, i) { if (writeRound(b, e, i + 1, v)) changed++; });
        });
        UI.toast(changed ? "Weights saved" : "Nothing changed");
        redraw(ctx);
      }, function () {
        wf.querySelectorAll("li[data-e]").forEach(function (li) { li.classList.toggle("is-by-round", li.getAttribute("data-by-round") === "true"); });
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
           record: { id: id, w: w, sets: sets, byKey: byKey }, savedAt: Store.savedAt(sets) || Store.savedAt(w) });
    if (Store.savedAt(sets) || Store.savedAt(w)) A.bindRetry(function () { renderWorkout(id); });
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
    var resumed = !!(resume && Runner.resume());
    if (resumed) { /* state restored */ }
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
      // A finished workout gets its celebration (views/celebrate.js), over Home.
      if (result && result.finished) V.celebrate(result);
    }, { countIn: !resumed });                 // 3 · 2 · 1 · Go! on a fresh start only
  };
})();
