import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Changements d'écran en un coup (v44), relus dans le code. Le comportement
// réel, image par image, est vérifié au banc (scripts/bench/scenarios/enUnCoup.js).
const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
// Code sans ses commentaires sur leur propre ligne.
const code = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .filter((line) => !line.trim().startsWith("//")).join("\n");
const app = code("app.js");
const fn = (name) => {
  const start = app.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  return app.slice(start, app.indexOf("\n}\n", start) + 2);
};

test("« Chargement… » : une seule zone, role=\"status\", nulle part ailleurs", () => {
  const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
  assert.equal(html.match(/Chargement…/g).length, 1);
  assert.match(html, /<section id="screen-loading" role="status" hidden>\s*<p>Chargement…<\/p>/);
  const appFiles = readdirSync(new URL("./", import.meta.url))
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && f !== "fakeIndexedDB.js" && f !== "fakeCaches.js");
  for (const file of appFiles) assert.ok(!code(file).includes("Chargement"), `${file} n'écrit aucun autre « Chargement… »`);
});

test("« Chargement… » seulement pour un changement d'écran, jamais pour un redessin", () => {
  // Changements d'écran : menu, « Fermer », entrée dans l'app, Bilan, Ma routine.
  assert.match(fn("showView"), /render\(\{ loading: true \}\)/);
  assert.match(fn("closeToToday"), /render\(\{ loading: true \}\)/);
  assert.match(fn("enterApp"), /render\(\{ loading: true, before:/);
  assert.match(fn("showBilan"), /\{ loading = true \} = \{\}/);
  // Redessins : case validée (safely), synchronisation, retour du réseau, premier plan.
  assert.match(fn("safely"), /if \(redraw\) render\(\);/);
  assert.match(app, /initSync\(\(\) => \{\s*if \(!appSection\.hidden\) render\(\);/);
  assert.match(app, /if \(!appSection\.hidden\) render\(\);\s*else if \(!bilanSection\.hidden\) showBilan\(\{ loading: false \}\);/);
  assert.match(app, /flushQueue\(\)\.catch\(\(\) => \{\}\)\.then\(\(\) => \{ if \(!appSection\.hidden\) render\(\); \}\);/);
  // Le minuteur n'est armé que si `loading`.
  assert.match(fn("swapScreen"), /if \(!loading\) return work\(\);/);
  // Toutes les autres demandes de rendu sont des redessins, sans argument.
  const calls = [...app.matchAll(/(?<!function )\brender\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(calls.filter((args) => args !== "").sort(),
    ["{ loading: true, before: (", "{ loading: true }", "{ loading: true }"].sort());
});

test("les gardes de la v43 restent : chaque vue vérifie qu'elle est toujours demandée", () => {
  assert.match(fn("renderMainView"), /await Promise\.all\(\[loadTasks\(\), readRoutineBlock\(\)\]\);\s*if \(currentView !== "main"\) return;/);
  assert.match(fn("renderHistoryView"), /const allTasks = await loadTasks\(\);\s*if \(currentView !== "history"\) return;/);
  assert.equal(fn("renderSettingsView").match(/if \(currentView !== "settings"\) return;/g).length, 2);
  assert.match(app, /if \(currentView !== "routine"\) return;/);
  assert.match(code("bilanScreen.js"), /if \(openId !== openCount \|\| !isWanted\(\)\) return false;/);
});

test("titre, contenu et apparition de l'écran dans la même image", () => {
  // #app n'apparaît qu'au dessin d'une vue (setHeader, appelée après la garde).
  assert.match(fn("setHeader"), /^\nfunction setHeader\(title\) \{\s*showOnly\(appSection\);/);
  assert.equal(app.match(/showOnly\(appSection\)/g).length, 1, "#app n'est montré nulle part ailleurs");
  // La routine du matin est dessinée avec les tâches, sans attente.
  assert.match(fn("renderMainView"), /mountRoutineBlock\(routineHost, routineData\);/);
  assert.doesNotMatch(code("routineBlock.js"), /export async function mountRoutineBlock/);
});

test("enterApp : n'efface plus l'écran, attend l'envoi de la file 2 s au plus", () => {
  const enter = fn("enterApp");
  assert.doesNotMatch(enter, /innerHTML/);
  assert.match(enter, /settlesWithin\(flushQueue\(\), FLUSH_WAIT_MS\)/);
  assert.doesNotMatch(enter, /await flushQueue\(\)/);
});

test("le vidage reste garanti à la déconnexion et au changement de compte", () => {
  const forget = fn("forgetShownData");
  for (const what of ["mainView.innerHTML = \"\";", "routineHost.innerHTML = \"\";", "bilanSection.innerHTML = \"\";", "repriseSection.innerHTML = \"\";"]) {
    assert.ok(forget.includes(what), `forgetShownData : ${what}`);
  }
  assert.match(fn("showAuth"), /forgetShownData\(\);/);
  assert.match(fn("handleAuthEvent"), /if \(out\.clear\) \{\s*forgetShownData\(\);\s*try \{\s*await clearLocalData\(\);/);
});
