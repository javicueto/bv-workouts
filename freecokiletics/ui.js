/* In-app dialogs and toasts, replacing the browser's confirm() / alert() —
 * which look like system errors, and on iPhone show the site address as their
 * title. Shared by runner.js and app.js.
 *
 *   UI.confirm({ title, body, confirm: "Delete", cancel: "Keep", danger: true })
 *     → Promise<boolean>
 *   UI.toast("Saved: 52 min, 18 sets")
 *   UI.announce("History")                → the screen reader's live region
 *   UI.overlay(el, "Hold timer", close)   → dialog semantics + Escape + focus
 */
window.UI = (function () {
  /* THE escape for markup built from strings. ui.js loads before store,
     runner and app, which take it as `var esc = UI.esc` — one copy, not
     three that could drift apart. */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function confirm(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var back = document.createElement("div");
      back.className = "sheet-back";
      back.innerHTML =
        '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">' +
          '<h2 id="sheet-t">' + esc(o.title || "Are you sure?") + "</h2>" +
          (o.body ? '<p class="dim">' + esc(o.body) + "</p>" : "") +
          '<div class="sheet__actions">' +
            '<button class="btn btn--ghost" data-v="0">' + esc(o.cancel || "Cancel") + "</button>" +
            '<button class="btn ' + (o.danger ? "btn--danger" : "btn--primary") + '" data-v="1">' + esc(o.confirm || "OK") + "</button>" +
          "</div>" +
        "</div>";
      var prevFocus = document.activeElement;
      function close(v) {
        back.classList.remove("in");
        document.removeEventListener("keydown", onKey, true);
        setTimeout(function () { back.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }, 160);
        resolve(v);
      }
      function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(false); } }
      back.addEventListener("click", function (e) {
        var b = e.target.closest("[data-v]");
        if (b) close(b.getAttribute("data-v") === "1");
        else if (e.target === back) close(false);          // tap outside = cancel
      });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(back);
      requestAnimationFrame(function () { back.classList.add("in"); });
      // Focus the safe choice for destructive actions, the action otherwise.
      back.querySelector(o.danger ? '[data-v="0"]' : '[data-v="1"]').focus();
    });
  }

  /* A sheet with rich content and one button — for instructions. `html` is
     trusted markup built by the app, never user text. */
  function info(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var back = document.createElement("div");
      back.className = "sheet-back";
      back.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">' +
        '<h2 id="sheet-t">' + esc(o.title || "") + "</h2>" + (o.html || "") +
        '<button class="btn btn--primary btn--block" data-v="1">' + esc(o.ok || "Got it") + "</button></div>";
      function close() { back.classList.remove("in"); document.removeEventListener("keydown", onKey, true); setTimeout(function () { back.remove(); }, 160); resolve(); }
      function onKey(e) { if (e.key === "Escape") close(); }
      back.addEventListener("click", function (e) { if (e.target.closest("[data-v]") || e.target === back) close(); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(back);
      requestAnimationFrame(function () { back.classList.add("in"); });
      back.querySelector("[data-v]").focus();
    });
  }

  /* One line into the page's only live region, so a screen reader hears
     where it is after a navigation without the whole screen being re-read. */
  function announce(text) {
    var el = document.getElementById("announce");
    if (!el) return;
    el.textContent = "";                 // same text twice must still announce
    setTimeout(function () { el.textContent = text; }, 30);
  }

  /* The one way to put something OVER the app: a full-screen element that is
     a dialog (role, aria-modal), closes on Escape, takes focus, and gives
     focus back to whatever opened it when it goes. The hold timer and the
     preview zoom both use it, so they cannot drift apart. `close` is the
     caller's own teardown; call the returned function from it. */
  function overlay(el, label, close) {
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    if (label) el.setAttribute("aria-label", label);
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    var prevFocus = document.activeElement;
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(el);
    var first = el.querySelector("button, [href], input, [tabindex='0']");
    (first || el).focus({ preventScroll: true });
    return function release() {
      document.removeEventListener("keydown", onKey, true);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    };
  }

  var toastEl = null, toastTimer = null;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast"; toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("in"); }, ms || 3200);
  }

  return { esc: esc, confirm: confirm, info: info, toast: toast, announce: announce, overlay: overlay };
})();
