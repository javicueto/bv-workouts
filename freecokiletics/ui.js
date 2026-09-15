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
    /* Focus goes to the layer itself, not its first button (Javier, 14 Sep
       2026): focusing "Close" drew the orange focus ring on it the first time
       a preview opened on the iPhone. The layer is still where focus is, so a
       screen reader reads it, Tab reaches its buttons and Escape closes it.
       focusVisible:false keeps the ring off where the browser supports it. */
    el.focus({ preventScroll: true, focusVisible: false });
    return function release() {
      document.removeEventListener("keydown", onKey, true);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true, focusVisible: false });
    };
  }

  /* A movement preview, full width, over everything. The ONE implementation:
     the runner's thumbnails and the read-only session screen both open it, so
     the two cannot drift. Escape, the Close button or a tap anywhere closes it,
     and focus goes back to the thumbnail that opened it (UI.overlay). */
  /* With a YouTube id, a link to the full video sits under the preview
     (Javier, 15 Sep 2026: after seeing the loop big you may still want the
     whole exercise). It opens outside the app and does NOT close this view,
     so the preview is still there when you come back. */
  function zoomImage(src, name, youtubeId) {
    var ov = document.createElement("div");
    ov.className = "zoom";
    ov.innerHTML = (src ? '<img src="' + esc(src) + '" alt="">' : "") +
      '<div class="zoom__name">' + esc(name || "") + "</div>" +
      (youtubeId ? '<a class="zoom__yt" href="https://www.youtube.com/watch?v=' + encodeURIComponent(youtubeId) +
        '" target="_blank" rel="noopener">' + ICONS.external + "Full video on YouTube</a>" : "") +
      '<button class="btn btn--ghost zoom__close" type="button">Close</button>' +
      '<div class="faint" style="font-size:13px">Or tap anywhere</div>';
    var release;
    function close() { release(); ov.remove(); }
    ov.addEventListener("click", function (e) { if (!e.target.closest(".zoom__yt")) close(); });
    release = overlay(ov, name || "Preview", close);
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

  /* Swipe sideways between pages (Javier, 14 Sep 2026 — the week screen):
     left = next, right = previous, the same way a session's swipe moves on.
     Only a clearly horizontal drag counts, so scrolling is untouched (the
     element is touch-action: pan-y). The page follows the finger; short of the
     threshold, or with no page that way, it settles back (with resistance).
     A drag never also taps the card it started on.
       opts: { prev, next }  — functions, or null where there is no page */
  /* The page moves like a page (Javier, 14 Sep 2026: "the whole page moving
     at the edge and disappearing"): it follows the finger, fading as it nears
     the edge; past the threshold it slides right off that side and the next
     page slides in from the other (the caller adds .is-in-next / .is-in-prev
     on the new page); short of it, it springs back. Returns { go(dir) } so a
     tap on an arrow plays the same slide. html.is-paging clips the sideways
     overflow while a page is off-centre, so the body never scrolls. */
  /* An inert copy of screen markup, for anything shown "beside" or "under"
     the live screen while swiping (the neighbouring week):
     no ids, no data-* hooks, no for= / aria-controls, so nothing in it can be
     found by the live code, clicked, focused or read when a round is logged.
     Returns a DocumentFragment. */
  function inertCopy(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html;
    Array.prototype.slice.call(tpl.content.querySelectorAll("*")).forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (a) {
        if (a.name === "id" || a.name === "for" || a.name === "aria-controls" || a.name.indexOf("data-") === 0) node.removeAttribute(a.name);
      });
    });
    return tpl.content;
  }

  function swipePages(el, opts) {
    var THRESHOLD = 80;                  // px
    var OUT_MS = 260;                    // matches .week-swipe.is-leaving
    var GAP = 16;                        // px between the page and its neighbour
    var root = document.documentElement;
    var x0 = 0, y0 = 0, dx = 0, active = false, horizontal = null;
    var sides = {};                      // dir → the neighbouring page (or null: none to show)
    function reduced() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    function paging(on) { root.classList.toggle("is-paging", !!on); }

    /* The neighbouring page, beside this one (opts.peek(dir) → its markup),
       Javier 14 Sep 2026: "the following or previous weeks appear on the sides
       while the swipe is active". It is a child of the page, so it moves with
       the drag; it lands exactly where the real page then renders. */
    function side(dir) {
      if (sides[dir] !== undefined) return sides[dir];
      var html = opts.peek && (dir > 0 ? opts.next : opts.prev) && !reduced() ? opts.peek(dir) : null;
      if (!html) { sides[dir] = null; return null; }
      var pane = document.createElement("div");
      pane.className = "swipe-side";
      pane.setAttribute("aria-hidden", "true");
      pane.inert = true;
      pane.style.left = dir > 0 ? "calc(100% + " + GAP + "px)" : "calc(-100% - " + GAP + "px)";
      pane.appendChild(inertCopy(html));
      el.appendChild(pane);
      sides[dir] = pane;
      return pane;
    }
    function dropSides() {
      Object.keys(sides).forEach(function (k) { if (sides[k]) sides[k].remove(); });
      sides = {};
    }
    function settle() {
      el.classList.remove("is-swiping");
      el.classList.add("is-settling");
      el.style.transform = ""; el.style.opacity = "";
      setTimeout(function () { el.classList.remove("is-settling"); dropSides(); paging(false); }, 280);
    }
    // dir 1 = next (the page leaves to the left), -1 = previous.
    function leave(dir) {
      var go = dir > 0 ? opts.next : opts.prev;
      if (!go) { settle(); return; }
      paging(true);
      var pane = side(dir);
      void el.offsetWidth;                                      // an arrow tap starts the slide from rest
      el.classList.remove("is-swiping");
      el.classList.add("is-leaving");
      if (pane) {
        // Carousel: the neighbour slides exactly into the page's place.
        el.style.transform = "translateX(calc(" + (dir > 0 ? "-100% - " : "100% + ") + GAP + "px))";
      } else {
        el.style.transform = "translateX(" + (dir > 0 ? -100 : 100) + "%)";
        el.style.opacity = "0";
      }
      setTimeout(function () {
        go(dir, !!pane);
        setTimeout(function () { paging(false); }, 1500);   // safety net; the new page clears it when it lands
      }, reduced() ? 0 : OUT_MS);
    }
    el.addEventListener("touchstart", function (e) {
      horizontal = null; dx = 0;
      if (e.touches.length !== 1 || e.target.closest("input, textarea, select")) { active = false; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; active = true;
    }, { passive: true });
    el.addEventListener("touchmove", function (e) {
      if (!active) return;
      var mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horizontal = Math.abs(mx) > Math.abs(my) * 1.3;
      if (!horizontal) return;
      /* Once a drag is sideways it never also scrolls the page (Javier,
         14 Sep 2026: the side scroll bar flashed while swiping weeks — the
         finger is never perfectly level, so the page moved a few pixels up
         or down). Needs a non-passive listener; vertical drags scroll as ever. */
      if (e.cancelable) e.preventDefault();
      var dir = mx < 0 ? 1 : -1, can = dir > 0 ? opts.next : opts.prev;
      dx = can ? mx : mx / 4;                                   // resistance where there's nowhere to go
      paging(true);
      var pane = can ? side(dir) : null;
      el.classList.add("is-swiping");
      el.style.transform = "translateX(" + dx + "px)";
      // With a neighbour beside it the page doesn't fade — it's a carousel.
      el.style.opacity = pane || !can ? "" : String(1 - Math.min(Math.abs(dx) / (el.offsetWidth || 1), 1) * 0.6);
    }, { passive: false });
    el.addEventListener("touchend", function () {
      if (!active) return;
      active = false;
      if (!horizontal) return;
      if (Math.abs(dx) >= THRESHOLD) leave(dx < 0 ? 1 : -1); else settle();
    });
    el.addEventListener("touchcancel", function () { active = false; if (horizontal) settle(); });
    el.addEventListener("click", function (e) {
      if (horizontal) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    return { go: leave };
  }

  return { esc: esc, confirm: confirm, info: info, toast: toast, announce: announce, overlay: overlay, zoomImage: zoomImage,
           swipePages: swipePages, inertCopy: inertCopy };
})();
