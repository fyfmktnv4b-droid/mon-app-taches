import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closeFooterHtml, CLOSE_LABEL } from "./closeFooter.js";

// Vérifications sans navigateur ; le comportement réel (chaque écran du menu,
// Réglages -> Bilan -> Fermer, notification, Ma routine) est vérifié par le
// banc : scripts/bench/scenarios/fermer.js.

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const code = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");

test("le gabarit contient exactement un bouton « Fermer »", () => {
  const html = closeFooterHtml();
  assert.equal(CLOSE_LABEL, "Fermer");
  assert.equal(html.match(/<button\b/g).length, 1);
  assert.match(html, /^<footer class="screen-footer"><button type="button" class="screen-close" data-close>Fermer<\/button><\/footer>$/);
});

test("plus aucun lien « ‹ Aujourd'hui » ni ancien bouton du Bilan", () => {
  for (const file of ["app.js", "bilanScreen.js", "index.html", "style.css"]) {
    const text = code(read(file));
    for (const old of ["‹", "back-link", "back-main", "BACK_BUTTON", "wireBackLink", "bilan-footer", "bilan-close"]) {
      assert.ok(!text.includes(old), `${file} contient encore ${old}`);
    }
  }
});

test("Bilan, Historique/Réglages et Ma routine utilisent le même gabarit", () => {
  const bilan = code(read("bilanScreen.js"));
  assert.equal(bilan.match(/closeFooterHtml\(\)/g).length, 1);
  assert.ok(!/>Fermer</.test(bilan), "le Bilan n'écrit plus son propre bouton");
  const app = code(read("app.js"));
  assert.match(app, /mainView\.insertAdjacentHTML\("afterend", closeFooterHtml\(\)\)/);
  assert.match(app, /routineSection\.insertAdjacentHTML\("beforeend", closeFooterHtml\(\)\)/);
  assert.equal(app.match(/closeFooterHtml\(\)/g).length, 2);
});

test("« Fermer » mène toujours à Aujourd'hui", () => {
  const app = code(read("app.js"));
  const close = app.slice(app.indexOf("function closeToToday"), app.indexOf("}\n", app.indexOf("function closeToToday")));
  assert.match(close, /currentView = "main";/);
  assert.match(close, /routineFromMenu = false;/);
  // Le Bilan (menu ou notification) ne revient plus à l'écran précédent.
  assert.match(app, /openBilanScreen\(bilanSection, \{\s*excludedIds: abandonedIds,\s*onClose: closeToToday,/);
  // Les deux « Fermer » de app.js vont au même endroit.
  assert.equal(app.match(/closest\("\[data-close\]"\)\) closeToToday\(\);/g).length, 2);
});

test("Ma routine : « Fermer », Continuer et Passer mènent à Aujourd'hui depuis le menu seulement", () => {
  const app = code(read("app.js"));
  assert.match(app, /const leaveRoutine = \(\) => \(routineFromMenu \? closeToToday\(\) : enterAfterRoutine\(\)\);/);
  assert.match(app, /routineContinue\.addEventListener\("click", leaveRoutine\);/);
  assert.match(app, /toggleRoutineCheck\(routineLocalDate, SKIP_KEY, true\)\.catch\(console\.error\);\s*leaveRoutine\(\);/);
  assert.match(app, /openRoutine\.addEventListener\("click", async \(\) => \{\s*routineFromMenu = true;/);
  assert.match(app, /async function maybeShowRoutine\(\) \{\s*routineFromMenu = false;/);
  assert.match(app, /routineFooter\.hidden = !routineFromMenu;/);
});

test("style « crème » : couleurs des cartes, aucune nouvelle couleur", () => {
  const css = read("style.css");
  const rule = css.match(/\.screen-close, \.screen-close:hover \{([^}]*)\}/)[1];
  assert.match(rule, /background: var\(--card\);/);
  assert.match(rule, /border: 1px solid var\(--border-warm\);/);
  assert.match(rule, /color: var\(--sage-deep\);/);
  assert.match(rule, /font-weight: 700;/);
  assert.match(rule, /min-height: 52px;/);
  const footer = css.match(/\.screen-footer \{([^}]*)\}/)[1];
  assert.match(footer, /env\(safe-area-inset-bottom\)/);
  assert.match(footer, /border-top: 1px solid var\(--border-warm\);/);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb/i.test(rule + footer), "couleurs par variables seulement");
});

// Un rendu lent (synchronisation au retour du réseau, écran ouvert juste avant
// « Fermer ») ne doit pas remplacer l'écran demandé après lui.
test("chaque écran s'abstient s'il n'est plus celui demandé après ses lectures", () => {
  const app = code(read("app.js"));
  const body = (name) => app.slice(app.indexOf(`async function ${name}`), app.indexOf("\n}\n", app.indexOf(`async function ${name}`)));
  for (const [name, view] of [["renderMainView", "main"], ["renderHistoryView", "history"], ["renderSettingsView", "settings"]]) {
    // Jusqu'à la dernière écriture de l'écran : les gestionnaires de clic
    // qui suivent n'affichent pas d'écran.
    const whole = body(name);
    const fn = whole.slice(0, whole.lastIndexOf("mainView.innerHTML =") + "mainView.innerHTML =".length);
    const guard = `if (currentView !== "${view}") return;`;
    // Après chaque lecture (await), la garde vient avant toute écriture de l'écran.
    for (const match of fn.matchAll(/await [^;]+;/g)) {
      const after = fn.slice(match.index);
      const firstGuard = after.indexOf(guard);
      const firstWrite = after.search(/setHeader\(|mainView\.innerHTML =/);
      assert.ok(firstGuard !== -1 && firstGuard < firstWrite, `${name} : garde manquante après « ${match[0]} »`);
    }
  }
});
