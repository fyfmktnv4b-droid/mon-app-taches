import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// routines.listRoutinesBetween (bilan de la semaine) : une seule lecture,
// bornes incluses, triée par jour, et rien du tout tant que la porte serveur
// est fermée. Faux client Supabase qui note la requête ; le vrai réseau est coupé.
globalThis.fetch = async () => {
  throw new TypeError("network disabled in tests");
};

const { supabase } = await import("./supabaseClient.js");
const { listRoutinesBetween } = await import("./routines.js");
const { setServerGate } = await import("./authGate.js");

let calls = [];
let reply = { data: [], error: null };
supabase.from = (table) => {
  const call = { table, steps: [] };
  calls.push(call);
  const query = {};
  for (const name of ["select", "gte", "lte", "order"]) {
    query[name] = (...args) => { call.steps.push([name, ...args]); return query; };
  }
  query.then = (ok, ko) => Promise.resolve(reply).then(ok, ko);
  return query;
};

beforeEach(() => {
  calls = [];
  reply = { data: [], error: null };
  setServerGate(true);
});

test("one read of daily_routines between the two days, both included, ordered by day", async () => {
  reply = { data: [{ local_date: "2026-11-02", checks: { gym: true } }], error: null };
  const rows = await listRoutinesBetween("2026-11-02", "2026-11-03");
  assert.deepEqual(rows, reply.data);
  assert.deepEqual(calls, [{
    table: "daily_routines",
    steps: [
      ["select", "local_date, checks"],
      ["gte", "local_date", "2026-11-02"],
      ["lte", "local_date", "2026-11-03"],
      ["order", "local_date", { ascending: true }],
    ],
  }]);
});

test("a server error is thrown, not hidden as an empty week", async () => {
  reply = { data: null, error: new Error("boom") };
  await assert.rejects(listRoutinesBetween("2026-11-02", "2026-11-03"), /boom/);
});

test("server gate closed: nothing is sent", async () => {
  setServerGate(false);
  await assert.rejects(listRoutinesBetween("2026-11-02", "2026-11-03"));
  assert.deepEqual(calls, []);
});
