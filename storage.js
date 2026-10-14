const DB_NAME = "mon-app-taches";
// v1 -> v2 : ajout de ROUTINES_STORE. Ce numéro DOIT être incrémenté pour tout
// nouveau store, sinon onupgradeneeded ne se déclenche jamais sur un appareil
// où l'app est déjà installée (l'iPhone), le store n'y est jamais créé, et la
// routine échoue hors-ligne alors qu'elle marche sur un appareil neuf.
const DB_VERSION = 2;
const TASKS_STORE = "tasks_cache";
const QUEUE_STORE = "pending_mutations";
const ROUTINES_STORE = "routines_cache";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // Les gardes `contains` rendent l'upgrade idempotent : une base neuve crée
    // les trois stores, une base en v1 ne crée que celui qui manque.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        db.createObjectStore(TASKS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "queueId", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(ROUTINES_STORE)) {
        db.createObjectStore(ROUTINES_STORE, { keyPath: "local_date" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Sans ça, cette connexion resterait ouverte et bloquerait la PROCHAINE
      // montée de version (les connexions ne sont jamais fermées ailleurs).
      db.onversionchange = () => db.close();
      resolve(db);
    };
    // Un onglet encore ouvert sur l'ancienne version retient la base en v1 et
    // fait attendre l'upgrade indéfiniment. On rejette plutôt que de laisser
    // l'appel pendre : les appelants savent se rabattre ou afficher une erreur.
    request.onblocked = () =>
      reject(new Error("Base de données occupée — ferme les autres onglets de l'app."));
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedTasks() {
  const db = await openDb();
  const tx = db.transaction(TASKS_STORE, "readonly");
  return requestToPromise(tx.objectStore(TASKS_STORE).getAll());
}

export async function setCachedTasks(tasks) {
  const db = await openDb();
  const tx = db.transaction(TASKS_STORE, "readwrite");
  const store = tx.objectStore(TASKS_STORE);
  store.clear();
  for (const task of tasks) {
    store.put(task);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Une entrée par jour, clé = local_date. On ne purge pas : une routine pèse
// quelques octets, et garder les jours passés en cache sert l'export.
export async function getCachedRoutine(localDate) {
  const db = await openDb();
  const tx = db.transaction(ROUTINES_STORE, "readonly");
  const found = await requestToPromise(tx.objectStore(ROUTINES_STORE).get(localDate));
  return found ?? null;
}

export async function getCachedRoutines() {
  const db = await openDb();
  const tx = db.transaction(ROUTINES_STORE, "readonly");
  return requestToPromise(tx.objectStore(ROUTINES_STORE).getAll());
}

export async function setCachedRoutine(routine) {
  const db = await openDb();
  const tx = db.transaction(ROUTINES_STORE, "readwrite");
  tx.objectStore(ROUTINES_STORE).put(routine);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingMutations() {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readonly");
  return requestToPromise(tx.objectStore(QUEUE_STORE).getAll());
}

export async function enqueueMutation(mutation) {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  return requestToPromise(tx.objectStore(QUEUE_STORE).add(mutation));
}

// Called on sign-out: the cache and queue are global, so without this a next
// user on a shared device would see the previous user's tasks and have their
// leftover queued mutations replayed against the new account.
export async function clearLocalData() {
  const db = await openDb();
  const tx = db.transaction([TASKS_STORE, QUEUE_STORE, ROUTINES_STORE], "readwrite");
  tx.objectStore(TASKS_STORE).clear();
  tx.objectStore(QUEUE_STORE).clear();
  tx.objectStore(ROUTINES_STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeMutation(queueId) {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  tx.objectStore(QUEUE_STORE).delete(queueId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
