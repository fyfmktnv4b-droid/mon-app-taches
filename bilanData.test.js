import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Habitudes du bilan (bilan.js, loadWeekHabits) : serveur d'abord, cache des
// routines si la lecture échoue, « indisponible » si le cache ne connaît pas
// tous les jours avant aujourd'hui. Faux client Supabase ; vrai réseau coupé.
globalThis.fetch = async () => {
  throw new TypeError("network disabled in tests");
};

const { supabase } = await import("./supabaseClient.js");
const storage = await import("./storage.js");
const { loadWeekHabits } = await import("./bilan.js");
const { setServerGate } = await import("./authGate.js");

const WEDNESDAY = "2026-11-04"; // semaine du lundi 2 au dimanche 8 novembre
let serverRows = [];
let hang = false;
supabase.from = () => {
  const query = {};
  for (const name of ["select", "gte", "lte", "order"]) query[name] = () => query;
  query.then = (ok, ko) => (hang ? new Promise(() => {}) : Promise.resolve({ data: serverRows, error: null })).then(ok, ko);
  return query;
};

const cachedDates = async () => (await storage.getCachedRoutines()).map((r) => r.local_date).sort();

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB();
  serverRows = [];
  hang = false;
  setServerGate(true);
});

test("online: the week's checks, Monday to today, with an empty object for a day without a row", async () => {
  serverRows = [{ local_date: "2026-11-02", checks: { gym: true, steps: true } }];
  const habits = await loadWeekHabits(WEDNESDAY);
  assert.equal(habits.source, "server");
  assert.deepEqual(habits.checksByDate, {
    "2026-11-02": { gym: true, steps: true },
    "2026-11-03": {},
    "2026-11-04": {},
  });
});

test("online: past days are cached — even without a row (known, no answer) — but never today", async () => {
  serverRows = [
    { local_date: "2026-11-02", checks: { gym: true } },
    { local_date: "2026-11-04", checks: { steps: true } },
  ];
  await loadWeekHabits(WEDNESDAY);
  assert.deepEqual(await cachedDates(), ["2026-11-02", "2026-11-03"]);
  assert.deepEqual(await storage.getCachedRoutine("2026-11-03"), { local_date: "2026-11-03", checks: {} });
});

test("online: a check still waiting in the offline queue already counts", async () => {
  await storage.enqueueMutation({ type: "routineCheck", localDate: "2026-11-03", key: "steps", value: true });
  const habits = await loadWeekHabits(WEDNESDAY);
  assert.deepEqual(habits.checksByDate["2026-11-03"], { steps: true });
});

test("offline with every past day in the cache: the cache is used (and today may be missing)", async () => {
  setServerGate(false);
  await storage.setCachedRoutine({ local_date: "2026-11-02", checks: { gym: true } });
  await storage.setCachedRoutine({ local_date: "2026-11-03", checks: {} });
  await storage.setCachedRoutine({ local_date: "2026-10-30", checks: { gym: true } }); // semaine passée : ignorée
  const habits = await loadWeekHabits(WEDNESDAY);
  assert.equal(habits.source, "cache");
  assert.deepEqual(habits.checksByDate, { "2026-11-02": { gym: true }, "2026-11-03": {}, "2026-11-04": {} });
});

test("offline with a past day missing from the cache: habits are unavailable", async () => {
  setServerGate(false);
  await storage.setCachedRoutine({ local_date: "2026-11-02", checks: { gym: true } });
  await storage.setCachedRoutine({ local_date: "2026-11-04", checks: { steps: true } });
  assert.deepEqual(await loadWeekHabits(WEDNESDAY), { source: "unavailable" });
});

test("offline on a Monday: no past day to require, today is « in progress »", async () => {
  setServerGate(false);
  const habits = await loadWeekHabits("2026-11-02");
  assert.equal(habits.source, "cache");
  assert.deepEqual(habits.checksByDate, { "2026-11-02": {} });
});

test("a slow server (over 2 s) falls back to the cache", async () => {
  hang = true;
  await storage.setCachedRoutine({ local_date: "2026-11-02", checks: { steps: true } });
  await storage.setCachedRoutine({ local_date: "2026-11-03", checks: {} });
  const habits = await loadWeekHabits(WEDNESDAY);
  assert.equal(habits.source, "cache");
  assert.deepEqual(habits.checksByDate["2026-11-02"], { steps: true });
});
