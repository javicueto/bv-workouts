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
  var T_MEMBERS = "freeco_members";      // who may use Cokiletics at all (db/006)
  var PLAN_KEY = "freeco.plan";
  var SESSION_KEY = "freeco.session";    // owned by runner.js; cleared here on sign-out
  var DROPPED_KEY = "freeco.dropped";    // rows the server refused, kept for inspection
  var MEMBER_KEY = "freeco.member";      // id of the account last confirmed as a member
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
      [PLAN_KEY, LAST_KEY, Q_KEY, SESSION_KEY, MEMBER_KEY, COPY_DONE, COPY_HISTORY, COPY_WORKOUTS, COPY_SOCIAL, "freeco.socialSeen"]
        .forEach(function (k) { localStorage.removeItem(k); });
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
  /* Each entry remembers the workout it came from and what it replaced
     (`before`, one level), so deleting or discarding that workout can put the
     previous "last time" back (forgetWorkout). Javier, 13 Sep 2026: weights
     from a discarded workout must be gone — including this local copy, which
     otherwise prefilled the next session with them, even online. */
  function rememberWeight(exerciseId, round, weight, reps, when, workoutId) {
    if (weight == null && reps == null) return;
    var at = when ? new Date(when).getTime() : Date.now();
    var m = lastWeights(), cur = m[exerciseId];
    /* A different session is a different WORKOUT. It used to be "more than
       12 hours apart", which filed a workout started, discarded and started
       again the same morning under the first one — so discarding the second
       deleted nothing and its weights kept coming back (Javier, 14 Sep 2026).
       The 12-hour guess only stays for entries written before workout ids. */
    var other = !!cur && (workoutId && cur.workout ? cur.workout !== workoutId
                                                   : Math.abs(cur.at - at) > 12 * 3600 * 1000);
    if (other && cur.at > at) return;                              // an older workout: leave newer data alone
    if (!cur || other) {                                           // a different session: start fresh
      var before = cur ? Object.assign({}, cur) : null;
      if (before) delete before.before;                             // one level is enough
      cur = { byRound: {}, workout: workoutId || null, before: before };
    }
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
        /* Once the server has answered, IT is "last time". The local copy only
           speaks for a workout still waiting to upload (its rows are in the
           queue, so the server can't know them yet). It used to win whenever
           it was newer — so weights from a discarded workout that the local
           copy couldn't trace (written before workout ids) prefilled every
           new session for good (Javier, 14 Sep 2026). The local copy is
           rewritten to match, which also clears anything already stuck. */
        var waiting = {};
        readQ().forEach(function (op) {
          if (op.row) waiting[op.table === "sets" ? op.row.workout_id : op.row.id] = true;
        });
        var healed = false;
        exerciseIds.forEach(function (id) {
          var loc = local[id], srv = fromServer[id];
          var keepLocal = !!loc && !!loc.workout && waiting[loc.workout] && (!srv || loc.at > srv.at);
          if (keepLocal) { out[id] = loc; return; }
          if (srv) out[id] = srv; else delete out[id];
          if (loc) { if (srv) local[id] = srv; else delete local[id]; healed = true; }
        });
        if (healed) { try { localStorage.setItem(LAST_KEY, JSON.stringify(local)); } catch (e) {} }
      }
    } catch (e) { /* offline, or too slow: the local copy is enough to start */ }
    return out;
  }

  /* Cokiletics is members-only (db/006): an account that is not listed in
     freeco_members can still sign in — the auth is Maky's, and shared — but
     every read comes back empty and every write is refused. This tells the
     app which case it is in, so a non-member is told so in plain words
     instead of meeting "Set up your plan" and then a refused save.

     true / false, or null when it cannot be known (offline, server slow). A
     member is NEVER shut out on a null: the phone remembers the last account
     it confirmed, and the database refuses anyone who is not listed anyway. */
  async function isMember(userId) {
    var known = null;
    try { known = localStorage.getItem(MEMBER_KEY); } catch (e) {}
    var fallback = known === userId ? true : null;
    if (!navigator.onLine || !sb() || !userId) return fallback;
    try {
      var row = await q(sb().from(T_MEMBERS).select("user_id").eq("user_id", userId).maybeSingle());
      try { if (row) localStorage.setItem(MEMBER_KEY, userId); else localStorage.removeItem(MEMBER_KEY); } catch (e) {}
      return !!row;
    } catch (e) { return fallback; }
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
  /* The shape the calendar is built from. Checked here AND by the table's
     own constraint (db/005): a plan with a malformed `blocks` would make
     buildWeeks produce nothing and the app open on an empty week forever. */
  function validPlan(row) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.start_date || "")) return "The start date is missing.";
    if (!Array.isArray(row.blocks) || !row.blocks.length) return "The plan has no blocks.";
    for (var i = 0; i < row.blocks.length; i++) {
      var b = row.blocks[i];
      if (!b || !Number.isInteger(b.block) || b.block < 1) return "Block " + (i + 1) + " has no number.";
      if (!Number.isInteger(b.weeks) || b.weeks < 1 || b.weeks > 12) return "Block " + b.block + " needs 1–12 weeks.";
    }
    return null;
  }
  async function savePlan(row) {
    var bad = validPlan(row);
    if (bad) throw new Error(bad);
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
    forgetWorkout(id);
    dropFromCopies(id);                 // or it would come back from a saved copy offline
    return flush();
  }
  /* The local "last time" copy forgets a deleted workout: each exercise it
     wrote goes back to what it held before, or is removed. Online the server
     already has no trace (sets cascade); this makes offline match. */
  function forgetWorkout(id) {
    var m = lastWeights(), changed = false;
    Object.keys(m).forEach(function (ex) {
      if (!m[ex] || m[ex].workout !== id) return;
      if (m[ex].before) m[ex] = m[ex].before; else delete m[ex];
      changed = true;
    });
    if (changed) { try { localStorage.setItem(LAST_KEY, JSON.stringify(m)); } catch (e) {} }
  }
  function saveSet(row) { rememberWeight(row.exercise_id, row.round, row.weight, row.reps, row.done_at, row.workout_id); enqueue({ table: "sets", row: row }); }

  // ------------------------------------------------------------- saved copies
  /* Offline by default (Javier, 16 Sep 2026). Each read below that reaches the
     server keeps what it said on this phone; when the server can't be reached
     the copy answers instead, marked with when it was saved — Store.savedAt(
     result) — so the screen can say "Offline · as of 18:40". Whatever is still
     waiting in the upload queue is laid over the answer either way, so a
     session finished with no signal counts as done at once and a deleted one
     is gone at once. Account data: cleared on sign-out. */
  var COPY_DONE = "freeco.copy.done";          // finished workouts by week (Home)
  var COPY_HISTORY = "freeco.copy.history";    // the History list
  var COPY_WORKOUTS = "freeco.copy.workouts";  // the sets of recent and opened workouts
  var COPY_WORKOUTS_MAX = 40;
  function readCopy(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function writeCopy(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function stamp(result, at) {
    if (at && result && typeof result === "object") Object.defineProperty(result, "savedAt", { value: at, enumerable: false });
    return result;
  }
  function savedAt(result) { return (result && result.savedAt) || null; }
  // With no network at all, fail at once instead of waiting out REQUEST_TIMEOUT_MS.
  function needNetwork() { if (!navigator.onLine) throw new Error("You’re offline."); }

  /* The queue read as data: the latest version of each workout waiting to
     upload (a session is queued when it starts and again when it finishes —
     the later wins), the ids waiting to be deleted, and the waiting sets. */
  function queued(userId) {
    var workouts = {}, deleted = {}, sets = [];
    readQ().forEach(function (op) {
      if (op.op === "delete") { deleted[op.id] = true; delete workouts[op.id]; return; }
      if (!op.row) return;
      if (op.table === "workouts") {
        if (userId && op.row.user_id && op.row.user_id !== userId) return;
        workouts[op.row.id] = Object.assign({}, workouts[op.row.id] || {}, op.row);
      } else if (op.table === "sets") sets.push(op.row);
    });
    return { workouts: workouts, deleted: deleted, sets: sets };
  }
  function withQueued(rows, qd) {
    var byId = {}, order = [];
    rows.forEach(function (w) { if (!qd.deleted[w.id]) { byId[w.id] = w; order.push(w.id); } });
    Object.keys(qd.workouts).forEach(function (id) {
      if (byId[id]) byId[id] = Object.assign({}, byId[id], qd.workouts[id]);
      else { byId[id] = qd.workouts[id]; order.push(id); }
    });
    return order.map(function (id) { return byId[id]; });
  }
  function dropFromCopies(id) {
    [COPY_DONE, COPY_HISTORY].forEach(function (key) {
      var c = readCopy(key);
      if (c && c.rows) { c.rows = c.rows.filter(function (w) { return w.id !== id; }); writeCopy(key, c); }
    });
    var ws = readCopy(COPY_WORKOUTS);
    if (ws && ws.items && ws.items[id]) {
      delete ws.items[id]; ws.order = ws.order.filter(function (x) { return x !== id; }); writeCopy(COPY_WORKOUTS, ws);
    }
  }
  // Newest first; the oldest past COPY_WORKOUTS_MAX are dropped.
  function keepSets(byWorkout, at) {
    var c = readCopy(COPY_WORKOUTS);
    if (!c || !c.items) c = { items: {}, order: [] };
    Object.keys(byWorkout).reverse().forEach(function (id) {
      c.items[id] = { at: at, sets: byWorkout[id] };
      c.order = [id].concat(c.order.filter(function (x) { return x !== id; }));
    });
    c.order.slice(COPY_WORKOUTS_MAX).forEach(function (id) { delete c.items[id]; });
    c.order = c.order.slice(0, COPY_WORKOUTS_MAX);
    writeCopy(COPY_WORKOUTS, c);
  }
  function newest(field) {
    return function (a, b) { return (a[field] || "") < (b[field] || "") ? 1 : (a[field] || "") > (b[field] || "") ? -1 : 0; };
  }

  /* The reads below THROW when the server cannot be reached and there is no
     saved copy (they used to return an empty list, which painted "Nothing
     logged yet" over a real history). The screens catch and offer Retry. */
  async function history(userId, limit) {
    if (!sb() || !userId) return [];
    var rows, at = null;
    try {
      needNetwork();
      // Embedded count of each workout's sets, so History can spot the empty
      // unfinished ones (a session opened and left without logging anything).
      rows = (await q(sb().from(T_WORKOUTS).select("*, freeco_sets(count)").eq("user_id", userId)
        .order("started_at", { ascending: false }).limit(limit || 60))).map(function (w) {
          w.set_count = (w.freeco_sets && w.freeco_sets[0] && w.freeco_sets[0].count) || 0;
          delete w.freeco_sets;
          return w;
        });
      writeCopy(COPY_HISTORY, { user: userId, at: new Date().toISOString(), rows: rows });
    } catch (e) {
      var c = readCopy(COPY_HISTORY);
      if (!c || c.user !== userId) throw e;
      rows = c.rows; at = c.at;
    }
    var qd = queued(userId);
    rows = withQueued(rows, qd).map(function (w) {
      var waiting = qd.sets.filter(function (x) { return x.workout_id === w.id; }).length;
      return waiting ? Object.assign({}, w, { set_count: (w.set_count || 0) + waiting }) : w;
    }).sort(newest("started_at")).slice(0, limit || 60);
    return stamp(rows, at);
  }
  async function setsFor(workoutId) {
    if (!sb()) return [];
    var sets, at = null, qd = queued();
    var waiting = qd.sets.filter(function (x) { return x.workout_id === workoutId; });
    try {
      needNetwork();
      sets = await q(sb().from(T_SETS).select("*").eq("workout_id", workoutId).order("done_at"));
      var one = {}; one[workoutId] = sets;
      keepSets(one, new Date().toISOString());
    } catch (e) {
      var c = readCopy(COPY_WORKOUTS), item = c && c.items && c.items[workoutId];
      if (!item && !waiting.length) throw e;
      sets = item ? item.sets : []; at = item ? item.at : null;
    }
    var byId = {}, order = [];
    sets.concat(waiting).forEach(function (x) {
      if (!byId[x.id]) order.push(x.id);
      byId[x.id] = Object.assign({}, byId[x.id] || {}, x);
    });
    var out = order.map(function (id) { return byId[id]; })
      .sort(function (a, b) { return (a.done_at || "") < (b.done_at || "") ? -1 : (a.done_at || "") > (b.done_at || "") ? 1 : 0; });
    return stamp(out, at);
  }
  /* Finished workouts from `fromWeekStart` onwards, grouped
     week → session key → the most recent workout for it, carrying how many
     times that session was done and every run (a third session in a week
     means doing one of the two twice — Javier, 12 Sep 2026 — and the week
     screen has to be able to say so). Includes the id so a done card can
     open that workout.

     ONE query covers the week Home is showing AND the weeks behind it, so
     asking "what is still open from earlier weeks" costs no extra request. */
  async function doneByWeek(userId, fromWeekStart) {
    if (!sb() || !userId) return {};
    var rows, at = null;
    try {
      needNetwork();
      rows = await q(sb().from(T_WORKOUTS).select("*")
        .eq("user_id", userId).gte("week_start", fromWeekStart).not("finished_at", "is", null)
        .order("finished_at", { ascending: false }));
      // The copy only grows backwards: weeks before this read keep what a
      // wider read saved earlier, so swiping back offline still has them.
      var old = readCopy(COPY_DONE), mine = !!(old && old.user === userId);
      writeCopy(COPY_DONE, { user: userId, at: new Date().toISOString(),
        from: mine && old.from < fromWeekStart ? old.from : fromWeekStart,
        rows: (mine ? old.rows.filter(function (w) { return w.week_start < fromWeekStart; }) : []).concat(rows) });
    } catch (e) {
      var c = readCopy(COPY_DONE);
      if (!c || c.user !== userId || c.from > fromWeekStart) throw e;     // no copy that covers these weeks
      rows = c.rows; at = c.at;
    }
    rows = withQueued(rows, queued(userId))
      .filter(function (w) { return w.finished_at && w.week_start && w.week_start >= fromWeekStart; })
      .sort(newest("finished_at"));
    var out = {};
    rows.forEach(function (w) {
      var m = out[w.week_start] || (out[w.week_start] = {});
      if (!m[w.session_key]) { m[w.session_key] = w; w.times = 1; w.runs = [w]; }
      else { m[w.session_key].times++; m[w.session_key].runs.push(w); }
    });
    return stamp(out, at);             // newest first, so runs[0] is the latest
  }
  async function workout(id) {
    if (!sb()) return null;
    var qd = queued(), row = null, at = null;
    if (qd.deleted[id]) return null;
    try {
      needNetwork();
      row = await q(sb().from(T_WORKOUTS).select("*").eq("id", id).maybeSingle());
    } catch (e) {
      // Offline: the row as History or Home last saw it.
      [readCopy(COPY_HISTORY), readCopy(COPY_DONE)].some(function (c) {
        var hit = c && c.rows && c.rows.filter(function (w) { return w.id === id; })[0];
        if (hit) { row = hit; at = c.at; }
        return !!hit;
      });
      if (!row && !qd.workouts[id]) throw e;
    }
    if (qd.workouts[id]) row = Object.assign({}, row || {}, qd.workouts[id]);
    return row ? stamp(row, at) : null;
  }
  /* In the background once the app is open (offline.js): History, and with it
     the sets of the latest finished workouts in ONE query, so those open with
     no signal even if they were never opened on this phone. Home keeps its
     own copy of done weeks on every visit. */
  async function warmOffline(userId) {
    if (!sb() || !userId || !navigator.onLine) return;
    var rows = await history(userId, 120);
    var ids = rows.filter(function (w) { return w.finished_at; }).slice(0, COPY_WORKOUTS_MAX).map(function (w) { return w.id; });
    if (!ids.length) return;
    var sets = await q(sb().from(T_SETS).select("*").in("workout_id", ids).order("done_at"));
    var by = {};
    ids.forEach(function (id) { by[id] = []; });
    sets.forEach(function (x) { if (by[x.workout_id]) by[x.workout_id].push(x); });
    keepSets(by, new Date().toISOString());
  }

  // ------------------------------------------------------------- social (db/008)
  /* Every member sees every member (db/008). ONE read for the Social screen:
     everyone's finished workouts (all of them: the points count every one),
     everyone's heaviest weight per movement per workout (freeco_set_best, for
     personal bests), the full sets of the latest SOCIAL_RECENT workouts (the
     weights on their cards), names, reactions and comments. Kept as a saved
     copy like the other reads, so Social opens offline, dated. Reacting,
     commenting and setting a name need the network — they are small and
     social, and pointless to queue for later. */
  var T_PROFILES = "freeco_profiles", T_REACTIONS = "freeco_reactions", T_COMMENTS = "freeco_comments";
  var V_BEST = "freeco_set_best";
  var COPY_SOCIAL = "freeco.copy.social";
  var SOCIAL_RECENT = 30, PAGE = 1000;
  // Every row, a page at a time: the server answers at most 1000 per request.
  async function allRows(build) {
    var out = [];
    for (var from = 0; ; from += PAGE) {
      var rows = await q(build().range(from, from + PAGE - 1));
      out = out.concat(rows || []);
      if (!rows || rows.length < PAGE) return out;
    }
  }
  async function social(userId) {
    if (!sb() || !userId) return null;
    var d, at = null;
    try {
      needNetwork();
      var workouts = await allRows(function () {
        return sb().from(T_WORKOUTS).select("id, user_id, session_key, block, week_start, started_at, finished_at, duration_seconds, logged_manually")
          .not("finished_at", "is", null).order("finished_at", { ascending: false });
      });
      var recent = workouts.slice(0, SOCIAL_RECENT).map(function (w) { return w.id; });
      var got = await Promise.all([
        allRows(function () { return sb().from(V_BEST).select("workout_id, user_id, exercise_id, weight").order("workout_id"); }),
        recent.length ? allRows(function () {
          return sb().from(T_SETS).select("workout_id, user_id, exercise_id, exercise_name, block_letter, round, weight")
            .in("workout_id", recent).order("done_at");
        }) : [],
        allRows(function () { return sb().from(T_PROFILES).select("user_id, display_name").order("user_id"); }),
        allRows(function () { return sb().from(T_REACTIONS).select("id, item_key, item_owner, user_id, emoji, created_at").order("created_at"); }),
        allRows(function () { return sb().from(T_COMMENTS).select("id, item_key, item_owner, user_id, body, created_at").order("created_at"); }),
      ]);
      d = { workouts: workouts, bests: got[0], sets: got[1], profiles: got[2], reactions: got[3], comments: got[4] };
      writeCopy(COPY_SOCIAL, { user: userId, at: new Date().toISOString(), d: d });
    } catch (e) {
      var c = readCopy(COPY_SOCIAL);
      if (!c || c.user !== userId) throw e;
      d = c.d; at = c.at;
    }
    return stamp(d, at);
  }
  // A reaction on (on = true) or off. A double tap can't make two: the
  // (item, person, emoji) pair is unique, and a repeat is ignored.
  async function react(itemKey, owner, emoji, on) {
    needNetwork();
    if (on) {
      return q(sb().from(T_REACTIONS).upsert({ item_key: itemKey, item_owner: owner, emoji: emoji },
        { onConflict: "item_key,user_id,emoji", ignoreDuplicates: true }));
    }
    var u = await user();
    return q(sb().from(T_REACTIONS).delete().eq("item_key", itemKey).eq("emoji", emoji).eq("user_id", u.id));
  }
  async function comment(itemKey, owner, body) {
    needNetwork();
    return q(sb().from(T_COMMENTS).insert({ item_key: itemKey, item_owner: owner, body: body }).select().single());
  }
  async function deleteComment(id) {
    needNetwork();
    return q(sb().from(T_COMMENTS).delete().eq("id", id));
  }
  async function setName(name) {
    needNetwork();
    var u = await user();
    return q(sb().from(T_PROFILES).upsert({ user_id: u.id, display_name: name, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }).select().single());
  }
  /* The newest thing a friend did — a finished workout, a reaction or a
     comment — for the dot on Home's Social button. Online only. */
  async function socialLatest(userId) {
    if (!sb() || !userId || !navigator.onLine) return null;
    var r = await Promise.all([
      q(sb().from(T_WORKOUTS).select("finished_at").neq("user_id", userId).not("finished_at", "is", null)
        .order("finished_at", { ascending: false }).limit(1)),
      q(sb().from(T_REACTIONS).select("created_at").neq("user_id", userId).order("created_at", { ascending: false }).limit(1)),
      q(sb().from(T_COMMENTS).select("created_at").neq("user_id", userId).order("created_at", { ascending: false }).limit(1)),
    ]);
    var times = [r[0][0] && r[0][0].finished_at, r[1][0] && r[1][0].created_at, r[2][0] && r[2][0].created_at]
      .filter(Boolean).map(function (t) { return new Date(t).toISOString(); }).sort();
    return times.length ? times[times.length - 1] : null;
  }

  return {
    configured: configured, user: user, signIn: signIn, signUp: signUp, signOut: signOut,
    sendReset: sendReset, setPassword: setPassword, ready: ready, onAuth: onAuth,
    plan: plan, savePlan: savePlan, isMember: isMember,
    uuid: uuid, saveWorkout: saveWorkout, saveSet: saveSet, lastForExercises: lastForExercises,
    history: history, setsFor: setsFor, doneByWeek: doneByWeek, workout: workout, deleteWorkout: deleteWorkout,
    warmOffline: warmOffline, savedAt: savedAt,
    social: social, react: react, comment: comment, deleteComment: deleteComment, setName: setName, socialLatest: socialLatest,
    flush: flush, pending: function () { return readQ().length; },
    onQueue: function (fn) { listeners.push(fn); },
  };
})();
