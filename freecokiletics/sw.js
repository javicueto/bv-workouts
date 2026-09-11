/* Cokiletics service worker: the app must open in a gym with no signal.
 *
 * - App shell + plan data: NETWORK-FIRST, falling back to the cache when the
 *   network fails or takes more than 3s. It used to be stale-while-revalidate,
 *   which served the old copy first — so every fix only reached the phone on
 *   the SECOND reload. Bump CACHE when the shell changes so old files go.
 * - Exercise previews (../previews/*.webp): cached the first time they are
 *   seen, so a session you have opened once works fully offline afterwards.
 * - Supabase: never cached — always network. The app keeps its own offline
 *   queue for writes.
 */
const CACHE = "freeco-v4";
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js",
  "./icons.js", "./ui.js", "./store.js", "./timer.js", "./runner.js", "./app.js",
  "./data/programme.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  // The Supabase client MUST be precached. It is fetched on the very first page
  // load, before this worker controls the page, so the runtime cache below
  // never sees it — without this line the first offline open cannot sign in.
  // Keep the version in step with index.html.
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname.endsWith("supabase.co")) return;          // live data, never cached
  if (url.hostname.includes("jsdelivr.net")) {                // the Supabase client library
    e.respondWith(cacheFirst(e.request));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/previews/")) { e.respondWith(cacheFirst(e.request)); return; }
  e.respondWith(networkFirst(e.request));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

// A weak gym signal must not leave the app hanging: after 3s, use the cache.
const NETWORK_TIMEOUT_MS = 3000;

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
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
