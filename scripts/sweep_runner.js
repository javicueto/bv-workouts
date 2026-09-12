/* Sweep every runner screen at the current viewport and report the ones that
 * do not fit. Paste into the console of the app served over http (any route,
 * signed in or not — it drives Runner directly), or run it from a browser
 * automation tool. Resize the WINDOW to 320 / 375 / 414 wide between runs:
 * media queries answer to the viewport, not to a container.
 *
 *   await window.sweepRunner()            → { screens, wide, tall, worst }
 *   await window.sweepRunner({ fill: "logged" | "carried" | "empty" })
 *
 * "fill" decides what the corner buttons carry — every field filled is when
 * the row is widest (CLAUDE.md), so the default is "logged": a 137.5 kg
 * weight and edited two-digit reps on every movement. "carried" shows the
 * "last time" chip instead. A screen counts as WIDE when the document scrolls
 * sideways, and TALL when the primary action's bottom edge is below the
 * viewport at the top of the page (the Done button must be visible without
 * scrolling on a 375×812 phone, per CLAUDE.md).
 */
window.sweepRunner = async function (opts) {
  var o = opts || {};
  var fill = o.fill || "logged";
  var P = window.PROGRAMME, R = window.Runner;
  var app = document.getElementById("app");
  var saved = localStorage.getItem("freeco.session");
  var host = document.createElement("div");
  host.className = "runner";
  app.innerHTML = ""; app.appendChild(host);
  // #app is min-height 100svh and the action bar is margin-top:auto, so on a
  // tall desktop window the button always sits at the window's bottom edge.
  // Content-size the column instead, so "bottom" is what the screen NEEDS.
  var prevMin = app.style.minHeight;
  app.style.minHeight = "0";
  // `height` = the phone's viewport height to judge against (812 for a 375
  // phone) when the browser window's own toolbars make innerHeight smaller.
  var H = o.height || innerHeight;
  var out = { width: innerWidth, height: H, fill: fill, screens: 0, wide: [], tall: [], worst: 0 };

  function last() {
    var m = {};
    Object.keys(P.exercises).forEach(function (id) {
      m[id] = { weight: 137.5, reps: 12, at: Date.now(), byRound: { 1: { weight: 137.5, reps: 12 }, 2: { weight: 137.5, reps: 12 }, 3: { weight: 137.5, reps: 12 } } };
    });
    return m;
  }

  for (var s = 0; s < P.sessions.length; s++) {
    var key = P.sessions[s].key;
    R.start(key, { userId: "sweep", weekStart: null, last: fill === "empty" ? {} : last() });
    var st = R.current();
    if (fill === "logged") {
      st.steps.forEach(function (step) {
        (step.items || []).forEach(function (it) {
          var n = typeof it.target.n === "number" ? it.target.n + 3 : 15;   // edited reps → the ↺ shows
          st.logs[it.setId] = { weight: 137.5, reps: n };
        });
      });
    }
    for (var i = 0; i < st.steps.length; i++) {
      st.i = i;
      localStorage.setItem("freeco.session", JSON.stringify(st));
      R.resume();
      R.mount(host, function () {});
      // rest / tabata screens start timers; stop them at once
      R.unmount();
      // Reading a rect forces layout synchronously; never wait on
      // requestAnimationFrame here — it does not fire in a background tab
      // and the sweep would sit forever.
      void host.offsetHeight;
      var kind = st.steps[i].kind;
      var docW = document.documentElement.scrollWidth, over = docW - innerWidth;
      var act = host.querySelector(".actions .btn--primary, [data-act='finish'], #tstart, [data-act='skip']");
      var bottom = act ? act.getBoundingClientRect().bottom + scrollY : 0;
      out.screens++;
      if (over > 0) out.wide.push(key + " step " + i + " (" + kind + ") +" + over + "px");
      if (bottom > H) out.tall.push(key + " step " + i + " (" + kind + ") bottom " + Math.round(bottom) + "/" + H);
      out.worst = Math.max(out.worst, over);
    }
  }
  R.unmount();
  app.style.minHeight = prevMin;
  if (saved == null) localStorage.removeItem("freeco.session"); else localStorage.setItem("freeco.session", saved);
  document.body.classList.remove("is-resting");
  return out;
};
