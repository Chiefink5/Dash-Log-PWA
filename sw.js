// sw.js — Cache-first PWA Service Worker (simple + reliable)

const CACHE_NAME = "dashlog-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Network-first for navigation (helps updates show up)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache-first for static files
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});