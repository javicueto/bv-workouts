/* Cokiletics — the plan: set it up / change it, and the list of all weeks. */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;

  /* Set up or change a plan: when it starts, and how many weeks each block
     runs. Two sessions a week, and the blocks stay in Francesco's order —
     Javier's call (12 Sep 2026). */
  V.renderPlanEdit = function () {
    A.ticket();
    var first = !S.PLAN;
    var blocks = A.planBlocks(S.PLAN);
    var startVal = S.PLAN ? S.PLAN.start_date : A.dateVal(A.nextMonday());

    function draw() {
      app.innerHTML = topbar(null, first ? null : "#/plan") +
        '<div class="stack">' +
          '<div class="eyebrow">' + (first ? "Welcome" : "Your plan") + "</div>" +
          "<h1>" + (first ? "Set up your plan" : "Change your plan") + "</h1>" +
          '<p class="dim">Two sessions a week. The ' + blocks.length + ' blocks stay in the order Francesco wrote them — you choose when you start and how long you spend on each.</p>' +
          '<div class="field"><label for="sd">First week starts</label><input class="input" id="sd" type="date" value="' + esc(startVal) + '"></div>' +
          '<div class="card stack">' +
            blocks.map(function (b, i) {
              return '<div class="plan-row"><div class="grow"><b>Block ' + b.block + "</b>" +
                (A.PHASE[b.block] ? ' <span class="dim">· ' + esc(A.PHASE[b.block]) + "</span>" : "") + "</div>" +
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
      var weeks = A.buildWeeks({ start_date: A.dateVal(A.mondayOf(new Date(sd + "T00:00:00"))), blocks: blocks });
      var last = weeks[weeks.length - 1], endD = new Date(last.start + "T00:00:00"); endD.setDate(endD.getDate() + 6);
      var lastBlock = blocks[blocks.length - 1].block;
      var peak = weeks.find(function (w) { return w.block === lastBlock; });
      el.innerHTML = "<b>" + weeks.length + " weeks</b>, " + weeks.length * 2 + " sessions — " +
        A.fmt(weeks[0].start) + " to " + A.fmt(A.isoDate(endD)) + ".<br>" +
        "Block " + lastBlock + " (the last one) starts " + A.fmt(peak.start) + ".";
    }
    async function save() {
      var sd = document.getElementById("sd").value, err = document.getElementById("perr"), btn = document.getElementById("psave");
      if (!sd) { err.textContent = "Pick a start date."; err.hidden = false; return; }
      // Weeks run Monday to Sunday, so a plan always starts on a Monday.
      var start = A.dateVal(A.mondayOf(new Date(sd + "T00:00:00")));
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        S.PLAN = await Store.savePlan({ user_id: S.me.id, name: (S.PLAN && S.PLAN.name) || "My plan",
          start_date: start, blocks: blocks });
        S.WEEKS = A.buildWeeks(S.PLAN);
        UI.toast(first ? "Plan set — your first session is ready" : "Plan saved");
        if ((location.hash || "#/") === "#/") A.route(); else location.hash = "#/";
      } catch (e) {
        err.textContent = (e && e.message) || "Could not save the plan"; err.hidden = false;
        btn.disabled = false; btn.textContent = first ? "Start my plan" : "Save plan";
      }
    }
    draw();
  };

  V.renderPlan = function () {
    A.ticket();
    var W = S.WEEKS, wf = A.weekFor(A.today());
    app.innerHTML = topbar("Plan", "#/") + '<p class="dim">Two days a week. Day 1 is the block’s first session, Day 2 the second.</p>' +
      '<div style="margin-top:var(--space-4)">' + W.map(function (w, ix) {
        var cls = ix < wf.index ? "past" : ix === wf.index ? "now" : "";
        var chip = ix === 0 || W[ix - 1].block !== w.block ? '<span class="badge badge--cool">' + esc(w.phase) + "</span>" : "";
        return '<a class="week-row ' + cls + '" href="#/week/' + w.start + '"><div class="num">' + w.block + '</div><div class="grow">' +
          "<b>" + A.fmtRange(w.start) + "</b> <span class=\"dim\">· week " + w.week_of_block + "/" + w.weeks_in_block + "</span>" +
          "</div>" + chip + "</a>";
      }).join("") +
      "</div>" +
      '<a class="btn btn--ghost btn--block" style="margin-top:var(--space-5)" href="#/plan/edit">Edit my plan</a>';
  };
})();
