import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Carte « Hier » (reprise.js, loadYesterdayQuestions) : les coches encore en
// file hors-ligne ne comptent comme réponses que si elles portent sur HIER.
// Faux Supabase qui rend la ligne de routine demandée ; le vrai réseau est coupé.
globalThis.fetch = async () => {
  throw new TypeError("network disabled in tests");
};

const { supabase } = await import("./supabaseClient.js");
const storage = await import("./storage.js");
const { loadYesterdayQuestions } = await import("./reprise.js");
const { setServerGate } = await import("./authGate.js");

const TODAY = "2026-11-03"; // mardi
const YESTERDAY = "2026-11-02"; // lundi : pas et salle attendus

let serverRow = null; // ligne daily_routines d'hier côté serveur (null = aucune)
supabase.from = () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: serverRow, error: null }),
  };
  return query;
};

const check = (localDate, key, value) => ({ type: "routineCheck", localDate, key, value });
const keys = async () => (await loadYesterdayQuestions(TODAY)).questions.map((q) => q.key);

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB();
  serverRow = null;
  setServerGate(true);
});

test("a queued check for TODAY does not answer yesterday's question", async () => {
  await storage.enqueueMutation(check(TODAY, "steps", true));
  await storage.enqueueMutation(check(TODAY, "gym", false));
  const result = await loadYesterdayQuestions(TODAY);
  assert.equal(result.yesterday, YESTERDAY);
  assert.deepEqual(result.questions.map((q) => q.key), ["steps", "gym"]);
});

test("a queued check for an older day does not answer yesterday's question either", async () => {
  await storage.enqueueMutation(check("2026-11-01", "steps", false));
  assert.deepEqual(await keys(), ["steps", "gym"]);
});

test("a queued answer for YESTERDAY (true or false) closes that question", async () => {
  await storage.enqueueMutation(check(TODAY, "gym", true));
  await storage.enqueueMutation(check(YESTERDAY, "steps", false));
  assert.deepEqual(await keys(), ["gym"]);
  await storage.enqueueMutation(check(YESTERDAY, "gym", true));
  assert.deepEqual(await keys(), []);
});

test("server row and queue combine: only yesterday's entries count", async () => {
  serverRow = { local_date: YESTERDAY, checks: { skipped: true, steps: true } };
  await storage.enqueueMutation(check(TODAY, "gym", true));
  assert.deepEqual(await keys(), ["gym"]);
});

test("gate closed (offline): no card at all, even with a queue", async () => {
  setServerGate(false);
  await storage.enqueueMutation(check(TODAY, "steps", true));
  assert.deepEqual(await keys(), []);
});
