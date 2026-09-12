/* Cokiletics — views and routing. The runner (runner.js) owns a session once it
 * starts; this file owns everything around it: sign-in, this week's two days,
 * the plan, history, and syncing state.
 */
(function () {
  "use strict";
  var P = window.PROGRAMME;

  /* The schedule used to be a file shipped with the app. It is now one plan per
     person, held in the database: a start date and how many weeks each block
     runs. WEEKS is that expanded into one entry per week — what the rest of the
     app reads. */
  var PLAN = null, WEEKS = [];
  var PHASE = { 1: "Base", 2: "Base", 3: "Base", 4: "Strength", 5: "Strength", 6: "Strength",
                7: "Power", 8: "Power", 9: "Explosive" };
  var DEFAULT_BLOCKS = [{ block: 1, weeks: 2 }, { block: 2, weeks: 2 }, { block: 3, weeks: 2 },
    { block: 4, weeks: 3 }, { block: 5, weeks: 3 }, { block: 6, weeks: 3 },
    { block: 7, weeks: 2 }, { block: 8, weeks: 3 }, { block: 9, weeks: 2 }];

  function buildWeeks(plan) {
    var out = [], d = new Date(plan.start_date + "T00:00:00");
    (plan.blocks || []).forEach(function (b) {
      for (var i = 0; i < b.weeks; i++) {
        out.push({ start: isoDate(d), block: b.block, phase: PHASE[b.block] || "",
                   week_of_block: i + 1, weeks_in_block: b.weeks });
        d.setDate(d.getDate() + 7);
      }
    });
    return out;
  }
  function planEnd() { var last = WEEKS[WEEKS.length - 1]; var d = new Date(last.start + "T00:00:00"); d.setDate(d.getDate() + 6); return d; }
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
    for (var i = 0; i < WEEKS.length; i++) {
      var w = WEEKS[i], a = new Date(w.start + "T00:00:00"), b = new Date(a); b.setDate(a.getDate() + 7);
      if (dateObj >= a && dateObj < b) return { week: w, index: i, status: "now" };
    }
    if (!WEEKS.length) return { week: null, index: -1, status: "none" };
    if (t < WEEKS[0].start) return { week: WEEKS[0], index: 0, status: "upcoming" };
    return { week: null, index: -1, status: "after" };
  }
  function sessionsFor(block) { return P.sessions.filter(function (s) { return s.block === block; }); }
  function sessionByKey(k) { return P.sessions.find(function (s) { return s.key === k; }); }

  // ---------------------------------------------------------------- views
  function topbar(title, back, menu) {
    return '<div class="topbar">' +
      (back ? '<a class="btn btn--quiet" href="' + back + '">‹ Back</a>' : '<div class="row"><span class="logo">' + ICONS.bicep + '</span><b>Cokiletics</b></div>') +
      '<div class="row">' +
        '<span class="faint" id="sync" style="font-size:12px"></span>' +
        (menu ? '<button class="iconbtn" id="menu-btn" type="button" aria-label="Menu" ' +
                'aria-expanded="false" aria-controls="menu">' + ICONS.bars + '</button>' : "") +
      "</div>" +
      // Inside .topbar, which is position:relative — so the panel anchors to
      // the bar and cannot drift off the right edge on a narrow phone.
      (menu ? menuPanel() : "") +
      "</div>" +
      (title ? "<h1>" + esc(title) + "</h1>" : "");
  }

  /* Everything that is not "do today's session" lives in here. It used to be
     five full-width buttons under the day cards, which pushed the one thing
     the screen is for off the top of a phone. */
  function menuPanel() {
    return '<div class="menu" id="menu" hidden>' +
      '<a class="menu__item" href="#/plan">Plan · all weeks</a>' +
      '<a class="menu__item" href="#/history">History</a>' +
      '<a class="menu__item" href="../">Programme reference ↗</a>' +
      '<div class="menu__sep"></div>' +
      '<button class="menu__item menu__item--icon" type="button" id="theme">' +
        themeLabel() + "</button>" +
      '<div class="menu__sep"></div>' +
      '<button class="menu__item" type="button" id="cp">Change password</button>' +
      '<button class="menu__item" type="button" id="out">Sign out</button>' +
      "</div>";
  }
  /* The document-level listeners are installed ONCE, not per render. Home is
     re-rendered every time you come back to it, so binding them per render
     piled up a new pair on every visit, each holding a panel that had already
     been thrown away. Look the elements up at event time instead. */
  // Offers the mode you would be switching TO, which is the thing you are choosing.
  function themeLabel() {
    return Theme.current() === "dark"
      ? '<span class="menu__icon">' + ICONS.sun + "</span>Light mode"
      : '<span class="menu__icon">' + ICONS.moon + "</span>Dark mode";
  }
  function closeMenu() {
    var btn = document.getElementById("menu-btn"), panel = document.getElementById("menu");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", function (e) {
    var btn = document.getElementById("menu-btn"), panel = document.getElementById("menu");
    if (!btn || !panel) return;
    if (btn.contains(e.target)) { // the button itself toggles
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      btn.setAttribute("aria-expanded", String(willOpen));
      return;
    }
    var theme = e.target.closest && e.target.closest("#theme");
    if (theme) {
      Theme.toggle();
      theme.innerHTML = themeLabel();     // the menu stays open so the switch is visible
      return;
    }
    // Picking an item closes it too, and so does a tap anywhere outside.
    closeMenu();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

  function renderSetup() {
    ticket();
    app.innerHTML = topbar() + '<div class="stack"><h1>Not configured</h1>' +
      '<p class="dim">config.js has no Supabase URL and key yet. Fill them in and reload.</p></div>';
  }

  // ---------------------------------------------------------------- add to home screen
  /* iPhone has no way for a site to install itself — only Android / desktop
     Chrome fire `beforeinstallprompt`. So: the real prompt where it exists,
     step-by-step help (with the icons you actually tap) everywhere else.
     Hidden once the app is running from the home screen. */
  var installEvt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvt = e; });
  window.addEventListener("appinstalled", function () { installEvt = null; });
  function isInstalled() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  var INSTALL_HIDE = "freeco.installHidden";
  function installHidden() { try { return !!localStorage.getItem(INSTALL_HIDE); } catch (e) { return false; } }

  function installCard() {
    if (isInstalled() || installHidden()) return "";
    return '<div class="card install-card">' +
      '<div class="install-card__icon">' + ICONS.phone + "</div>" +
      '<div class="grow"><b>Put Cokiletics on your home screen</b>' +
      '<p class="dim">Opens full-screen, like an app, and works with no signal.</p></div>' +
      '<div class="install-card__actions"><button class="btn btn--primary" id="inst">Add to home screen</button>' +
      '<button class="btn btn--quiet" id="inst-x">Not now</button></div></div>';
  }
  function bindInstall() {
    var b = document.getElementById("inst");
    if (b) b.addEventListener("click", installFlow);
    var x = document.getElementById("inst-x");
    if (x) x.addEventListener("click", function () { try { localStorage.setItem(INSTALL_HIDE, "1"); } catch (e) {} route(); });
    var h = document.getElementById("inst-help");
    if (h) h.addEventListener("click", installFlow);
  }
  function installFlow() {
    if (installEvt) {                                     // Android / desktop Chrome: the real prompt
      installEvt.prompt();
      installEvt.userChoice.finally(function () { installEvt = null; route(); });
      return;
    }
    var chromeIOS = /CriOS/i.test(navigator.userAgent);
    var step = function (n, html) { return '<li><span class="step__n">' + n + "</span><span>" + html + "</span></li>"; };
    var steps = isIOS()
      ? step(1, "Tap <b>Share</b> " + '<span class="inline-icon">' + ICONS.share + "</span> " +
          (chromeIOS ? "— top right, inside the address bar." : "— at the bottom of the screen.")) +
        step(2, "Scroll down and tap <b>Add to Home Screen</b> " + '<span class="inline-icon">' + ICONS.addSquare + "</span>") +
        step(3, "Tap <b>Add</b>. From now on, open Cokiletics from that icon.")
      : step(1, "Open your browser’s menu.") +
        step(2, "Choose <b>Install app</b> or <b>Add to Home screen</b>.") +
        step(3, "Open Cokiletics from the new icon.");
    UI.info({ title: "Add to your home screen", ok: "Got it",
      html: '<ol class="steps">' + steps + "</ol>" +
        '<p class="faint" style="font-size:13px">Your browser has to do this part — a website can’t add itself on iPhone.</p>' });
  }

  // ---------------------------------------------------------------- the plan
  function mondayOf(d) { var x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function nextMonday() { var x = mondayOf(today()); if (x < today()) x.setDate(x.getDate() + 7); return x; }

  /* Set up or change a plan: when it starts, and how many weeks each block
     runs. Two sessions a week, and the blocks stay in Francesco's order —
     Javier's call (12 Sep 2026). */
  function renderPlanEdit() {
    ticket();
    var first = !PLAN;
    var blocks = (PLAN && PLAN.blocks ? PLAN.blocks : DEFAULT_BLOCKS).map(function (b) { return { block: b.block, weeks: b.weeks }; });
    var startVal = PLAN ? PLAN.start_date : dateVal(nextMonday());

    function draw() {
      app.innerHTML = topbar(null, first ? null : "#/plan") +
        '<div class="stack">' +
          '<div class="eyebrow">' + (first ? "Welcome" : "Your plan") + "</div>" +
          "<h1>" + (first ? "Set up your plan" : "Change your plan") + "</h1>" +
          '<p class="dim">Two sessions a week. The nine blocks stay in the order Francesco wrote them — you choose when you start and how long you spend on each.</p>' +
          '<div class="field"><label for="sd">First week starts</label><input class="input" id="sd" type="date" value="' + esc(startVal) + '"></div>' +
          '<div class="card stack">' +
            blocks.map(function (b, i) {
              return '<div class="plan-row"><div class="grow"><b>Block ' + b.block + '</b> <span class="dim">· ' + esc(PHASE[b.block]) + "</span></div>" +
                '<div class="stepper"><button class="btn btn--ghost" data-d="-1" data-i="' + i + '" aria-label="Fewer weeks">−</button>' +
                '<span class="stepper__n">' + b.weeks + ' <small>wk</small></span>' +
                '<button class="btn btn--ghost" data-d="1" data-i="' + i + '" aria-label="More weeks">+</button></div></div>';
            }).join("") +
          "</div>" +
          '<div class="card"><div class="eyebrow">That gives you</div><p id="sum"></p></div>' +
          '<p class="error" id="perr" hidden></p>' +
          '<button class="btn btn--primary btn--big btn--block" id="psave">' + (first ? "Start my plan" : "Save plan") + "</button>" +
        "</div>";
      summary();
      app.querySelectorAll("[data-d]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var i = +btn.getAttribute("data-i"), d = +btn.getAttribute("data-d");
          blocks[i].weeks = Math.max(1, Math.min(8, blocks[i].weeks + d));
          startVal = document.getElementById("sd").value || startVal;
          draw();
        });
      });
      document.getElementById("sd").addEventListener("change", function () { startVal = this.value; summary(); });
      document.getElementById("psave").addEventListener("click", save);
    }
    function summary() {
      var el = document.getElementById("sum"); if (!el) return;
      var sd = document.getElementById("sd").value;
      if (!sd) { el.textContent = "Pick a start date."; return; }
      var weeks = buildWeeks({ start_date: dateVal(mondayOf(new Date(sd + "T00:00:00"))), blocks: blocks });
      var last = weeks[weeks.length - 1], endD = new Date(last.start + "T00:00:00"); endD.setDate(endD.getDate() + 6);
      var lastBlock = blocks[blocks.length - 1].block;
      var peak = weeks.find(function (w) { return w.block === lastBlock; });
      el.innerHTML = "<b>" + weeks.length + " weeks</b>, " + weeks.length * 2 + " sessions — " +
        fmt(weeks[0].start) + " to " + fmt(isoDate(endD)) + ".<br>" +
        "Block " + lastBlock + " (the last one) starts " + fmt(peak.start) + ".";
    }
    async function save() {
      var sd = document.getElementById("sd").value, err = document.getElementById("perr"), btn = document.getElementById("psave");
      if (!sd) { err.textContent = "Pick a start date."; err.hidden = false; return; }
      // Weeks run Monday to Sunday, so a plan always starts on a Monday.
      var start = dateVal(mondayOf(new Date(sd + "T00:00:00")));
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        PLAN = await Store.savePlan({ user_id: me.id, name: (PLAN && PLAN.name) || "My plan",
          start_date: start, days_per_week: 2, blocks: blocks });
        WEEKS = buildWeeks(PLAN);
        UI.toast(first ? "Plan set — your first session is ready" : "Plan saved");
        if ((location.hash || "#/") === "#/") route(); else location.hash = "#/";
      } catch (e) {
        err.textContent = (e && e.message) || "Could not save the plan"; err.hidden = false;
        btn.disabled = false; btn.textContent = first ? "Start my plan" : "Save plan";
      }
    }
    draw();
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
      '<div class="logo logo--big">' + ICONS.bicep + '</div>' +
      '<div class="eyebrow">Sign in</div><h1>Cokiletics</h1>' +
      '<form id="f" class="stack" autocomplete="on">' +
        '<div class="field"><label for="e">Email</label><input class="input" id="e" type="email" autocomplete="username" required value="' + esc(email || "") + '"></div>' +
        pwField("p", "Password", "current-password") +
        (msg ? '<p class="error">' + esc(msg) + "</p>" : "") +
        '<button class="btn btn--primary btn--big btn--block" type="submit">Sign in</button>' +
        '<button class="btn btn--quiet btn--block" type="button" id="fp">Forgot password?</button>' +
        ((window.FREECO_CONFIG || {}).allowSignup ? '<button class="btn btn--quiet btn--block" type="button" id="su">Create an account</button>' : "") +
      "</form>" +
      (isInstalled() ? "" : '<button class="btn btn--quiet btn--block" type="button" id="inst-help">' + ICONS.phone + " Add to your home screen</button>") +
      "</div>";
    bindPwToggles();
    bindInstall();
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
          '<p class="dim">You’re signed in here. If you use Cokiletics from your home screen, open it there and sign in with the new password.</p>' +
          '<a class="btn btn--primary btn--big btn--block" href="#/">Continue</a></div>';
      } catch (err) { renderSetPassword(friendly(err, "Could not save the password"), o); }
    });
  }

  /* Home shows one plan week — this week by default, or any other picked with
     the arrows (to do next week's sessions early, or look back). Whatever is
     started or logged from a week's card is filed under THAT week, so doing
     next week's workout early shows as done on next week, not this one. */
  async function renderHome(weekStart) {
    var t = ticket();
    var nowWf = weekFor(today());
    var wf = nowWf;
    if (weekStart) {
      var ix = WEEKS.findIndex(function (x) { return x.start === weekStart; });
      if (ix !== -1) wf = { week: WEEKS[ix], index: ix, status: ix === nowWf.index ? "now" : (ix < nowWf.index ? "past" : "later") };
    }
    var pendingRun = Runner.pending();
    var html = topbar(null, null, true) + installCard();

    if (pendingRun) {
      html += '<div class="card card--tap" id="resume"><div class="eyebrow">In progress</div>' +
        '<h2>' + esc(pendingRun.title) + '</h2><p class="dim">Started ' + new Date(pendingRun.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
        ' · step ' + (pendingRun.i + 1) + "/" + pendingRun.steps.length + "</p>" +
        '<div class="row" style="margin-top:var(--space-4)"><button class="btn btn--primary grow" id="resume-go">Resume</button>' +
        '<button class="btn btn--ghost" id="resume-drop">Discard</button></div></div>';
    }

    if (wf.status === "after") {
      html += '<div class="stack"><div class="eyebrow">Plan finished</div><h1>' + esc(PLAN.name || "Your plan") + " is done</h1>" +
        '<p class="dim">It ran to ' + fmt(isoDate(planEnd())) + ". Set the next one when you know what it looks like.</p>" +
        '<a class="btn btn--primary btn--big btn--block" href="#/plan/edit">Set up the next plan</a></div>';
    } else {
      var w = wf.week;
      var done = await Store.doneThisWeek(me.id, w.start);
      if (stale(t)) return;
      var sessions = sessionsFor(w.block);
      var prevW = WEEKS[wf.index - 1], nextW = WEEKS[wf.index + 1];
      var label = wf.index === nowWf.index && nowWf.status === "now" ? "This week"
        : wf.index === nowWf.index + 1 ? "Next week"
        : wf.index === nowWf.index - 1 ? "Last week"
        : (wf.status === "upcoming" ? "Starts " + fmt(w.start) : "Week of " + fmtRange(w.start));
      var wq = "?w=" + encodeURIComponent(w.start);        // carried into run / log links
      html += '<div class="week-nav">' +
          (prevW ? '<a class="btn btn--ghost btn--icon" href="#/week/' + prevW.start + '" aria-label="Previous week">‹</a>' : '<span class="btn--icon"></span>') +
          '<div class="week-nav__label"><b>' + esc(label) + "</b><span>" + fmtRange(w.start) + "</span></div>" +
          (nextW ? '<a class="btn btn--ghost btn--icon" href="#/week/' + nextW.start + '" aria-label="Next week">›</a>' : '<span class="btn--icon"></span>') +
        "</div>" +
        (wf.index !== nowWf.index && nowWf.week ? '<a class="week-nav__today" href="#/">Back to this week</a>' : "") +
        '<div class="stack">' +
        '<div class="eyebrow">' + esc(w.phase) + " · week " + w.week_of_block + " of " + w.weeks_in_block + "</div>" +
        "<h1>Block " + w.block + "</h1>" +
        (w.note ? '<p class="dim">' + esc(w.note) + "</p>" : "") +
        '<div class="list" style="margin-top:var(--space-4)">' +
        sessions.map(function (s, ix) {
          var d = done[s.key];
          // Done → opens that workout (view, edit times, do it again).
          // Not done → starts the session, with "Mark as done" for a workout
          // done without the phone.
          return '<div class="card day-card' + (d ? " card--done" : "") + '">' +
            '<a class="day-card__main" href="' + (d ? "#/h/" + esc(d.id) : "#/run/" + esc(s.key) + wq) + '">' +
            '<div class="row"><div class="grow"><div class="eyebrow">Day ' + (ix + 1) + "</div>" +
            '<h2>' + esc(s.title) + "</h2>" +
            '<p class="dim">' + (d
              ? longDate(d.started_at) + " · " + hhmm(d.started_at) + "–" + hhmm(d.finished_at)
              : s.blocks.length + " blocks · " + s.blocks.map(function (b) { return b.letter; }).join(" ")) + "</p></div>" +
            (d ? '<span class="badge badge--good">done ✓</span>' : '<span class="badge">start ›</span>') + "</div></a>" +
            (d ? "" : '<a class="day-card__alt" href="#/log/' + esc(s.key) + wq + '">Did it without the phone? Mark as done</a>') +
            "</div>";
        }).join("") + "</div></div>";
    }

    app.innerHTML = html;
    syncBadge();
    bindInstall();
    document.getElementById("out").addEventListener("click", async function () { await Store.signOut(); me = null; PLAN = null; WEEKS = []; route(); });
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
      '<div style="margin-top:var(--space-4)">' + WEEKS.map(function (w, ix) {
        var cls = ix < wf.index ? "past" : ix === wf.index ? "now" : "";
        var chip = ix === 0 || WEEKS[ix - 1].block !== w.block ? '<span class="badge badge--cool">' + esc(w.phase) + "</span>" : "";
        return '<a class="week-row ' + cls + '" href="#/week/' + w.start + '"><div class="num">' + w.block + '</div><div class="grow">' +
          "<b>" + fmtRange(w.start) + "</b> <span class=\"dim\">· week " + w.week_of_block + "/" + w.weeks_in_block + "</span>" +
          (w.note ? '<div class="faint" style="font-size:13px">' + esc(w.note) + "</div>" : "") + "</div>" + chip + "</a>";
      }).join("") +
      "</div>" +
      '<a class="btn btn--ghost btn--block" style="margin-top:var(--space-5)" href="#/plan/edit">Edit my plan</a>';
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
    var back = /^#\/(history|week\/)/.test(prevHash) ? prevHash : "#/";
    app.innerHTML = topbar("Workout", back) + '<p class="dim">Loading…</p>';
    var w = await Store.workout(id);
    if (stale(t)) return;
    if (!w) { app.innerHTML = topbar("Workout", back) + '<p class="dim">Couldn’t load this workout — it needs a connection.</p>'; return; }
    var sets = await Store.setsFor(id);
    if (stale(t)) return;
    var s = sessionByKey(w.session_key);
    var setKey = function (L, r, exId) { return L + "|" + r + "|" + exId; };
    var byKey = {};
    sets.forEach(function (x) { byKey[setKey(x.block_letter, x.round, x.exercise_id)] = x; });
    var blocks = s ? s.blocks.filter(function (b) { return b.kind === "rounds"; }) : [];
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
        (blocks.length
          ? '<form id="wf" class="stack">' +
              '<div class="row"><h2 class="grow">Weights</h2><span class="faint" style="font-size:13px">kg per round</span></div>' +
              blocks.map(function (b) {
                var rounds = b.rounds || 1;
                return '<div class="card wt-block"><div class="eyebrow">' + esc(b.letter) + " · " + esc(b.name) + "</div>" +
                  b.exercises.map(function (e) {
                    return '<div class="wt-ex"><div class="wt-ex__name">' + esc(e.name) + "</div>" +
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
      var r = timesFrom(f.d.value, f.st.value, f.en.value);
      if (r.error) { err.textContent = r.error; err.hidden = false; return; }
      err.hidden = true;
      var row = Object.assign({}, w, { started_at: r.start, finished_at: r.end, duration_seconds: r.seconds });
      delete row.freeco_sets; delete row.set_count;          // view-only fields, not columns
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

  function renderLog(key, weekStart) {
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
        week_start: weekStart || (wf.week ? wf.week.start : null), started_at: r.start, finished_at: r.end,
        duration_seconds: r.seconds, logged_manually: true });
      f.querySelector("button[type=submit]").disabled = true;
      // Wait for the upload (if online) so Home shows the day as done at once.
      Promise.race([Store.flush(), new Promise(function (ok) { setTimeout(ok, 4000); })])
        .then(function () { location.hash = weekStart ? "#/week/" + weekStart : "#/"; });
    });
  }

  async function renderRun(key, resume, weekStart) {
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
      Runner.start(key, { userId: me.id, weekStart: weekStart || (wf.week ? wf.week.start : null), last: last });
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
    if (!PLAN) {
      PLAN = await Store.plan(me.id);
      if (stale(t)) return;
      if (PLAN) WEEKS = buildWeeks(PLAN);
    }
    Store.flush();
    var h = location.hash || "#/";
    // A new account has no plan yet — nothing else makes sense until it does.
    if (!PLAN && h !== "#/plan/edit") { renderPlanEdit(); return; }
    var m;
    var wParam = (h.match(/[?&]w=(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
    if ((m = h.match(/^#\/run\/([\d.]+)/))) { renderRun(m[1], /[?&]resume=1/.test(h), wParam); return; }
    Runner.unmount();
    if (h === "#/plan/edit") renderPlanEdit();
    else if (h === "#/plan") renderPlan();
    else if (h === "#/history") renderHistory();
    else if ((m = h.match(/^#\/h\/([\w-]+)$/))) renderWorkout(m[1]);
    else if ((m = h.match(/^#\/log\/([\d.]+)/))) renderLog(m[1], wParam);
    else if ((m = h.match(/^#\/week\/(\d{4}-\d{2}-\d{2})$/))) renderHome(m[1]);
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
