import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startBench } from "./bench.js";
import { findChrome } from "./chrome.js";
import { runIsolationCheck } from "./isolation.js";

// Tests AVEC Chrome du contrôle d'isolation. Ils ne tournent que sur demande :
//   BENCH_CHROME=1 node --test scripts/bench/isolation.chrome.test.js
// et sont ignorés si Chrome est absent. Les isolations retirées ici sont celles
// qui ne font rien sortir (le piège et la résolution « introuvable » restent) ;
// la sonde 2 est testée en logique pure (isolation.test.js).
const skip = !process.env.BENCH_CHROME ? "lancer avec BENCH_CHROME=1 pour tester avec Chrome"
  : !findChrome() ? "Chrome introuvable" : false;

async function check(options) {
  const bench = await startBench(options);
  try {
    return await runIsolationCheck({ page: bench.page, fake: bench.fake });
  } finally {
    await bench.close();
  }
}
const failed = (report) => report.points.filter((p) => !p.ok).map((p) => p.n);

test("with the full isolation, the check passes", { skip }, async () => {
  const report = await check();
  assert.deepEqual(failed(report), [], report.text);
});

test("without the *.supabase.co mapping, point 1 fails", { skip }, async () => {
  const report = await check({ mapSupabase: false });
  assert.deepEqual(failed(report), [1], report.text);
});

test("with a service worker in the copy, point 3 fails", { skip }, async () => {
  const report = await check({ copyHook: (dir) => writeFile(join(dir, "service-worker.js"), "self.addEventListener('fetch', () => {});") });
  assert.deepEqual(failed(report), [3], report.text);
});
