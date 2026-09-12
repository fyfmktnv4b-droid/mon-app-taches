// Bump CACHE_VERSION (v1 -> v2 -> ...) on every deploy that changes any
// file listed in ASSETS below. This is what makes the browser notice a
// new service worker and refresh its cache — there's no build tool here
// to hash files automatically, so this is a manual, required step.
const CACHE_VERSION = "v3";
const CACHE_NAME = `mon-app-taches-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./supabaseClient.js",
  "./tasks.js",
  "./quadrants.js",
  "./export.js",
  "./sync.js",
  "./storage.js",
  "./syncLogic.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  // Vendored Supabase JS module graph — every file must be listed, since a
  // missing one breaks the import chain on a cold offline boot.
  "./vendor/supabase-js.esm.js",
  "./vendor/supabase-auth-js-2.115.0.js",
  "./vendor/supabase-functions-js-2.115.0.js",
  "./vendor/supabase-postgrest-js-2.115.0.js",
  "./vendor/supabase-realtime-js-2.115.0.js",
  "./vendor/supabase-storage-js-2.115.0.js",
  "./vendor/supabase-phoenix-0.4.5.js",
  "./vendor/iceberg-js-0.8.1.js",
  "./vendor/tslib-2.8.1.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const sameOrigin = new URL(event.request.url).origin === self.location.origin;
        if (event.request.method === "GET" && response.ok && sameOrigin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
