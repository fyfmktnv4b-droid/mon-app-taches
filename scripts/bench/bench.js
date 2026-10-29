// Commande unique du banc :  node scripts/bench/bench.js
// Prépare la copie de l'app, lance les serveurs locaux et Chrome isolé,
// PROUVE l'isolation, puis exécute les scénarios de scenarios/*.js.
// Si l'isolation n'est pas prouvée, aucun scénario n'est exécuté.
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareAppCopy } from "./appCopy.js";
import { launchChrome } from "./chrome.js";
import { hostnameOf, startServers } from "./fakeSupabase.js";
import { IsolationError, runIsolationCheck } from "./isolation.js";

// Monte tout le banc ; `close()` arrête Chrome, les serveurs et efface les dossiers temporaires.
export async function startBench({ mapSupabase = true, copyHook } = {}) {
  const fake = await startServers();
  let copy, chrome;
  const close = async () => {
    await chrome?.close();
    await fake.close();
    await copy?.cleanup();
  };
  try {
    copy = await prepareAppCopy({ apiPort: fake.ports.api });
    await copyHook?.(copy.dir); // pour les tests : modifier la copie avant de servir
    fake.setAppDir(copy.dir);
    chrome = await launchChrome({ trapPort: fake.ports.piege, mapSupabase });
    const page = await chrome.newPage();
    return { fake, page, chrome, copy, close };
  } catch (err) {
    await close();
    throw err;
  }
}

async function main() {
  const bench = await startBench();
  const { fake, page } = bench;
  let failures = 0;
  try {
    const report = await runIsolationCheck({ page, fake });
    console.log(report.text);
    if (!report.ok) throw new IsolationError(report);

    const dir = fileURLToPath(new URL("./scenarios/", import.meta.url));
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".js")).sort()) {
      const scenario = await import(pathToFileURL(dir + file));
      console.log(`\nScénario : ${scenario.name}`);
      try {
        await scenario.run({ page, fake, appOrigin: fake.appOrigin, log: (line) => console.log(`  ${line}`) });
        console.log(`  → OK`);
      } catch (err) {
        failures++;
        console.log(`  → ÉCHEC : ${err.message}`);
        if (page.errors.length) console.log(`  erreurs JS de la page :\n    ${page.errors.join("\n    ")}`);
      }
    }

    const illicit = fake.illicit(page.requestedHosts);
    const browserOwn = fake.browserOwn(page.requestedHosts);
    console.log(`\nJournal : ${fake.entries.length} requêtes vues`);
    console.log(`  entrées ILLICITES (demandées par la page) hors sondes volontaires du contrôle : ${illicit.length}`);
    for (const e of illicit) console.log(`    ${e.server} ${e.method} ${e.target}`);
    console.log(`  tentatives propres à Chrome (non demandées par la page), refusées par le piège : ${browserOwn.length}`);
    for (const host of new Set(browserOwn.map((e) => hostnameOf(e.target)))) console.log(`    ${host}`);
    console.log(`  sondes volontaires du contrôle (refusées comme prévu) : ${fake.wantedIllicit().length}`);
    console.log(`  requêtes non gérées par le faux Supabase : ${fake.unhandled().length}`);
    for (const e of fake.unhandled()) console.log(`    ${e.target}`);
    if (illicit.length > 0) failures++;
  } catch (err) {
    console.error(err.message);
    failures++;
  } finally {
    await bench.close();
  }
  process.exitCode = failures > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
