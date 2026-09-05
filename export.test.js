import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksToExportJson } from "./export.js";

test("tasksToExportJson serializes the task list as pretty JSON", () => {
  const tasks = [{ id: "a", text: "Test", urgent: true, important: false }];
  const json = tasksToExportJson(tasks);
  assert.deepEqual(JSON.parse(json), tasks);
  assert.ok(json.includes("\n"), "expected pretty-printed (multi-line) JSON");
});

test("tasksToExportJson handles an empty list", () => {
  assert.equal(tasksToExportJson([]), "[]");
});
