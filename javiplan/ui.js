/* In-app dialogs and toasts, replacing the browser's confirm() / alert() —
 * which look like system errors, and on iPhone show the site address as their
 * title. Shared by runner.js and app.js.
 *
 *   UI.confirm({ title, body, confirm: "Delete", cancel: "Keep", danger: true })
 *     → Promise<boolean>
 *   UI.toast("Saved: 52 min, 18 sets")
 */
window.UI = (function () {
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

  return { confirm: confirm, info: info, toast: toast };
})();
