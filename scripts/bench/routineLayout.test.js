import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutProblems } from "./routineLayout.js";

// Mesures inventées : ce test n'a pas besoin de Chrome.
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const row = (top, withButton, { buttonLeft = 280, buttonWidth = 94, buttonHeight = 44, labelHeight = 44 } = {}) => ({
  label: rect(0, top, 150, labelHeight),
  button: withButton ? rect(buttonLeft, top + (labelHeight - buttonHeight) / 2, buttonWidth, buttonHeight) : null,
});

test("two aligned buttons, 12 px apart: no problem", () => {
  assert.deepEqual(layoutProblems([row(0, true), row(56, true)], { blockRight: 374 }), []);
});

test("any number of habits, with buttons on some only", () => {
  assert.deepEqual(layoutProblems([row(0, true)]), []);
  assert.deepEqual(layoutProblems([row(0, false), row(56, true)]), []);
  assert.deepEqual(layoutProblems([row(0, true), row(56, false), row(112, true), row(168, false)]), []);
});

test("a label wrapped on two lines keeps its button centred on its own row", () => {
  assert.deepEqual(layoutProblems([row(0, true, { labelHeight: 70 }), row(82, true)]), []);
});

test("buttons that start at different places or have different widths are reported", () => {
  const different = layoutProblems([row(0, true, { buttonLeft: 250 }), row(56, true, { buttonLeft: 280, buttonWidth: 94 })]);
  assert.ok(different.some((p) => p.includes("bords gauches")), different.join("|"));
  const widths = layoutProblems([row(0, true, { buttonWidth: 100 }), row(56, true, { buttonWidth: 94 })]);
  assert.ok(widths.some((p) => p.includes("largeurs")), widths.join("|"));
});

test("buttons almost touching are reported", () => {
  const problems = layoutProblems([row(0, true), row(46, true)]);
  assert.ok(problems.some((p) => p.includes("écart vertical")), problems.join("|"));
});

test("a button that fell under its own label is reported (the auto-placement trap)", () => {
  const misplaced = { label: rect(0, 0, 150, 44), button: rect(0, 56, 94, 44) };
  const problems = layoutProblems([misplaced]);
  assert.ok(problems.some((p) => p.includes("chevauche ou passe sous")), problems.join("|"));
  assert.ok(problems.some((p) => p.includes("pas sur la ligne")), problems.join("|"));
});

test("a button shorter than 44 px, or overflowing the block, is reported", () => {
  assert.ok(layoutProblems([row(0, true, { buttonHeight: 40 })]).some((p) => p.includes("minimum 44")));
  assert.ok(layoutProblems([row(0, true)], { blockRight: 300 }).some((p) => p.includes("dépasse")));
});
