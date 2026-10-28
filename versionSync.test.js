import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "./version.js";

// Le service worker n'est pas importable en Node : on lit sa constante dans le texte.
const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
const cacheVersion = worker.match(/^const CACHE_VERSION = "([^"]+)";/m)?.[1];

test("APP_VERSION (version.js) equals CACHE_VERSION (service-worker.js)", () => {
  assert.ok(cacheVersion, "CACHE_VERSION not found in service-worker.js");
  assert.equal(APP_VERSION, cacheVersion, "bump version.js and service-worker.js together");
});
