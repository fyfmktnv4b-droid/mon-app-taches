// IndexedDB minimale en mémoire, pour les tests Node uniquement (Node n'en a
// pas). Ne couvre que ce que storage.js utilise. Jamais chargée par l'app.
export function fakeIndexedDB() {
  const databases = new Map();
  const later = (fn) => setTimeout(fn, 0);

  const byKey = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));

  function request(run) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    try {
      req.result = run();
      later(() => req.onsuccess?.());
    } catch (err) {
      req.error = err;
      later(() => req.onerror?.());
    }
    return req;
  }

  function objectStore(store) {
    const write = (value, mustBeNew) => {
      const row = structuredClone(value);
      if (row[store.keyPath] === undefined && store.autoIncrement) row[store.keyPath] = store.next++;
      const key = row[store.keyPath];
      if (mustBeNew && store.rows.has(key)) throw new Error("ConstraintError");
      store.rows.set(key, row);
      return key;
    };
    return {
      getAll: () => request(() => [...store.rows.keys()].sort(byKey).map((k) => structuredClone(store.rows.get(k)))),
      get: (key) => request(() => (store.rows.has(key) ? structuredClone(store.rows.get(key)) : undefined)),
      put: (value) => request(() => write(value, false)),
      add: (value) => request(() => write(value, true)),
      delete: (key) => request(() => { store.rows.delete(key); }),
      clear: () => request(() => { store.rows.clear(); }),
    };
  }

  function connection(entry) {
    return {
      onversionchange: null,
      objectStoreNames: { contains: (name) => entry.stores.has(name) },
      createObjectStore(name, { keyPath, autoIncrement = false } = {}) {
        entry.stores.set(name, { keyPath, autoIncrement, next: 1, rows: new Map() });
      },
      transaction(names) {
        const tx = { oncomplete: null, onerror: null, error: null };
        const allowed = new Set([names].flat());
        tx.objectStore = (name) => {
          if (!allowed.has(name)) throw new Error(`store ${name} not in transaction`);
          return objectStore(entry.stores.get(name));
        };
        later(() => later(() => tx.oncomplete?.()));
        return tx;
      },
      close() {},
    };
  }

  return {
    open(name, version) {
      const req = { result: undefined, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      later(() => {
        let entry = databases.get(name);
        const upgrade = !entry || version > entry.version;
        if (!entry) {
          entry = { version, stores: new Map() };
          databases.set(name, entry);
        }
        req.result = connection(entry);
        if (upgrade) {
          entry.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}
