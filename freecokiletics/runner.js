/* Session runner — walks one programme session screen by screen.
 *
 * One screen = one ROUND, not one exercise (Javier, 11 Sep 2026: "I don't want
 * to be swiping after every single exercise"):
 *
 *   warm-up      one screen: a grid of small moving thumbnails as reference,
 *                one swipe when done, nothing logged
 *   rounds block one screen per round with every movement of that round on it
 *                (A1 + A2 together). One swipe logs the whole round. Then a rest
 *                timer — only if the block states a rest, and never after the
 *                last round. Core/shoulder blocks with no rest written go
 *                straight to the next round with no timer.
 *   tabata       one timer-driven screen, 8 × 20″/10″, movements alternating
 *   done         summary
 *
 * Progress is saved after every step so a session survives the app being
 * killed; a version tag stops an old saved session from being resumed into a
 * newer step layout.
 */
window.Runner = (function () {
  var SAVE_KEY = "freeco.session";
  var STATE_VERSION = 2;
  var P = window.PROGRAMME;
  var state = null;
  var container = null;
  var onExit = null;
  var countdown = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function preview(id) { return P.exercises[id] && P.exercises[id].has_preview ? "../previews/" + id + ".webp" : ""; }

  // ---------------------------------------------------------------- steps
  function targetFor(e, round) {
    if (e.reps_per_round) return { n: e.reps_per_round[round - 1], unit: "reps" };
    if (e.holds) return { n: e.holds, unit: "× " + e.seconds + "″ hold" };
    if (e.seconds) return { n: e.seconds, unit: e.per_side ? "sec / side" : "sec", timed: true };
    if (e.reps === "MAX") return { n: "MAX", unit: "reps" };
    if (e.reps != null) return { n: e.reps, unit: e.per_side ? "/ side" : "reps" };
    return { n: "", unit: "" };
  }

  function restLabel(sec) {
    if (sec === 90) return "Rest 1½ min";
    if (sec % 60 === 0) return "Rest " + sec / 60 + " min";
    if (sec < 60) return "Rest " + sec + " s";
    return "Rest " + Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") + " min";
  }

  function buildSteps(session) {
    var steps = [], segments = [];
    if (session.warmup.exercises.length) {
      segments.push("W");
      steps.push({ kind: "warmup", seg: 0, text: session.warmup.text, exercises: session.warmup.exercises });
    }
    session.blocks.forEach(function (b) {
      var seg = segments.length; segments.push(b.letter);
      if (b.kind === "tabata") { steps.push({ kind: "tabata", seg: seg, block: b.letter, tabata: b }); return; }
      var rounds = b.rounds || 1;
      for (var r = 1; r <= rounds; r++) {
        steps.push({ kind: "round", seg: seg, block: b.letter, blockName: b.name, round: r, rounds: rounds,
          // The block's rest, shown on every round as a reference so you
          // always know what follows the swipe. Same on the last round.
          restRef: b.rest_seconds > 0 ? restLabel(b.rest_seconds) : (b.rest_note || "No rest"),
          items: b.exercises.map(function (e, ix) {
            return { exercise: e, round: r, label: b.exercises.length > 1 ? b.letter + (ix + 1) : b.letter,
                     target: targetFor(e, r), note: e.note || null, setId: Store.uuid() };
          }) });
        if (r < rounds && b.rest_seconds > 0) {
          steps.push({ kind: "rest", seg: seg, block: b.letter, seconds: b.rest_seconds,
            nextRound: r + 1, rounds: rounds, next: b.exercises.map(function (e) { return e.name; }) });
        }
      }
    });
    steps.push({ kind: "done", seg: segments.length });
    return { steps: steps, segments: segments };
  }

  // ---------------------------------------------------------------- persistence
  function save() { if (state) localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
  function clear() { localStorage.removeItem(SAVE_KEY); state = null; }
  function pending() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      return s && s.v === STATE_VERSION ? s : null;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- lifecycle
  function start(sessionKey, opts) {
    var session = P.sessions.find(function (s) { return s.key === sessionKey; });
    if (!session) throw new Error("no session " + sessionKey);
    var built = buildSteps(session);
    state = { v: STATE_VERSION, key: sessionKey, title: session.title, workoutId: Store.uuid(), userId: opts.userId,
      weekStart: opts.weekStart || null, startedAt: new Date().toISOString(), i: 0,
      steps: built.steps, segments: built.segments, last: opts.last || {}, logs: {},
      // Not written to the database yet. Opening a session just to look at it
      // used to create an "unfinished" workout every time; now the row only
      // appears once a round is actually logged (or the session is finished).
      workoutSaved: false };
    save();
  }
  function ensureWorkout() {
    if (state.workoutSaved !== false) return;       // undefined = older saved session, already written
    var session = P.sessions.find(function (s) { return s.key === state.key; });
    Store.saveWorkout({ id: state.workoutId, user_id: state.userId, session_key: state.key,
      block: session.block, week_start: state.weekStart, started_at: state.startedAt });
    state.workoutSaved = true; save();
  }
  function resume() { state = pending(); return !!state; }
  function mount(el, exit) { container = el; onExit = exit; Sound.unlock(); WakeLock.on(); render(); }
  function unmount() {
    if (countdown) { countdown.stop(); countdown = null; }
    var hs = document.querySelector(".hold-screen"); if (hs) hs.remove();   // leaving mid-hold
    setResting(false); WakeLock.off();
  }
  // Discard: the session and anything logged in it are removed, not left
  // behind as an "unfinished" workout in History.
  function abandon() {
    var s = state || pending();
    if (s && s.workoutSaved !== false) Store.deleteWorkout(s.workoutId);
    unmount(); clear(); onExit && onExit();
  }

  /* Rest is a different mode, so it looks like one: the whole screen turns
     blue, including the phone's status bar. Toggled by the rest timer and by
     Tabata's rest phases; always switched off when leaving them. */
  function setResting(on) {
    document.body.classList.toggle("is-resting", !!on);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", on ? "#1e5bd6" : Theme.uiColor());
  }

  function go(delta) {
    if (countdown) { countdown.stop(); countdown = null; }
    var n = state.i + delta;
    while (delta < 0 && n > 0 && state.steps[n].kind === "rest") n--;   // never sit through a rest twice
    state.i = Math.max(0, Math.min(state.steps.length - 1, n));
    save(); render();
  }

  function finish() {
    var finished = new Date().toISOString();
    var dur = Math.round((new Date(finished) - new Date(state.startedAt)) / 1000);
    var session = P.sessions.find(function (s) { return s.key === state.key; });
    var sets = Object.keys(state.logs).length;
    Store.saveWorkout({ id: state.workoutId, user_id: state.userId, session_key: state.key,
      block: session.block, week_start: state.weekStart, started_at: state.startedAt,
      finished_at: finished, duration_seconds: dur });
    Sound.done(); unmount(); clear();
    onExit && onExit({ finished: true, duration: dur, sets: sets });
  }

  // ---------------------------------------------------------------- chrome
  function progressBar(step) {
    return '<div class="progress" aria-hidden="true">' + state.segments.map(function (s, ix) {
      return '<i class="' + (ix < step.seg ? "done" : ix === step.seg ? "now" : "") + '"></i>'; }).join("") + "</div>";
  }
  function header(step, sub) {
    return '<div class="row">' +
      '<button class="btn btn--quiet btn--icon" data-act="quit" aria-label="Leave session">' + ICONS.xmark + "</button>" +
      '<div class="grow" style="text-align:center"><div class="eyebrow">' + esc(state.title) + '</div>' +
      '<div class="dim" style="font-size:13px">' + esc(sub || "") + "</div></div>" +
      '<span style="width:44px"></span></div>' + progressBar(step);
  }
  function footer(label) {
    return '<div class="actions">' +
      '<button class="btn btn--ghost" data-act="back"' + (state.i === 0 ? " disabled" : "") + ">Back</button>" +
      '<button class="btn btn--primary btn--big" data-act="next">' + esc(label) + "</button></div>" +
      '<div class="swipe-hint">swipe left when done · right to go back</div>';
  }

  function render() {
    var step = state.steps[state.i];
    setResting(step.kind === "rest");
    if (step.kind === "warmup") renderWarmup(step);
    else if (step.kind === "round") renderRound(step);
    else if (step.kind === "rest") renderRest(step);
    else if (step.kind === "tabata") renderTabata(step);
    else renderDone();
  }

  // ---------------------------------------------------------------- warm-up
  /* The coach's warm-up text is a heading, an instruction ("1 round, 8/10 reps
     each exercise:") and then every movement listed again. The grid already
     names each movement, so only the lines up to the instruction are shown —
     the full list pushed the Done button off a phone screen. */
  function warmupInstruction(text) {
    var lines = String(text || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var cut = lines.findIndex(function (l) { return /rep|round/i.test(l); });
    return (cut === -1 ? lines.slice(0, 1) : lines.slice(0, cut + 1)).join("\n").replace(/:\s*$/, "");
  }

  function renderWarmup(step) {
    var instr = warmupInstruction(step.text);
    container.innerHTML = header(step, "Warm-up · " + step.exercises.length + " movements") +
      '<section class="screen" id="scr">' +
        (instr ? '<div class="note">' + esc(instr) + "</div>" : "") +
        '<div class="thumb-grid">' + step.exercises.map(function (e) {
          var img = preview(e.id);
          return '<button class="thumb" data-zoom="' + esc(e.id) + '">' +
            (img ? '<img src="' + img + '" alt="" loading="lazy">' : '<span class="thumb__none"></span>') +
            '<span class="thumb__name">' + esc(e.name) + "</span></button>";
        }).join("") + "</div>" +
        footer("Warm-up done ✓") +
      "</section>";
    bind(step);
  }

  // ---------------------------------------------------------------- one round
  function renderRound(step) {
    var sub = "Block " + step.block + " · round " + step.round + " of " + step.rounds;
    container.innerHTML = header(step, sub) +
      '<section class="screen" id="scr">' +
        '<div class="round-head"><h2>' + esc(step.blockName) + "</h2>" +
          (step.restRef ? '<span class="badge badge--cool">' + esc(step.restRef) + "</span>" : "") + "</div>" +
        // Three or more movements (the core circuits) get a denser card so the
        // whole round — and the Done button — still fits one phone screen.
        '<div class="ex-list' + (step.items.length >= 3 ? " ex-list--dense" : "") + '">' +
          step.items.map(exerciseCard).join("") + "</div>" +
        footer(step.round < step.rounds ? "Round " + step.round + " done ✓" : "Block done ✓") +
      "</section>";
    bind(step);
  }

  function exerciseCard(it, ix) {
    var e = it.exercise, id = e.id, img = preview(id);
    var prev = state.logs[it.setId] || null;
    // Same round last time if there is one (pyramids climb each round), else
    // whatever was lifted last for this exercise.
    var lastAll = state.last[id] || null;
    var last = lastAll && lastAll.byRound && lastAll.byRound[it.round] && lastAll.byRound[it.round].weight != null
      ? lastAll.byRound[it.round] : lastAll;
    var timed = !!it.target.timed;
    var w = prev ? prev.weight : (last && last.weight != null ? last.weight : "");
    var r = prev ? prev.reps : (typeof it.target.n === "number" ? it.target.n : "");
    if (r == null) r = "";
    /* Logging is folded away (Javier, 12 Sep 2026): most sets are done with
       whatever weight is to hand and only a few movements are worth tracking,
       so a pair of boxes on every card was clutter. The weight sits behind one
       tap; the reps sit behind a second, because they are almost never changed.
       MAX sets (chin-ups) have no target, so their reps box opens with the
       weight rather than hiding another level down. */
    var needsBox = it.target.n === "MAX" || r === "";
    var unitWord = timed ? "Seconds" : "Reps";
    var target = typeof it.target.n === "number" ? it.target.n : null;
    var repsEdited = target != null && r !== "" && +r !== target;
    /* Two icons in the card's bottom corners (Javier, 12 Sep 2026): a dumbbell
       bottom-left opens the weight, an arrows-repeat bottom-right opens the
       reps. Just the icon when there is nothing to say; the number beside it
       when there is. The weight box is PREFILLED with last time's weight, so
       the value alone can't tell the two apart — `prev` is what says this round
       was logged here. A carried-over weight shows in the accent. */
    var wLabel = prev && prev.weight != null
      ? '<b class="logbtn__v">' + esc(prev.weight) + "</b>"
      : (w !== "" && w != null ? '<b class="logbtn__v logbtn__v--last">' + esc(w) + "</b>" : "");
    var rLabel = repsEdited ? '<b class="logbtn__v logbtn__v--last">' + esc(r) + "</b>" : "";
    return '<article class="ex-card">' +
      '<button class="ex-card__thumb" data-zoom="' + esc(id) + '" aria-label="Show ' + esc(e.name) + ' larger">' +
        (img ? '<img src="' + img + '" alt="">' : "") + "</button>" +
      '<div class="ex-card__body">' +
        '<div class="ex-card__label">' + esc(it.label) + "</div>" +
        '<div class="ex-card__name">' + esc(e.name) + "</div>" +
        '<div class="ex-card__target' + (repsEdited ? " is-edited" : "") + '" data-target-for="' + ix + '"' +
          (target != null ? ' data-target="' + esc(target) + '"' : "") + ">" +
          '<span data-target-n="' + ix + '">' + esc(repsEdited ? r : it.target.n) + "</span> <small>" + esc(it.target.unit) + "</small>" +
          (target != null
            ? ' <button class="target__reset" type="button" data-repsreset="' + ix + '"' +
              ' aria-label="Back to ' + esc(target) + ' ' + esc(it.target.unit) + '"' + (repsEdited ? "" : " hidden") + ">\u21ba</button>"
            : "") +
        "</div>" +
        (it.note ? '<div class="ex-card__cue">' + esc(it.note) + "</div>" : "") +
      "</div>" +
      '<div class="ex-card__log">' +
        (timed ? '<button class="btn btn--hold" data-hold="' + ix + '" data-side="1">' + ICONS.play +
          '<span class="hold__long">Start </span>' + esc(it.target.n) + ' s<span class="hold__long"> timer</span>' +
          (e.per_side ? " · side 1" : "") + "</button>" : "") +
        '<div class="logbtns">' +
          '<button class="logbtn" type="button" data-logtoggle="' + ix + '" aria-expanded="false" aria-controls="log' + ix + '"' +
            ' aria-label="Weight in kilos">' + ICONS.dumbbell + wLabel + "</button>" +
          (needsBox ? "" :
            '<button class="logbtn logbtn--r" type="button" data-repstoggle="' + ix + '" aria-expanded="false"' +
              ' aria-label="Change ' + (timed ? "seconds" : "reps") + '">' + rLabel + ICONS.arrowsRepeat + "</button>") +
        "</div>" +
      "</div>" +
      '<div class="logpanel" id="log' + ix + '" data-logpanel="' + ix + '" hidden>' +
        '<div class="logfield"><label for="w' + ix + '">kg</label>' +
          '<input class="input input--sm input--num" id="w' + ix + '" data-w="' + ix + '" inputmode="decimal" placeholder="\u2014" value="' + esc(w) + '">' +
          '<button class="logok" type="button" data-logdone="' + ix + '" aria-label="Done">' + ICONS.check + "</button></div>" +
        (needsBox
          ? '<div class="logfield"><label for="r' + ix + '">' + (timed ? "sec" : "reps") + "</label>" +
            '<input class="input input--sm input--num" id="r' + ix + '" data-r="' + ix + '" inputmode="numeric" placeholder="' + (it.target.n === "MAX" ? "how many?" : "\u2014") + '" value="' + esc(r) + '">' +
            '<button class="logok" type="button" data-logdone="' + ix + '" aria-label="Done">' + ICONS.check + "</button></div>"
          : "") +
      "</div>" +
      (needsBox ? "" :
        '<div class="logpanel logpanel--reps" data-repsbox="' + ix + '" hidden>' +
          '<div class="logfield"><label for="r' + ix + '">' + (timed ? "sec" : "reps") + "</label>" +
            '<input class="input input--sm input--num" id="r' + ix + '" data-r="' + ix + '" inputmode="numeric" value="' + esc(r) + '" aria-label="' + unitWord + '">' +
            '<button class="logok" type="button" data-repsdone="' + ix + '" aria-label="Done">' + ICONS.check + "</button></div>" +
          '<button class="logpanel__reset" type="button" data-repsreset="' + ix + '">Back to ' + esc(target) + "</button>" +
        "</div>") +
      "</article>";
  }

  /* Keep the folded views honest about what the hidden inputs hold. */
  function syncChip(ix) {
    var inp = container.querySelector('[data-w="' + ix + '"]');
    var btn = container.querySelector('[data-logtoggle="' + ix + '"]');
    if (!inp || !btn) return;
    var v = inp.value.trim();
    btn.innerHTML = ICONS.dumbbell + (v !== "" ? '<b class="logbtn__v">' + esc(v) + "</b>" : "");
  }
  function syncTarget(ix) {
    var inp = container.querySelector('[data-r="' + ix + '"]');
    var line = container.querySelector('[data-target-for="' + ix + '"]');
    if (!inp || !line) return;
    var nSpan = line.querySelector('[data-target-n="' + ix + '"]');
    var reset = line.querySelector(".target__reset");
    var target = line.getAttribute("data-target");      // one source of truth
    var v = inp.value.trim();
    if (nSpan && v !== "") nSpan.textContent = v;
    var edited = target != null && v !== "" && +v !== +target;
    line.classList.toggle("is-edited", edited);
    if (reset) reset.hidden = !edited;
    // the corner button carries the changed number too
    var rBtn = container.querySelector('[data-repstoggle="' + ix + '"]');
    if (rBtn) rBtn.innerHTML = (edited ? '<b class="logbtn__v logbtn__v--last">' + esc(v) + "</b>" : "") + ICONS.arrowsRepeat;
  }

  function logRound(step) {
    ensureWorkout();
    step.items.forEach(function (it, ix) {
      var wEl = container.querySelector('[data-w="' + ix + '"]'), rEl = container.querySelector('[data-r="' + ix + '"]');
      var weight = wEl && wEl.value.trim() !== "" ? parseFloat(wEl.value.replace(",", ".")) : null;
      var reps = rEl && rEl.value.trim() !== "" ? parseInt(rEl.value, 10) : null;
      if (weight != null && isNaN(weight)) weight = null;
      if (reps != null && isNaN(reps)) reps = null;
      var row = { id: it.setId, workout_id: state.workoutId, user_id: state.userId, block_letter: step.block,
        round: step.round, exercise_id: it.exercise.id, exercise_name: it.exercise.name,
        weight: weight, reps: it.target.timed ? null : reps, seconds: it.target.timed ? reps : null,
        skipped: false, done_at: new Date().toISOString() };
      state.logs[it.setId] = { weight: weight, reps: reps };
      Store.saveSet(row);
    });
  }

  // ---------------------------------------------------------------- wiring
  function advance(step) {
    if (step.kind === "round") logRound(step);
    slide("out", function () { go(1); });
  }
  function slide(cls, then) {
    var el = document.getElementById("scr");
    if (!el) { then(); return; }
    el.classList.add(cls); setTimeout(then, 170);
  }

  function bind(step) {
    container.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "next") advance(step);
        else if (a === "back") slide("back", function () { go(-1); });
        else if (a === "skip") go(1);
        else if (a === "extend") { if (countdown) countdown.extend(30); }
        else if (a === "finish") finish();
        else if (a === "quit") {
          UI.confirm({ title: "Leave this session?", body: "What you’ve logged is kept. You can pick it up again from the home screen.",
                       confirm: "Leave", cancel: "Keep going" })
            .then(function (ok) { if (ok) { unmount(); onExit && onExit({ finished: false }); } });
        }
      });
    });
    container.querySelectorAll("[data-zoom]").forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); zoom(b.getAttribute("data-zoom")); });
    });
    /* Fold the weight open, and the reps one level below it. The inputs stay
       in the DOM either way, so logRound still reads them by data-w/data-r —
       hiding them must never change what gets saved. */
    container.querySelectorAll("[data-logtoggle]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ix = b.getAttribute("data-logtoggle");
        var panel = container.querySelector('[data-logpanel="' + ix + '"]');
        var open = panel.hidden;
        panel.hidden = !open;
        b.setAttribute("aria-expanded", String(open));
        if (open) { var f = panel.querySelector("input"); if (f) { f.focus(); f.select(); } }
      });
    });
    container.querySelectorAll("[data-repstoggle]").forEach(function (b) {
      b.addEventListener("click", function () {
        var box = container.querySelector('[data-repsbox="' + b.getAttribute("data-repstoggle") + '"]');
        var open = box.hidden;
        box.hidden = !open;
        b.setAttribute("aria-expanded", String(open));
        if (open) { var f = box.querySelector("input"); if (f) { f.focus(); f.select(); } }
      });
    });
    /* The tick is "I'm done typing" — it folds the panel away. The value is
       already held by the input; the round is what actually saves it. */
    container.querySelectorAll("[data-logdone]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ix = b.getAttribute("data-logdone");
        var panel = container.querySelector('[data-logpanel="' + ix + '"]');
        var t = container.querySelector('[data-logtoggle="' + ix + '"]');
        if (panel) panel.hidden = true;
        if (t) t.setAttribute("aria-expanded", "false");
      });
    });
    container.querySelectorAll("[data-repsdone]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ix = b.getAttribute("data-repsdone");
        var box = container.querySelector('[data-repsbox="' + ix + '"]');
        var t = container.querySelector('[data-repstoggle="' + ix + '"]');
        if (box) box.hidden = true;
        if (t) t.setAttribute("aria-expanded", "false");
      });
    });
    container.querySelectorAll("[data-repsreset]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var ix = b.getAttribute("data-repsreset");
        var inp = container.querySelector('[data-r="' + ix + '"]');
        var line = container.querySelector('[data-target-for="' + ix + '"]');
        if (inp && line) { inp.value = line.getAttribute("data-target") || ""; syncTarget(ix); }
      });
    });
    // The folded button and the big target line both mirror what is typed, so
    // closing the panel never hides a change you just made.
    container.querySelectorAll("[data-w]").forEach(function (inp) {
      inp.addEventListener("input", function () { syncChip(inp.getAttribute("data-w")); });
    });
    container.querySelectorAll("[data-r]").forEach(function (inp) {
      inp.addEventListener("input", function () { syncTarget(inp.getAttribute("data-r")); });
    });
    container.querySelectorAll("[data-hold]").forEach(function (b) {
      b.addEventListener("click", function () { startHold(step.items[+b.getAttribute("data-hold")], b); });
    });
    var scr = document.getElementById("scr");
    if (scr) bindSwipe(scr, step);
  }

  function zoom(id) {
    var e = P.exercises[id] || {}, img = preview(id);
    var ov = document.createElement("div");
    ov.className = "zoom";
    ov.innerHTML = (img ? '<img src="' + img + '" alt="">' : "") + '<div class="zoom__name">' + esc(e.name || "") + "</div>" +
      '<div class="faint" style="font-size:13px">tap anywhere to close</div>';
    ov.addEventListener("click", function () { ov.remove(); });
    document.body.appendChild(ov);
  }

  /* Timed hold (30″ plank…): takes over the whole screen, like the rest timer
     but orange — you can't read a small button face-down in a plank. A 3-2-1
     "get ready" first, so there's time to get into position after the tap.
     Per-side holds offer side 2 on the same screen. */
  function startHold(it, btn) {
    Sound.unlock();
    if (countdown) { countdown.stop(); countdown = null; }
    var sides = it.exercise.per_side ? 2 : 1, side = +btn.getAttribute("data-side") || 1;
    var R = 44, C = 2 * Math.PI * R, total = it.target.n;
    var ov = document.createElement("div");
    ov.className = "hold-screen";
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Hold timer");
    ov.innerHTML =
      '<div class="hold-screen__name">' + esc(it.exercise.name) + "</div>" +
      '<div class="hold-screen__side" id="hsd"></div>' +
      '<div class="rest__ring hold-screen__ring"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="' + R + '"/>' +
      '<circle class="arc" id="harc" cx="50" cy="50" r="' + R + '" stroke-dasharray="' + C + '" stroke-dashoffset="0"/></svg>' +
      '<div class="rest__time" id="ht"></div></div>' +
      '<div class="hold-screen__phase" id="hp"></div>' +
      '<div class="hold-screen__actions" id="ha"></div>';
    document.body.appendChild(ov);
    var ht = ov.querySelector("#ht"), hp = ov.querySelector("#hp"), ha = ov.querySelector("#ha"), arc = ov.querySelector("#harc"), hsd = ov.querySelector("#hsd");

    function actions(html) {
      ha.innerHTML = html;
      ha.querySelectorAll("[data-h]").forEach(function (b) {
        b.addEventListener("click", function () {
          var a = b.getAttribute("data-h");
          if (a === "stop" || a === "close") close(a === "close");
          else if (a === "next") { side++; btn.setAttribute("data-side", side); lead(); }
        });
      });
    }
    function close(finished) {
      if (countdown) { countdown.stop(); countdown = null; }
      ov.remove();
      if (finished) { btn.classList.add("is-done"); btn.innerHTML = 'Done ✓<span class="hold__long"> — swipe when ready</span>'; }
      else if (side > 1 && side <= sides) { btn.innerHTML = ICONS.play + '<span class="hold__long">Start </span>side ' + side; }
    }
    function lead() {
      hsd.textContent = sides > 1 ? "side " + side + " of " + sides : "";
      ov.classList.remove("is-holding", "is-done");
      hp.textContent = "Get ready"; arc.style.strokeDashoffset = "0";
      actions('<button class="btn btn--ghost" data-h="stop">Cancel</button>');
      countdown = new Countdown(3, { cues: false,
        onTick: function (l) { ht.textContent = l > 0 ? String(l) : ""; if (l > 0) Sound.count(); },
        onDone: function () { countdown = null; Sound.go(); hold(); } });
    }
    function hold() {
      ov.classList.add("is-holding");
      hp.textContent = "Hold";
      actions('<button class="btn btn--ghost" data-h="stop">Stop</button>');
      countdown = new Countdown(total, { endSound: Sound.done,
        onTick: function (l, t) { ht.textContent = String(l); arc.style.strokeDashoffset = String(C * (1 - l / t)); },
        onDone: function () {
          countdown = null; ov.classList.remove("is-holding"); ov.classList.add("is-done");
          if (side < sides) {
            hp.textContent = "Side " + side + " done ✓"; ht.textContent = "✓";
            actions('<button class="btn btn--ghost" data-h="stop">Close</button><button class="btn btn--primary" data-h="next">Start side ' + (side + 1) + "</button>");
          } else {
            hp.textContent = "Done ✓"; ht.textContent = "✓";
            actions('<button class="btn btn--primary btn--block" data-h="close">Back to the round</button>');
            setTimeout(function () { if (document.body.contains(ov)) close(true); }, 1800);
          }
        } });
    }
    lead();
  }

  // Swipe left = done, right = back. Must be clearly horizontal, so scrolling
  // a tall round never fires it, and never starts on an input.
  /* Swipe, card-deck style (Javier, 12 Sep 2026 — "more like Tinder").
     Three things make it feel like a card rather than a slide:
       - it tilts as it travels, and the tilt flips depending on whether you
         grabbed above or below the middle, so it pivots around your thumb;
       - a flick counts even if it is short, because velocity is judged as well
         as distance — a fast 60px flick is a decision, a slow 100px drag is a
         look;
       - under the threshold it settles back instead of snapping, so nothing
         moves without being animated.
     No overshoot on the way back: this is UI, not a toy. */
  /* These three are DeHetSwipe's own numbers, read from its engine.js so the
     two apps feel identical in the hand: threshold 80px, rotation 0.15deg per
     px dragged, and distance only — no velocity, so a flick that doesn't
     travel never counts. Change them in both places or not at all. */
  var SWIPE_THRESHOLD = 80;
  var ROTATION_FACTOR = 0.15;

  function bindSwipe(el, step) {
    var x0 = 0, y0 = 0, dx = 0, dy = 0, active = false, horizontal = null;

    function paint() {
      el.style.transform = "translateX(" + dx + "px) rotate(" + (dx * ROTATION_FACTOR).toFixed(2) + "deg)";
      // the hint under the card strengthens as you approach the threshold,
      // which is how DeHetSwipe tells you the swipe has registered
      var progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      el.classList.toggle("swipe-left", dx < -20);
      el.classList.toggle("swipe-right", dx > 20);
      el.style.setProperty("--swipe-progress", progress.toFixed(2));
    }
    function settle() {
      el.classList.remove("swiping", "swipe-left", "swipe-right");
      el.style.transform = ""; el.style.opacity = "";
      el.style.removeProperty("--swipe-progress");
    }
    function fling(dir, then) {
      el.classList.remove("swiping", "swipe-left", "swipe-right");
      el.style.transform = ""; el.style.opacity = "";   // let the keyframe own it
      el.classList.add(dir < 0 ? "out" : "back");
      setTimeout(then, 400);                            // matches the animation
    }

    el.addEventListener("touchstart", function (ev) {
      if (ev.target.closest("input, button, a")) { active = false; return; }
      var t = ev.touches[0];
      x0 = t.clientX; y0 = t.clientY; dx = dy = 0;
      active = true; horizontal = null;
    }, { passive: true });

    el.addEventListener("touchmove", function (ev) {
      if (!active) return;
      var t = ev.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
      if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my) * 1.3;
      if (!horizontal) return;
      dx = mx; dy = my;
      el.classList.add("swiping");
      paint();
    }, { passive: true });

    el.addEventListener("touchend", function () {
      if (!active) return;
      active = false;
      if (!horizontal) { settle(); return; }
      if (Math.abs(dx) < SWIPE_THRESHOLD) { settle(); return; }
      if (dx < 0) {
        if (step.kind === "round") logRound(step);
        fling(-1, function () { go(1); });
      } else if (state.i > 0) {
        fling(1, function () { go(-1); });
      } else settle();
    });

    el.addEventListener("touchcancel", function () { active = false; settle(); });
  }

  // ---------------------------------------------------------------- rest
  function renderRest(step) {
    // Radius + half the stroke (10/2) must stay inside the 100-unit viewBox:
    // 46 + 5 = 51 cropped the ring at the edges. 44 + 5 = 49 fits.
    var R = 44, C = 2 * Math.PI * R;
    container.innerHTML = header(step, "Block " + step.block + " · rest") +
      '<section class="rest">' +
        '<div class="rest__ring"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="' + R + '"/>' +
        '<circle class="arc" id="arc" cx="50" cy="50" r="' + R + '" stroke-dasharray="' + C + '" stroke-dashoffset="0"/></svg>' +
        '<div class="rest__time" id="t"></div></div>' +
        '<div class="rest__next">Next · round ' + step.nextRound + " of " + step.rounds + "<br><b>" + step.next.map(esc).join(" + ") + "</b></div>" +
        '<div class="rest__actions"><button class="btn btn--ghost" data-act="extend">+30″</button>' +
        '<button class="btn btn--primary" data-act="skip">Skip →</button></div>' +
      "</section>";
    bind(step);
    var t = document.getElementById("t"), arc = document.getElementById("arc");
    countdown = new Countdown(step.seconds, {
      onTick: function (l, total) {
        t.textContent = l >= 60 ? Math.floor(l / 60) + ":" + String(l % 60).padStart(2, "0") : String(l);
        arc.style.strokeDashoffset = String(C * (1 - l / total));
        if (l <= 10) arc.classList.add("final");
      },
      onDone: function () { countdown = null; go(1); },
    });
  }

  // ---------------------------------------------------------------- tabata
  function renderTabata(step) {
    var tb = step.tabata, moves = tb.exercises, cycles = tb.cycles || 8, phase = "work", cycle = 1;
    // Before starting: both movements as reference. Once running: only the one
    // being done, big; rest phases are a plain blue screen with the countdown.
    container.innerHTML = header(step, "Block " + step.block + " · Tabata") +
      '<section class="tabata" id="tab">' +
        '<div class="thumb-grid thumb-grid--2">' + moves.map(function (m) {
          var img = preview(m.id);
          return '<button class="thumb" data-zoom="' + esc(m.id) + '">' + (img ? '<img src="' + img + '" alt="">' : "") +
            '<span class="thumb__name">' + esc(m.name) + "</span></button>"; }).join("") + "</div>" +
        '<div class="tabata__phase">Ready</div>' +
        '<div class="tabata__time">' + tb.work_seconds + "/" + tb.rest_seconds + "</div>" +
        '<div class="tabata__cycle">' + cycles + " cycles · 4 min · alternating</div>" +
        '<button class="btn btn--primary btn--big btn--block" id="tstart">Start Tabata</button>' +
        '<button class="btn btn--quiet" data-act="skip">Skip block</button>' +
      "</section>";
    bind(step);

    function startRun() {
      var tab = document.getElementById("tab");
      tab.innerHTML =
        '<div class="tabata__phase" id="ph"></div>' +
        '<div class="tabata__gif" id="gif"></div>' +
        '<div class="tabata__time" id="t"></div>' +
        '<div class="tabata__move" id="mv"></div>' +
        '<div class="tabata__cycle" id="cy"></div>' +
        '<button class="btn btn--quiet" data-act="skip">Skip block</button>';
      bind(step);
      run();
    }
    function show() {
      var m = moves[(cycle - 1) % moves.length] || {}, next = moves[cycle % moves.length] || {};
      var ph = document.getElementById("ph"), gif = document.getElementById("gif");
      var mv = document.getElementById("mv"), cy = document.getElementById("cy");
      ph.textContent = phase === "work" ? "Work" : "Rest"; ph.className = "tabata__phase " + phase;
      if (phase === "work") {
        var img = preview(m.id);
        gif.innerHTML = img ? '<img src="' + img + '" alt="">' : ""; gif.hidden = !img;
        mv.textContent = m.name || "";
      } else {
        gif.hidden = true; gif.innerHTML = "";
        mv.textContent = "next: " + (next.name || "");
      }
      cy.textContent = "cycle " + cycle + " of " + cycles;
      setResting(phase === "rest");
    }
    function run() {
      show();
      var t = document.getElementById("t");
      countdown = new Countdown(phase === "work" ? tb.work_seconds : tb.rest_seconds, { cues: false,
        onTick: function (l) { t.textContent = String(l); if (l <= 3 && l > 0) Sound.count(); },
        onDone: function () {
          countdown = null;
          if (phase === "work") { phase = "rest"; Sound.halfway(); run(); }
          else { cycle++; if (cycle > cycles) { setResting(false); Sound.done(); go(1); return; } phase = "work"; Sound.go(); run(); }
        } });
    }
    document.getElementById("tstart").addEventListener("click", function () { Sound.unlock(); Sound.go(); startRun(); });
  }

  // ---------------------------------------------------------------- done
  function renderDone() {
    var n = Object.keys(state.logs).length;
    var mins = Math.round((Date.now() - new Date(state.startedAt)) / 60000);
    container.innerHTML = header(state.steps[state.i], "") +
      '<section class="rest"><div class="eyebrow">Session complete</div><h1>' + esc(state.title) + "</h1>" +
      '<p class="dim">' + mins + " min · " + n + " sets logged</p>" +
      '<button class="btn btn--primary btn--big btn--block" data-act="finish">Save & finish</button>' +
      '<button class="btn btn--quiet" data-act="back">Back</button></section>';
    bind(state.steps[state.i]);
  }

  return { start: start, resume: resume, mount: mount, unmount: unmount, abandon: abandon, pending: pending,
           current: function () { return state; } };
})();
