import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_HABITS, habitByKey, isOfficialDay, sessionLabel, expectedHabits, doneCount, weekdayFromLocalDate,
} from "./habits.js";
import { CHECK_KEYS, plannedSession } from "./routineLogic.js";

// Semaine du lundi 2026-10-12 au dimanche 2026-10-18.
const MON = "2026-10-12";
const TUE = "2026-10-13";
const WED = "2026-10-14";
const THU = "2026-10-15";
const FRI = "2026-10-16";
const SAT = "2026-10-17";
const SUN = "2026-10-18";

test("weekdayFromLocalDate reads the weekday off the date string (0 = Sunday)", () => {
  assert.equal(weekdayFromLocalDate(SUN), 0);
  assert.equal(weekdayFromLocalDate(MON), 1);
  assert.equal(weekdayFromLocalDate(FRI), 5);
});

test("steps are expected every day, weekly target 7", () => {
  const steps = habitByKey("steps");
  assert.equal(steps.weeklyTarget, 7);
  for (const date of [MON, TUE, WED, THU, FRI, SAT, SUN]) assert.ok(isOfficialDay(steps, date), date);
});

test("gym: weekly target 3, official on Monday, Wednesday, Friday only", () => {
  const gym = habitByKey("gym");
  assert.equal(gym.weeklyTarget, 3);
  assert.deepEqual([MON, TUE, WED, THU, FRI, SAT, SUN].map((d) => isOfficialDay(gym, d)),
    [true, false, true, false, true, false, false]);
});

test("gym session labels are the routine's own, day by day", () => {
  const gym = habitByKey("gym");
  assert.equal(sessionLabel(gym, MON), "Haut du corps A");
  assert.equal(sessionLabel(gym, WED), "Jambes");
  assert.equal(sessionLabel(gym, FRI), "Haut du corps B");
  assert.equal(sessionLabel(gym, TUE), null);
  for (const date of [MON, WED, FRI]) assert.equal(sessionLabel(gym, date), plannedSession(date).label);
});

test("expectedHabits lists what is expected on a given day, with the planned session", () => {
  assert.deepEqual(expectedHabits(MON), [
    { key: "steps", label: "10 000 pas", session: null },
    { key: "gym", label: "Salle", session: "Haut du corps A" },
  ]);
  assert.deepEqual(expectedHabits(WED).map((h) => h.session), [null, "Jambes"]);
  for (const date of [TUE, THU, SAT, SUN]) assert.deepEqual(expectedHabits(date).map((h) => h.key), ["steps"], date);
});

test("a gym session done on an off day counts towards the 3 out of 3", () => {
  const week = [
    { local_date: MON, checks: { gym: true, steps: true } },
    { local_date: TUE, checks: { gym: true } }, // jour non officiel
    { local_date: WED, checks: { gym: false } },
    { local_date: FRI, checks: { gym: true } },
  ];
  assert.equal(doneCount(week, "gym"), 3);
  assert.equal(doneCount(week, "steps"), 1);
  assert.equal(doneCount([{ local_date: SAT }], "gym"), 0); // ligne sans checks
});

test("the habit list survives a JSON round trip (it may come from the database one day)", () => {
  const fromDb = JSON.parse(JSON.stringify(DEFAULT_HABITS));
  for (const date of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
    assert.deepEqual(expectedHabits(date, fromDb), expectedHabits(date), date);
  }
});

test("every habit key is accepted by set_routine_check and by the checks constraint", () => {
  const sql = (file) => readFileSync(new URL(`./supabase/migrations/${file}`, import.meta.url), "utf8");
  const list = (text) => [...text.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  const rpcKeys = list(sql("0002_daily_routines.sql").match(/p_key not in \(([^)]*)\)/)[1]);
  const constraintKeys = list(sql("0003_data_constraints.sql").match(/checks - array\[([^\]]*)\]/)[1]);
  for (const { key } of DEFAULT_HABITS) {
    assert.ok(CHECK_KEYS.includes(key), `${key} dans CHECK_KEYS`);
    assert.ok(rpcKeys.includes(key), `${key} dans set_routine_check`);
    assert.ok(constraintKeys.includes(key), `${key} dans daily_routines_checks_shape`);
  }
});
