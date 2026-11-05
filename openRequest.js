// Boîte aux lettres entre le service worker et l'app : au toucher d'une
// notification, le service worker y dépose une marque datée, que l'app relève
// pour ouvrir le bon écran. Pas d'adresse à transmettre : sur iPhone, l'adresse
// demandée à l'ouverture n'est pas toujours respectée, et un message envoyé à
// une app qui démarre peut se perdre.
//
// Le nom de la boîte et sa clé sont repris tels quels dans service-worker.js
// (il ne peut pas importer de module) : serviceWorkerOpen.test.js le vérifie.
export const OPEN_REQUEST_CACHE = "mon-app-taches-open-request";
export const OPEN_REQUEST_KEY = "__open-request";
export const OPEN_REQUEST_TTL_MS = 10 * 60 * 1000;

// Relève la boîte : vrai si le Bilan doit s'ouvrir, une seule fois par marque.
// Ne lève jamais. delete() ne répond vrai qu'à un seul appel : si deux relevés
// se croisent (retour au premier plan et message du service worker), un seul
// gagne. Une marque trop vieille ou illisible est simplement jetée.
export async function takeOpenRequest(storage, now = Date.now()) {
  try {
    const store = storage === undefined ? globalThis.caches : storage;
    if (!store) return false;
    const cache = await store.open(OPEN_REQUEST_CACHE);
    const response = await cache.match(OPEN_REQUEST_KEY);
    if (!response) return false;
    if (!(await cache.delete(OPEN_REQUEST_KEY))) return false;
    const { screen, createdAt } = await response.json();
    const age = now - createdAt;
    return screen === "bilan" && age >= 0 && age < OPEN_REQUEST_TTL_MS;
  } catch (_err) {
    return false;
  }
}
