/* Cokiletics service worker: the app must open in a gym with no signal.
 *
 * - App shell + plan data: NETWORK-FIRST, falling back to the cache when the
 *   network fails or takes more than 3s. It used to be stale-while-revalidate,
 *   which served the old copy first — so every fix only reached the phone on
 *   the SECOND reload. Bump CACHE when the shell changes so old files go.
 * - Exercise previews (../previews/*.webp?v=…): kept in their OWN cache,
 *   PREVIEWS, which a CACHE bump never deletes — an app update must not throw
 *   35 MB away. offline.js fills it in the background and prunes old
 *   versions; a preview requested before then is saved on the way.
 * - Supabase data: never cached — always network. The app keeps its own
 *   offline queue for writes. The Supabase CLIENT LIBRARY is vendored in
 *   vendor/ and precached with the shell like any other file — no CDN, so
 *   the precache cannot half-fail on a third party at install time.
 */
const CACHE = "freeco-v85";
const PREVIEWS = "freeco-previews";     // not versioned with CACHE — see above; same name in offline.js
const SHELL = [
  "./", "./index.html", "./styles.css", "../shared/tokens.css", "./config.js",
  "./theme.js", "./icons.js", "./ui.js", "./store.js", "./timer.js", "./runner.js",
  "./core.js", "./points.js", "./views/auth.js", "./views/home.js", "./views/plan.js", "./views/session.js",
  "./views/history.js", "./views/social.js", "./offline.js", "./app.js",
  "./data/programme.js",
  "./vendor/supabase-js-2.116.0.min.js",     // keep in step with index.html
  // Self-hosted type. Both are variable fonts — one file per family.
  "../fonts/fonts.css", "../fonts/big-shoulders-display.woff2", "../fonts/ibm-plex-sans.woff2",
  "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
];

self.addEventListener("install", (e) => {
  /* cache: "reload" on every precache request. A plain addAll() is allowed to
     take files from the BROWSER's HTTP cache, and GitHub Pages serves the
     shell with max-age=600 — so a freshly installed CACHE could be filled
     with the previous version's files and then serve them for as long as the
     network stayed slow. That is how a fix could be live on the server and
     still not on the phone. */
  const fresh = SHELL.map((u) => new Request(u, { cache: "reload" }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PREVIEWS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname.endsWith("supabase.co")) return;          // live data, never cached
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/previews/")) { e.respondWith(previewFirst(e.request)); return; }
  e.respondWith(networkFirst(e.request));
});

async function previewFirst(req) {
  const cache = await caches.open(PREVIEWS);
  const hit = await cache.match(req);       // the exact address, ?v= included
  if (hit) return hit;
  // cache: "no-cache" for the same reason as networkFirst: never take a copy
  // the browser's HTTP cache (max-age=600) may still hold.
  const res = await fetch(req, { cache: "no-cache" });
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// A weak gym signal must not leave the app hanging: after 3s, use the cache.
const NETWORK_TIMEOUT_MS = 3000;

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // cache: "no-cache" = ask the SERVER, not the browser's HTTP cache. Without
    // it, "network-first" happily served a shell file the HTTP cache still
    // held (GitHub Pages says max-age=600), so a fix took ten minutes and two
    // reloads to reach the phone. A revalidation is a cheap 304.
    const res = await Promise.race([
      fetch(req, { cache: "no-cache" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
