/* Cokiletics — dark / light.
 *
 * Loaded SYNCHRONOUSLY in <head>, before the stylesheet, so the right palette
 * is in place for the first paint. Deferring it flashes the wrong theme, which
 * at 6am in a dark gym is a face full of white.
 *
 * Three states, two of them visible: "dark" and "light" are explicit choices
 * the menu writes; no stored choice means follow the phone, re-resolved when
 * the phone changes so the app tracks the iOS sunset switch without a reload.
 * The CSS only ever sees an explicit data-theme — that is why the light palette
 * needs no @media duplicate of itself. */
window.Theme = (function () {
  var KEY = "freeco.theme";
  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch (e) { return null; }        // private mode / storage blocked
  }
  function system() { return dark && dark.matches ? "dark" : "light"; }
  // What is actually on screen right now.
  function current() { return stored() || system(); }

  function apply() {
    document.documentElement.setAttribute("data-theme", current());
    paintStatusBar();
  }

  /* The phone's status bar follows the page. The rest timer paints it blue and
     owns it for as long as it runs, so never fight it from here. */
  function paintStatusBar() {
    if (document.body && document.body.classList.contains("is-resting")) return;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", uiColor());
  }
  // Read from the stylesheet rather than repeating the hex here; a second copy
  // is a second thing to forget when the palette changes.
  function uiColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--ui-bg").trim();
    return v || "#0e0c0b";       // keep in step with --bg
  }

  function set(mode) {
    try {
      if (mode) localStorage.setItem(KEY, mode); else localStorage.removeItem(KEY);
    } catch (e) { /* not fatal: the theme still applies for this session */ }
    apply();
  }
  function toggle() { set(current() === "dark" ? "light" : "dark"); return current(); }

  // Follow the phone until a choice has been made.
  if (dark && dark.addEventListener) {
    dark.addEventListener("change", function () { if (!stored()) apply(); });
  }
  apply();
  /* In <head> the <body> does not exist yet, so the first paintStatusBar() is a
     no-op for the meta colour. Repaint once the document is up. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintStatusBar);
  }

  return { current: current, set: set, toggle: toggle, uiColor: uiColor,
           paintStatusBar: paintStatusBar };
})();
