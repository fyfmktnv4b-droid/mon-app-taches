import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Classement Important / Autre (sync.js) : important et important_since
// partent TOUJOURS dans une seule écriture, en direct comme via la file
// hors-ligne. Faux Supabase qui note chaque update ; le vrai réseau est coupé.
globalThis.fetch = async () => {
  throw new TypeError("network disabled in tests");
};

const { supabase } = await import("./supabaseClient.js");
const storage = await import("./storage.js");
const sync = await import("./sync.js");
const { setServerGate } = await import("./authGate.js");

const updates = [];
supabase.from = (table) => {
  const query = {
    update: (payload) => { updates.push({ table, payload }); return query; },
    eq: () => query,
    then: (ok, ko) => Promise.resolve({ data: null, error: null }).then(ok, ko),
  };
  return query;
};

const FIELDS = { important: true, important_since: "2026-11-02" };

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB();
  updates.length = 0;
  setServerGate(false);
});

test("online: one classification is one update carrying both fields", async () => {
  setServerGate(true);
  await sync.updateFields("task-1", FIELDS);
  assert.deepEqual(updates, [{ table: "tasks", payload: FIELDS }]);
  assert.equal((await storage.getPendingMutations()).length, 0);
});

test("offline: one classification is one queued mutation carrying both fields, applied to the cache", async () => {
  await storage.setCachedTasks([{ id: "task-1", text: "Pain", done: false, important: null }]);
  await sync.updateFields("task-1", FIELDS);
  const queue = await storage.getPendingMutations();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, "setFields");
  assert.equal(queue[0].id, "task-1");
  assert.deepEqual(queue[0].fields, FIELDS);
  const [cached] = await storage.getCachedTasks();
  assert.equal(cached.important, true);
  assert.equal(cached.important_since, "2026-11-02");
  assert.deepEqual(updates, []);
});

test("replay: the queued classification goes out as one update with both fields", async () => {
  await sync.updateFields("task-1", FIELDS);
  await sync.updateFields("task-1", { important: false, important_since: null });
  setServerGate(true);
  await sync.flushQueue();
  assert.deepEqual(updates, [
    { table: "tasks", payload: FIELDS },
    { table: "tasks", payload: { important: false, important_since: null } },
  ]);
  assert.equal((await storage.getPendingMutations()).length, 0);
});
