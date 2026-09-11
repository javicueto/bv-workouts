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
  var cfg = window.JAVIPLAN_CONFIG || {};
  var client = null;
  var Q_KEY = "javiplan.queue";
  var LAST_KEY = "javiplan.lastWeights";
  // Tables live in the Maky project, prefixed so they never collide with it.
  var T_WORKOUTS = "javiplan_workouts";
  var T_SETS = "javiplan_sets";
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

  // ------------------------------------------------------------- auth
  async function user() {
    if (!sb()) return null;
    var r = await sb().auth.getUser();
    return r.data && r.data.user ? r.data.user : null;
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
  async function signOut() { if (sb()) await sb().auth.signOut(); }

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

  function enqueue(op) { var q = readQ(); q.push(op); writeQ(q); flush(); }

  var flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine || !sb()) return;
    var u = await user();
    if (!u) return;
    flushing = true;
    try {
      var q = readQ();
      while (q.length) {
        var op = q[0];
        var res;
        if (op.table === "workouts") res = await sb().from(T_WORKOUTS).upsert(op.row, { onConflict: "id" });
        else res = await sb().from(T_SETS).upsert(op.row, { onConflict: "id" });
        if (res.error) {
          // A rejected row (bad data, RLS) would block the queue forever: drop it
          // and say so rather than wedge every later write behind it.
          if (res.error.code && res.error.code.indexOf("PGRST") === 0 || res.error.code === "42501" || res.error.code === "23503") {
            console.error("dropping unsyncable row", op, res.error);
            q.shift(); writeQ(q); continue;
          }
          break;                                  // network-ish: retry later
        }
        q.shift(); writeQ(q);
      }
    } finally { flushing = false; }
  }
  window.addEventListener("online", flush);

  // ------------------------------------------------------------- logging
  function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }

  function lastWeights() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || "{}"); } catch (e) { return {}; } }
  function rememberWeight(exerciseId, weight, reps) {
    if (weight == null && reps == null) return;
    var m = lastWeights(); m[exerciseId] = { weight: weight, reps: reps, at: Date.now() };
    localStorage.setItem(LAST_KEY, JSON.stringify(m));
  }

  /* Pull the most recent set for each exercise in a session, to prefill the
     weight inputs. Online: one query. Offline or signed out: the local map. */
  async function lastForExercises(exerciseIds, userId) {
    var local = lastWeights();
    var out = {};
    exerciseIds.forEach(function (id) { if (local[id]) out[id] = local[id]; });
    if (!navigator.onLine || !sb() || !userId) return out;
    try {
      var r = await sb().from(T_SETS)
        .select("exercise_id, weight, reps, done_at")
        .eq("user_id", userId).in("exercise_id", exerciseIds).eq("skipped", false)
        .order("done_at", { ascending: false }).limit(400);
      if (!r.error) {
        r.data.forEach(function (row) {
          if (!out[row.exercise_id] || new Date(row.done_at).getTime() > (out[row.exercise_id].at || 0)) {
            out[row.exercise_id] = { weight: row.weight, reps: row.reps, at: new Date(row.done_at).getTime() };
          }
        });
      }
    } catch (e) { /* offline mid-request: local map is enough */ }
    return out;
  }

  function saveWorkout(row) { enqueue({ table: "workouts", row: row }); }
  function saveSet(row) { rememberWeight(row.exercise_id, row.weight, row.reps); enqueue({ table: "sets", row: row }); }

  async function history(userId, limit) {
    if (!sb() || !userId) return [];
    var r = await sb().from(T_WORKOUTS).select("*").eq("user_id", userId)
      .order("started_at", { ascending: false }).limit(limit || 60);
    return r.error ? [] : r.data;
  }
  async function setsFor(workoutId) {
    if (!sb()) return [];
    var r = await sb().from(T_SETS).select("*").eq("workout_id", workoutId).order("done_at");
    return r.error ? [] : r.data;
  }
  async function doneThisWeek(userId, weekStart) {
    if (!sb() || !userId) return {};
    var r = await sb().from(T_WORKOUTS).select("session_key, finished_at")
      .eq("user_id", userId).eq("week_start", weekStart).not("finished_at", "is", null);
    var m = {}; (r.data || []).forEach(function (w) { m[w.session_key] = w.finished_at; });
    return m;
  }

  return {
    configured: configured, user: user, signIn: signIn, signUp: signUp, signOut: signOut,
    sendReset: sendReset, setPassword: setPassword, ready: ready, onAuth: onAuth,
    uuid: uuid, saveWorkout: saveWorkout, saveSet: saveSet, lastForExercises: lastForExercises,
    history: history, setsFor: setsFor, doneThisWeek: doneThisWeek,
    flush: flush, pending: function () { return readQ().length; },
    onQueue: function (fn) { listeners.push(fn); },
  };
})();
