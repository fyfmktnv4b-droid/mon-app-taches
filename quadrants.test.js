import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getQuadrant,
  getPriorityTasks,
  getUnsorted,
  splitActiveAndArchived,
} from "./quadrants.js";

function makeTask(overrides) {
  return {
    id: "1", text: "x", urgent: null, important: null,
    done: false, completed_at: null, created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("getQuadrant filters by exact urgent/important combination", () => {
  const tasks = [
    makeTask({ id: "a", urgent: true, important: true }),
    makeTask({ id: "b", urgent: true, important: false }),
    makeTask({ id: "c", urgent: false, important: true }),
    makeTask({ id: "d", urgent: false, important: false }),
  ];
  assert.deepEqual(getQuadrant(tasks, true, true).map((t) => t.id), ["a"]);
  assert.deepEqual(getQuadrant(tasks, true, false).map((t) => t.id), ["b"]);
  assert.deepEqual(getQuadrant(tasks, false, true).map((t) => t.id), ["c"]);
  assert.deepEqual(getQuadrant(tasks, false, false).map((t) => t.id), ["d"]);
});

test("getQuadrant excludes unsorted tasks (null tags) from every quadrant", () => {
  const tasks = [makeTask({ id: "a", urgent: null, important: true })];
  assert.deepEqual(getQuadrant(tasks, true, true), []);
  assert.deepEqual(getQuadrant(tasks, false, true), []);
});

test("getPriorityTasks returns only urgent+important tasks, no truncation or padding", () => {
  const tasks = [
    makeTask({ id: "a", urgent: true, important: true }),
    makeTask({ id: "b", urgent: true, important: true }),
    makeTask({ id: "c", urgent: true, important: true }),
    makeTask({ id: "d", urgent: true, important: true }),
    makeTask({ id: "e", urgent: false, important: true }),
  ];
  assert.equal(getPriorityTasks(tasks).length, 4);
});

test("getUnsorted returns tasks missing either tag", () => {
  const tasks = [
    makeTask({ id: "a", urgent: null, important: null }),
    makeTask({ id: "b", urgent: true, important: null }),
    makeTask({ id: "c", urgent: true, important: true }),
  ];
  assert.deepEqual(getUnsorted(tasks).map((t) => t.id), ["a", "b"]);
});

test("splitActiveAndArchived archives only tasks done before today", () => {
  const tasks = [
    makeTask({ id: "a", done: true, completed_at: "2026-09-04T10:00:00Z" }),
    makeTask({ id: "b", done: true, completed_at: "2026-09-05T08:00:00Z" }),
    makeTask({ id: "c", done: false, completed_at: null }),
  ];
  const { active, archived } = splitActiveAndArchived(tasks, "2026-09-05");
  assert.deepEqual(archived.map((t) => t.id), ["a"]);
  assert.deepEqual(active.map((t) => t.id), ["b", "c"]);
});
