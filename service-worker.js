// Bump CACHE_VERSION (v1 -> v2 -> ...) on every deploy that changes any
// file listed in ASSETS below. This is what makes the browser notice a
// new service worker and refresh its cache — there's no build tool here
// to hash files automatically, so this is a manual, required step.
const CACHE_VERSION = "v43";
const CACHE_NAME = `mon-app-taches-${CACHE_VERSION}`;

// Boîte aux lettres vers l'app (voir openRequest.js, qui porte les mêmes noms).
// Cache à part : ni « activate » ni « fetch » n'y touchent, et aucune requête
// de l'app ne demande cette clé.
const OPEN_REQUEST_CACHE = "mon-app-taches-open-request";
const OPEN_REQUEST_KEY = "__open-request";

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
  "./push.js",
  "./settings.js",
  "./settingsLogic.js",
  "./closeFooter.js",
  "./quotes.js",
  "./dayScenes.js",
  "./localDate.js",
  "./routineLogic.js",
  "./habits.js",
  "./routines.js",
  "./routineBlock.js",
  "./screenSwap.js",
  "./splashLogic.js",
  "./version.js",
  "./noZoom.js",
  "./bilanLogic.js",
  "./bilan.js",
  "./bilanScreen.js",
  "./openRequest.js",
  "./repriseLogic.js",
  "./reprise.js",
  "./repriseScreen.js",
  "./authLogic.js",
  "./authGate.js",
  "./lastUser.js",
  "./lastUserLogic.js",
  "./fonts/plus-jakarta-sans-latin-400-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-ext-400-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-500-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-ext-500-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-600-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-ext-600-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-700-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-ext-700-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-800-normal.woff2",
  "./fonts/plus-jakarta-sans-latin-ext-800-normal.woff2",
  "./illustrations/lundi.png",
  "./illustrations/mardi.png",
  "./illustrations/mercredi.png",
  "./illustrations/jeudi.png",
  "./illustrations/vendredi.png",
  "./illustrations/samedi.png",
  "./illustrations/dimanche.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names
        .filter((name) => name !== CACHE_NAME && name !== OPEN_REQUEST_CACHE)
        .map((name) => caches.delete(name)))
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

self.addEventListener("push", (event) => {
  let payload = { title: "Mes Tâches", body: "Nouvelle notification" };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_err) {
      payload = { title: "Mes Tâches", body: event.data.text() };
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "./icons/icon-192.png",
      // Liste fermée : on n'ouvre jamais une adresse reçue par le réseau.
      data: { open: payload.open === "bilan" ? "bilan" : null },
    })
  );
});

// La marque passe avant tout : l'app la relève même si le reste échoue. Sans
// stockage, le toucher ouvre quand même l'app, sur son écran habituel.
async function leaveOpenRequest(screen) {
  try {
    const cache = await caches.open(OPEN_REQUEST_CACHE);
    await cache.put(OPEN_REQUEST_KEY, new Response(JSON.stringify({ screen, createdAt: Date.now() })));
  } catch (_err) {
    // Rien à faire de plus.
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const screen = event.notification.data?.open === "bilan" ? "bilan" : null;
  event.waitUntil((async () => {
    if (screen) await leaveOpenRequest(screen);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if ("focus" in client) {
        // Prévient une app déjà à l'écran, qui ne recevra pas d'autre signal.
        if (screen) client.postMessage({ type: "open-request" });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow("./");
  })());
});
