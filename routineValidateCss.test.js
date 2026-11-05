import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Garde-fou des boutons « Validé ? » du bloc « Routine du matin » : une grille à
// deux colonnes (libellé / bouton), même bord gauche et même largeur pour tous
// les boutons, 12 px entre les lignes, et un placement par COLONNES seulement :
// aucune règle ne dépend du nombre ni de la position des habitudes, puisque les
// routines deviendront personnalisables. La mise en page réelle est mesurée par
// le banc (scripts/bench/scenarios/routineBoutons.js).
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

// Corps de la règle dont le sélecteur est exactement `selector`.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `règle introuvable : ${selector}`);
  return match[1];
}

const ROW = ".routine-row:has(.routine-validate)";

// Toutes les règles de ce chantier, sélecteurs compris.
const routineRules = css.match(/\.routine-row:has\(\.routine-validate\)[^{]*\{[^}]*\}/g) ?? [];

test("the row becomes a two-column grid only while a button is shown", () => {
  const grid = ruleBody(ROW);
  assert.match(grid, /display:\s*grid/);
  assert.match(grid, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/);
  assert.match(grid, /align-items:\s*center/);
  assert.doesNotMatch(ruleBody(".routine-row"), /display:\s*grid/, "sans bouton, la ligne reste celle d'origine");
});

test("12 px between the lines, 10 px between label and button", () => {
  assert.match(ruleBody(ROW), /gap:\s*12px\s+10px/);
});

test("each item dissolves into the grid, which places by column only", () => {
  assert.match(ruleBody(`${ROW} > .routine-item`), /display:\s*contents/);
  assert.match(ruleBody(`${ROW} .routine-check,\n${ROW} .routine-rest`), /grid-column:\s*1\b/);
  assert.match(ruleBody(`${ROW} .routine-validate`), /grid-column:\s*2\b/);
});

test("the buttons share one left edge and one width, and stay 44 px tall", () => {
  assert.match(ruleBody(`${ROW} .routine-validate`), /justify-self:\s*stretch/);
  assert.match(ruleBody(".routine-validate"), /min-height:\s*44px/);
  assert.match(css, /^button\s*\{\s*min-height:\s*44px;\s*\}/m);
});

test("no rule depends on the number or the position of the habits", () => {
  assert.ok(routineRules.length >= 4, "les règles de la grille sont introuvables");
  for (const rule of routineRules) {
    assert.doesNotMatch(rule, /nth-child|nth-of-type|first-child|last-child|grid-row/, rule);
  }
});

test("colours come only from :root variables (none written in the grid rules)", () => {
  for (const rule of routineRules) assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, rule);
});
