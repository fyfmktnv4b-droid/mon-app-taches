import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneForDay } from "./dayScenes.js";

test("sceneForDay returns the Monday waking-up scene for a Monday date", () => {
  const scene = sceneForDay(new Date("2026-09-14T12:00:00"));
  assert.equal(scene.label, "Lundi");
  assert.equal(scene.file, "illustrations/lundi.png");
});

test("sceneForDay returns the Thursday vegetable-chopping scene for a Thursday date", () => {
  const scene = sceneForDay(new Date("2026-09-17T12:00:00"));
  assert.equal(scene.label, "Jeudi");
  assert.equal(scene.file, "illustrations/jeudi.png");
});

test("sceneForDay returns the Sunday hammock-nap scene for a Sunday date", () => {
  const scene = sceneForDay(new Date("2026-09-13T12:00:00"));
  assert.equal(scene.label, "Dimanche");
  assert.equal(scene.file, "illustrations/dimanche.png");
});

test("every scene has a non-empty alt text describing the illustration", () => {
  for (let day = 0; day < 7; day++) {
    // Any Sunday-anchored date plus `day` lands on that weekday.
    const scene = sceneForDay(new Date(2026, 8, 13 + day, 12));
    assert.ok(scene.alt && scene.alt.length > 0);
  }
});
