import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeCaches } from "./fakeCaches.js";
import { OPEN_REQUEST_CACHE, OPEN_REQUEST_KEY, OPEN_REQUEST_TTL_MS, takeOpenRequest } from "./openRequest.js";

const NOW = 1_800_000_000_000;

async function mailbox({ screen = "bilan", createdAt = NOW, raw } = {}) {
  const storage = fakeCaches();
  const cache = await storage.open(OPEN_REQUEST_CACHE);
  await cache.put(OPEN_REQUEST_KEY, new Response(raw ?? JSON.stringify({ screen, createdAt })));
  return { storage, cache };
}

test("takeOpenRequest : boîte vide, rien à ouvrir", async () => {
  assert.equal(await takeOpenRequest(fakeCaches(), NOW), false);
});

test("takeOpenRequest : une marque récente est prise, puis la boîte est vide", async () => {
  const { storage, cache } = await mailbox();
  assert.equal(await takeOpenRequest(storage, NOW), true);
  assert.equal(cache.entries.size, 0);
  assert.equal(await takeOpenRequest(storage, NOW), false);
});

test("takeOpenRequest : deux appels simultanés, un seul prend la marque", async () => {
  const { storage } = await mailbox();
  const results = await Promise.all([takeOpenRequest(storage, NOW), takeOpenRequest(storage, NOW)]);
  assert.deepEqual(results.sort(), [false, true]);
});

test("takeOpenRequest : valable juste avant les 10 minutes", async () => {
  assert.equal(OPEN_REQUEST_TTL_MS, 10 * 60 * 1000);
  const { storage } = await mailbox({ createdAt: NOW - OPEN_REQUEST_TTL_MS + 1 });
  assert.equal(await takeOpenRequest(storage, NOW), true);
});

test("takeOpenRequest : périmée à 10 minutes, ignorée et effacée", async () => {
  const { storage, cache } = await mailbox({ createdAt: NOW - OPEN_REQUEST_TTL_MS });
  assert.equal(await takeOpenRequest(storage, NOW), false);
  assert.equal(cache.entries.size, 0);
});

test("takeOpenRequest : une date dans le futur est ignorée", async () => {
  const { storage } = await mailbox({ createdAt: NOW + 60000 });
  assert.equal(await takeOpenRequest(storage, NOW), false);
});

test("takeOpenRequest : un autre écran est ignoré", async () => {
  const { storage } = await mailbox({ screen: "reglages" });
  assert.equal(await takeOpenRequest(storage, NOW), false);
});

test("takeOpenRequest : une marque illisible est ignorée et effacée", async () => {
  const { storage, cache } = await mailbox({ raw: "pas du json" });
  assert.equal(await takeOpenRequest(storage, NOW), false);
  assert.equal(cache.entries.size, 0);
});

test("takeOpenRequest : stockage absent ou en panne, l'app démarre normalement", async () => {
  assert.equal(await takeOpenRequest(null, NOW), false);
  const broken = { open: async () => { throw new Error("stockage indisponible"); } };
  assert.equal(await takeOpenRequest(broken, NOW), false);
});
