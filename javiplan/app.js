/* Javi Plan — views and routing. The runner (runner.js) owns a session once it
 * starts; this file owns everything around it: sign-in, this week's two days,
 * the plan, history, and syncing state.
 */
(function () {
  "use strict";
  var P = window.PROGRAMME, S = window.SCHEDULE;
  var app = document.getElementById("app");
  var me = null;

  /* Every screen takes a ticket when it starts drawing. A screen that waited on
     the network checks its ticket before painting and gives up if a newer
     screen started meanwhile. Without this, a slow Home painted over a newer
     screen — which is how a password-reset link ended on the plan instead of
     "Choose a new password" (11 Sep 2026). Any new async view must do the same. */
  var screen = 0;
  function ticket() { return ++screen; }
  function stale(t) { return t !== screen; }
  // True from a reset link until the new password is saved: every route shows
  // "Choose a new password" and nothing else.
  var recoveryMode = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmt(iso) { var d = new Date(iso + "T00:00:00"); return d.getDate() + " " + MONTHS[d.getMonth()]; }
  function fmtRange(startIso) {
    var a = new Date(startIso + "T00:00:00"), b = new Date(a); b.setDate(a.getDate() + 6);
    return a.getDate() + (a.getMonth() === b.getMonth() ? "–" + b.getDate() + " " + MONTHS[a.getMonth()]
      : " " + MONTHS[a.getMonth()] + " – " + b.getDate() + " " + MONTHS[b.getMonth()]);
  }
  // <input type="date"> / <input type="time"> values <-> ISO timestamps, local time.
  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateVal(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function timeVal(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function toIso(dateStr, timeStr) { return new Date(dateStr + "T" + timeStr).toISOString(); }
  function hhmm(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function longDate(iso) { return new Date(iso).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); }

  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  // ---------------------------------------------------------------- schedule
  function weekFor(dateObj) {
    var t = isoDate(dateObj);
    for (var i = 0; i < S.weeks.length; i++) {
      var w = S.weeks[i], a = new Date(w.start + "T00:00:00"), b = new Date(a); b.setDate(a.getDate() + 7);
      if (dateObj >= a && dateObj < b) return { week: w, index: i, status: "now" };
    }
    if (t < S.weeks[0].start) return { week: S.weeks[0], index: 0, status: "upcoming" };
    return { week: null, index: -1, status: "after" };
  }
  function sessionsFor(block) { return P.sessions.filter(function (s) { return s.block === block; }); }
  function sessionByKey(k) { return P.sessions.find(function (s) { return s.key === k; }); }

  // ---------------------------------------------------------------- views
  function topbar(title, back) {
    return '<div class="topbar">' +
      (back ? '<a class="btn btn--quiet" href="' + back + '">‹ Back</a>' : '<div class="row"><span class="mark"></span><b>Javi Plan</b></div>') +
      '<span class="faint" id="sync" style="font-size:12px"></span></div>' +
      (title ? "<h1>" + esc(title) + "</h1>" : "");
  }

  function renderSetup() {
    ticket();
    app.innerHTML = topbar() + '<div class="stack"><h1>Not configured</h1>' +
      '<p class="dim">config.js has no Supabase URL and key yet. Fill them in and reload.</p></div>';
  }

  // ---------------------------------------------------------------- auth screens
  /* Password input with a show/hide toggle. The toggle is a real button with a
     label and aria-pressed, so it is usable by touch and by screen reader. */
  function pwField(id, label, autocomplete) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<div class="pw-field"><input class="input" id="' + id + '" type="password" autocomplete="' + autocomplete + '" required minlength="6">' +
      '<button type="button" class="pw-toggle" data-pw="' + id + '" aria-label="Show password" aria-pressed="false">' + ICONS.eye + "</button></div></div>";
  }
  function bindPwToggles() {
    app.querySelectorAll("[data-pw]").forEach(function (b) {
      b.addEventListener("click", function () {
        var input = document.getElementById(b.getAttribute("data-pw"));
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        b.innerHTML = show ? ICONS.eyeSlash : ICONS.eye;
        b.setAttribute("aria-label", show ? "Hide password" : "Show password");
        b.setAttribute("aria-pressed", String(show));
        input.focus();
      });
    });
  }
  function friendly(err, fallback) {
    var m = (err && err.message) || "";
    if (/already registered/i.test(m)) return "You already have an account with this email — sign in instead, or use Forgot password.";
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/for security purposes|rate limit|too many|seconds/i.test(m)) return "Too many emails just now — wait a minute and try again.";
    if (/password should be at least/i.test(m)) return "Password needs at least 6 characters.";
    if (/same.*password|different from the old/i.test(m)) return "That’s your current password — choose a new one.";
    return m || fallback;
  }

  function renderLogin(msg, email) {
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">Sign in</div><h1>Javi Plan</h1>' +
      '<form id="f" class="stack" autocomplete="on">' +
        '<div class="field"><label for="e">Email</label><input class="input" id="e" type="email" autocomplete="username" required value="' + esc(email || "") + '"></div>' +
        pwField("p", "Password", "current-password") +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit">Sign in</button>' +
        '<button class="btn btn--quiet btn--block" type="button" id="fp">Forgot password?</button>' +
        ((window.JAVIPLAN_CONFIG || {}).allowSignup ? '<button class="btn btn--quiet btn--block" type="button" id="su">Create an account</button>' : "") +
      "</form></div>";
    bindPwToggles();
    var f = document.getElementById("f");
    f.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      try { me = await Store.signIn(f.e.value.trim(), f.p.value); route(); }
      catch (err) { renderLogin(friendly(err, "Could not sign in"), f.e.value.trim()); }
    });
    document.getElementById("fp").addEventListener("click", function () { renderForgot(null, f.e.value.trim()); });
    var su = document.getElementById("su");
    if (su) su.addEventListener("click", async function () {
      if (!f.e.value || !f.p.value) { renderLogin("Enter an email and a password (6+ characters) first.", f.e.value.trim()); return; }
      try {
        var r = await Store.signUp(f.e.value.trim(), f.p.value);
        if (r.session) { me = r.user; route(); }
        else renderLogin("Account created — check your email to confirm it, then sign in.", f.e.value.trim());
      } catch (err) { renderLogin(friendly(err, "Could not create the account"), f.e.value.trim()); }
    });
  }

  function renderForgot(msg, email) {
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">Forgot password</div><h1>Reset it by email</h1>' +
      '<p class="dim">We’ll email you a link. Tap it on your phone and you can choose a new password.</p>' +
      '<form id="f" class="stack">' +
        '<div class="field"><label for="e">Email</label><input class="input" id="e" type="email" autocomplete="username" required value="' + esc(email || "") + '"></div>' +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit" id="send">Send reset link</button>' +
        '<button class="btn btn--quiet btn--block" type="button" id="bk">‹ Back to sign in</button>' +
      "</form></div>";
    var f = document.getElementById("f");
    document.getElementById("bk").addEventListener("click", function () { renderLogin(null, f.e.value.trim()); });
    f.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var btn = document.getElementById("send"); btn.disabled = true; btn.textContent = "Sending…";
      try { await Store.sendReset(f.e.value.trim()); renderForgotSent(f.e.value.trim()); }
      catch (err) { renderForgot(friendly(err, "Could not send the email"), f.e.value.trim()); }
    });
  }

  function renderForgotSent(email) {
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">Check your email</div><h1>Link sent</h1>' +
      '<p class="dim">We sent a reset link to <b>' + esc(email) + '</b>. It can take a minute — check spam if it doesn’t show up.</p>' +
      '<div class="note">Tapping the link opens your browser, not this app. Set the new password there, then come back here and sign in with it.</div>' +
      '<button class="btn btn--ghost btn--block" id="bk">‹ Back to sign in</button></div>';
    document.getElementById("bk").addEventListener("click", function () { renderLogin(null, email); });
  }

  function renderSetPassword(msg, opts) {
    var o = opts || {};
    ticket();
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">' + (o.cancel ? "Change password" : "New password") + '</div><h1>Choose a new password</h1>' +
      '<form id="f" class="stack">' +
        pwField("p1", "New password", "new-password") +
        pwField("p2", "Type it again", "new-password") +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit" id="save">Save password</button>' +
        (o.cancel ? '<button class="btn btn--quiet btn--block" type="button" id="cx">Cancel</button>' : "") +
      "</form></div>";
    bindPwToggles();
    var f = document.getElementById("f");
    var cx = document.getElementById("cx");
    if (cx) cx.addEventListener("click", function () { route(); });
    f.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (f.p1.value.length < 6) { renderSetPassword("Password needs at least 6 characters.", o); return; }
      if (f.p1.value !== f.p2.value) { renderSetPassword("The two passwords don’t match.", o); return; }
      var btn = document.getElementById("save"); btn.disabled = true; btn.textContent = "Saving…";
      try {
        me = await Store.setPassword(f.p1.value);
        recoveryMode = false;
        ticket();
        app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
          '<div class="eyebrow">Done</div><h1>Password saved</h1>' +
          '<p class="dim">You’re signed in here. If you use Javi Plan from your home screen, open it there and sign in with the new password.</p>' +
          '<a class="btn btn--primary btn--big btn--block" href="#/">Continue</a></div>';
      } catch (err) { renderSetPassword(friendly(err, "Could not save the password"), o); }
    });
  }

  async function renderHome() {
    var t = ticket();
    var wf = weekFor(today());
    var pendingRun = Runner.pending();
    var html = topbar();

    if (pendingRun) {
      html += '<div class="card card--tap" id="resume"><div class="eyebrow">In progress</div>' +
        '<h2>' + esc(pendingRun.title) + '</h2><p class="dim">Started ' + new Date(pendingRun.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
        ' · step ' + (pendingRun.i + 1) + "/" + pendingRun.steps.length + "</p>" +
        '<div class="row" style="margin-top:var(--space-4)"><button class="btn btn--primary grow" id="resume-go">Resume</button>' +
        '<button class="btn btn--ghost" id="resume-drop">Discard</button></div></div>';
    }

    if (wf.status === "after") {
      html += '<div class="stack"><div class="eyebrow">Cycle 1 complete</div><h1>Next cycle to plan</h1>' +
        '<p class="dim">' + esc(S.next_cycle_note || "") + "</p></div>";
    } else {
      var w = wf.week;
      var done = await Store.doneThisWeek(me.id, w.start);
      if (stale(t)) return;
      var sessions = sessionsFor(w.block);
      html += '<div class="stack">' +
        '<div class="eyebrow">' + (wf.status === "upcoming" ? "Starts " + fmt(w.start) : "Week of " + fmtRange(w.start)) + "</div>" +
        '<h1>Block ' + w.block + ' <span class="dim" style="font-weight:500;font-size:.6em">· ' + esc(w.phase) + "</span></h1>" +
        '<p class="dim">Week ' + w.week_of_block + " of " + w.weeks_in_block + (w.note ? " · " + esc(w.note) : "") + "</p>" +
        '<div class="list" style="margin-top:var(--space-4)">' +
        sessions.map(function (s, ix) {
          var d = done[s.key];
          // Done → opens that workout (view, edit times, do it again).
          // Not done → starts the session, with "Mark as done" for a workout
          // done without the phone.
          return '<div class="card day-card' + (d ? " card--done" : "") + '">' +
            '<a class="day-card__main" href="' + (d ? "#/h/" + esc(d.id) : "#/run/" + esc(s.key)) + '">' +
            '<div class="row"><div class="grow"><div class="eyebrow">Day ' + (ix + 1) + "</div>" +
            '<h2>' + esc(s.title) + "</h2>" +
            '<p class="dim">' + (d
              ? longDate(d.started_at) + " · " + hhmm(d.started_at) + "–" + hhmm(d.finished_at)
              : s.blocks.length + " blocks · " + s.blocks.map(function (b) { return b.letter; }).join(" ")) + "</p></div>" +
            (d ? '<span class="badge badge--good">done ✓</span>' : '<span class="badge">start ›</span>') + "</div></a>" +
            (d ? "" : '<a class="day-card__alt" href="#/log/' + esc(s.key) + '">Did it without the phone? Mark as done</a>') +
            "</div>";
        }).join("") + "</div></div>";
    }

    html += '<div class="divider" style="margin:var(--space-6) 0"></div>' +
      '<div class="list">' +
        '<a class="btn btn--ghost btn--block" href="#/plan">Plan · all weeks</a>' +
        '<a class="btn btn--ghost btn--block" href="#/history">History</a>' +
        '<button class="btn btn--quiet btn--block" id="cp">Change password</button>' +
        '<button class="btn btn--quiet btn--block" id="out">Sign out</button>' +
      "</div>";
    app.innerHTML = html;
    syncBadge();
    document.getElementById("out").addEventListener("click", async function () { await Store.signOut(); me = null; route(); });
    document.getElementById("cp").addEventListener("click", function () { renderSetPassword(null, { cancel: true }); });
    if (pendingRun) {
      document.getElementById("resume-go").addEventListener("click", function () { location.hash = "#/run/" + pendingRun.key + "?resume=1"; });
      document.getElementById("resume-drop").addEventListener("click", function () {
        UI.confirm({ title: "Discard this session?", body: "Anything you logged in it is deleted too.",
                     confirm: "Discard", cancel: "Keep it", danger: true })
          .then(function (ok) { if (ok) { Runner.abandon(); route(); } });
      });
    }
  }

  function renderPlan() {
    ticket();
    var wf = weekFor(today());
    app.innerHTML = topbar("Plan", "#/") + '<p class="dim">Two days a week. Day 1 is the block’s first session, Day 2 the second.</p>' +
      '<div style="margin-top:var(--space-4)">' + S.weeks.map(function (w, ix) {
        var cls = ix < wf.index ? "past" : ix === wf.index ? "now" : "";
        var chip = ix === 0 || S.weeks[ix - 1].block !== w.block ? '<span class="badge badge--cool">' + esc(w.phase) + "</span>" : "";
        return '<div class="week-row ' + cls + '"><div class="num">' + w.block + '</div><div class="grow">' +
          "<b>" + fmtRange(w.start) + "</b> <span class=\"dim\">· week " + w.week_of_block + "/" + w.weeks_in_block + "</span>" +
          (w.note ? '<div class="faint" style="font-size:13px">' + esc(w.note) + "</div>" : "") + "</div>" + chip + "</div>";
      }).join("") +
      '<div class="week-row"><div class="num">→</div><div class="grow"><b>' + fmt(S.next_cycle_starts) + "</b><div class=\"faint\" style=\"font-size:13px\">" + esc(S.next_cycle_note) + "</div></div></div>" +
      "</div>";
  }

  async function renderHistory() {
    var t = ticket();
    app.innerHTML = topbar("History", "#/") + '<p class="dim">Loading…</p>';
    var rows = await Store.history(me.id, 120);
    if (stale(t)) return;
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
          ? (w.duration_seconds ? Math.round(w.duration_seconds / 60) + " min" : "") + (w.logged_manually ? " · logged by hand" : " · " + w.set_count + " sets")
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
  }

  /* One finished workout: read-only summary with its sets, plus the only two
     things you can change — start and end time — and "Do it again". Used for
     both the done cards on Home and History. */
  async function renderWorkout(id) {
    var t = ticket();
    var back = prevHash === "#/history" ? "#/history" : "#/";
    app.innerHTML = topbar("Workout", back) + '<p class="dim">Loading…</p>';
    var w = await Store.workout(id);
    if (stale(t)) return;
    if (!w) { app.innerHTML = topbar("Workout", back) + '<p class="dim">Couldn’t load this workout — it needs a connection.</p>'; return; }
    var sets = await Store.setsFor(id);
    if (stale(t)) return;
    var byBlock = {};
    sets.forEach(function (x) { (byBlock[x.block_letter] = byBlock[x.block_letter] || []).push(x); });
    var s = sessionByKey(w.session_key);
    var start = new Date(w.started_at), end = w.finished_at ? new Date(w.finished_at) : null;

    app.innerHTML = topbar(null, back) +
      '<div class="stack">' +
        '<div class="eyebrow">' + (w.logged_manually ? "Logged by hand" : "Done") + "</div>" +
        "<h1>" + esc(s ? s.title : "Workout " + w.session_key) + "</h1>" +
        '<p class="dim">' + longDate(w.started_at) + (w.duration_seconds ? " · " + Math.round(w.duration_seconds / 60) + " min" : "") + "</p>" +
        '<form id="tf" class="card stack">' +
          '<div class="field"><label for="d">Date</label><input class="input" id="d" type="date" value="' + dateVal(start) + '"></div>' +
          '<div class="time-row">' +
            '<div class="field"><label for="st">Start</label><input class="input" id="st" type="time" value="' + timeVal(start) + '"></div>' +
            '<div class="field"><label for="en">End</label><input class="input" id="en" type="time" value="' + (end ? timeVal(end) : "") + '"></div>' +
          "</div>" +
          '<p class="error" id="terr" hidden></p>' +
          '<button class="btn btn--ghost btn--block" type="submit" id="tsave" disabled>Save times</button>' +
        "</form>" +
        '<a class="btn btn--primary btn--big btn--block" href="#/run/' + esc(w.session_key) + '">Do it again</a>' +
        '<button class="btn btn--quiet btn--block btn--danger-text" id="del">Delete this workout</button>' +
        (Object.keys(byBlock).length ? Object.keys(byBlock).sort().map(function (L) {
          return '<div class="card"><div class="eyebrow">Block ' + esc(L) + '</div><ul class="done-list" style="padding:0;margin:var(--space-2) 0 0">' +
            byBlock[L].map(function (x) {
              var v = x.skipped ? "skipped" : [x.weight != null ? x.weight + " kg" : null, x.reps != null ? x.reps + " reps" : null, x.seconds != null ? x.seconds + "″" : null].filter(Boolean).join(" × ");
              return "<li><span>R" + x.round + " · " + esc(x.exercise_name) + "</span><span>" + esc(v || "—") + "</span></li>";
            }).join("") + "</ul></div>";
        }).join("") : '<p class="dim">' + (w.logged_manually ? "Logged by hand — no sets recorded." : "No sets recorded.") + "</p>") +
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
    var f = document.getElementById("tf"), btn = document.getElementById("tsave"), err = document.getElementById("terr");
    f.addEventListener("input", function () { btn.disabled = false; });
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var r = timesFrom(f.d.value, f.st.value, f.en.value);
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      err.hidden = true;
      var row = Object.assign({}, w, { started_at: r.start, finished_at: r.end, duration_seconds: r.seconds });
      delete row.javiplan_sets; delete row.set_count;          // view-only fields, not columns
      Store.saveWorkout(row);
      btn.disabled = true; btn.textContent = "Saved ✓";
    });
  }

  /* Shared by "Mark as done" and "Save times": date + two times → ISO, with
     the checks a tired person at 10pm needs. */
  function timesFrom(dateStr, startStr, endStr) {
    if (!dateStr || !startStr || !endStr) return { error: "Fill in the date, start and end." };
    var a = new Date(dateStr + "T" + startStr), b = new Date(dateStr + "T" + endStr);
    if (b <= a) return { error: "End has to be after start." };
    if (a > new Date()) return { error: "That start time is in the future." };
    return { start: a.toISOString(), end: b.toISOString(), seconds: Math.round((b - a) / 1000) };
  }

  function renderLog(key) {
    ticket();
    var s = sessionByKey(key);
    if (!s) { location.hash = "#/"; return; }
    var now = new Date(), from = new Date(now.getTime() - 75 * 60000);
    app.innerHTML = topbar(null, "#/") +
      '<div class="stack">' +
        '<div class="eyebrow">Mark as done</div><h1>' + esc(s.title) + "</h1>" +
        '<p class="dim">For a session done without the phone. It’s saved with its times, no weights.</p>' +
        '<form id="lf" class="card stack">' +
          '<div class="field"><label for="d">Date</label><input class="input" id="d" type="date" value="' + dateVal(now) + '"></div>' +
          '<div class="time-row">' +
            '<div class="field"><label for="st">Start</label><input class="input" id="st" type="time" value="' + timeVal(from) + '"></div>' +
            '<div class="field"><label for="en">End</label><input class="input" id="en" type="time" value="' + timeVal(now) + '"></div>' +
          "</div>" +
          '<p class="error" id="lerr" hidden></p>' +
          '<button class="btn btn--primary btn--big btn--block" type="submit">Save as done</button>' +
        "</form></div>";
    var f = document.getElementById("lf"), err = document.getElementById("lerr");
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var r = timesFrom(f.d.value, f.st.value, f.en.value);
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      var wf = weekFor(new Date(f.d.value + "T12:00"));
      Store.saveWorkout({ id: Store.uuid(), user_id: me.id, session_key: s.key, block: s.block,
        week_start: wf.week ? wf.week.start : null, started_at: r.start, finished_at: r.end,
        duration_seconds: r.seconds, logged_manually: true });
      f.querySelector("button[type=submit]").disabled = true;
      // Wait for the upload (if online) so Home shows the day as done at once.
      Promise.race([Store.flush(), new Promise(function (ok) { setTimeout(ok, 4000); })])
        .then(function () { location.hash = "#/"; });
    });
  }

  async function renderRun(key, resume) {
    var t = ticket();
    var s = sessionByKey(key);
    if (!s) { location.hash = "#/"; return; }
    if (resume && Runner.resume()) { /* state restored */ }
    else {
      var wf = weekFor(today());
      var ids = []; s.warmup.exercises.forEach(function (e) { ids.push(e.id); });
      s.blocks.forEach(function (b) { b.exercises.forEach(function (e) { if (e.id) ids.push(e.id); }); });
      var last = await Store.lastForExercises(ids, me.id);
      if (stale(t)) return;
      Runner.start(key, { userId: me.id, weekStart: wf.week ? wf.week.start : null, last: last });
    }
    app.innerHTML = '<div class="runner" id="runner"></div>';
    Runner.mount(document.getElementById("runner"), function (result) {
      location.hash = "#/";
      if (result && result.finished) {
        UI.toast("Saved · " + Math.round(result.duration / 60) + " min · " + result.sets + " sets");
      }
    });
  }

  // ---------------------------------------------------------------- sync badge
  function syncBadge() {
    var el = document.getElementById("sync"); if (!el) return;
    var n = Store.pending();
    el.textContent = !navigator.onLine ? "offline · " + n + " to sync" : n ? n + " to sync…" : "";
  }
  Store.onQueue(syncBadge);
  window.addEventListener("online", syncBadge);
  window.addEventListener("offline", syncBadge);

  // ---------------------------------------------------------------- router
  var prevHash = "#/", curHash = "#/";     // for "Back" on views reachable from two places
  async function route() {
    prevHash = curHash; curHash = location.hash || "#/";
    if (!Store.configured()) { renderSetup(); return; }
    if (recoveryMode) { renderSetPassword(); return; }
    var t = ticket();
    if (!me) me = await Store.user();
    if (stale(t) || recoveryMode) return;
    if (!me) { renderLogin(); return; }
    Store.flush();
    var h = location.hash || "#/";
    var m;
    if ((m = h.match(/^#\/run\/([\d.]+)(\?resume=1)?$/))) { renderRun(m[1], !!m[2]); return; }
    Runner.unmount();
    if (h === "#/plan") renderPlan();
    else if (h === "#/history") renderHistory();
    else if ((m = h.match(/^#\/h\/([\w-]+)$/))) renderWorkout(m[1]);
    else if ((m = h.match(/^#\/log\/([\d.]+)$/))) renderLog(m[1]);
    else renderHome();
  }
  /* Boot. A password-reset link comes back as #access_token=…&type=recovery
     (or #error=… if the link expired). That has to be read BEFORE the router
     sees the hash, or it would be mistaken for a route and the reset lost. */
  async function boot() {
    if (!Store.configured()) { renderSetup(); return; }
    var h = location.hash || "";
    var hadAuthParams = /access_token=|error_description=|type=recovery/.test(h);
    var recovery = /type=recovery/.test(h);
    var linkError = (h.match(/error_description=([^&]+)/) || [])[1];

    Store.onAuth(function (event) {
      if (event === "PASSWORD_RECOVERY") { recoveryMode = true; renderSetPassword(); }
    });
    var session = await Store.ready();              // waits for the link to be read
    if (hadAuthParams) history.replaceState(null, "", location.pathname + location.search + "#/");
    window.addEventListener("hashchange", route);

    if (recovery && session) recoveryMode = true;
    if (recoveryMode) { renderSetPassword(); return; }
    if (linkError) {
      renderForgot("That reset link has expired or was already used. Send a new one.");
      return;
    }
    route();
  }
  boot();
})();
