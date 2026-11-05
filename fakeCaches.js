// Faux CacheStorage pour les tests Node (le vrai n'existe que dans le navigateur).
// Chaque opération est asynchrone, comme la vraie : deux appels simultanés
// s'entremêlent. delete() ne répond vrai qu'à celui qui a réellement effacé.
const keyOf = (request) => (typeof request === "string" ? request : request.url);

function fakeCache() {
  const entries = new Map();
  return {
    entries,
    match: async (request) => entries.get(keyOf(request))?.clone(),
    put: async (request, response) => { entries.set(keyOf(request), response); },
    addAll: async () => {},
    delete: async (request) => entries.delete(keyOf(request)),
  };
}

export function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, fakeCache());
      return stores.get(name);
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request) => {
      for (const cache of stores.values()) {
        const found = await cache.match(request);
        if (found) return found;
      }
      return undefined;
    },
  };
}
