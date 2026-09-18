#!/usr/bin/env node
/* Tests for freecokiletics/points.js — the rules as agreed with Javier on
 * 18 Sep 2026. Run: node scripts/test_points.js */
"use strict";
var P = require("../freecokiletics/points.js");
var failures = 0;
function check(name, cond) { console.log((cond ? "  ok   " : "  FAIL ") + name); if (!cond) failures++; }
var n = 0;
function w(session, week, finished, dur, extra) {
  return Object.assign({ id: "w" + (++n), session_key: session, week_start: week, finished_at: finished,
                         duration_seconds: dur, logged_manually: false }, extra || {});
}

console.log("1. a workout is 100, and the start is Tomás Pina");
var r = P.compute([w("1.1", "2026-09-14", "2026-09-14T09:00:00Z", 3600)], [], "2026-09-18");
check("100 points", r.total === 100);
check("Tomás Pina", r.tier.name === "Tomás Pina" && r.tier.next.name === "Dani Parejo");
check("an unfinished workout is not counted",
  P.compute([w("1.1", "2026-09-14", null, 0)], [], "2026-09-18").total === 0);

console.log("2. faster than last time on the same session: +25");
var a = w("1.1", "2026-09-07", "2026-09-07T09:00:00Z", 3600), b = w("1.1", "2026-09-14", "2026-09-14T09:00:00Z", 3300);
r = P.compute([a, b], [], "2026-09-18");
check("the faster one earns 125", r.byWorkout[b.id].points === 125);
check("an event says by how much", r.events.some(function (e) { return e.kind === "faster" && e.detail.was === 3600 && e.detail.now === 3300; }));
var c = w("1.1", "2026-09-21", "2026-09-21T09:00:00Z", 3500);
r = P.compute([a, b, c], [], "2026-09-22");
check("slower than the last time: no bonus", r.byWorkout[c.id].points === 100);
var m = w("1.1", "2026-09-21", "2026-09-21T09:00:00Z", 60, { logged_manually: true });
r = P.compute([a, m], [], "2026-09-22");
check("logged by hand never counts as faster", r.byWorkout[m.id].points === 100);
var other = w("1.2", "2026-09-14", "2026-09-14T09:00:00Z", 60);
r = P.compute([a, other], [], "2026-09-18");
check("a different session is not compared", !r.events.some(function (e) { return e.kind === "faster"; }));

console.log("3. heavier than ever: +10 per movement; the first weight only sets the mark");
var x = w("1.1", "2026-09-07", "2026-09-07T09:00:00Z", 0), y = w("1.2", "2026-09-07", "2026-09-10T09:00:00Z", 0);   // same week: +50 too
var bests = [{ workout_id: x.id, exercise_id: "bench", weight: 40 }, { workout_id: x.id, exercise_id: "squat", weight: 60 },
             { workout_id: y.id, exercise_id: "bench", weight: 42.5 }, { workout_id: y.id, exercise_id: "squat", weight: 60 },
             { workout_id: y.id, exercise_id: "row", weight: 30 }];
r = P.compute([x, y], bests, "2026-09-12");
check("first workout: no bests", r.byWorkout[x.id].points === 100);
check("second: only the bench beats its mark (+10)", r.byWorkout[y.id].points === 100 + 10 + 50);
var ev = r.events.filter(function (e) { return e.kind === "best"; })[0];
check("the event names it with before and after", ev && ev.detail.bests.length === 1 && ev.detail.bests[0].weight === 42.5 && ev.detail.bests[0].was === 40);

console.log("4. full weeks and streaks: +50, +10 more per week of streak");
n = 0;
var weeks = ["2026-08-31", "2026-09-07", "2026-09-14"], list = [];
weeks.forEach(function (wk, i) {
  list.push(w("1.1", wk, wk + "T08:00:00Z", 0));
  list.push(w("1.2", wk, wk + "T18:00:00Z", 0));
});
r = P.compute(list, [], "2026-09-18");
var wkPts = r.events.filter(function (e) { return e.kind === "week"; }).map(function (e) { return e.pts + "@" + e.detail.streak; });
check("50, 60, 70 for a 3-week streak", wkPts.join() === "50@1,60@2,70@3");
check("streak alive this week: 3", r.streak === 3 && r.longest === 3 && r.fullWeeks === 3);
check("two weeks with nothing after the last full one: streak 0", P.compute(list, [], "2026-09-28").streak === 0);
var twice = [w("1.1", "2026-09-14", "2026-09-14T08:00:00Z", 0), w("1.1", "2026-09-14", "2026-09-16T08:00:00Z", 0)];
check("the same session twice does not complete a week", !P.compute(twice, [], "2026-09-18").events.some(function (e) { return e.kind === "week"; }));
var gap = [w("1.1", "2026-08-31", "2026-08-31T08:00:00Z", 0), w("1.2", "2026-08-31", "2026-08-31T18:00:00Z", 0),
           w("1.1", "2026-09-14", "2026-09-14T08:00:00Z", 0), w("1.2", "2026-09-14", "2026-09-14T18:00:00Z", 0)];
check("a missed week starts the streak again at 50", P.compute(gap, [], "2026-09-18").events.filter(function (e) { return e.kind === "week"; }).map(function (e) { return e.pts; }).join() === "50,50");

console.log("5. milestones and status");
n = 0;
var ten = [];
for (var i = 0; i < 10; i++) ten.push(w("1.1", null, "2026-09-" + String(i + 1).padStart(2, "0") + "T09:00:00Z", 0));
r = P.compute(ten, [], "2026-09-18");
check("the tenth workout earns +100", r.byWorkout[ten[9].id].points === 200 && r.total === 1100);
check("crossing 500 is an event: level 2, Dani Parejo", r.events.some(function (e) { return e.kind === "status" && e.detail.name === "Dani Parejo" && e.detail.level === 2; }));
check("Messi is level 10", P.tierFor(16000).level === 10 && P.tierFor(0).level === 1);
check("1100 is still Dani Parejo, next Iago Aspas at 1200", r.tier.name === "Dani Parejo" && r.tier.next.min === 1200);
check("12,500 is Lamine Yamal", P.tierFor(12500).name === "Lamine Yamal");
check("16,000 is Messi, and there is nothing above", P.tierFor(16000).name === "Lionel Messi" && P.tierFor(99999).next === null);
check("ten players", P.LADDER.length === 10 && P.LADDER[0].name === "Tomás Pina");

console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
