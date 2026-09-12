/* Data layer: Supabase auth + writes, with an offline queue.
 *
 * Every log write goes to the queue first (localStorage), then flushes to
 * Supabase. If the gym has no signal, the queue simply waits; it flushes on
 * the next app open or when the network comes back. Nothing is lost by
 * finishing a session offline.
 *
 * "Last weight" lookups come from Supabase when online and from a local map
 * (updated on every log) when not, so the default weight is always available.
 */
window.Store = (function () {
  var cfg = window.FREECO_CONFIG || {};
  var client = null;
  var Q_KEY = "freeco.queue";
  var LAST_KEY = "freeco.lastWeights";
  // Tables live in the Maky project, prefixed so they never collide with it.
  // Renamed from javiplan_* on 12 Sep 2026 with the app.
  var T_WORKOUTS = "freeco_workouts";
  var T_SETS = "freeco_sets";
  var T_PLANS = "freeco_plans";
  var PLAN_KEY = "freeco.plan";
  var SESSION_KEY = "freeco.session";    // owned by runner.js; cleared here on sign-out
  var DROPPED_KEY = "freeco.dropped";    // rows the server refused, kept for inspection
  var listeners = [];

  function configured() { return !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase); }

  function sb() {
    if (!client && configured()) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: {
          persistSession: true, autoRefreshToken: true,
          // Needed for "Forgot password": the reset email lands back here with
          // the recovery session in the URL, and the client must read it.
          detectSessionInUrl: true,
          // MUST stay "implicit", not "pkce". On iPhone the home-screen app and
          // Safari keep separate storage, and the reset link always opens in
          // Safari. PKCE needs a secret saved by the browser that asked for the
          // email, so a reset requested from the app would fail in Safari.
          // Implicit carries everything in the link itself.
          flowType: "implicit",
        },
      });
    }
    return client;
  }

  /* Every read goes through this. A gym with one bar of signal is the normal
     case, and a request that never answers is worse than one that fails: the
     screen just sits on "Loading…". So a read either resolves within
     REQUEST_TIMEOUT_MS or throws, and the caller shows a Retry. The service
     worker's own 3s timeout does not apply here — it never touches Supabase. */
  var REQUEST_TIMEOUT_MS = 8000;
  function timed(promise) {
    return new Promise(function (resolve, reject) {
      var h = setTimeout(function () { reject(new Error("The server took too long to answer")); }, REQUEST_TIMEOUT_MS);
      Promise.resolve(promise).then(function (v) { clearTimeout(h); resolve(v); },
                                    function (e) { clearTimeout(h); reject(e); });
    });
  }
  // Run a query builder; throw on error or timeout, return data otherwise.
  async function q(builder) {
    var r = await timed(builder);
    if (r.error) throw r.error;
    return r.data;
  }

  // ------------------------------------------------------------- auth
  /* Who is signed in, from the session stored ON THIS PHONE. This used to be
     auth.getUser(), which asks the server — with no signal it answered
     "nobody" and the app opened on the sign-in form, which also needs signal.
     getSession() reads local storage (and refreshes the token when it can;
     when it can't, supabase-js keeps the stored session rather than dropping
     it). The server is still the authority on every write: row-level security
     rejects a revoked account the moment it is back online. */
  async function user() {
    if (!sb()) return null;
    var r = await sb().auth.getSession();
    return r.data && r.data.session && r.data.session.user ? r.data.session.user : null;
  }
  async function signIn(email, password) {
    var r = await sb().auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw r.error;
    return r.data.user;
  }
  async function signUp(email, password) {
    var r = await sb().auth.signUp({ email: email, password: password });
    if (r.error) throw r.error;
    return r.data;
  }
  /* Leaves nothing of this account on the phone: plan, last weights, the
     upload queue and a half-done session (the runner's own key). The queue
     used to survive — on a shared phone the next account then saw the previous
     one's session card, and the previous account's unsent sets were rejected
     by row-level security under the new token. app.js warns about unsent sets
     BEFORE calling this; by here the decision is made. Device preferences
     (theme, "not now" on the install card) are not the account's and stay. */
  async function signOut() {
    try {
      [PLAN_KEY, LAST_KEY, Q_KEY, SESSION_KEY].forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    notify();
    if (sb()) { try { await timed(sb().auth.signOut()); } catch (e) { /* offline: the local session is gone regardless */ } }
  }

  // ------------------------------------------------------------- password reset
  // The link in the email comes back to this app's own address. That address
  // must be in the Supabase project's Redirect URLs list, or Supabase sends the
  // user to the project's default Site URL (Maky's) instead.
  function appUrl() { return new URL("./", location.href).href; }

  async function sendReset(email) {
    var r = await sb().auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (r.error) throw r.error;
  }
  async function setPassword(password) {
    var r = await sb().auth.updateUser({ password: password });
    if (r.error) throw r.error;
    return r.data.user;
  }
  /* Resolves once the client has finished reading any session out of the URL
     (the reset link), so the app does not route before it knows. */
  async function ready() {
    if (!sb()) return null;
    var r = await sb().auth.getSession();
    return r.data && r.data.session ? r.data.session : null;
  }
  function onAuth(fn) { if (sb()) sb().auth.onAuthStateChange(function (event, session) { fn(event, session); }); }

  // ------------------------------------------------------------- queue
  function readQ() { try { return JSON.parse(localStorage.getItem(Q_KEY) || "[]"); } catch (e) { return []; } }
  function writeQ(q) { localStorage.setItem(Q_KEY, JSON.stringify(q)); notify(); }
  function notify() { listeners.forEach(function (fn) { fn(readQ().length); }); }

  /* Every queued op carries its own id. The flush removes an op by that id
     AFTER its upload lands, re-reading the queue at that moment — never by
     writing back a copy it took earlier. A copy taken before a slow upload
     did not contain anything logged during it, so writing it back threw those
     sets away, silently, with the sync badge reading zero. */
  function enqueue(op) { op.qid = uuid(); var q = readQ(); q.push(op); writeQ(q); flush(); }
  function dropFromQ(qid) { writeQ(readQ().filter(function (x) { return x.qid !== qid; })); }

  /* flush() returns the upload already in progress if there is one, so a
     caller can `await Store.flush()` and know its row has landed — the home
     screen used to reload before a "Mark as done" save arrived and showed the
     day as not done. */
  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = doFlush().finally(function () { flushing = null; });
    return flushing;
  }
  /* The server refused the row for what it IS (bad data, a policy, a missing
     parent): sending it again can only fail again, so it must not block the
     rows behind it. Postgres/PostgREST errors carry a code; a dead network does
     not — those are retried for as long as it takes. */
  function isPermanent(res) {
    var e = res.error || {};
    if (res.status >= 500) return false;
    return !!e.code;
  }
  function keepDropped(op, err) {
    console.error("server refused this row; kept in " + DROPPED_KEY, op, err);
    try {
      var d = JSON.parse(localStorage.getItem(DROPPED_KEY) || "[]");
      d.push({ op: op, error: err && err.message, at: new Date().toISOString() });
      localStorage.setItem(DROPPED_KEY, JSON.stringify(d.slice(-50)));
    } catch (e) {}
  }
  async function doFlush() {
    if (!navigator.onLine || !sb()) return;
    var u = await user();
    if (!u) return;
    var q;
    while ((q = readQ()).length) {
      var op = q[0];
      if (!op.qid) { op.qid = uuid(); writeQ(q); }        // queued before ids existed
      var res;
      try {
        if (op.op === "delete") {
          // Deleting a workout removes its sets too (on delete cascade).
          res = await timed(sb().from(T_WORKOUTS).delete().eq("id", op.id));
        } else if (op.table === "workouts") res = await timed(sb().from(T_WORKOUTS).upsert(op.row, { onConflict: "id" }));
        else res = await timed(sb().from(T_SETS).upsert(op.row, { onConflict: "id" }));
      } catch (e) { break; }                              // timeout: retry later
      if (res.error) {
        if (isPermanent(res)) { keepDropped(op, res.error); dropFromQ(op.qid); continue; }
        break;                                            // network: retry later
      }
      dropFromQ(op.qid);
    }
  }
  window.addEventListener("online", flush);
  // A failed upload is retried when the app comes back to the front and, while
  // anything is waiting, every half minute — a bar of signal comes and goes.
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") flush(); });
  setInterval(function () { if (readQ().length) flush(); }, 30000);

  // ------------------------------------------------------------- logging
  function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }

  function lastWeights() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || "{}"); } catch (e) { return {}; } }
  /* Local copy of "last time", per exercise AND per round, for offline use.
     Only moves forward in time, so editing an old workout's weights never
     overwrites what you lifted more recently. */
  function rememberWeight(exerciseId, round, weight, reps, when) {
    if (weight == null && reps == null) return;
    var at = when ? new Date(when).getTime() : Date.now();
    var m = lastWeights(), cur = m[exerciseId];
    if (cur && cur.at > at + 12 * 3600 * 1000) return;              // an older workout: leave newer data alone
    if (!cur || Math.abs(cur.at - at) > 12 * 3600 * 1000) cur = { byRound: {} };   // a different session: start fresh
    cur.byRound = cur.byRound || {};
    cur.byRound[round] = { weight: weight, reps: reps };
    cur.weight = weight; cur.reps = reps; cur.at = Math.max(cur.at || 0, at);
    m[exerciseId] = cur;
    localStorage.setItem(LAST_KEY, JSON.stringify(m));
  }

  /* "Last time" for each exercise in a session, to prefill the kg boxes.
     Round-aware: the last workout that had that exercise, round by round — in
     a 10-8-6 pyramid the weight rises each round, and prefilling round 1 with
     last session's round-3 weight was wrong. Online: one query. Offline or
     signed out: the local copy. */
  async function lastForExercises(exerciseIds, userId) {
    var local = lastWeights();
    var out = {};
    exerciseIds.forEach(function (id) { if (local[id]) out[id] = local[id]; });
    if (!navigator.onLine || !sb() || !userId) return out;
    try {
      var rows = await q(sb().from(T_SETS)
        .select("exercise_id, workout_id, round, weight, reps, done_at")
        .eq("user_id", userId).in("exercise_id", exerciseIds).eq("skipped", false)
        .order("done_at", { ascending: false }).limit(600));
      {
        var fromServer = {};
        rows.forEach(function (row) {
          var e = fromServer[row.exercise_id];
          if (!e) e = fromServer[row.exercise_id] = { workout: row.workout_id, at: new Date(row.done_at).getTime(), byRound: {} };
          if (row.workout_id !== e.workout) return;                   // only the most recent workout
          if (!e.byRound[row.round]) e.byRound[row.round] = { weight: row.weight, reps: row.reps };
          if (e.weight == null && row.weight != null) { e.weight = row.weight; e.reps = row.reps; }
        });
        Object.keys(fromServer).forEach(function (id) {
          if (!out[id] || fromServer[id].at >= (out[id].at || 0)) out[id] = fromServer[id];
        });
      }
    } catch (e) { /* offline, or too slow: the local copy is enough to start */ }
    return out;
  }

  /* The training plan: when you start and how long each block runs. One per
     person, so Javier and Nacho each have their own. Cached locally, because
     the app has to know which week it is with no signal. */
  async function plan(userId) {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(PLAN_KEY) || "null"); } catch (e) {}
    if (cached && cached.user_id !== userId) cached = null;      // a different account on this phone
    if (!navigator.onLine || !sb() || !userId) return cached;
    var row;
    try { row = await q(sb().from(T_PLANS).select("*").eq("user_id", userId).maybeSingle()); }
    catch (e) {
      /* With a cached plan, a failed fetch is just offline. Without one it
         must NOT look like "no plan yet": the router would then open "Set up
         your plan" over a plan that exists, and saving there overwrites it. */
      if (cached) return cached;
      throw e;
    }
    if (row) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(row)); } catch (e) {} }
    return row || cached;
  }
  async function savePlan(row) {
    row.updated_at = new Date().toISOString();
    var saved = await q(sb().from(T_PLANS).upsert(row, { onConflict: "user_id" }).select().maybeSingle());
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(saved || row)); } catch (e) {}
    return saved || row;
  }

  function saveWorkout(row) { enqueue({ table: "workouts", row: row }); }

  /* Delete a workout and its sets. Anything for it still waiting in the queue
     is dropped first — if it never reached the server there is nothing to
     delete there, and uploading it just to delete it would be pointless. */
  function deleteWorkout(id) {
    var q = readQ().filter(function (op) {
      return !(op.table === "workouts" && op.row && op.row.id === id) && !(op.table === "sets" && op.row && op.row.workout_id === id);
    });
    q.push({ table: "workouts", op: "delete", id: id, qid: uuid() });
    writeQ(q);
    return flush();
  }
  function saveSet(row) { rememberWeight(row.exercise_id, row.round, row.weight, row.reps, row.done_at); enqueue({ table: "sets", row: row }); }

  /* The reads below THROW when the server cannot be reached or refuses (they
     used to return an empty list, which painted "Nothing logged yet" over a
     real history). The screens catch and offer Retry. */
  async function history(userId, limit) {
    if (!sb() || !userId) return [];
    // Embedded count of each workout's sets, so History can spot the empty
    // unfinished ones (a session opened and left without logging anything).
    var rows = await q(sb().from(T_WORKOUTS).select("*, freeco_sets(count)").eq("user_id", userId)
      .order("started_at", { ascending: false }).limit(limit || 60));
    return rows.map(function (w) {
      w.set_count = (w.freeco_sets && w.freeco_sets[0] && w.freeco_sets[0].count) || 0;
      delete w.freeco_sets;
      return w;
    });
  }
  async function setsFor(workoutId) {
    if (!sb()) return [];
    return q(sb().from(T_SETS).select("*").eq("workout_id", workoutId).order("done_at"));
  }
  /* The most recent finished workout per session for a week, plus how many
     times that session was done — doing a third session in a week means doing
     one of the two twice (Javier, 12 Sep 2026), and the week screen has to be
     able to say so. Includes the id so a done card can open that workout. */
  async function doneThisWeek(userId, weekStart) {
    if (!sb() || !userId) return {};
    var rows = await q(sb().from(T_WORKOUTS).select("*")
      .eq("user_id", userId).eq("week_start", weekStart).not("finished_at", "is", null)
      .order("finished_at", { ascending: false }));
    var m = {};
    rows.forEach(function (w) {
      if (!m[w.session_key]) { m[w.session_key] = w; w.times = 1; w.runs = [w]; }
      else { m[w.session_key].times++; m[w.session_key].runs.push(w); }
    });
    return m;                          // newest first, so runs[0] is the latest
  }
  async function workout(id) {
    if (!sb()) return null;
    return q(sb().from(T_WORKOUTS).select("*").eq("id", id).maybeSingle());
  }

  return {
    configured: configured, user: user, signIn: signIn, signUp: signUp, signOut: signOut,
    sendReset: sendReset, setPassword: setPassword, ready: ready, onAuth: onAuth,
    plan: plan, savePlan: savePlan,
    uuid: uuid, saveWorkout: saveWorkout, saveSet: saveSet, lastForExercises: lastForExercises,
    history: history, setsFor: setsFor, doneThisWeek: doneThisWeek, workout: workout, deleteWorkout: deleteWorkout,
    flush: flush, pending: function () { return readQ().length; },
    onQueue: function (fn) { listeners.push(fn); },
  };
})();
