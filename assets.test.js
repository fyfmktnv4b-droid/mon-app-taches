import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { posix } from "node:path";

// Liste ASSETS du service worker : un fichier chargé par l'app mais absent de
// la liste ne gêne rien en ligne, et casse le démarrage hors-ligne. Ce test
// relit l'app comme le navigateur (index.html, imports, style.css, manifeste,
// chemins écrits dans le code) et compare avec ASSETS. Il ne voit que les
// chemins écrits en entier : un chemin construit pendant l'exécution est donc
// refusé, pour qu'on le remarque.

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const exists = (file) => existsSync(new URL(`./${file}`, import.meta.url));
const resolve = (from, spec) => posix.normalize(posix.join(posix.dirname(from), spec));

// Code sans ses commentaires, numéros de ligne conservés.
const code = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
  .split("\n").map((line) => (line.trim().startsWith("//") ? "" : line)).join("\n");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const EXT = "png|jpe?g|svg|webp|gif|ico|woff2?|ttf|otf|css|m?js|json|html";
const LITERAL_PATH = new RegExp(`["'\`]((?:\\./)?[\\w./-]+\\.(?:${EXT}))["'\`]`, "g");
const PATHY = new RegExp(`(?:\\./|\\b(?:icons|illustrations|fonts|vendor)/|\\.(?:${EXT})\\b)`);
const IMPORT = /(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"']+)["']/g;

// Chemins écrits dans le code mais que l'app ne charge pas, avec la raison.
const NOT_LOADED = {
  "service-worker.js": "le navigateur le télécharge lui-même à chaque vérification de mise à jour, jamais depuis ce cache",
};

// Gabarits qui ressemblent à un chemin sans en être un, avec la raison.
const EXCEPTIONS = {
  "app.js": {
    "`mes-taches-${todayDateString()}.json`": "nom du fichier que l'export propose au téléchargement ; l'app ne le charge pas",
  },
};

// Chemins construits pendant l'exécution, que ce test ne peut pas suivre.
function dynamicPathsIn(text) {
  const found = [];
  const report = (index, snippet) => found.push({ line: lineOf(text, index), snippet: snippet.trim() });
  for (const m of text.matchAll(/\b(?:import|importScripts)\s*\(\s*(?!["'][^"'`$]*["']\s*\))/g)) {
    report(m.index, text.slice(m.index, m.index + 60).split("\n")[0]);
  }
  for (const m of text.matchAll(/`[^`]*`/g)) {
    const fixed = m[0].replace(/\$\{[^}]*\}/g, "\u0000");
    if (m[0].includes("${") && PATHY.test(fixed)) report(m.index, m[0]);
  }
  const pathString = `["'](?:[^"'\\n]*?(?:${PATHY.source})[^"'\\n]*|[^"'\\n]*/)["']`;
  for (const m of text.matchAll(new RegExp(`${pathString}\\s*\\+|\\+\\s*${pathString}`, "g"))) {
    report(m.index, m[0]);
  }
  return found;
}

// --- Ce que l'app charge ----------------------------------------------------

const loaded = new Map(); // fichier -> qui le charge
const load = (file, by) => { if (!loaded.has(file)) loaded.set(file, by); };
const ownFiles = ["service-worker.js"]; // code de l'app (hors vendor/)
const vendorFiles = [];

// Adresse racine de l'app (portée du manifeste) : ouverte telle quelle.
load("./", "racine de l'app (scope du manifeste)");

const html = read("index.html");
const queue = [];
for (const [, attr, url] of html.matchAll(/\b(src|href)="([^"]+)"/g)) {
  if (/^(?:[a-z]+:|#)/i.test(url)) continue;
  load(posix.normalize(url), `index.html (${attr})`);
  if (url.endsWith(".js")) queue.push(posix.normalize(url));
}

const seen = new Set();
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  (file.startsWith("vendor/") ? vendorFiles : ownFiles).push(file);
  const text = file.startsWith("vendor/") ? read(file) : code(read(file));
  for (const [, spec] of text.matchAll(IMPORT)) {
    if (!spec.startsWith(".")) continue;
    load(resolve(file, spec), `import dans ${file}`);
    queue.push(resolve(file, spec));
  }
}

// Le service worker, sans sa propre liste (sinon la comparaison serait vide de sens).
const swSource = read("service-worker.js");
const assetsBlock = swSource.match(/const ASSETS = \[([\s\S]*?)\];/);
const ownCode = (file) => code(file !== "service-worker.js" ? read(file)
  : swSource.replace(assetsBlock[0], (block) => block.replace(/[^\n]/g, "")));

for (const file of ownFiles) {
  for (const [, path] of ownCode(file).matchAll(LITERAL_PATH)) {
    const target = resolve(file, path);
    if (!NOT_LOADED[target]) load(target, `chemin écrit dans ${file}`);
  }
}

for (const [, url] of read("style.css").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
  if (!url.startsWith("data:")) load(resolve("style.css", url), "style.css");
}

const manifest = JSON.parse(read("manifest.json"));
load(posix.normalize(manifest.start_url), "manifest.json (start_url)");
for (const icon of manifest.icons) load(posix.normalize(icon.src), "manifest.json (icons)");

// --- La liste ASSETS --------------------------------------------------------

const assets = [...assetsBlock[1].matchAll(/["']([^"']+)["']/g)].map(([, entry]) => entry);
const listed = new Set(assets.map((entry) => posix.normalize(entry)));

// --- Vérifications -----------------------------------------------------------

test("every file the app loads is listed in ASSETS", () => {
  const missing = [...loaded].filter(([file]) => !listed.has(file)).map(([file, by]) => `${file} (${by})`);
  assert.deepEqual(missing, [], `Chargés par l'app mais absents d'ASSETS (service-worker.js) — à ajouter, avec CACHE_VERSION +1 :\n  ${missing.join("\n  ")}`);
});

test("ASSETS lists nothing the app does not load", () => {
  const extra = [...listed].filter((file) => !loaded.has(file));
  assert.deepEqual(extra, [], `Dans ASSETS mais chargés par rien — à retirer (ou le chargement n'est pas vu par ce test) :\n  ${extra.join("\n  ")}`);
});

test("every ASSETS entry exists on disk", () => {
  const absent = [...listed].filter((file) => file !== "./" && !exists(file));
  assert.deepEqual(absent, [], `Dans ASSETS mais introuvables : l'installation hors-ligne échouerait en entier :\n  ${absent.join("\n  ")}`);
});

test("ASSETS has no duplicate", () => {
  const dupes = assets.filter((entry, i) => assets.findIndex((e) => posix.normalize(e) === posix.normalize(entry)) !== i);
  assert.deepEqual(dupes, [], `En double dans ASSETS :\n  ${dupes.join("\n  ")}`);
});

test("no file path is built at run time (this test could not follow it)", () => {
  const found = [];
  for (const file of ownFiles) {
    for (const { line, snippet } of dynamicPathsIn(ownCode(file))) {
      if (!EXCEPTIONS[file]?.[snippet]) found.push(`${file}:${line}  ${snippet}`);
    }
  }
  // vendor/ : figé, vérifié à chaque mise à jour (vendor/README.md) ; seuls les
  // imports dynamiques y sont cherchés, ses gabarits n'étant pas des chemins.
  for (const file of vendorFiles) {
    for (const m of read(file).matchAll(/\bimport\s*\(\s*(?!["'][^"'`$]*["']\s*\))/g)) found.push(`${file}:${lineOf(read(file), m.index)}  import dynamique`);
  }
  assert.deepEqual(found, [], `Chemin de fichier construit pendant l'exécution : ce test ne peut pas vérifier qu'il est dans ASSETS. Écris le chemin en entier (comme dans dayScenes.js), ou ajoute une exception justifiée dans assets.test.js :\n  ${found.join("\n  ")}`);
});

test("the exceptions still exist", () => {
  for (const [file, snippets] of Object.entries(EXCEPTIONS)) {
    for (const snippet of Object.keys(snippets)) assert.ok(read(file).includes(snippet), `${file} › ${snippet}`);
  }
  for (const file of Object.keys(NOT_LOADED)) assert.ok(exists(file), file);
});

test("the built-path check does catch built paths, and only those", () => {
  const built = [
    "img.src = `illustrations/${day}.png`;",
    "img.src = \"icons/icon-\" + size + \".png\";",
    "img.src = folder + \"/lundi.png\";",
    "const m = await import(name);",
    "const m = await import(`./${name}.js`);",
  ];
  for (const sample of built) assert.ok(dynamicPathsIn(sample).length > 0, sample);
  const fine = [
    "const t = `Il y a ${days} jours`;",
    "const url = `${SUPABASE_URL}/rest/v1/`;",
    "img.src = \"illustrations/lundi.png\";",
    "import { a } from \"./a.js\";",
    "const total = count + \" tâches\";",
  ];
  for (const sample of fine) assert.deepEqual(dynamicPathsIn(sample), [], sample);
});
