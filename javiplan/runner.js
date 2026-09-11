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
  var SAVE_KEY = "javiplan.session";
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
    if (e.seconds) return { n: e.seconds, unit: "sec", timed: true };
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
          after: r === rounds ? (rounds > 1 ? "Last round" : null)
               : b.rest_seconds > 0 ? restLabel(b.rest_seconds) : (b.rest_note || "No rest"),
          items: b.exercises.map(function (e, ix) {
            return { exercise: e, label: b.exercises.length > 1 ? b.letter + (ix + 1) : b.letter,
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
      steps: built.steps, segments: built.segments, last: opts.last || {}, logs: {} };
    Store.saveWorkout({ id: state.workoutId, user_id: state.userId, session_key: sessionKey,
      block: session.block, week_start: state.weekStart, started_at: state.startedAt });
    save();
  }
  function resume() { state = pending(); return !!state; }
  function mount(el, exit) { container = el; onExit = exit; Sound.unlock(); WakeLock.on(); render(); }
  function unmount() { if (countdown) { countdown.stop(); countdown = null; } WakeLock.off(); }
  function abandon() { unmount(); clear(); onExit && onExit(); }

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
      '<button class="btn btn--quiet" data-act="quit" aria-label="Leave session">✕</button>' +
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
          (step.after ? '<span class="badge badge--cool">' + esc(step.after) + "</span>" : "") + "</div>" +
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
    var last = state.last[id] || null;
    var timed = !!it.target.timed;
    var w = prev ? prev.weight : (last && last.weight != null ? last.weight : "");
    var r = prev ? prev.reps : (typeof it.target.n === "number" ? it.target.n : "");
    return '<article class="ex-card">' +
      '<button class="ex-card__thumb" data-zoom="' + esc(id) + '" aria-label="Show ' + esc(e.name) + ' larger">' +
        (img ? '<img src="' + img + '" alt="">' : "") + "</button>" +
      '<div class="ex-card__body">' +
        '<div class="ex-card__label">' + esc(it.label) + "</div>" +
        '<div class="ex-card__name">' + esc(e.name) + "</div>" +
        '<div class="ex-card__target">' + esc(it.target.n) + " <small>" + esc(it.target.unit) + "</small></div>" +
        (it.note ? '<div class="ex-card__cue">' + esc(it.note) + "</div>" : "") +
      "</div>" +
      '<div class="ex-card__log">' +
        '<label><span>kg</span><input class="input input--sm" data-w="' + ix + '" inputmode="decimal" placeholder="—" value="' + esc(w) + '"></label>' +
        '<label><span>' + (timed ? "sec" : "reps") + '</span><input class="input input--sm" data-r="' + ix + '" inputmode="numeric" placeholder="—" value="' + esc(r) + '"></label>' +
        (timed ? '<button class="btn btn--ghost btn--sm" data-hold="' + ix + '">▶ ' + esc(it.target.n) + "″</button>" : "") +
      "</div>" +
      (last && last.weight != null ? '<div class="ex-card__last">last time ' + esc(last.weight) + " kg" + (last.reps ? " × " + esc(last.reps) : "") + "</div>" : "") +
      "</article>";
  }

  function logRound(step) {
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
        else if (a === "quit") { if (confirm("Leave this session? What you’ve logged so far is saved.")) { unmount(); onExit && onExit({ finished: false }); } }
      });
    });
    container.querySelectorAll("[data-zoom]").forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.stopPropagation(); zoom(b.getAttribute("data-zoom")); });
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

  function startHold(it, btn) {
    Sound.unlock(); btn.disabled = true;
    if (countdown) countdown.stop();
    countdown = new Countdown(it.target.n, {
      onTick: function (l) { btn.textContent = l + "″"; },
      onDone: function () { btn.textContent = "✓"; countdown = null; },
    });
  }

  // Swipe left = done, right = back. Must be clearly horizontal, so scrolling
  // a tall round never fires it, and never starts on an input.
  function bindSwipe(el, step) {
    var x0 = 0, y0 = 0, dx = 0, active = false, horizontal = null;
    el.addEventListener("touchstart", function (ev) {
      if (ev.target.closest("input, button")) { active = false; return; }
      var t = ev.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; active = true; horizontal = null;
    }, { passive: true });
    el.addEventListener("touchmove", function (ev) {
      if (!active) return;
      var t = ev.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
      if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my) * 1.3;
      if (!horizontal) return;
      dx = mx; el.classList.add("swiping");
      el.style.transform = "translateX(" + dx + "px)";
      el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 420));
    }, { passive: true });
    el.addEventListener("touchend", function () {
      if (!active) return;
      active = false; el.classList.remove("swiping");
      if (horizontal && dx < -90) { if (step.kind === "round") logRound(step); el.classList.add("out"); setTimeout(function () { go(1); }, 170); }
      else if (horizontal && dx > 90 && state.i > 0) { el.classList.add("back"); setTimeout(function () { go(-1); }, 170); }
      else { el.style.transform = ""; el.style.opacity = ""; }
    });
  }

  // ---------------------------------------------------------------- rest
  function renderRest(step) {
    var R = 46, C = 2 * Math.PI * R;
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
    container.innerHTML = header(step, "Block " + step.block + " · Tabata") +
      '<section class="tabata">' +
        '<div class="thumb-grid thumb-grid--2">' + moves.map(function (m) {
          var img = preview(m.id);
          return '<button class="thumb" data-zoom="' + esc(m.id) + '">' + (img ? '<img src="' + img + '" alt="">' : "") +
            '<span class="thumb__name">' + esc(m.name) + "</span></button>"; }).join("") + "</div>" +
        '<div class="tabata__phase" id="ph">Ready</div>' +
        '<div class="tabata__time" id="t">' + tb.work_seconds + "/" + tb.rest_seconds + "</div>" +
        '<div class="tabata__move" id="mv"></div>' +
        '<div class="tabata__cycle" id="cy">' + cycles + " cycles · 4 min</div>" +
        '<button class="btn btn--primary btn--big btn--block" id="tstart">Start Tabata</button>' +
        '<button class="btn btn--quiet" data-act="skip">Skip block</button>' +
      "</section>";
    bind(step);
    var ph = document.getElementById("ph"), t = document.getElementById("t"), mv = document.getElementById("mv"), cy = document.getElementById("cy");
    function show() {
      var m = moves[(cycle - 1) % moves.length] || {};
      ph.textContent = phase === "work" ? "Work" : "Rest"; ph.className = "tabata__phase " + phase;
      mv.textContent = phase === "work" ? (m.name || "") : "next: " + ((moves[cycle % moves.length] || {}).name || "");
      cy.textContent = "cycle " + cycle + " of " + cycles;
    }
    function run() {
      show();
      countdown = new Countdown(phase === "work" ? tb.work_seconds : tb.rest_seconds, { cues: false,
        onTick: function (l) { t.textContent = String(l); if (l <= 3 && l > 0) Sound.count(); },
        onDone: function () {
          countdown = null;
          if (phase === "work") { phase = "rest"; Sound.halfway(); run(); }
          else { cycle++; if (cycle > cycles) { Sound.done(); go(1); return; } phase = "work"; Sound.go(); run(); }
        } });
    }
    document.getElementById("tstart").addEventListener("click", function () { Sound.unlock(); this.remove(); Sound.go(); run(); });
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
