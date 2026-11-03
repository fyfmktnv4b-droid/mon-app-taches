import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Le bilan de la semaine ignore une tâche terminée sans completed_at (il ne
// peut pas la placer dans une semaine). Ces tests vérifient que TOUS les
// chemins qui terminent une tâche écrivent completed_at avec done = true :
//   - la case « Validé ? » de l'écran principal (sync.updateDone), en direct,
//     en file hors-ligne et au rejeu de la file ;
//   - tasks.setDone appelée sans date ;
//   - « Valider » de « À reprendre » (reprise.writeChanges), en direct et en file.
// Faux Supabase qui note chaque update ; le vrai réseau est coupé.
globalThis.fetch = async () => {
  throw new TypeError("network disabled in tests");
};

const { supabase } = await import("./supabaseClient.js");
const storage = await import("./storage.js");
const sync = await import("./sync.js");
const { setDone } = await import("./tasks.js");
const { writeChanges } = await import("./reprise.js");
const { validateChanges, applyChanges } = await import("./repriseLogic.js");
const { applyMutation } = await import("./syncLogic.js");
const { setServerGate } = await import("./authGate.js");

const updates = [];
supabase.from = () => {
  const query = {
    update: (payload) => { updates.push(payload); return query; },
    eq: () => query,
    then: (ok, ko) => Promise.resolve({ data: null, error: null }).then(ok, ko),
  };
  return query;
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OPEN = { id: "t1", text: "Pain", important: true, done: false, completed_at: null };

// État final d'une tâche après une suite d'updates (dans l'ordre).
const replayed = (task) => updates.reduce((acc, payload) => ({ ...acc, ...payload }), task);

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB();
  updates.length = 0;
  setServerGate(false);
});

test("main screen, online: done = true always goes out with a completed_at", async () => {
  setServerGate(true);
  await sync.updateDone("t1", true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].done, true);
  assert.match(updates[0].completed_at, ISO);
});

test("main screen, offline: the queued validation carries its completed_at, cache included", async () => {
  await storage.setCachedTasks([OPEN]);
  await sync.updateDone("t1", true);
  const [mutation] = await storage.getPendingMutations();
  assert.equal(mutation.type, "setDone");
  assert.match(mutation.completedAt, ISO);
  const [cached] = await storage.getCachedTasks();
  assert.equal(cached.done, true);
  assert.equal(cached.completed_at, mutation.completedAt);
});

test("main screen, replay: the queued validation is sent with the SAME completed_at (time of the tap)", async () => {
  await sync.updateDone("t1", true);
  const [mutation] = await storage.getPendingMutations();
  setServerGate(true);
  await sync.flushQueue();
  assert.deepEqual(updates, [{ done: true, completed_at: mutation.completedAt }]);
});

test("tasks.setDone called without a date stamps now; undoing clears it", async () => {
  setServerGate(true);
  await setDone("t1", true);
  await setDone("t1", false);
  assert.equal(updates[0].done, true);
  assert.match(updates[0].completed_at, ISO);
  assert.deepEqual(updates[1], { done: false, completed_at: null });
});

test("« Valider » on « À reprendre », online: the task ends done WITH a completed_at", async () => {
  setServerGate(true);
  await writeChanges("t1", validateChanges("2026-11-04", "Europe/Paris"));
  const after = replayed(OPEN);
  assert.equal(after.done, true);
  assert.match(after.completed_at, ISO);
});

test("« Valider » on « À reprendre », offline then replayed: done never without completed_at", async () => {
  await storage.setCachedTasks([OPEN]);
  const changes = validateChanges("2026-11-04", "Europe/Paris");
  await writeChanges("t1", changes);
  const queue = await storage.getPendingMutations();
  // À chaque étape de la file, une tâche terminée a déjà sa date.
  let state = [OPEN];
  for (const mutation of queue) {
    state = applyMutation(state, mutation);
    if (state[0].done) assert.match(state[0].completed_at, ISO);
  }
  assert.deepEqual(state[0], applyChanges(OPEN, changes));
  setServerGate(true);
  await sync.flushQueue();
  const after = replayed(OPEN);
  assert.equal(after.done, true);
  assert.match(after.completed_at, ISO);
});
