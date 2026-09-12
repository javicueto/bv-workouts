/* Cokiletics — the router and boot. Screens are in views/*.js (registered on
 * App.views); everything they share is in core.js. This file is loaded last.
 */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, app = A.app;

  async function route() {
    S.prevHash = S.curHash; S.curHash = location.hash || "#/";
    if (!Store.configured()) { A.renderSetup(); return; }
    if (S.recoveryMode) { V.renderSetPassword(); return; }
    var t = A.ticket();
    if (!S.me) S.me = await Store.user();
    if (A.stale(t) || S.recoveryMode) return;
    if (!S.me) { V.renderLogin(); return; }
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
