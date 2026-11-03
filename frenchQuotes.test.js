import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Textes affichés avec des guillemets français : espace insécable (U+00A0)
// à l'intérieur de « … », jamais une espace ordinaire. Sinon le navigateur
// peut couper la ligne juste après « ou juste avant », et laisser le
// guillemet seul. On relit le code de l'app (fichiers JS et HTML de ASSETS),
// sans les commentaires, où les espaces ordinaires restent permises.

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const assets = [...read("service-worker.js").matchAll(/"\.\/([\w./-]+\.(?:m?js|html))"/g)]
  .map((m) => m[1])
  .filter((file) => !file.startsWith("vendor/"));

const withoutComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""))
  .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""))
  .split("\n")
  .map((line) => (line.trim().startsWith("//") ? "" : line.replace(/\s\/\/\s.*$/, "")));

test("app code: no ordinary space just inside « … »", () => {
  assert.ok(assets.includes("app.js") && assets.includes("repriseLogic.js"), "ASSETS doit être lu");
  const offending = [];
  for (const file of assets) {
    withoutComments(read(file)).forEach((line, i) => {
      if (/« | »/.test(line)) offending.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offending, []);
});
