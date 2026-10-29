// Copie de l'app dans un dossier temporaire HORS du dépôt, avec l'adresse
// Supabase et la CSP réécrites vers le faux serveur. Le service worker n'est
// pas copié : le banc ne teste ni le cache ni le hors-ligne du navigateur.
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIRS = ["fonts", "icons", "illustrations", "vendor"];
const TEXT_ROOT_FILES = (name) => /\.(js|html|css|json)$/.test(name)
  && !name.endsWith(".test.js") && name !== "service-worker.js" && name !== "fakeIndexedDB.js";

// Le projet est lu dans supabaseClient.js : aucune adresse n'est dupliquée ici.
export function projectRef(clientSource) {
  const ref = clientSource.match(/SUPABASE_URL = "https:\/\/([a-z0-9]+)\.supabase\.co"/)?.[1];
  if (!ref) throw new Error("supabaseClient.js : SUPABASE_URL introuvable, le banc ne sait plus quoi réécrire.");
  return ref;
}

export function rewrite(text, ref, apiPort) {
  return text
    .replaceAll(`https://${ref}.supabase.co`, `http://${ref}.supabase.co:${apiPort}`)
    .replaceAll(`wss://${ref}.supabase.co`, `ws://${ref}.supabase.co:${apiPort}`);
}

// Il ne doit rester AUCUNE adresse du vrai projet dans la copie.
export function leftovers(text, ref, apiPort) {
  return [...text.matchAll(new RegExp(`(?:https|wss)://${ref}\\.supabase\\.co|${ref}\\.supabase\\.co(?!:${apiPort})`, "g"))].map((m) => m[0]);
}

export async function prepareAppCopy({ apiPort, repoRoot = REPO_ROOT }) {
  const ref = projectRef(await readFile(join(repoRoot, "supabaseClient.js"), "utf8"));
  const dir = await mkdtemp(join(tmpdir(), "bench-app-"));
  const found = [];

  for (const name of (await readdir(repoRoot)).filter(TEXT_ROOT_FILES)) {
    const text = rewrite(await readFile(join(repoRoot, name), "utf8"), ref, apiPort);
    for (const bad of leftovers(text, ref, apiPort)) found.push(`${name}: ${bad}`);
    await writeFile(join(dir, name), text);
  }
  for (const sub of DIRS) await cp(join(repoRoot, sub), join(dir, sub), { recursive: true });

  // vendor/ est copié tel quel : on vérifie seulement qu'il ne vise pas le vrai projet.
  for (const name of await readdir(join(dir, "vendor"))) {
    for (const bad of leftovers(await readFile(join(dir, "vendor", name), "utf8"), ref, apiPort)) found.push(`vendor/${name}: ${bad}`);
  }
  if (found.length > 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`La copie contient encore l'adresse du vrai projet :\n  ${found.join("\n  ")}`);
  }

  return { dir, ref, apiOrigin: `http://${ref}.supabase.co:${apiPort}`, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
