const DB_NAME = "mon-app-taches";
const DB_VERSION = 1;
const TASKS_STORE = "tasks_cache";
const QUEUE_STORE = "pending_mutations";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        db.createObjectStore(TASKS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "queueId", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
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

export async function removeMutation(queueId) {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  tx.objectStore(QUEUE_STORE).delete(queueId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
