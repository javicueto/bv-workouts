/* Cokiletics — points and status (Javier, 18 Sep 2026).
 *
 * Worked out from the workouts themselves, never stored: the same data always
 * gives the same total, the rules can change and every total follows, and the
 * workouts done before points existed count too. Pure — no DOM, no network —
 * so scripts/test_points.js runs it in Node.
 *
 * Rules (agreed with Javier):
 *   - a finished workout ........................ 100
 *   - faster than your last time on that session  +25   (timed sessions only,
 *                                                        not ones logged by hand)
 *   - heavier than ever on a movement ........... +10 each (a movement's first
 *                                                        weight sets the mark)
 *   - a full week (both of its sessions) ........ +50, and +10 more for every
 *                                                        week the streak has run
 *   - 10 / 25 / 50 / 100 workouts ............... +100 / 250 / 500 / 1000
 * A streak counts consecutive full weeks and stays alive while its last full
 * week is this week or last week.
 *
 * Status: ten players, from Tomás Pina to Messi, each with an icon (Font
 * Awesome, ICONS key) telling a player's growth — seedling to crown. Javier's
 * calls: Lamine Yamal in place of Cristiano; Buffon, the goalkeeper, in
 * place of Koke — the one name on the ladder who never played in La Liga.
 */
(function (root) {
  "use strict";
  var LADDER = [
    { min: 0, name: "Tomás Pina", icon: "seedling" },               // just growing
    { min: 500, name: "Dani Parejo", icon: "personRunning" },        // in the game
    { min: 1200, name: "Iago Aspas", icon: "bolt" },                 // sharp finisher
    { min: 2200, name: "Gianluigi Buffon", icon: "shieldHalved" },   // the wall
    { min: 3500, name: "Antoine Griezmann", icon: "star" },          // a real star
    { min: 5000, name: "Sergio Busquets", icon: "chessKnight" },     // the brain
    { min: 7000, name: "Xavi", icon: "compass" },                    // runs the game
    { min: 9500, name: "Andrés Iniesta", icon: "wandMagicSparkles" }, // pure magic
    { min: 12500, name: "Lamine Yamal", icon: "rocket" },            // rising fast
    { min: 16000, name: "Lionel Messi", icon: "crown" },             // the god
  ];
  var RULES = { workout: 100, faster: 25, best: 10, week: 50, weekStep: 10,
                milestones: { 10: 100, 25: 250, 50: 500, 100: 1000 } };

  function tierFor(points) {
    var i = 0;
    while (i + 1 < LADDER.length && points >= LADDER[i + 1].min) i++;
    // level: 1 … LADDER.length, as the league card shows it ("Level 2 of 10").
    return { index: i, level: i + 1, name: LADDER[i].name, icon: LADDER[i].icon, min: LADDER[i].min, next: LADDER[i + 1] || null };
  }
  function dayNumber(iso) {                         // "2026-09-14" → whole days, no time zone drift
    var p = String(iso).slice(0, 10).split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }
  function byFinished(a, b) { return a.finished_at < b.finished_at ? -1 : a.finished_at > b.finished_at ? 1 : 0; }

  /* One person's points.
     workouts: their workouts (only finished ones count), with id, session_key,
               week_start, finished_at, duration_seconds, logged_manually.
     bests:    their heaviest weight per movement per workout — rows of the
               freeco_set_best view: { workout_id, exercise_id, weight }.
     today:    "YYYY-MM-DD", for whether the streak is still alive.
     Returns the total, the status, the live streak, the points of every
     workout (byWorkout) and every achievement in order (events). */
  function compute(workouts, bests, today) {
    var list = (workouts || []).filter(function (w) { return w.finished_at; }).slice().sort(byFinished);
    var bestsBy = {};
    (bests || []).forEach(function (b) { (bestsBy[b.workout_id] = bestsBy[b.workout_id] || []).push(b); });
    var total = 0, count = 0, maxEver = {}, lastTimed = {}, weekDone = {};
    var streak = 0, longest = 0, lastFull = null, fullWeeks = 0;
    var byWorkout = {}, events = [];

    list.forEach(function (w) {
      var parts = [], before = total;
      function add(kind, pts, detail) { parts.push({ kind: kind, pts: pts, detail: detail || null }); }
      add("workout", RULES.workout);
      count++;

      var timed = w.duration_seconds > 0 && !w.logged_manually;
      var prev = lastTimed[w.session_key];
      if (timed && prev && w.duration_seconds < prev.duration_seconds) {
        add("faster", RULES.faster, { was: prev.duration_seconds, now: w.duration_seconds });
      }
      if (timed) lastTimed[w.session_key] = w;

      var pbs = [];
      (bestsBy[w.id] || []).forEach(function (b) {
        var kg = +b.weight, was = maxEver[b.exercise_id];
        if (!(kg > 0)) return;
        if (was != null && kg > was) pbs.push({ exercise_id: b.exercise_id, weight: kg, was: was });
        if (was == null || kg > was) maxEver[b.exercise_id] = kg;
      });
      if (pbs.length) add("best", RULES.best * pbs.length, { bests: pbs });

      if (w.week_start) {
        var seen = weekDone[w.week_start] || (weekDone[w.week_start] = {});
        var had = Object.keys(seen).length;
        seen[w.session_key] = true;
        if (had === 1 && Object.keys(seen).length === 2) {        // this one completes the week
          streak = lastFull != null && dayNumber(w.week_start) - dayNumber(lastFull) === 7 ? streak + 1 : 1;
          longest = Math.max(longest, streak);
          lastFull = w.week_start; fullWeeks++;
          add("week", RULES.week + RULES.weekStep * (streak - 1), { streak: streak, week: w.week_start });
        }
      }

      if (RULES.milestones[count]) add("milestone", RULES.milestones[count], { workouts: count });

      var pts = parts.reduce(function (s, p) { return s + p.pts; }, 0);
      total += pts;
      byWorkout[w.id] = { points: pts, parts: parts, total: total };
      parts.forEach(function (p) {
        if (p.kind !== "workout") events.push({ kind: p.kind, workout_id: w.id, at: w.finished_at, pts: p.pts, detail: p.detail });
      });
      var t0 = tierFor(before), t1 = tierFor(total);
      if (t1.index > t0.index) events.push({ kind: "status", workout_id: w.id, at: w.finished_at, pts: 0, detail: { name: t1.name, level: t1.level, icon: t1.icon } });
    });

    var alive = lastFull != null && today && dayNumber(today) - dayNumber(lastFull) <= 13;
    return { total: total, tier: tierFor(total), streak: alive ? streak : 0, longest: longest,
             fullWeeks: fullWeeks, workouts: count, byWorkout: byWorkout, events: events };
  }

  var api = { LADDER: LADDER, RULES: RULES, tierFor: tierFor, compute: compute };
  root.Points = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
