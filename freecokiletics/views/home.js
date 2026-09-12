/* Cokiletics — Home: one plan week with its two day cards. */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;

  /* Home shows one plan week — this week by default, or any other picked with
     the arrows (to do next week's sessions early, or look back). Whatever is
     started or logged from a week's card is filed under THAT week, so doing
     next week's workout early shows as done on next week, not this one. */
  V.renderHome = async function renderHome(weekStart) {
    var t = A.ticket();
    var W = S.WEEKS;
    var nowWf = A.weekFor(A.today());
    var wf = nowWf;
    if (weekStart) {
      var ix = W.findIndex(function (x) { return x.start === weekStart; });
      if (ix !== -1) wf = { week: W[ix], index: ix, status: ix === nowWf.index ? "now" : (ix < nowWf.index ? "past" : "later") };
    }
    var pendingRun = Runner.pending();
    var html = topbar(null, null, true) + A.installCard();

    if (pendingRun) {
      html += '<div class="card card--tap" id="resume"><div class="eyebrow">In progress</div>' +
        '<h2>' + esc(pendingRun.title) + '</h2><p class="dim">Started ' + new Date(pendingRun.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
        ' · step ' + (pendingRun.i + 1) + "/" + pendingRun.steps.length + "</p>" +
        '<div class="row" style="margin-top:var(--space-4)"><button class="btn btn--primary grow" id="resume-go">Resume</button>' +
        '<button class="btn btn--ghost" id="resume-drop">Discard</button></div></div>';
    }

    if (wf.status === "after") {
      html += '<div class="stack"><div class="eyebrow">Plan finished</div><h1>' + esc(S.PLAN.name || "Your plan") + " is done</h1>" +
        '<p class="dim">It ran to ' + A.fmt(A.isoDate(A.planEnd())) + ". Set the next one when you know what it looks like.</p>" +
        '<a class="btn btn--primary btn--big btn--block" href="#/plan/edit">Set up the next plan</a></div>';
    } else {
      var w = wf.week;
      /* The week is usable without knowing what is done — offline in the gym
         is exactly when it must be — so a failed check does not block the
         screen; it gets a notice and a Retry. */
      var done = {}, doneErr = null;
      try { done = await Store.doneThisWeek(S.me.id, w.start); }
      catch (e) { doneErr = e; }
      if (A.stale(t)) return;
      var sessions = A.sessionsFor(w.block);
      var prevW = W[wf.index - 1], nextW = W[wf.index + 1];
      var label = wf.index === nowWf.index && nowWf.status === "now" ? "This week"
        : wf.index === nowWf.index + 1 ? "Next week"
        : wf.index === nowWf.index - 1 ? "Last week"
        : (wf.status === "upcoming" ? "Starts " + A.fmt(w.start) : "Week of " + A.fmtRange(w.start));
      var wq = "?w=" + encodeURIComponent(w.start);        // carried into run / log links
      html += '<div class="week-nav">' +
          (prevW ? '<a class="btn btn--ghost btn--icon" href="#/week/' + prevW.start + '" aria-label="Previous week">‹</a>' : '<span class="btn--icon"></span>') +
          '<div class="week-nav__label"><b>' + esc(label) + "</b><span>" + A.fmtRange(w.start) + "</span></div>" +
          (nextW ? '<a class="btn btn--ghost btn--icon" href="#/week/' + nextW.start + '" aria-label="Next week">›</a>' : '<span class="btn--icon"></span>') +
        "</div>" +
        (wf.index !== nowWf.index && nowWf.week ? '<a class="week-nav__today" href="#/">Back to this week</a>' : "") +
        (doneErr ? '<div class="notice" role="status"><span>' + (navigator.onLine ? "Couldn’t check what’s done this week." : "Offline — done sessions can’t be checked.") +
                   '</span><button class="btn btn--quiet" type="button" id="retry">Retry</button></div>' : "") +
        '<div class="stack">' +
        '<div class="eyebrow">' + esc(w.phase) + " · week " + w.week_of_block + " of " + w.weeks_in_block + "</div>" +
        "<h1>Block " + w.block + "</h1>" +
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
              ? (d.times > 1
                  ? "Done " + d.times + " times this week"
                  : A.longDate(d.started_at) + " · " + A.hhmm(d.started_at) + "–" + A.hhmm(d.finished_at))
              : s.blocks.length + " blocks · " + s.blocks.map(function (b) { return b.letter; }).join(" ")) + "</p></div>" +
            (d
              ? '<span class="badge badge--good">done ✓' + (d.times > 1 ? " ×" + d.times : "") + "</span>"
              : '<span class="badge">start ›</span>') + "</div>" +
            // What you are about to do, so the card answers "what is today?"
            // without having to open anything.
            (d ? "" : '<ul class="day-card__blocks">' + s.blocks.map(function (b) {
              return "<li><span class=\"letter\">" + esc(b.letter) + "</span>" +
                '<span class="grow">' + esc(b.name) + "</span>" +
                '<span class="faint">' + esc(A.blockCount(b)) + "</span></li>";
            }).join("") + "</ul>") +
            "</a>" +
            // Done more than once: every run gets its own line, so the extra
            // session is visible and openable, not just counted in the badge.
            (d && d.times > 1
              ? '<ul class="day-card__runs">' + d.runs.map(function (r) {
                  return '<li><a href="#/h/' + esc(r.id) + '">' +
                    "<span>" + esc(A.shortDate(r.started_at)) + "</span>" +
                    '<span class="faint">' + esc(A.hhmm(r.started_at)) +
                      (r.finished_at ? "–" + esc(A.hhmm(r.finished_at)) : "") + "</span>" +
                    "</a></li>";
                }).join("") + "</ul>"
              : "") +
            '<div class="day-card__acts">' +
              (d
                ? '<a href="#/run/' + esc(s.key) + wq + '">Do it again</a>' +
                  '<a href="#/view/' + esc(s.key) + wq + '">View workout</a>'
                : '<a href="#/view/' + esc(s.key) + wq + '">View workout</a>' +
                  '<a href="#/log/' + esc(s.key) + wq + '">Mark as done</a>') +
            "</div>" +
            "</div>";
        }).join("") + "</div></div>";
    }

    app.innerHTML = html;
    A.syncBadge();
    A.bindInstall();
    A.bindRetry(function () { renderHome(weekStart); });
    document.getElementById("out").addEventListener("click", V.signOutFlow);
    document.getElementById("cp").addEventListener("click", function () { V.renderSetPassword(null, { cancel: true }); });
    if (pendingRun) {
      document.getElementById("resume-go").addEventListener("click", function () { location.hash = "#/run/" + pendingRun.key + "?resume=1"; });
      document.getElementById("resume-drop").addEventListener("click", function () {
        UI.confirm({ title: "Discard this session?", body: "Anything you logged in it is deleted too.",
                     confirm: "Discard", cancel: "Keep it", danger: true })
          .then(function (ok) { if (ok) { Runner.abandon(); A.route(); } });
      });
    }
  };
})();
