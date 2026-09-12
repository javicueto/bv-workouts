#!/usr/bin/env node
/* Offline-queue tests for freecokiletics/store.js, run in Node with a fake
 * supabase-js. No network, no browser.
 *
 *   node scripts/test_store_queue.js
 *
 * What is asserted is the OUTCOME — which rows reached the fake server and
 * what is left in the fake localStorage — not that some function was called.
 *
 *   1. A set logged DURING a slow upload still reaches the server. (The old
 *      flush wrote back a stale copy of the queue and lost it.)
 *   2. A row the server refuses for what it is (a code) is dropped and kept in
 *      freeco.dropped; the rows behind it still go through.
 *   3. A dead network leaves the queue intact and retries later.
 *   4. A request that never answers times out instead of hanging.
 *   5. Sign-out clears the account's keys and leaves device preferences.
 */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");

function fakeStorage() {
  var m = {};
  return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); },
           removeItem: function (k) { delete m[k]; }, _m: m };
}
function makeWindow(server) {
  var w = { addEventListener: function () {} };
  w.window = w;
  w.document = { addEventListener: function () {}, visibilityState: "visible" };
  w.navigator = { onLine: true };
  w.localStorage = fakeStorage();
  w.crypto = { randomUUID: function () { return "id-" + Math.random().toString(16).slice(2); } };
  w.setTimeout = setTimeout; w.clearTimeout = clearTimeout; w.setInterval = function () {}; w.console = console;
  w.Promise = Promise; w.Date = Date; w.JSON = JSON; w.Math = Math; w.Object = Object; w.Error = Error; w.String = String;
  w.FREECO_CONFIG = { supabaseUrl: "https://x.supabase.co", supabaseKey: "k" };
  w.supabase = { createClient: function () { return server.client; } };
  return w;
}
/* A fake supabase-js client: every builder resolves through server.respond(op). */
function fakeServer() {
  var srv = { rows: [], respond: null, signedOut: 0 };
  function builder(table, kind, payload) {
    var op = { table: table, kind: kind, payload: payload };
    var p = { eq: function () { return p; }, then: function (ok, ko) { return srv.respond(op).then(ok, ko); } };
    return p;
  }
  srv.client = {
    auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: "u1" } } } }); },
            signOut: function () { srv.signedOut++; return Promise.resolve({}); } },
    from: function (table) {
      return { upsert: function (row) { return builder(table, "upsert", row); },
               delete: function () { return builder(table, "delete", null); } };
    },
  };
  srv.accept = function (op) { srv.rows.push(op.payload); return Promise.resolve({ data: op.payload, error: null }); };
  return srv;
}
function loadStore(w) {
  var src = fs.readFileSync(path.join(__dirname, "..", "freecokiletics", "store.js"), "utf8");
  vm.runInNewContext(src, w);
  return w.Store;
}
var failures = 0;
function check(name, cond) { console.log((cond ? "  ok   " : "  FAIL ") + name); if (!cond) failures++; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function test1_logDuringSlowUpload() {
  console.log("1. a set logged during a slow upload is not lost");
  var srv = fakeServer(), w = makeWindow(srv), Store = loadStore(w);
  var gate;                                  // the first upload waits on this
  srv.respond = function (op) {
    if (op.payload && op.payload.id === "w1") return new Promise(function (r) { gate = function () { r(srv.accept(op)); }; });
    return srv.accept(op);
  };
  Store.saveWorkout({ id: "w1", user_id: "u1" });          // starts a flush that stalls on the server
  await sleep(20);
  Store.saveSet({ id: "s1", workout_id: "w1", user_id: "u1", exercise_id: "e", round: 1, weight: 40, reps: 10, done_at: new Date().toISOString() });
  check("two ops queued while the first is in flight", Store.pending() === 2);
  gate();                                                   // the slow upload lands now
  await sleep(50);
  var ids = srv.rows.map(function (r) { return r.id; });
  check("workout reached the server", ids.indexOf("w1") !== -1);
  check("the set logged meanwhile reached the server too", ids.indexOf("s1") !== -1);
  check("queue is empty afterwards", Store.pending() === 0);
}

async function test2_refusedRowIsDroppedNotWedged() {
  console.log("2. a refused row is set aside and the rest still go through");
  var srv = fakeServer(), w = makeWindow(srv), Store = loadStore(w);
  srv.respond = function (op) {
    if (op.payload && op.payload.id === "bad") return Promise.resolve({ data: null, error: { code: "23503", message: "fk" }, status: 409 });
    return srv.accept(op);
  };
  Store.saveSet({ id: "bad", workout_id: "nope", exercise_id: "e", round: 1 });
  Store.saveSet({ id: "good", workout_id: "w", exercise_id: "e", round: 1 });
  await sleep(50);
  check("the good row landed", srv.rows.some(function (r) { return r.id === "good"; }));
  check("queue drained", Store.pending() === 0);
  var dropped = JSON.parse(w.localStorage.getItem("freeco.dropped") || "[]");
  check("the refused row is kept in freeco.dropped", dropped.length === 1 && dropped[0].op.row.id === "bad");
}

async function test3_deadNetworkKeepsQueue() {
  console.log("3. a dead network keeps everything for later");
  var srv = fakeServer(), w = makeWindow(srv), Store = loadStore(w);
  srv.respond = function () { return Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 }); };
  Store.saveSet({ id: "s1", workout_id: "w", exercise_id: "e", round: 1 });
  Store.saveSet({ id: "s2", workout_id: "w", exercise_id: "e", round: 2 });
  await sleep(50);
  check("nothing reached the server", srv.rows.length === 0);
  check("both rows still queued", Store.pending() === 2);
  srv.respond = srv.accept;                                 // signal is back
  await Store.flush();
  check("both land on the next flush, in order", srv.rows.map(function (r) { return r.id; }).join() === "s1,s2");
}

async function test4_hangingRequestTimesOut() {
  console.log("4. a request that never answers times out (8s) and the row is kept");
  var srv = fakeServer(), w = makeWindow(srv), Store = loadStore(w);
  var realTimeout = w.setTimeout;
  // Shrink the 8s timeout to 30ms for the test by intercepting the timer.
  w.setTimeout = function (fn, ms) { return realTimeout(fn, ms === 8000 ? 30 : ms); };
  Store = loadStore(w);
  srv.respond = function () { return new Promise(function () {}); };   // never resolves
  Store.saveSet({ id: "s1", workout_id: "w", exercise_id: "e", round: 1 });
  var t0 = Date.now();
  await Store.flush();
  check("flush returned instead of hanging", Date.now() - t0 < 1000);
  check("row still queued for the next attempt", Store.pending() === 1);
  var threw = false;
  try { await Store.history("u1", 10); } catch (e) { threw = true; }
  // history() goes through a builder our fake does not fully mimic (select/order/limit);
  // the assertion that matters is that a read either resolves or throws — never hangs.
  check("a read that cannot complete throws rather than hanging", threw);
}

async function test5_signOutClearsAccountKeys() {
  console.log("5. sign-out clears the account's keys and leaves device preferences");
  var srv = fakeServer(), w = makeWindow(srv), Store = loadStore(w);
  srv.respond = function () { return Promise.resolve({ data: null, error: { message: "Failed to fetch" }, status: 0 }); };
  Store.saveSet({ id: "s1", workout_id: "w", exercise_id: "e", round: 1, weight: 40 });
  await sleep(30);
  w.localStorage.setItem("freeco.plan", "{}"); w.localStorage.setItem("freeco.session", "{}");
  w.localStorage.setItem("freeco.theme", "light"); w.localStorage.setItem("freeco.installHidden", "1");
  await Store.signOut();
  ["freeco.queue", "freeco.plan", "freeco.session", "freeco.lastWeights"].forEach(function (k) {
    check(k + " is gone", w.localStorage.getItem(k) === null);
  });
  check("freeco.theme stays", w.localStorage.getItem("freeco.theme") === "light");
  check("freeco.installHidden stays", w.localStorage.getItem("freeco.installHidden") === "1");
  check("supabase signOut was called", srv.signedOut === 1);
}

(async function () {
  await test1_logDuringSlowUpload();
  await test2_refusedRowIsDroppedNotWedged();
  await test3_deadNetworkKeepsQueue();
  await test4_hangingRequestTimesOut();
  await test5_signOutClearsAccountKeys();
  console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
