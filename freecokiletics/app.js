/* Cokiletics — the router and boot. Screens are in views/*.js (registered on
 * App.views); everything they share is in core.js. This file is loaded last.
 */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, app = A.app;

  /* Motion between screens (styles.css "motion"). Where a screen sits:
     home (and every week) and history are the top; plan, a workout to look
     at and a finished one are one level in; editing the plan, logging by hand
     and a running session are two. Deeper → arrives from the right, back →
     from the left, same level → crossfade, one week to another → nothing
     here (the week swipe has its own), a first screen → crossfade. */
  function place(h) {
    if (!h || h === "#/" || /^#\/week\//.test(h)) return { key: "home", depth: 0 };
    if (h === "#/history") return { key: "history", depth: 0 };
    if (h === "#/plan") return { key: "plan", depth: 1 };
    if (h === "#/social") return { key: "social", depth: 1 };
    if (/^#\/(view|h)\//.test(h)) return { key: "view", depth: 1 };
    return { key: h.split(/[/?]/)[1] || "", depth: 2 };          // #/plan/edit, #/log/…, #/run/…
  }
  function moveFor(from, to) {
    if (from == null) return "fade";
    if (from === to) return "none";                              // the same screen drawn again
    var a = place(from), b = place(to);
    if (a.key === "home" && b.key === "home") return "none";
    return b.depth > a.depth ? "forward" : b.depth < a.depth ? "back" : "fade";
  }
  /* Views render when their data arrives, and some twice ("Loading…", then
     the screen). The move is decided when the hash changes and played on
     the first render after it; a second render close behind gets only a
     fade, so content never slides twice. A move nobody rendered expires, so
     it can't fire later on a redraw (a save redraws the same screen). */
  var pendingMove = null, pendingAt = 0, movedAt = 0;
  new MutationObserver(function (list) {
    if (!list.some(function (m) { return m.addedNodes.length; })) return;
    var now = Date.now();
    if (pendingMove && now - pendingAt < 5000) {
      if (pendingMove !== "none") { window.scrollTo(0, 0); UI.enter(app, pendingMove); movedAt = now; }
      pendingMove = null;
    } else if (movedAt && now - movedAt < 1200) {
      UI.enter(app, "fade"); movedAt = 0;
    }
  }).observe(app, { childList: true });

  async function route() {
    S.prevHash = S.curHash; S.curHash = location.hash || "#/";
    pendingMove = moveFor(S.prevHash, S.curHash); pendingAt = Date.now();
    if (!Store.configured()) { A.renderSetup(); return; }
    if (S.recoveryMode) { V.renderSetPassword(); return; }
    var t = A.ticket();
    if (!S.me) S.me = await Store.user();
    if (A.stale(t) || S.recoveryMode) return;
    if (!S.me) { V.renderLogin(); return; }
    /* Members only (db/006). false = the server says this account is not
       listed: say so, rather than let it wander into an empty app. null =
       could not tell (offline): carry on — the database still refuses a
       stranger, and a real member must never be locked out in the gym. */
    if (S.memberFor !== S.me.id) {
      var member = await Store.isMember(S.me.id);
      if (A.stale(t)) return;
      if (member === false) { V.renderNotMember(); return; }
      if (member === true) S.memberFor = S.me.id;
    }
    if (!S.PLAN) {
      try { S.PLAN = await Store.plan(S.me.id); }
      catch (e) {
        // No cached plan and no server: nothing can be shown yet, but "Set up
        // your plan" would be wrong — the plan may well exist.
        if (A.stale(t)) return;
        app.innerHTML = A.topbar() + A.loadError(e);
        A.bindRetry(route);
        return;
      }
      if (A.stale(t)) return;
      if (S.PLAN) S.WEEKS = A.buildWeeks(S.PLAN);
    }
    Store.flush();
    Offline.start();              // offline by default: previews and saved copies (offline.js)
    var h = location.hash || "#/";
    // A new account has no plan yet — nothing else makes sense until it does.
    if (!S.PLAN && h !== "#/plan/edit") { V.renderPlanEdit(); return; }
    var m;
    var wParam = (h.match(/[?&]w=(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
    if ((m = h.match(/^#\/run\/([\d.]+)/))) { V.renderRun(m[1], /[?&]resume=1/.test(h), wParam); return; }
    Runner.unmount();
    if (h === "#/plan/edit") V.renderPlanEdit();
    else if (h === "#/plan") V.renderPlan();
    else if (h === "#/history") V.renderHistory();
    else if (h === "#/social") V.renderSocial();
    else if ((m = h.match(/^#\/h\/([\w-]+)$/))) V.renderWorkout(m[1]);
    else if ((m = h.match(/^#\/view\/([\d.]+)/))) V.renderView(m[1], wParam);
    else if ((m = h.match(/^#\/log\/([\d.]+)/))) V.renderLog(m[1], wParam);
    else if ((m = h.match(/^#\/week\/(\d{4}-\d{2}-\d{2})$/))) V.renderHome(m[1]);
    else V.renderHome();
  }
  A.route = route;

  /* Boot. A password-reset link comes back as #access_token=…&type=recovery
     (or #error=… if the link expired). That has to be read BEFORE the router
     sees the hash, or it would be mistaken for a route and the reset lost. */
  async function boot() {
    if (!Store.configured()) { A.renderSetup(); return; }
    var h = location.hash || "";
    var hadAuthParams = /access_token=|error_description=|type=recovery/.test(h);
    var recovery = /type=recovery/.test(h);
    var linkError = (h.match(/error_description=([^&]+)/) || [])[1];

    Store.onAuth(function (event) {
      if (event === "PASSWORD_RECOVERY") { S.recoveryMode = true; V.renderSetPassword(); }
    });
    var session = await Store.ready();              // waits for the link to be read
    if (hadAuthParams) history.replaceState(null, "", location.pathname + location.search + "#/");
    window.addEventListener("hashchange", route);

    if (recovery && session) S.recoveryMode = true;
    if (S.recoveryMode) { V.renderSetPassword(); return; }
    if (linkError) {
      V.renderForgot("That reset link has expired or was already used. Send a new one.");
      return;
    }
    route();
  }
  boot();
})();
