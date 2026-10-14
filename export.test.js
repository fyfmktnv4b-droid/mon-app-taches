import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksToExportJson, fullExportJson } from "./export.js";

test("tasksToExportJson serializes the task list as pretty JSON", () => {
  const tasks = [{ id: "a", text: "Test", urgent: true, important: false }];
  const json = tasksToExportJson(tasks);
  assert.deepEqual(JSON.parse(json), tasks);
  assert.ok(json.includes("\n"), "expected pretty-printed (multi-line) JSON");
});

test("tasksToExportJson handles an empty list", () => {
  assert.equal(tasksToExportJson([]), "[]");
});

test("fullExportJson bundles tasks and routines under separate keys", () => {
  const tasks = [{ id: "a", text: "Test" }];
  const routines = [{ local_date: "2026-10-14", checks: { wake: true } }];
  const parsed = JSON.parse(fullExportJson(tasks, routines));
  assert.deepEqual(parsed, { tasks, routines });
});

test("fullExportJson keeps empty lists as empty arrays", () => {
  assert.deepEqual(JSON.parse(fullExportJson([], [])), { tasks: [], routines: [] });
});
