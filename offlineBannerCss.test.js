import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Garde-fou du bandeau « Mode hors-ligne » : la marge sous la zone de sécurité
// de l'iPhone est définie UNE fois dans :root, et la boîte comme sa hauteur
// (reprise par html.offline-mode) s'appuient sur elle. Sans cela, le texte
// repasse sous la zone floue ou les écrans se décalent du bandeau.
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

test("the banner gap is defined once, in :root", () => {
  assert.equal(css.match(/--offline-banner-gap\s*:/g).length, 1);
  const root = css.match(/:root\s*\{([^}]*--offline-banner-gap\s*:[^}]*)\}/);
  assert.ok(root, "--offline-banner-gap must be declared in a :root block");
});

test("the banner height and padding both use the gap and the safe area", () => {
  const h = css.match(/--offline-banner-h\s*:\s*([^;]+);/)[1];
  assert.match(h, /env\(safe-area-inset-top\)/);
  assert.match(h, /var\(--offline-banner-gap\)/);
  const box = css.match(/#offline-banner\s*\{([^}]*)\}/)[1];
  assert.match(box, /height:\s*var\(--offline-banner-h\)/);
  assert.match(box, /padding:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*var\(--offline-banner-gap\)\)/);
});

test("the offline-mode screens are shortened by the same banner height", () => {
  assert.match(css, /html\.offline-mode #app[^{]*\{[^}]*calc\(100dvh - var\(--offline-banner-h\)\)/);
  assert.match(css, /html\.offline-mode #reprise\s*\{[^}]*calc\(100dvh - var\(--offline-banner-h\)\)/);
});
