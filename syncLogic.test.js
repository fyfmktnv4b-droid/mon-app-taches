import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMutation, resolveMutationIds, buildOptimisticTasks } from "./syncLogic.js";

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
