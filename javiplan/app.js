/* Javi Plan — views and routing. The runner (runner.js) owns a session once it
 * starts; this file owns everything around it: sign-in, this week's two days,
 * the plan, history, and syncing state.
 */
(function () {
  "use strict";
  var P = window.PROGRAMME, S = window.SCHEDULE;
  var app = document.getElementById("app");
  var me = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmt(iso) { var d = new Date(iso + "T00:00:00"); return d.getDate() + " " + MONTHS[d.getMonth()]; }
  function fmtRange(startIso) {
    var a = new Date(startIso + "T00:00:00"), b = new Date(a); b.setDate(a.getDate() + 6);
    return a.getDate() + (a.getMonth() === b.getMonth() ? "–" + b.getDate() + " " + MONTHS[a.getMonth()]
      : " " + MONTHS[a.getMonth()] + " – " + b.getDate() + " " + MONTHS[b.getMonth()]);
  }
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
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">Check your email</div><h1>Link sent</h1>' +
      '<p class="dim">We sent a reset link to <b>' + esc(email) + '</b>. It can take a minute — check spam if it doesn’t show up.</p>' +
      '<div class="note">Tapping the link opens your browser, not this app. Set the new password there, then come back here and sign in with it.</div>' +
      '<button class="btn btn--ghost btn--block" id="bk">‹ Back to sign in</button></div>';
    document.getElementById("bk").addEventListener("click", function () { renderLogin(null, email); });
  }

  function renderSetPassword(msg) {
    app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
      '<div class="eyebrow">New password</div><h1>Choose a new password</h1>' +
      '<form id="f" class="stack">' +
        pwField("p1", "New password", "new-password") +
        pwField("p2", "Type it again", "new-password") +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit" id="save">Save password</button>' +
      "</form></div>";
    bindPwToggles();
    var f = document.getElementById("f");
    f.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (f.p1.value.length < 6) { renderSetPassword("Password needs at least 6 characters."); return; }
      if (f.p1.value !== f.p2.value) { renderSetPassword("The two passwords don’t match."); return; }
      var btn = document.getElementById("save"); btn.disabled = true; btn.textContent = "Saving…";
      try {
        me = await Store.setPassword(f.p1.value);
        app.innerHTML = topbar() + '<div class="stack" style="margin-top:var(--space-8)">' +
          '<div class="eyebrow">Done</div><h1>Password saved</h1>' +
          '<p class="dim">You’re signed in here. If you use Javi Plan from your home screen, open it there and sign in with the new password.</p>' +
          '<a class="btn btn--primary btn--big btn--block" href="#/">Continue</a></div>';
      } catch (err) { renderSetPassword(friendly(err, "Could not save the password")); }
    });
  }

  async function renderHome() {
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
      var sessions = sessionsFor(w.block);
      html += '<div class="stack">' +
        '<div class="eyebrow">' + (wf.status === "upcoming" ? "Starts " + fmt(w.start) : "Week of " + fmtRange(w.start)) + "</div>" +
        '<h1>Block ' + w.block + ' <span class="dim" style="font-weight:500;font-size:.6em">· ' + esc(w.phase) + "</span></h1>" +
        '<p class="dim">Week ' + w.week_of_block + " of " + w.weeks_in_block + (w.note ? " · " + esc(w.note) : "") + "</p>" +
        '<div class="list" style="margin-top:var(--space-4)">' +
        sessions.map(function (s, ix) {
          var d = done[s.key];
          return '<a class="card card--tap' + (d ? " card--done" : "") + '" href="#/run/' + esc(s.key) + '">' +
            '<div class="row"><div class="grow"><div class="eyebrow">Day ' + (ix + 1) + "</div>" +
            '<h2>' + esc(s.title) + "</h2>" +
            '<p class="dim">' + s.blocks.length + " blocks · " + s.blocks.map(function (b) { return b.letter; }).join(" ") + "</p></div>" +
            (d ? '<span class="badge badge--good">done ✓</span>' : '<span class="badge">start ›</span>') + "</div></a>";
        }).join("") + "</div></div>";
    }

    html += '<div class="divider" style="margin:var(--space-6) 0"></div>' +
      '<div class="list">' +
        '<a class="btn btn--ghost btn--block" href="#/plan">Plan · all weeks</a>' +
        '<a class="btn btn--ghost btn--block" href="#/history">History</a>' +
        '<button class="btn btn--quiet btn--block" id="out">Sign out</button>' +
      "</div>";
    app.innerHTML = html;
    syncBadge();
    document.getElementById("out").addEventListener("click", async function () { await Store.signOut(); me = null; route(); });
    if (pendingRun) {
      document.getElementById("resume-go").addEventListener("click", function () { location.hash = "#/run/" + pendingRun.key + "?resume=1"; });
      document.getElementById("resume-drop").addEventListener("click", function () { Runner.abandon(); route(); });
    }
  }

  function renderPlan() {
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
    app.innerHTML = topbar("History", "#/") + '<p class="dim">Loading…</p>';
    var rows = await Store.history(me.id, 80);
    app.innerHTML = topbar("History", "#/") + (rows.length ? '<div class="list">' + rows.map(function (w) {
      var d = new Date(w.started_at);
      return '<a class="card card--tap" href="#/h/' + esc(w.id) + '"><div class="row"><div class="grow"><h2>Workout ' + esc(w.session_key) + "</h2>" +
        '<p class="dim">' + d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) +
        (w.duration_seconds ? " · " + Math.round(w.duration_seconds / 60) + " min" : " · not finished") + "</p></div>" +
        (w.finished_at ? '<span class="badge badge--good">✓</span>' : "") + "</div></a>";
    }).join("") + "</div>" : '<p class="dim">Nothing logged yet.</p>');
  }

  async function renderWorkout(id) {
    app.innerHTML = topbar("Workout", "#/history") + '<p class="dim">Loading…</p>';
    var sets = await Store.setsFor(id);
    var byBlock = {};
    sets.forEach(function (s) { (byBlock[s.block_letter] = byBlock[s.block_letter] || []).push(s); });
    app.innerHTML = topbar("Workout", "#/history") + Object.keys(byBlock).sort().map(function (L) {
      return '<div class="card" style="margin-top:var(--space-3)"><div class="eyebrow">Block ' + esc(L) + "</div><ul class=\"done-list\" style=\"padding:0;margin:var(--space-2) 0 0\">" +
        byBlock[L].map(function (s) {
          var v = s.skipped ? "skipped" : [s.weight != null ? s.weight + " kg" : null, s.reps != null ? s.reps + " reps" : null, s.seconds != null ? s.seconds + "″" : null].filter(Boolean).join(" × ");
          return "<li><span>R" + s.round + " · " + esc(s.exercise_name) + "</span><span>" + esc(v || "—") + "</span></li>";
        }).join("") + "</ul></div>";
    }).join("") || '<p class="dim">No sets recorded.</p>';
  }

  async function renderRun(key, resume) {
    var s = sessionByKey(key);
    if (!s) { location.hash = "#/"; return; }
    if (resume && Runner.resume()) { /* state restored */ }
    else {
      var wf = weekFor(today());
      var ids = []; s.warmup.exercises.forEach(function (e) { ids.push(e.id); });
      s.blocks.forEach(function (b) { b.exercises.forEach(function (e) { if (e.id) ids.push(e.id); }); });
      var last = await Store.lastForExercises(ids, me.id);
      Runner.start(key, { userId: me.id, weekStart: wf.week ? wf.week.start : null, last: last });
    }
    app.innerHTML = '<div class="runner" id="runner"></div>';
    Runner.mount(document.getElementById("runner"), function (result) {
      location.hash = "#/";
      if (result && result.finished) {
        setTimeout(function () { alert("Saved: " + Math.round(result.duration / 60) + " min, " + result.sets + " sets."); }, 50);
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
  async function route() {
    if (!Store.configured()) { renderSetup(); return; }
    if (!me) me = await Store.user();
    if (!me) { renderLogin(); return; }
    Store.flush();
    var h = location.hash || "#/";
    var m;
    if ((m = h.match(/^#\/run\/([\d.]+)(\?resume=1)?$/))) { renderRun(m[1], !!m[2]); return; }
    Runner.unmount();
    if (h === "#/plan") renderPlan();
    else if (h === "#/history") renderHistory();
    else if ((m = h.match(/^#\/h\/([\w-]+)$/))) renderWorkout(m[1]);
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
      if (event === "PASSWORD_RECOVERY") { recovery = true; renderSetPassword(); }
    });
    var session = await Store.ready();              // waits for the link to be read
    if (hadAuthParams) history.replaceState(null, "", location.pathname + location.search + "#/");
    window.addEventListener("hashchange", route);

    if (recovery && session) { renderSetPassword(); return; }
    if (linkError) {
      renderForgot("That reset link has expired or was already used. Send a new one.");
      return;
    }
    route();
  }
  boot();
})();
