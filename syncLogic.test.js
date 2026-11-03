import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMutation, resolveMutationIds, buildOptimisticTasks, longestTooLongLine, MAX_TASK_LENGTH, importanceFields } from "./syncLogic.js";
import { recoverChanges, validateChanges, undoChanges, applyChanges } from "./repriseLogic.js";

function makeTask(overrides) {
  return {
    id: "1", text: "x", urgent: null, important: null,
    done: false, completed_at: null, created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("applyMutation create appends the optimistic tasks", () => {
  const tasks = [makeTask({ id: "a" })];
  const newTasks = [makeTask({ id: "b" }), makeTask({ id: "c" })];
  const result = applyMutation(tasks, { type: "create", tasks: newTasks });
  assert.deepEqual(result.map((t) => t.id), ["a", "b", "c"]);
});

test("applyMutation setTag updates only the matching task", () => {
  const tasks = [makeTask({ id: "a", urgent: null }), makeTask({ id: "b", urgent: null })];
  const result = applyMutation(tasks, { type: "setTag", id: "a", tagName: "urgent", value: true });
  assert.equal(result.find((t) => t.id === "a").urgent, true);
  assert.equal(result.find((t) => t.id === "b").urgent, null);
});

test("applyMutation setDone sets done and completed_at together", () => {
  const tasks = [makeTask({ id: "a", done: false, completed_at: null })];
  const result = applyMutation(tasks, { type: "setDone", id: "a", done: true, completedAt: "2026-09-06T10:00:00Z" });
  assert.equal(result[0].done, true);
  assert.equal(result[0].completed_at, "2026-09-06T10:00:00Z");
});

test("applyMutation delete removes the matching task", () => {
  const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
  const result = applyMutation(tasks, { type: "delete", id: "a" });
  assert.deepEqual(result.map((t) => t.id), ["b"]);
});

test("applyMutation returns the list unchanged for an unknown mutation type", () => {
  const tasks = [makeTask({ id: "a" })];
  const result = applyMutation(tasks, { type: "unknown" });
  assert.deepEqual(result, tasks);
});

test("resolveMutationIds rewrites a task id that was remapped after a create synced", () => {
  const idMap = new Map([["temp-1", "real-1"]]);
  const mutation = { type: "setTag", id: "temp-1", tagName: "urgent", value: true };
  const resolved = resolveMutationIds(mutation, idMap);
  assert.equal(resolved.id, "real-1");
});

test("resolveMutationIds leaves the mutation unchanged when its id isn't in the map", () => {
  const idMap = new Map();
  const mutation = { type: "setTag", id: "real-2", tagName: "urgent", value: true };
  const resolved = resolveMutationIds(mutation, idMap);
  assert.equal(resolved.id, "real-2");
});

test("resolveMutationIds leaves create mutations unchanged (no id field to resolve)", () => {
  const idMap = new Map([["temp-1", "real-1"]]);
  const mutation = { type: "create", rawText: "x", tasks: [] };
  const resolved = resolveMutationIds(mutation, idMap);
  assert.deepEqual(resolved, mutation);
});

test("buildOptimisticTasks splits lines into full task-shaped objects with a generated id", () => {
  const tasks = buildOptimisticTasks("Tâche A\nTâche B", "user-1", "2026-09-06T08:00:00Z");
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].text, "Tâche A");
  assert.equal(tasks[0].user_id, "user-1");
  assert.equal(tasks[0].urgent, null);
  assert.equal(tasks[0].important, null);
  assert.equal(tasks[0].done, false);
  assert.equal(tasks[0].created_at, "2026-09-06T08:00:00Z");
  assert.ok(tasks[0].id && tasks[0].id !== tasks[1].id, "each task gets a distinct id");
});

test("buildOptimisticTasks drops blank lines", () => {
  const tasks = buildOptimisticTasks("Tâche A\n\n  \nTâche B", "user-1");
  assert.equal(tasks.length, 2);
});

test("applyMutation setReminderTime updates only the matching task", () => {
  const tasks = [
    makeTask({ id: "a", reminder_time: null }),
    makeTask({ id: "b", reminder_time: null }),
  ];
  const result = applyMutation(tasks, { type: "setReminderTime", id: "a", reminderTime: "09:30" });
  assert.equal(result.find((t) => t.id === "a").reminder_time, "09:30");
  assert.equal(result.find((t) => t.id === "b").reminder_time, null);
});

test("applyMutation setReminderTime can clear a reminder by passing null", () => {
  const tasks = [makeTask({ id: "a", reminder_time: "09:30" })];
  const result = applyMutation(tasks, { type: "setReminderTime", id: "a", reminderTime: null });
  assert.equal(result[0].reminder_time, null);
});

// --- cohabitation avec les coches de routine dans la file partagée ---

test("applyMutation leaves tasks untouched for a routine mutation", () => {
  const tasks = [{ id: "t1", text: "a", done: false }];
  const result = applyMutation(tasks, {
    type: "routineCheck", localDate: "2026-10-13", key: "meditate", value: true,
  });
  assert.deepEqual(result, tasks);
});

test("resolveMutationIds passes a routine mutation through unchanged", () => {
  const idMap = new Map([["optimistic-1", "server-1"]]);
  const mutation = { type: "routineCheck", localDate: "2026-10-13", key: "pray", value: true };
  assert.equal(resolveMutationIds(mutation, idMap), mutation);
});

test("longestTooLongLine is 0 when every line fits, including exactly the limit", () => {
  assert.equal(longestTooLongLine("Acheter du pain\nAppeler Paul"), 0);
  assert.equal(longestTooLongLine("a".repeat(MAX_TASK_LENGTH)), 0);
  assert.equal(longestTooLongLine(`  ${"a".repeat(MAX_TASK_LENGTH)}  `), 0); // trimmed like buildOptimisticTasks
});

test("longestTooLongLine reports the longest line over the limit", () => {
  const text = `court\n${"a".repeat(1001)}\n${"b".repeat(1500)}`;
  assert.equal(longestTooLongLine(text), 1500);
});

test("longestTooLongLine counts characters like Postgres char_length (an emoji is one)", () => {
  assert.equal(longestTooLongLine("😀".repeat(MAX_TASK_LENGTH)), 0);
  assert.equal(longestTooLongLine("😀".repeat(MAX_TASK_LENGTH + 1)), MAX_TASK_LENGTH + 1);
});

// --- Jour d'entrée dans « Important » (important_since) ---

const DAY1 = "2026-11-02";
const DAY2 = "2026-11-03";
const DAY3 = "2026-11-05";

// Classe la tâche comme le font les boutons Important / Autre : une seule
// mutation setFields, appliquée au cache comme le ferait la file hors-ligne.
function classify(task, important, today) {
  const mutation = { type: "setFields", id: task.id, fields: importanceFields(task, important, today) };
  return applyMutation([task], mutation)[0];
}

test("importanceFields: entering Important (from À trier or Autres) stamps today", () => {
  assert.deepEqual(importanceFields(makeTask({ important: null }), true, DAY1), { important: true, important_since: DAY1 });
  assert.deepEqual(importanceFields(makeTask({ important: false }), true, DAY1), { important: true, important_since: DAY1 });
  // Tâche créée hors-ligne par une ancienne version : colonne absente = pas Important.
  const legacy = makeTask({});
  delete legacy.important;
  assert.deepEqual(importanceFields(legacy, true, DAY1), { important: true, important_since: DAY1 });
});

test("importanceFields: staying Important never touches important_since", () => {
  const fields = importanceFields(makeTask({ important: true, important_since: DAY1 }), true, DAY2);
  assert.deepEqual(fields, { important: true });
  assert.equal("important_since" in fields, false);
});

test("importanceFields: leaving Important (to Autres or À trier) clears important_since", () => {
  const task = makeTask({ important: true, important_since: DAY1 });
  assert.deepEqual(importanceFields(task, false, DAY2), { important: false, important_since: null });
  assert.deepEqual(importanceFields(task, null, DAY2), { important: null, important_since: null });
  assert.deepEqual(importanceFields(makeTask({ important: null }), false, DAY2), { important: false, important_since: null });
});

test("applyMutation setFields writes every field of the mutation at once, on the matching task only", () => {
  const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
  const result = applyMutation(tasks, { type: "setFields", id: "a", fields: { important: true, important_since: DAY1 } });
  assert.equal(result[0].important, true);
  assert.equal(result[0].important_since, DAY1);
  assert.deepEqual(result[1], tasks[1]);
});

test("resolveMutationIds maps a setFields on a task created offline", () => {
  const idMap = new Map([["optimistic-1", "server-1"]]);
  const mutation = { type: "setFields", id: "optimistic-1", fields: { important: true, important_since: DAY1 } };
  assert.deepEqual(resolveMutationIds(mutation, idMap), { ...mutation, id: "server-1" });
});

test("important_since: Important, staying, through Autres and back restarts from the new day", () => {
  let task = makeTask({ id: "a", important: null });
  task = classify(task, true, DAY1);
  assert.equal(task.important_since, DAY1);
  task = classify(task, true, DAY2); // re-tap Important : rien ne bouge
  assert.equal(task.important_since, DAY1);
  task = classify(task, false, DAY2);
  assert.equal(task.important_since, null);
  task = classify(task, true, DAY3);
  assert.equal(task.important_since, DAY3);
});

test("important_since: validating and undoing the validation leave it untouched", () => {
  let task = classify(makeTask({ id: "a", important: null }), true, DAY1);
  task = applyMutation([task], { type: "setDone", id: "a", done: true, completedAt: "2026-11-03T10:00:00Z" })[0];
  assert.equal(task.important_since, DAY1);
  task = applyMutation([task], { type: "setDone", id: "a", done: false, completedAt: null })[0];
  assert.equal(task.important_since, DAY1);
  assert.equal(task.important, true);
});

test("important_since: Récupérer, Valider and their undo on « À reprendre » leave it untouched", () => {
  // Tâche de la semaine en cours : une tâche Important d'une semaine passée
  // est, elle, renvoyée dans « À trier » (voir repriseLogic.test.js).
  const task = makeTask({ id: "a", important: null, last_triaged_on: null, reminder_time: null, created_at: "2026-11-02T08:00:00Z" });
  const before = classify(task, true, DAY1);
  for (const changes of [recoverChanges(before, DAY3, "Europe/Paris"), validateChanges(DAY3, "Europe/Paris")]) {
    assert.ok(changes.every((step) => !("important" in step) && !("important_since" in step)));
    const after = applyChanges(before, changes);
    assert.equal(after.important, true);
    assert.equal(after.important_since, DAY1);
    assert.equal(applyChanges(after, undoChanges(before, changes)).important_since, DAY1);
  }
});
