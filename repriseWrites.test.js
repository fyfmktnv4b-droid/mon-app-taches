import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Écritures de l'écran « À reprendre » (reprise.js -> sync.js -> tasks.js),
// de bout en bout : Récupérer, Valider, leur Annuler, en direct comme via la
// file hors-ligne, puis au rejeu. Faux Supabase qui note chaque update ; le
// vrai réseau est coupé. « Hors-ligne » = porte serveur fermée : l'écriture
// directe échoue et sync.js met en file.
globalThis.fetch = async () => {
  throw new TypeError("network disabled in tests");
};

const { supabase } = await import("./supabaseClient.js");
const storage = await import("./storage.js");
const sync = await import("./sync.js");
const { writeChanges } = await import("./reprise.js");
const { recoverChanges, validateChanges, undoChanges } = await import("./repriseLogic.js");
const { setServerGate } = await import("./authGate.js");

const updates = [];
supabase.from = (table) => {
  const call = { table };
  const query = {
    update: (payload) => { call.payload = payload; return query; },
    eq: (_column, id) => { call.id = id; return query; },
    then: (ok, ko) => {
      updates.push(call);
      return Promise.resolve({ data: null, error: null }).then(ok, ko);
    },
  };
  return query;
};

const PARIS = "Europe/Paris";
const TODAY = "2026-11-04"; // mercredi
const payloads = () => updates.map((u) => u.payload);

// Tâche de la semaine en cours (née lundi) : comportement actuel de Récupérer.
const BEFORE = Object.freeze({
  id: "t1", text: "Recontacter Pierre", important: true, important_since: "2026-11-02",
  done: false, completed_at: null, reminder_time: "09:30:00", last_triaged_on: "2026-11-02",
  created_at: "2026-11-02T08:00:00Z",
});

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB();
  updates.length = 0;
  setServerGate(false);
});

test("online, empty queue: Récupérer then Annuler are direct updates, one field each, in order", async () => {
  setServerGate(true);
  const changes = recoverChanges(TODAY);
  await writeChanges(BEFORE.id, changes);
  await writeChanges(BEFORE.id, undoChanges(BEFORE, changes));
  assert.deepEqual(payloads(), [
    { reminder_time: null },
    { last_triaged_on: TODAY },
    { last_triaged_on: "2026-11-02" },
    { reminder_time: "09:30:00" },
  ]);
  assert.ok(updates.every((u) => u.table === "tasks" && u.id === "t1"));
  assert.equal((await storage.getPendingMutations()).length, 0);
});

test("Récupérer (this week's task) never touches important nor important_since", async () => {
  setServerGate(true);
  await writeChanges(BEFORE.id, recoverChanges(TODAY));
  for (const payload of payloads()) {
    assert.equal("important" in payload, false);
    assert.equal("important_since" in payload, false);
  }
});

test("offline: Récupérer then Annuler are queued in order, the cache follows, and comes back to the original", async () => {
  await storage.setCachedTasks([BEFORE]);
  const changes = recoverChanges(TODAY);
  await writeChanges(BEFORE.id, changes);
  const [recovered] = await storage.getCachedTasks();
  assert.deepEqual(recovered, { ...BEFORE, reminder_time: null, last_triaged_on: TODAY });

  await writeChanges(BEFORE.id, undoChanges(BEFORE, changes));
  assert.deepEqual((await storage.getCachedTasks())[0], BEFORE);
  const queue = await storage.getPendingMutations();
  assert.deepEqual(queue.map(({ queueId: _q, ...m }) => m), [
    { type: "setReminderTime", id: "t1", reminderTime: null },
    { type: "setTag", id: "t1", tagName: "last_triaged_on", value: TODAY },
    { type: "setTag", id: "t1", tagName: "last_triaged_on", value: "2026-11-02" },
    { type: "setReminderTime", id: "t1", reminderTime: "09:30:00" },
  ]);
  assert.deepEqual(updates, []);
});

test("replay: the queued Récupérer and Annuler go out in the same order, then the queue is empty", async () => {
  const changes = recoverChanges(TODAY);
  await writeChanges(BEFORE.id, changes);
  await writeChanges(BEFORE.id, undoChanges(BEFORE, changes));
  setServerGate(true);
  await sync.flushQueue();
  assert.deepEqual(payloads(), [
    { reminder_time: null },
    { last_triaged_on: TODAY },
    { last_triaged_on: "2026-11-02" },
    { reminder_time: "09:30:00" },
  ]);
  assert.equal((await storage.getPendingMutations()).length, 0);
});

test("a write already waiting in the queue: Récupérer goes behind it, never direct", async () => {
  await storage.enqueueMutation({ type: "setTag", id: "other", tagName: "important", value: false });
  setServerGate(true);
  await writeChanges(BEFORE.id, recoverChanges(TODAY));
  assert.deepEqual(updates, []);
  const queue = await storage.getPendingMutations();
  assert.deepEqual(queue.map((m) => m.type), ["setTag", "setReminderTime", "setTag"]);
  await sync.flushQueue();
  assert.deepEqual(updates.map((u) => u.id), ["other", "t1", "t1"]);
});

test("Valider then Annuler: completed_at is written before done, and undone after it", async () => {
  setServerGate(true);
  const changes = validateChanges(TODAY, PARIS);
  await writeChanges(BEFORE.id, changes);
  await writeChanges(BEFORE.id, undoChanges(BEFORE, changes));
  assert.deepEqual(payloads(), [
    { completed_at: "2026-11-03T11:00:00.000Z" },
    { done: true },
    { done: false },
    { completed_at: null },
  ]);
});
