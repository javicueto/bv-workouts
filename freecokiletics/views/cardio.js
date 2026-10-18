/* Cokiletics — cardio days (Javier, 18 Oct 2026): conditioning routines
 * OUTSIDE Francesco's plan, picked whenever he wants one. Reached from the
 * menu only (his choice) at #/cardio.
 *
 * Each routine is named after a football legend and wraps one WOD: a
 * Stairmaster warm-up, the WOD, an easy cooldown and an optional core
 * circuit (data/cardio.json → PROGRAMME.cardio). A card opens the routine
 * (#/view/<key>, the same screen as a plan session); Start is at its bottom,
 * as everywhere else — opening a routine never starts it. */
(function () {
  "use strict";
  var A = window.App, V = A.views, esc = A.esc, app = A.app, topbar = A.topbar;

  V.renderCardio = function () {
    A.ticket();
    var list = A.P.cardio || [];
    app.innerHTML = topbar("Cardio days", "#/") +
      '<p class="dim cardio-intro">Outside the plan, whenever you want one. Each starts with a Stairmaster warm-up and ends with an easy cooldown, plus optional core.</p>' +
      '<div class="list">' + list.map(function (s) {
        var wod = s.blocks.find(function (b) { return b.letter === "A"; });
        return '<a class="card card--tap cardio-card" href="#/view/' + esc(s.key) + '">' +
          '<div class="eyebrow">' + esc(s.wod.name) + " · " + esc(s.wod.format) + "</div>" +
          "<h2>" + esc(s.title) + "</h2>" +
          '<ul class="day-card__blocks">' + wod.exercises.map(function (e) {
            var reps = A.repsLabel(e);
            return '<li><span class="grow">' + A.cueHTML(e.name) + "</span>" +
              (reps ? '<span class="faint">' + esc(reps) + "</span>" : "") + "</li>";
          }).join("") + "</ul>" +
          '<p class="dim cardio-card__zone">' + esc(wod.zone || "") + "</p>" +
        "</a>";
      }).join("") + "</div>";
    A.syncBadge();
  };
})();
