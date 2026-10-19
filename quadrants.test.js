import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getImportant,
  getOthers,
  getUnsorted,
  getSorted,
  splitActiveAndArchived,
  splitOpenAndDone,
} from "./quadrants.js";
import { localDateString } from "./localDate.js";

function makeTask(overrides) {
  return {
    id: "1", text: "x", urgent: null, important: null,
    done: false, completed_at: null, created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("getImportant and getOthers split on the important flag only", () => {
  const tasks = [
    makeTask({ id: "a", important: true }),
    makeTask({ id: "b", important: false }),
    makeTask({ id: "c", important: null }),
  ];
  assert.deepEqual(getImportant(tasks).map((t) => t.id), ["a"]);
  assert.deepEqual(getOthers(tasks).map((t) => t.id), ["b"]);
});

test("the urgent column is ignored whatever its value", () => {
  const tasks = [
    makeTask({ id: "a", urgent: true, important: true }),
    makeTask({ id: "b", urgent: false, important: true }),
    makeTask({ id: "c", urgent: true, important: false }),
    makeTask({ id: "d", urgent: null, important: false }),
  ];
  assert.deepEqual(getImportant(tasks).map((t) => t.id), ["a", "b"]);
  assert.deepEqual(getOthers(tasks).map((t) => t.id), ["c", "d"]);
});

test("an urgent task that was never classified as important stays in 'à trier'", () => {
  const tasks = [makeTask({ id: "a", urgent: true, important: null })];
  assert.deepEqual(getUnsorted(tasks).map((t) => t.id), ["a"]);
  assert.deepEqual(getImportant(tasks), []);
  assert.deepEqual(getOthers(tasks), []);
});

test("getSorted and getUnsorted partition the task list with no overlap", () => {
  const tasks = [
    makeTask({ id: "a", important: null }),
    makeTask({ id: "b", urgent: true, important: null }),
    makeTask({ id: "c", important: true }),
    makeTask({ id: "d", important: false }),
  ];
  const sorted = getSorted(tasks);
  const unsorted = getUnsorted(tasks);
  assert.deepEqual(sorted.map((t) => t.id), ["c", "d"]);
  assert.deepEqual(unsorted.map((t) => t.id), ["a", "b"]);
  assert.equal(sorted.length + unsorted.length, tasks.length);
});

test("splitActiveAndArchived archives only tasks done before today", () => {
  const tasks = [
    makeTask({ id: "a", done: true, completed_at: "2026-09-04T10:00:00Z" }),
    makeTask({ id: "b", done: true, completed_at: "2026-09-05T08:00:00Z" }),
    makeTask({ id: "c", done: false, completed_at: null }),
  ];
  const { active, archived } = splitActiveAndArchived(tasks, "2026-09-05", "UTC");
  assert.deepEqual(archived.map((t) => t.id), ["a"]);
  assert.deepEqual(active.map((t) => t.id), ["b", "c"]);
});

test("splitActiveAndArchived uses the local day, not the UTC day", () => {
  // 2026-09-04T22:30Z = 00:30 le 5 septembre à Paris (UTC+2).
  const tasks = [makeTask({ id: "a", done: true, completed_at: "2026-09-04T22:30:00Z" })];
  const paris = splitActiveAndArchived(tasks, "2026-09-05", "Europe/Paris");
  assert.deepEqual(paris.active.map((t) => t.id), ["a"]);
  assert.deepEqual(paris.archived, []);
  // Le même instant, lu en UTC, est « la veille » : archivé.
  const utc = splitActiveAndArchived(tasks, "2026-09-05", "UTC");
  assert.deepEqual(utc.archived.map((t) => t.id), ["a"]);
});

test("a task validated before midnight leaves 'Terminé' once the local day changes", () => {
  const tasks = [makeTask({ id: "a", done: true, completed_at: "2026-09-05T20:00:00Z" })];
  const evening = splitActiveAndArchived(tasks, "2026-09-05", "Europe/Paris");
  assert.deepEqual(splitOpenAndDone(evening.active).done.map((t) => t.id), ["a"]);
  const nextDay = splitActiveAndArchived(tasks, "2026-09-06", "Europe/Paris");
  assert.deepEqual(nextDay.active, []);
  assert.deepEqual(nextDay.archived.map((t) => t.id), ["a"]);
});

test("splitOpenAndDone puts finished tasks in 'done' whatever their category, newest first", () => {
  const tasks = [
    makeTask({ id: "a", important: true }),
    makeTask({ id: "b", important: false, done: true, completed_at: "2026-09-05T08:00:00Z" }),
    makeTask({ id: "c", important: null, done: true, completed_at: "2026-09-05T09:00:00Z" }),
  ];
  const { open, done } = splitOpenAndDone(tasks);
  assert.deepEqual(open.map((t) => t.id), ["a"]);
  assert.deepEqual(done.map((t) => t.id), ["c", "b"]);
});

test("cancelling a validation sends the task back to its own box", () => {
  const validated = makeTask({ id: "a", important: false, done: true, completed_at: "2026-09-05T08:00:00Z" });
  const reopened = { ...validated, done: false, completed_at: null };
  const { open, done } = splitOpenAndDone([reopened]);
  assert.deepEqual(done, []);
  assert.deepEqual(getOthers(open).map((t) => t.id), ["a"]);
  const unsorted = splitOpenAndDone([{ ...reopened, important: null }]).open;
  assert.deepEqual(getUnsorted(unsorted).map((t) => t.id), ["a"]);
});

// Boîte « Terminé » de bout en bout, comme le fait renderMainView :
// today = localDateString() au moment du rendu, puis splitActiveAndArchived
// + splitOpenAndDone. Fuseau fixé pour que le test ne dépende pas du Mac.
const TZ = "Europe/Paris";
function doneBoxAt(tasks, nowIso) {
  const today = localDateString(new Date(nowIso), TZ);
  const { active, archived } = splitActiveAndArchived(tasks, today, TZ);
  return { done: splitOpenAndDone(active).done.map((t) => t.id), archived: archived.map((t) => t.id) };
}

test("boîte Terminé : une tâche validée hier n'y est pas (elle est dans l'Historique)", () => {
  const tasks = [makeTask({ id: "hier", important: true, done: true, completed_at: "2026-10-18T16:00:00Z" })];
  assert.deepEqual(doneBoxAt(tasks, "2026-10-19T08:00:00Z"), { done: [], archived: ["hier"] });
});

test("boîte Terminé : une tâche validée aujourd'hui y est", () => {
  const tasks = [makeTask({ id: "auj", important: false, done: true, completed_at: "2026-10-19T07:30:00Z" })];
  assert.deepEqual(doneBoxAt(tasks, "2026-10-19T08:00:00Z"), { done: ["auj"], archived: [] });
});

test("boîte Terminé : une tâche validée sans date de validation n'y reste pas indéfiniment", () => {
  // Ne devrait pas arriver (l'app écrit toujours done et completed_at
  // ensemble), mais une ligne modifiée à la main en base ne doit pas rester
  // « terminée aujourd'hui » pour toujours : on ne sait pas quand elle l'a été.
  const tasks = [makeTask({ id: "sans-date", important: true, done: true, completed_at: null })];
  assert.deepEqual(doneBoxAt(tasks, "2026-10-19T08:00:00Z"), { done: [], archived: ["sans-date"] });
});

test("boîte Terminé : au changement de jour, app ouverte, le rendu suivant la vide", () => {
  // Validée à 23h50 heure de Paris (21:50Z) ; rendus à 23h59 puis 00h01.
  const tasks = [makeTask({ id: "tard", important: true, done: true, completed_at: "2026-10-19T21:50:00Z" })];
  assert.deepEqual(doneBoxAt(tasks, "2026-10-19T21:59:00Z"), { done: ["tard"], archived: [] });
  assert.deepEqual(doneBoxAt(tasks, "2026-10-19T22:01:00Z"), { done: [], archived: ["tard"] });
});
