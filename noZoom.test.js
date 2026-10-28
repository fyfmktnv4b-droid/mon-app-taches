import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Garde-fou « écrans figés » : sans l'une de ces trois protections, l'iPhone
// peut de nouveau zoomer par pincement ou double-tap. Seul un vrai iPhone
// confirme le geste ; ce test vérifie que les protections sont en place.
const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("style.css");

test("the viewport tag blocks scaling and keeps device-width and viewport-fit=cover", () => {
  const content = html.match(/<meta name="viewport" content="([^"]+)">/)?.[1] ?? "";
  const parts = content.split(",").map((p) => p.trim());
  for (const part of ["width=device-width", "maximum-scale=1", "user-scalable=no", "viewport-fit=cover"]) {
    assert.ok(parts.includes(part), `viewport must contain ${part}`);
  }
});

test("a touch-action: manipulation rule covers every element, not only html or body", () => {
  // touch-action ne s'hérite pas : seul le sélecteur « * » couvre aussi les
  // conteneurs qui défilent (#main-view, .unsorted-wrap, #reprise).
  assert.match(css, /(?:^|\}|,)\s*\*\s*\{[^}]*touch-action\s*:\s*manipulation/m);
});

test("the CSS adds no overscroll-behavior on html or body (the bounce stays)", () => {
  assert.doesNotMatch(css, /(?:^|\}|,)\s*(?:html|body)\s*\{[^}]*overscroll-behavior/m);
});

test("noZoom.js cancels the three iOS gesture events, non-passive, and app.js loads it", () => {
  const js = read("noZoom.js");
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) assert.ok(js.includes(`"${type}"`), type);
  assert.match(js, /preventDefault\(\)/);
  assert.match(js, /passive:\s*false/);
  assert.match(read("app.js"), /^import "\.\/noZoom\.js";$/m);
});

// Accueil figé (v37) : #welcome ne bouge pas du tout, mais les écrans qui défilent
// gardent leur défilement et leur rebond.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
const noneRules = rules.filter((r) => /touch-action\s*:\s*none/.test(r.body));

test("#welcome has touch-action: none, and so does the offline banner while the welcome is shown", () => {
  assert.ok(noneRules.some((r) => r.selector === "#welcome"), "#welcome { touch-action: none }");
  assert.ok(
    noneRules.some((r) => /#welcome:not\(\[hidden\]\)/.test(r.selector) && /#offline-banner\s*$/.test(r.selector)),
    "the banner is frozen only when #welcome is shown",
  );
});

test("touch-action: none targets only #welcome and the banner, never a scrolling screen", () => {
  assert.ok(noneRules.length > 0);
  for (const { selector } of noneRules) {
    assert.match(selector, /^(#welcome|body:has\(#welcome:not\(\[hidden\]\)\) #offline-banner)$/, `unexpected touch-action: none on "${selector}"`);
  }
  for (const scroller of ["#main-view", "#reprise", ".unsorted-wrap", ".unsorted-list"]) {
    assert.ok(!noneRules.some((r) => r.selector.includes(scroller)), `${scroller} must keep scrolling`);
  }
});
