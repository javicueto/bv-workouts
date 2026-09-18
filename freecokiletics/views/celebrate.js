/* Cokiletics — the celebration after a workout (Javier, 18 Sep 2026: "When
 * achievements happen, is it shown in the app? At the end of a workout?" —
 * option 1: right after Save and finish).
 *
 * Over Home, just after it: the points this workout earned, counted up, with
 * the breakdown (points.js — workout, faster, personal bests, full week and
 * streak, milestones), the level you are at with its icon — big, marked "New
 * level", when this workout took you up one — and the bar to the next level
 * filling from where it was. One tap on Done closes it. "End and save now" on
 * the pause screen finishes the same way, so it gets it too.
 *
 * Worked out against the whole history (Store.pointsInput: server, else
 * Social's saved copy, plus the upload queue). With no history at all —
 * offline and Social never opened on this phone — it shows only this
 * workout's points and says the rest adds up in Social, rather than a level
 * that would be wrong.
 */
(function () {
  "use strict";
  var A = window.App, S = A.S, V = A.views, esc = A.esc;

  function minutes(sec) { return Math.round(sec / 60) + " min"; }
  function num(n) { return Number(n).toLocaleString("en"); }
  function exName(id) { var e = A.P.exercises[id]; return A.cueText(e ? e.name : "A movement"); }

  // One line of the breakdown, in the feed's words.
  function partLine(p) {
    var d = p.detail || {}, text;
    if (p.kind === "workout") text = "Workout done";
    else if (p.kind === "faster") text = "Faster than last time · " + minutes(d.was - d.now);
    else if (p.kind === "best") text = d.bests.length === 1
      ? "New personal best · " + exName(d.bests[0].exercise_id) + " " + d.bests[0].weight + " kg"
      : d.bests.length + " personal bests · " + d.bests.map(function (b) { return exName(b.exercise_id); }).join(", ");
    else if (p.kind === "week") text = d.streak > 1 ? "Full week · " + d.streak + "-week streak" : "Full week, both sessions";
    else if (p.kind === "milestone") text = d.workouts + " workouts";
    else text = "";
    return '<li><span>' + esc(text) + "</span><b>+" + p.pts + "</b></li>";
  }
  function pct(total, tier) {
    return tier.next ? Math.max(0, Math.min(100, Math.round((total - tier.min) / (tier.next.min - tier.min) * 100))) : 100;
  }

  V.celebrate = function (result) {
    var ov = document.createElement("div");
    ov.className = "celebrate";
    var s = A.sessionByKey(result.key);
    ov.innerHTML = '<div class="celebrate__inner">' +
      '<div class="eyebrow">Workout done</div>' +
      '<div class="celebrate__title">' + esc(s ? s.title : "Workout") + "</div>" +
      '<p class="dim celebrate__meta">' + esc(minutes(result.duration || 0) + " · " + (result.sets || 0) + " sets") + "</p>" +
      '<div class="celebrate__body" aria-live="polite"><p class="dim">Adding up your points…</p></div>' +
      '<button class="btn btn--primary btn--big btn--block" type="button" data-done>Done</button></div>';
    var closing = false, release = UI.overlay(ov, "Workout done", close);
    UI.enter(ov, "rise");
    function close() { if (closing) return; closing = true; release(); UI.leave(ov, function () { ov.remove(); }); }
    ov.querySelector("[data-done]").addEventListener("click", close);

    Store.pointsInput(S.me.id).then(function (input) {
      if (closing) return;
      var today = A.isoDate(A.today());
      var after = Points.compute(input.workouts, input.bests, today);
      var mine = after.byWorkout[result.workoutId];
      var body = ov.querySelector(".celebrate__body");
      if (!mine) { body.innerHTML = '<p class="dim">Your points add up in Social.</p>'; return; }
      var before = Points.compute(input.workouts.filter(function (w) { return w.id !== result.workoutId; }),
                                  input.bests.filter(function (b) { return b.workout_id !== result.workoutId; }), today);
      var t = after.tier, up = !input.partial && t.level > before.tier.level;
      body.innerHTML =
        '<div class="celebrate__pts"><span data-count="' + mine.points + '">+0</span><small>points</small></div>' +
        '<ul class="celebrate__parts">' + mine.parts.map(partLine).join("") + "</ul>" +
        (input.partial
          ? '<p class="dim">Your level and the rest add up in Social when you’re back online.</p>'
          : '<div class="celebrate__level' + (up ? " is-up" : "") + '">' +
              (up ? '<div class="celebrate__new">New level</div>' : "") +
              '<div class="league__level">Level ' + t.level + " of " + Points.LADDER.length + "</div>" +
              '<div class="league__status">' + (ICONS[t.icon] || "") + "<span>" + esc(t.name) + "</span></div>" +
              '<div class="league__bar"><i style="width:' + (up ? 0 : pct(before.total, t)) + '%"></i></div>' +
              '<div class="league__meta"><span>' + num(after.total) + " points</span><span>" +
                esc(t.next ? num(t.next.min - after.total) + " to " + t.next.name : "Top of La Liga") + "</span></div>" +
            "</div>");
      // The number counts up and the bar fills to where it is now.
      var el = body.querySelector("[data-count]"), target = mine.points, steps = 18, k = 0;
      var tick = setInterval(function () {
        k++; el.textContent = "+" + Math.round(target * Math.min(1, k / steps));
        if (k >= steps) { clearInterval(tick); UI.bump(el); }
      }, 40);
      var bar = body.querySelector(".celebrate__level .league__bar i");
      if (bar) setTimeout(function () { bar.style.width = pct(after.total, t) + "%"; }, 120);
    }).catch(function () {
      if (closing) return;
      ov.querySelector(".celebrate__body").innerHTML = '<p class="dim">Saved. Your points add up in Social.</p>';
    });
  };
})();
