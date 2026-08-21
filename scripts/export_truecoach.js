/* ============================================================================
 * TrueCoach export — paste-and-run inside a LOGGED-IN app.truecoach.co tab.
 *
 * WHY THIS SHAPE
 * TrueCoach has no public API. The web app (Ember, "fitbot-client") talks to a
 * private API at /proxy/api/... using a bearer token held in memory by its own
 * `ajax` service. We borrow that service rather than copying the token out, so
 * no credential is ever written to disk. Nothing here is stored or sent
 * anywhere: the script builds a JSON blob and saves it via the browser.
 *
 * HOW TO RUN (refresh procedure)
 *   1. Open https://app.truecoach.co/client/workouts and make sure you're logged in.
 *   2. Paste this whole file into DevTools console (or have Claude run it in the tab).
 *   3. It downloads `truecoach_export.json` — move it to data/truecoach_export.json.
 *   4. Run ./scripts/download_videos.sh  (fetches only the new videos).
 *   5. Run ./scripts/build_site.py       (regenerates data/workouts.js).
 *
 * NOTE ON CLIENT ID: 3373893 is Javier's client record. It is read from the
 * logged-in user below rather than hardcoded, so this keeps working if it changes.
 * ==========================================================================*/
(async () => {
  const app = Ember.Namespace.NAMESPACES.find(n => n.name === 'fitbot-client');
  const container = app.__deprecatedInstance__.__container__;
  const ajax = container.lookup('service:ajax');

  // Resolve the logged-in client id instead of hardcoding it.
  const me = await ajax.request('/proxy/api/users/current').catch(() => null);
  const clientId = (me && (me.user?.client_id || me.client_id)) || 3373893;

  // per_page=300 comfortably covers the whole history in one call (139 as of Aug 2026).
  const big = await ajax.request(
    `/proxy/api/clients/${clientId}/workouts?order=asc&page=1&per_page=300`);
  if (big.meta && big.meta.total_pages > 1) {
    throw new Error('More than one page of workouts — raise per_page.');
  }
  const exList = await ajax.request('/proxy/api/exercises');
  const exById = Object.fromEntries(exList.exercises.map(e => [String(e.id), e]));

  const itemsByWorkout = {};
  big.workout_items.forEach(i => (itemsByWorkout[i.workout_id] ||= []).push(i));

  // Only the numbered programme ("Workout 8.2"). Prevention routine, Volley warm
  // up and anything else the coach assigns are deliberately excluded.
  const numbered = big.workouts
    .filter(w => /^Workout \d+\.\d+\s*$/.test(w.title || ''))
    .sort((a, b) => (a.due < b.due ? -1 : 1));

  // Some exercises live in the shared TrueCoach library, not the coach's own
  // list, so they are absent from /exercises and must be fetched one by one.
  const refIds = new Set();
  numbered.forEach(w => {
    (itemsByWorkout[w.id] || []).forEach(i =>
      (i.selected_exercises || []).forEach(e => refIds.add(String(e.id))));
    (w.warmup_selected_exercises || []).forEach(e => refIds.add(String(e.id)));
    (w.cooldown_selected_exercises || []).forEach(e => refIds.add(String(e.id)));
  });
  for (const id of [...refIds].filter(id => !exById[id])) {
    try { exById[id] = (await ajax.request('/proxy/api/exercises/' + id)).exercise; }
    catch (e) { console.warn('could not resolve exercise', id); }
  }

  /* Blocks with no linked exercise -------------------------------------------
   * The coach only links exercises on circuit blocks. For a single-movement
   * block ("BB Bench press", 3 sets of 8-6-6) nothing is linked and the block
   * NAME is the exercise. 24 of ~100 blocks are like this, so without the
   * lookup below a quarter of the programme would have no video at all.
   * Match the block name against the coach's library on a normalised name.
   * Exact matches only — no fuzzy matching, which would silently attach the
   * wrong video. Ambiguous names (same name, several library entries) take the
   * highest id, i.e. the coach's most recent upload, and are reported.
   * ------------------------------------------------------------------------*/
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const libByName = {};
  exList.exercises.forEach(e => { (libByName[norm(e.exercise_name)] ||= []).push(e); });

  const resolvedByName = [];
  const unresolved = [];
  const ambiguous = [];
  numbered.forEach(w => {
    (itemsByWorkout[w.id] || []).forEach(item => {
      if ((item.selected_exercises || []).length) return;
      const hits = libByName[norm(item.name)];
      if (!hits || !hits.length) { unresolved.push(item.name); return; }
      const pick = hits.slice().sort((a, b) => b.id - a.id)[0];
      if (hits.length > 1) ambiguous.push(item.name + ' → id ' + pick.id +
        ' (of ' + hits.map(h => h.id).join(', ') + ')');
      // Mark it so the site can show that this was matched, not linked.
      item.selected_exercises = [{ id: String(pick.id), name: pick.exercise_name }];
      item.matched_by_name = true;
      exById[String(pick.id)] = pick;
      resolvedByName.push(item.name);
    });
  });
  console.log('blocks with no linked exercise resolved by name:', resolvedByName.length);
  if (ambiguous.length) console.warn('ambiguous names (took newest):', ambiguous);
  if (unresolved.length) console.warn('could NOT resolve:', unresolved);

  const ytId = u => {
    if (!u) return null;
    const m = String(u).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_\-]{6,})/);
    return m ? m[1] : null;
  };
  const LETTERS = 'ABCDEFGHIJ';

  // Each numbered workout is assigned 6–8 times with identical content. Collapse
  // to one entry per number, keeping the LATEST version (the coach edited 4.1
  // mid-block, and the latest is the one that counts) plus the date range.
  const byKey = {};
  numbered.forEach(w => {
    const key = w.title.trim().replace(/^Workout\s+/, '');
    const items = (itemsByWorkout[w.id] || [])
      .slice().sort((a, b) => a.position - b.position)
      .map((i, ix) => ({
        letter: LETTERS[ix],
        name: (i.name || '').trim(),
        info: (i.info || '').trim(),
        is_circuit: !!i.is_circuit,
        matched_by_name: !!i.matched_by_name,
        exercises: (i.selected_exercises || []).map(e => String(e.id)),
      }));
    const g = (byKey[key] ||= { key, dates: [] });
    g.dates.push(w.due);
    g.latest = {
      warmup: (w.warmup || '').trim(),
      warmup_exercises: (w.warmup_selected_exercises || []).map(e => String(e.id)),
      cooldown: (w.cooldown || '').trim(),
      cooldown_exercises: (w.cooldown_selected_exercises || []).map(e => String(e.id)),
      items,
    };
  });

  const workouts = Object.values(byKey)
    .map(g => ({ ...g, block: +g.key.split('.')[0], variant: +g.key.split('.')[1] }))
    .sort((a, b) => a.block - b.block || a.variant - b.variant)
    .map(g => ({
      key: g.key, block: g.block, variant: g.variant, title: 'Workout ' + g.key,
      assigned_count: g.dates.length,
      first_date: g.dates[0], last_date: g.dates[g.dates.length - 1],
      ...g.latest,
    }));

  const usedIds = new Set();
  workouts.forEach(w => {
    w.warmup_exercises.forEach(i => usedIds.add(i));
    w.cooldown_exercises.forEach(i => usedIds.add(i));
    w.items.forEach(it => it.exercises.forEach(i => usedIds.add(i)));
  });
  const exercises = {};
  [...usedIds].forEach(id => {
    const e = exById[id];
    if (e) exercises[id] = {
      id: String(id), name: (e.exercise_name || '').trim(),
      url: e.url || null, youtube_id: ytId(e.url),
    };
  });

  const payload = {
    exported_at: new Date().toISOString(),
    source: `app.truecoach.co client ${clientId}`,
    workout_count: workouts.length,
    exercise_count: Object.keys(exercises).length,
    exercises, workouts,
  };

  const missing = Object.values(exercises).filter(e => !e.youtube_id);
  if (missing.length) console.warn('exercises without a video:', missing.map(e => e.name));

  const s = JSON.stringify(payload);
  const hash = [...new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  console.log(`export: ${workouts.length} workouts, ${Object.keys(exercises).length} exercises`);
  console.log('sha256 (compare with `shasum -a 256` on the saved file):', hash);

  const url = URL.createObjectURL(new Blob([s], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'truecoach_export.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return payload;
})();
