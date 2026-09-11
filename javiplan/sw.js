/* Service worker: the app must open in a gym with no signal.
 *
 * - App shell + plan data: cached at install, served cache-first, refreshed in
 *   the background. Bump CACHE when the shell changes so old files are dropped.
 * - Exercise previews (../previews/*.webp): cached the first time they are
 *   seen, so a session you have opened once works fully offline afterwards.
 * - Supabase: never cached — always network. The app keeps its own offline
 *   queue for writes.
 */
const CACHE = "javiplan-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js",
  "./store.js", "./timer.js", "./runner.js", "./app.js",
  "./data/programme.js", "./data/schedule.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
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
  e.respondWith(staleWhileRevalidate(e.request));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || refresh;
}
