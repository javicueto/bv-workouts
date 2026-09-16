/* Cokiletics — the shared core the screens are built on: state, the plan
 * calendar, formatting, the top bar and menu, the install card, the sync
 * badge. Screens live in views/*.js and register on App.views; app.js is the
 * router and boot. Load order: ui → store → timer → runner → core → views →
 * app. The runner (runner.js) owns a session once it starts.
 *
 * Everything a screen needs is on window.App; a view file takes local
 * aliases at the top (`var S = App.S, esc = App.esc …`) so its body reads
 * like plain code. State that more than one screen writes lives on App.S —
 * never in a module-local variable, which the other files cannot see.
 */
window.App = (function () {
  "use strict";
  var P = window.PROGRAMME;
  var esc = UI.esc;

  /* Shared, mutable, in one place. */
  var S = {
    me: null,               // the signed-in user, from Store.user()
    PLAN: null,             // the person's plan row, or null before it is loaded / exists
    WEEKS: [],              // PLAN expanded to one entry per week — what the app reads
    recoveryMode: false,    // true from a reset link until the new password is saved
    prevHash: "#/", curHash: "#/",   // for "Back" on screens reachable from two places
    installEvt: null,       // Android/desktop Chrome's beforeinstallprompt, if it fired
    memberFor: null,        // account id the server confirmed as a Cokiletics member (db/006)
  };

  /* Francesco's names for the phases, by block. A block beyond these (10 and
     on, when he writes it) simply has no phase label until he gives it one. */
  var PHASE = { 1: "Base", 2: "Base", 3: "Base", 4: "Strength", 5: "Strength", 6: "Strength",
                7: "Power", 8: "Power", 9: "Explosive" };
  /* The blocks come from the PROGRAMME, never from a list typed here: block
     10 arrives with the next TrueCoach export and has to reach the plan
     editor with no code change. The default lengths are Javier's (12 Sep
     2026): three weeks on the strength blocks and block 8, two elsewhere. */
  var DEFAULT_WEEKS = { 4: 3, 5: 3, 6: 3, 8: 3 };
  function programmeBlocks() {
    var seen = {}, out = [];
    P.sessions.forEach(function (s) { if (!seen[s.block]) { seen[s.block] = true; out.push(s.block); } });
    return out.sort(function (a, b) { return a - b; });
  }
  function defaultWeeks(block) { return DEFAULT_WEEKS[block] || 2; }
  /* A plan's blocks, completed with any block the programme has gained since
     the plan was saved, so a new block can be given a length rather than
     silently never appearing in the calendar. */
  function planBlocks(plan) {
    var blocks = (plan && plan.blocks ? plan.blocks : []).map(function (b) { return { block: b.block, weeks: b.weeks }; });
    programmeBlocks().forEach(function (n) {
      if (!blocks.some(function (b) { return b.block === n; })) blocks.push({ block: n, weeks: defaultWeeks(n) });
    });
    return blocks.sort(function (a, b) { return a.block - b.block; });
  }
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
  function planEnd() { var last = S.WEEKS[S.WEEKS.length - 1]; var d = new Date(last.start + "T00:00:00"); d.setDate(d.getDate() + 6); return d; }

  var app = document.getElementById("app");
  /* Each screen's <h1> is its name; announcing it once per paint is what a
     screen reader needs after a navigation. Watching the container means a
     new screen is covered without remembering to call anything. The runner
     paints inside its own child and announces its own steps. */
  new MutationObserver(function () {
    var h = app.querySelector("h1");
    if (h) UI.announce(h.textContent);
  }).observe(app, { childList: true });

  /* Every screen takes a ticket when it starts drawing. A screen that waited on
     the network checks its ticket before painting and gives up if a newer
     screen started meanwhile. Without this, a slow Home painted over a newer
     screen — which is how a password-reset link ended on the plan instead of
     "Choose a new password" (11 Sep 2026). Any new async view must do the same. */
  var screen = 0;
  function ticket() { return ++screen; }
  function stale(t) { return t !== screen; }

  /* Read-only description of a movement or a block. The runner has its own
     copies tuned for a live session; these are the quiet, at-a-glance versions.
     Never invent a number here — only restate what the programme says. */
  function previewUrl(id) {
    // ?v= is the file's content version (build_freeco.py preview_v): a rebuilt
    // preview is a new address, so the offline copy fetches it again (offline.js).
    var e = P.exercises[id];
    return e && e.has_preview ? "../previews/" + id + ".webp" + (e.preview_v ? "?v=" + e.preview_v : "") : "";
  }
  function repsLabel(e) {
    if (e.holds && e.seconds) return e.holds + " × " + dur(e.seconds);
    if (e.seconds) return dur(e.seconds) + (e.per_side ? " / side" : "");
    if (e.reps != null) return e.reps + (e.per_side ? " / side" : "");
    return "";
  }
  /* Time as the app writes it (Javier, 14 Sep 2026): under a minute "45 sec",
     whole minutes "2 min", anything else "1:30 min" — never 90 sec, 1.5 min,
     1½ min or a quote mark. The coach's text gets the same rule at build time
     (scripts/units.py). Running clocks stay digital with no unit. */
  function dur(sec) {
    sec = Math.round(+sec || 0);
    if (sec < 60) return sec + " sec";
    if (sec % 60 === 0) return sec / 60 + " min";
    return Math.floor(sec / 60) + ":" + pad2(sec % 60) + " min";
  }
  // What a screen reader says instead of "1:30 min": "1 minute 30 seconds".
  function durSpoken(sec) {
    sec = Math.round(+sec || 0);
    var m = Math.floor(sec / 60), s = sec % 60, out = [];
    if (m) out.push(m + (m === 1 ? " minute" : " minutes"));
    if (s || !m) out.push(s + (s === 1 ? " second" : " seconds"));
    return out.join(" ");
  }
  // Markup: the short form on screen, the spoken form for a screen reader.
  function durHTML(sec) {
    return '<span aria-hidden="true">' + UI.esc(dur(sec)) + '</span><span class="sr-only">' + UI.esc(durSpoken(sec)) + "</span>";
  }
  /* A coach's cue — the text after "*" in a name or note, up to the next
     " + " movement — shown in orange without the "*" (Javier, 14 Sep 2026:
     "orange on both sites, no italic"). cueHTML is for markup; cueText is for
     attributes and plain text (aria-label, the preview's name), where the
     "*" is simply dropped. The reference site's app.js has the same rule. */
  function cueHTML(text) {
    return String(text == null ? "" : text).split("\n").map(function (line) {
      var i = line.indexOf("*");
      if (i === -1) return UI.esc(line);
      var before = line.slice(0, i).replace(/\s+$/, ""), rest = line.slice(i + 1);
      var j = rest.indexOf(" + ");
      var cue = (j === -1 ? rest : rest.slice(0, j)).trim();
      return UI.esc(before) + (before ? " " : "") + '<span class="cue">' + UI.esc(cue) + "</span>" +
        (j === -1 ? "" : cueHTML(rest.slice(j)));
    }).join("\n");
  }
  function cueText(text) { return String(text == null ? "" : text).replace(/\s*\*\s*/g, " ").trim(); }
  function restLabel(sec) { return sec ? "Rest " + dur(sec) : ""; }
  function restHTML(sec) { return sec ? "Rest " + durHTML(sec) : ""; }
  function blockCount(b) {
    return b.kind === "tabata" ? b.cycles + " × " + dur(b.work_seconds) : b.rounds + " rounds";
  }

  // ---------------------------------------------------------------- dates
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
  /* Built by hand, never toLocale*String: that hands order, separators and
     12- vs 24-hour to the phone's locale, so the same workout read "06:30 PM"
     on one device and "18:30" on another. Javier's formats (12 Sep 2026):
     24-hour time, and "Fri 11 Sep ’26" — the apostrophe stands for the
     dropped century. */
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function hhmm(iso) { var d = new Date(iso); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function dayDate(iso) {
    var d = new Date(iso);
    return WEEKDAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " ’" + String(d.getFullYear()).slice(-2);
  }
  function longDate(iso) { return new Date(iso).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); }
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function isoDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function mondayOf(d) { var x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function nextMonday() { var x = mondayOf(today()); if (x < today()) x.setDate(x.getDate() + 7); return x; }

  /* Shared by "Mark as done" and "Save times": date + two times → ISO, with
     the checks a tired person at 10pm needs. */
  function timesFrom(dateStr, startStr, endStr) {
    if (!dateStr || !startStr || !endStr) return { error: "Fill in the date, start and end." };
    var a = new Date(dateStr + "T" + startStr), b = new Date(dateStr + "T" + endStr);
    if (b <= a) return { error: "End has to be after start." };
    if (a > new Date()) return { error: "That start time is in the future." };
    return { start: a.toISOString(), end: b.toISOString(), seconds: Math.round((b - a) / 1000) };
  }

  // ---------------------------------------------------------------- schedule
  function weekFor(dateObj) {
    var W = S.WEEKS, t = isoDate(dateObj);
    for (var i = 0; i < W.length; i++) {
      var w = W[i], a = new Date(w.start + "T00:00:00"), b = new Date(a); b.setDate(a.getDate() + 7);
      if (dateObj >= a && dateObj < b) return { week: w, index: i, status: "now" };
    }
    if (!W.length) return { week: null, index: -1, status: "none" };
    if (t < W[0].start) return { week: W[0], index: 0, status: "upcoming" };
    return { week: null, index: -1, status: "after" };
  }
  function sessionsFor(block) { return P.sessions.filter(function (s) { return s.block === block; }); }
  function sessionByKey(k) { return P.sessions.find(function (s) { return s.key === k; }); }

  // ---------------------------------------------------------------- chrome
  function topbar(title, back, menu) {
    return '<div class="topbar">' +
      // `back` can come from the URL hash: escape it like any other value.
      (back ? '<a class="btn btn--quiet" href="' + esc(back) + '">' + ICONS.chevronLeft + "Back</a>" : '<div class="row"><span class="logo">' + ICONS.bicep + '</span><b>Cokiletics</b></div>') +
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
      '<button class="menu__item menu__item--icon" type="button" id="sound">' +
        soundLabel() + "</button>" +
      // How much is saved for offline (offline.js keeps it current).
      '<div class="menu__note" id="offline-note"' + (offlineText() ? "" : " hidden") + ">" + UI.esc(offlineText()) + "</div>" +
      '<div class="menu__sep"></div>' +
      '<button class="menu__item" type="button" id="cp">Change password</button>' +
      '<button class="menu__item" type="button" id="out">Sign out</button>' +
      "</div>";
  }
  function offlineText() { return window.Offline ? window.Offline.label() : ""; }
  // Offers the mode you would be switching TO, which is the thing you are choosing.
  function themeLabel() {
    return Theme.current() === "dark"
      ? '<span class="menu__icon">' + ICONS.sun + "</span>Light mode"
      : '<span class="menu__icon">' + ICONS.moon + "</span>Dark mode";
  }
  /* Same rule as the theme: offers what you would switch TO. Remembered on
     this phone until switched back (Sound.muted, timer.js). */
  function soundLabel() {
    return Sound.muted()
      ? '<span class="menu__icon">' + ICONS.volumeHigh + "</span>Turn sound on"
      : '<span class="menu__icon">' + ICONS.volumeXmark + "</span>Mute sound";
  }
  function closeMenu() {
    var btn = document.getElementById("menu-btn"), panel = document.getElementById("menu");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  /* The document-level listeners are installed ONCE, not per render. Home is
     re-rendered every time you come back to it, so binding them per render
     piled up a new pair on every visit, each holding a panel that had already
     been thrown away. Look the elements up at event time instead. */
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
    var sound = e.target.closest && e.target.closest("#sound");
    if (sound) {
      if (!Sound.toggleMuted()) Sound.introCount();   // turned on: one soft blip says so
      sound.innerHTML = soundLabel();
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

  /* A read that failed or timed out. Every screen that waits on the server
     shows this instead of sitting on "Loading…": what went wrong in plain
     words, and one button that tries again. bindRetry(fn) wires it. */
  /* A screen showing a copy kept on this phone (Store.savedAt) says so, with
     when, and offers Retry: "Offline · as of 18:40", or with the day when it
     is not today. bindRetry wires the button like loadError's. */
  function savedNotice(at, label) {
    if (!at) return "";
    var A = window.App, today = new Date().toDateString() === new Date(at).toDateString();
    return '<div class="notice" role="status"><span>Offline · ' + UI.esc(label || "as of") + " " +
      (today ? "" : UI.esc(A.dayDate(at)) + ", ") + UI.esc(A.hhmm(at)) +
      '</span><button class="btn btn--quiet" type="button" id="retry">Retry</button></div>';
  }
  function loadError(err) {
    var msg = !navigator.onLine ? "You’re offline." : ((err && err.message) || "Couldn’t reach the server.");
    return '<div class="card stack load-error" role="alert"><p><b>Couldn’t load this.</b></p>' +
      '<p class="dim">' + esc(msg) + "</p>" +
      '<button class="btn btn--primary" type="button" id="retry">Try again</button></div>';
  }
  function bindRetry(retry) {
    var b = document.getElementById("retry");
    if (b) b.addEventListener("click", function () { b.disabled = true; b.textContent = "Loading…"; retry(); });
  }

  // ---------------------------------------------------------------- add to home screen
  /* iPhone has no way for a site to install itself — only Android / desktop
     Chrome fire `beforeinstallprompt`. So: the real prompt where it exists,
     step-by-step help (with the icons you actually tap) everywhere else.
     Hidden once the app is running from the home screen. */
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); S.installEvt = e; });
  window.addEventListener("appinstalled", function () { S.installEvt = null; });
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
    if (x) x.addEventListener("click", function () { try { localStorage.setItem(INSTALL_HIDE, "1"); } catch (e) {} App.route(); });
    var h = document.getElementById("inst-help");
    if (h) h.addEventListener("click", installFlow);
  }
  function installFlow() {
    if (S.installEvt) {                                   // Android / desktop Chrome: the real prompt
      S.installEvt.prompt();
      S.installEvt.userChoice.finally(function () { S.installEvt = null; App.route(); });
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

  // ---------------------------------------------------------------- sync badge
  function syncBadge() {
    var el = document.getElementById("sync"); if (!el) return;
    var n = Store.pending();
    el.textContent = !navigator.onLine ? "Offline · " + n + " to sync" : n ? n + " to sync…" : "";
  }
  Store.onQueue(syncBadge);
  window.addEventListener("online", syncBadge);
  window.addEventListener("offline", syncBadge);

  return {
    S: S, P: P, PHASE: PHASE, esc: esc, app: app,
    views: {},                 // filled by views/*.js
    route: null,               // set by app.js
    programmeBlocks: programmeBlocks, planBlocks: planBlocks, buildWeeks: buildWeeks, planEnd: planEnd,
    ticket: ticket, stale: stale,
    previewUrl: previewUrl, repsLabel: repsLabel, restLabel: restLabel, restHTML: restHTML, blockCount: blockCount,
    dur: dur, durSpoken: durSpoken, durHTML: durHTML, cueHTML: cueHTML, cueText: cueText,
    fmt: fmt, fmtRange: fmtRange, dateVal: dateVal, timeVal: timeVal, hhmm: hhmm, longDate: longDate,
    dayDate: dayDate, today: today, isoDate: isoDate, mondayOf: mondayOf, nextMonday: nextMonday, timesFrom: timesFrom,
    weekFor: weekFor, sessionsFor: sessionsFor, sessionByKey: sessionByKey,
    topbar: topbar, renderSetup: renderSetup, loadError: loadError, bindRetry: bindRetry, savedNotice: savedNotice,
    isInstalled: isInstalled, installCard: installCard, bindInstall: bindInstall, syncBadge: syncBadge,
  };
})();
