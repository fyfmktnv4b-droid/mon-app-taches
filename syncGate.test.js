import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Couche de données (sync.js) branchée sur un FAUX Supabase qui compte ses
// appels. Le vrai réseau est coupé : rien ne peut joindre le vrai projet.
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new TypeError("network disabled in tests");
};

const { supabase } = await import("./supabaseClient.js");
const storage = await import("./storage.js");
const sync = await import("./sync.js");

// Comme un client SANS session : la RLS laisse passer la requête mais ne
// touche aucune ligne, et PostgREST ne renvoie AUCUNE erreur.
const dataCalls = [];
function anonymousQuery(table) {
  const result = { data: [], error: null };
  const query = {
    select: () => query, insert: () => query, update: () => query, delete: () => query,
    eq: () => query, order: () => query, maybeSingle: () => ({ ...query, then: (ok) => ok({ data: null, error: null }) }),
    then: (ok, ko) => Promise.resolve(result).then(ok, ko),
  };
  dataCalls.push(table);
  return query;
}
supabase.from = anonymousQuery;
supabase.rpc = (name) => { dataCalls.push(`rpc:${name}`); return Promise.resolve({ data: null, error: null }); };
supabase.auth.getUser = async () => { dataCalls.push("auth.getUser"); return { data: { user: null }, error: null }; };
supabase.auth.getSession = async () => { dataCalls.push("auth.getSession"); return { data: { session: null }, error: null }; };

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB();
  dataCalls.length = 0;
});

// Faille A : sans session vérifiée, le rejeu d'un setTag « réussissait » sans
// rien modifier côté serveur, et la mutation était retirée de la file.
test("replaying the queue without a verified session never loses a mutation", async () => {
  await storage.enqueueMutation({ type: "setTag", id: "task-1", tagName: "important", value: true });
  await storage.enqueueMutation({ type: "routineCheck", localDate: "2026-10-27", key: "wake", value: true });

  await sync.flushQueue();

  assert.equal((await storage.getPendingMutations()).length, 2);
  assert.deepEqual(dataCalls, []);
  assert.equal(networkCalls, 0);
});

// --- Condition L : un rejet de la porte est un échec à réessayer ---

const { setServerGate, ServerGateClosedError } = await import("./authGate.js");
const { writeMarker, clearMarker } = await import("./lastUser.js");
const settings = await import("./settings.js");

const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
};

test("gate closed: setTag goes to the queue without error, the replay leaves it there", async () => {
  setServerGate(false);
  await sync.updateTag("task-1", "important", true);
  assert.equal((await storage.getPendingMutations()).length, 1);

  await sync.flushQueue();

  assert.equal((await storage.getPendingMutations()).length, 1);
  assert.deepEqual(dataCalls, []);
  assert.equal(networkCalls, 0);
});

test("gate closed: every write is queued and every read uses the cache, with zero data call", async () => {
  setServerGate(false);
  writeMarker("user-A", "b@icloud.com");
  await storage.setCachedTasks([{ id: "task-1", user_id: "user-A", text: "Pain", done: false, important: null }]);
  await storage.setCachedRoutine({ local_date: "2026-10-27", checks: { wake: true } });

  const created = await sync.captureTasks("Lait\nOeufs");
  await sync.updateDone("task-1", true);
  await sync.updateReminderTime("task-1", "18:00");
  await sync.removeTask(created[1].id);
  await sync.toggleRoutineCheck("2026-10-27", "wash", true);

  assert.deepEqual(created.map((t) => t.user_id), ["user-A", "user-A"]);
  assert.deepEqual((await storage.getPendingMutations()).map((m) => m.type),
    ["create", "setDone", "setReminderTime", "delete", "routineCheck"]);
  const tasks = await sync.loadTasks();
  assert.deepEqual(tasks.map((t) => t.text).sort(), ["Lait", "Pain"]);
  assert.deepEqual((await sync.loadRoutine("2026-10-27")).checks, { wake: true, wash: true });
  assert.equal((await sync.loadAllRoutines()).length, 1);
  assert.deepEqual(dataCalls, []);
  assert.equal(networkCalls, 0);
  clearMarker();
});

test("gate closed without a marker: a new task is refused, nothing is queued", async () => {
  setServerGate(false);
  clearMarker();
  await assert.rejects(sync.captureTasks("Lait"), /Session expirée/);
  assert.equal((await storage.getPendingMutations()).length, 0);
  assert.deepEqual(dataCalls, []);
});

test("gate closed: settings are refused at once, without any call", async () => {
  setServerGate(false);
  await assert.rejects(settings.getSettings(), ServerGateClosedError);
  await assert.rejects(settings.setNotificationsEnabled(true), ServerGateClosedError);
  assert.deepEqual(dataCalls, []);
});

// --- Régression : porte ouverte, tout se passe comme avant ---

test("gate open: a write goes straight to the server and the queue stays empty", async () => {
  setServerGate(true);
  await sync.updateTag("task-1", "important", true);
  assert.deepEqual(dataCalls, ["tasks"]);
  assert.equal((await storage.getPendingMutations()).length, 0);
  setServerGate(false);
});

test("gate open: the queue is replayed in order and emptied", async () => {
  await storage.enqueueMutation({ type: "setTag", id: "task-1", tagName: "important", value: true });
  await storage.enqueueMutation({ type: "routineCheck", localDate: "2026-10-27", key: "wake", value: true });
  setServerGate(true);
  await sync.flushQueue();
  assert.deepEqual(dataCalls, ["tasks", "rpc:set_routine_check"]);
  assert.equal((await storage.getPendingMutations()).length, 0);
  setServerGate(false);
});

// --- Jeton expiré pendant l'usage : porte encore ouverte, le SDK n'a plus de session ---

test("gate open but the SDK has no session: a new task is queued under the marker, no error", async () => {
  setServerGate(true);
  writeMarker("user-A", "b@icloud.com");
  const realFrom = supabase.from;
  const realGetUser = supabase.auth.getUser;
  const realGetSession = supabase.auth.getSession;
  supabase.from = () => { throw new Error("must not be called"); };
  supabase.auth.getUser = async () => ({ data: { user: null }, error: Object.assign(new Error("Load failed"), { name: "AuthRetryableFetchError" }) });
  supabase.auth.getSession = async () => ({ data: { session: null }, error: Object.assign(new Error("Load failed"), { name: "AuthRetryableFetchError" }) });
  try {
    const created = await sync.captureTasks("Pendant la coupure");
    assert.equal(created[0].user_id, "user-A");
    assert.deepEqual((await storage.getPendingMutations()).map((m) => m.type), ["create"]);
  } finally {
    supabase.from = realFrom;
    supabase.auth.getUser = realGetUser;
    supabase.auth.getSession = realGetSession;
    setServerGate(false);
    clearMarker();
  }
});
