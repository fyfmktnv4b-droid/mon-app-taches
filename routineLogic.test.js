import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_KEYS,
  MORNING_KEYS,
  applyRoutineMutation,
  countMorningDone,
  emptyRoutine,
  isCheckKey,
  isMorningDone,
  plannedSession,
  shouldShowRoutine,
  weekdayFromLocalDate,
} from "./routineLogic.js";

test("weekdayFromLocalDate reads the weekday off the date string, not the host timezone", () => {
  assert.equal(weekdayFromLocalDate("2026-10-11"), 0); // dimanche
  assert.equal(weekdayFromLocalDate("2026-10-12"), 1); // lundi
  assert.equal(weekdayFromLocalDate("2026-10-16"), 5); // vendredi
});

test("plannedSession labels the three programme days", () => {
  assert.deepEqual(plannedSession("2026-10-12"), { kind: "planned", label: "Haut du corps A" });
  assert.deepEqual(plannedSession("2026-10-14"), { kind: "planned", label: "Jambes" });
  assert.deepEqual(plannedSession("2026-10-16"), { kind: "planned", label: "Haut du corps B" });
});

test("plannedSession keeps the gym available but unlabelled on off days", () => {
  for (const date of ["2026-10-13", "2026-10-15", "2026-10-17"]) { // mar, jeu, sam
    assert.deepEqual(plannedSession(date), { kind: "optional", label: "Facultative" });
  }
});

test("plannedSession marks Sunday as rest, which carries no checkbox", () => {
  assert.deepEqual(plannedSession("2026-10-11"), { kind: "rest", label: "Repos" });
});

test("countMorningDone and isMorningDone count only the four morning keys", () => {
  assert.equal(countMorningDone({}), 0);
  assert.equal(countMorningDone({ wake: true, meditate: true }), 2);
  assert.equal(isMorningDone({ wake: true, wash: true, meditate: true }), false);
  // gym/steps ne comptent pas dans la routine du matin.
  assert.equal(isMorningDone({ wake: true, wash: true, meditate: true, gym: true }), false);
  assert.equal(isMorningDone({ wake: true, wash: true, meditate: true, pray: true }), true);
});

test("shouldShowRoutine asks again while the morning is incomplete", () => {
  assert.equal(shouldShowRoutine({}), true);
  assert.equal(shouldShowRoutine({ wake: true }), true);
});

test("shouldShowRoutine stops asking once the morning is complete", () => {
  assert.equal(shouldShowRoutine({ wake: true, wash: true, meditate: true, pray: true }), false);
});

test("shouldShowRoutine stops asking after a skip, but the day is not closed", () => {
  const skipped = { skipped: true };
  assert.equal(shouldShowRoutine(skipped), false);
  // Rouvrir à la main et cocher à 10h reste possible : la coche s'applique.
  const later = applyRoutineMutation(
    { local_date: "2026-10-13", checks: skipped },
    { type: "routineCheck", localDate: "2026-10-13", key: "meditate", value: true },
  );
  assert.deepEqual(later.checks, { skipped: true, meditate: true });
  assert.equal(countMorningDone(later.checks), 1);
});

test("applyRoutineMutation merges one key without dropping the others", () => {
  // L'invariant de la fusion entre appareils : le Mac coche "pray" sur une
  // routine où l'iPhone avait déjà coché "meditate" — les deux survivent.
  const fromIphone = { local_date: "2026-10-13", checks: { meditate: true } };
  const merged = applyRoutineMutation(fromIphone, {
    type: "routineCheck", localDate: "2026-10-13", key: "pray", value: true,
  });
  assert.deepEqual(merged.checks, { meditate: true, pray: true });
  assert.deepEqual(fromIphone.checks, { meditate: true }, "ne mute pas l'entrée");
});

test("applyRoutineMutation can uncheck a key checked by mistake", () => {
  const routine = { local_date: "2026-10-13", checks: { wake: true, meditate: true } };
  const fixed = applyRoutineMutation(routine, {
    type: "routineCheck", localDate: "2026-10-13", key: "meditate", value: false,
  });
  assert.deepEqual(fixed.checks, { wake: true, meditate: false });
  assert.equal(isMorningDone(fixed.checks), false);
});

test("applyRoutineMutation ignores other days and other mutation types", () => {
  const routine = { local_date: "2026-10-13", checks: { wake: true } };
  const otherDay = applyRoutineMutation(routine, {
    type: "routineCheck", localDate: "2026-10-12", key: "pray", value: true,
  });
  assert.equal(otherDay, routine);
  // Une mutation de tâche traverse la file partagée sans toucher la routine.
  const taskMutation = applyRoutineMutation(routine, { type: "setDone", id: "x", done: true });
  assert.equal(taskMutation, routine);
  const unknownKey = applyRoutineMutation(routine, {
    type: "routineCheck", localDate: "2026-10-13", key: "weigh_in", value: true,
  });
  assert.equal(unknownKey, routine);
});

test("emptyRoutine is a blank day, and every new day starts blank", () => {
  assert.deepEqual(emptyRoutine("2026-10-13"), { local_date: "2026-10-13", checks: {} });
  assert.equal(shouldShowRoutine(emptyRoutine("2026-10-13").checks), true);
});

test("isCheckKey matches the SQL allowlist and nothing else", () => {
  assert.deepEqual(CHECK_KEYS, ["wake", "wash", "meditate", "pray", "gym", "steps", "skipped"]);
  assert.deepEqual(MORNING_KEYS, ["wake", "wash", "meditate", "pray"]);
  for (const key of CHECK_KEYS) assert.ok(isCheckKey(key), key);
  assert.equal(isCheckKey("weight"), false);
  assert.equal(isCheckKey("__proto__"), false);
});
