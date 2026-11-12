import { test } from "node:test";
import assert from "node:assert/strict";
import { showAfterLoading, settlesWithin, LOADING_DELAY_MS, FLUSH_WAIT_MS } from "./screenSwap.js";

// Minuteurs factices : le temps n'avance que quand le test le dit.
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) {
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { pending.delete(id); t.fn(); }
      }
      await new Promise((ok) => setImmediate(ok));
    },
  };
}

// Un écran factice : la « lecture » se termine quand le test le décide.
function screen({ wanted = () => true, immediately = false } = {}) {
  const timers = fakeTimers();
  const log = [];
  let loadingVisible = false;
  let finish;
  const work = () => new Promise((ok, ko) => { finish = { ok, ko }; });
  const options = {
    wanted, immediately, timers,
    showLoading: () => { loadingVisible = true; log.push("Chargement…"); },
    stillLoading: () => loadingVisible,
    giveUp: () => { loadingVisible = false; log.push("abandon"); },
  };
  const draw = () => { loadingVisible = false; log.push("écran complet"); };
  return { timers, log, work, options, draw, finish: () => finish };
}

test("les délais : « Chargement… » à 300 ms, envoi attendu 2 s au plus", () => {
  assert.equal(LOADING_DELAY_MS, 300);
  assert.equal(FLUSH_WAIT_MS, 2000);
});

test("lecture rapide : jamais de « Chargement… », l'écran arrive en un coup", async () => {
  const s = screen();
  const done = showAfterLoading(async () => { await s.work(); s.draw(); return "dessiné"; }, s.options);
  await s.timers.advance(100);
  s.finish().ok();
  assert.equal(await done, "dessiné");
  await s.timers.advance(1000);
  assert.deepEqual(s.log, ["écran complet"]);
});

test("lecture lente : « Chargement… » une seule fois à 300 ms, puis l'écran complet", async () => {
  const s = screen();
  const done = showAfterLoading(async () => { await s.work(); s.draw(); }, s.options);
  await s.timers.advance(299);
  assert.deepEqual(s.log, []);
  await s.timers.advance(1);
  await s.timers.advance(2000);
  assert.deepEqual(s.log, ["Chargement…"]);
  s.finish().ok();
  await done;
  assert.deepEqual(s.log, ["Chargement…", "écran complet"]);
});

test("autre écran demandé pendant la lecture : ni « Chargement… », ni abandon", async () => {
  let current = true;
  const s = screen({ wanted: () => current });
  const done = showAfterLoading(async () => { await s.work(); if (current) s.draw(); }, s.options);
  await s.timers.advance(100);
  current = false;
  await s.timers.advance(500);
  s.finish().ok();
  await done;
  assert.deepEqual(s.log, []);
});

test("lecture en erreur après « Chargement… » : il ne reste pas, l'erreur remonte", async () => {
  const s = screen();
  const done = showAfterLoading(async () => { await s.work(); s.draw(); }, s.options);
  await s.timers.advance(400);
  s.finish().ko(new Error("réseau"));
  await assert.rejects(done, /réseau/);
  assert.deepEqual(s.log, ["Chargement…", "abandon"]);
});

test("rien d'autre à l'écran : « Chargement… » tout de suite, une seule fois", async () => {
  const s = screen({ immediately: true });
  const done = showAfterLoading(async () => { await s.work(); s.draw(); }, s.options);
  await s.timers.advance(1000);
  s.finish().ok();
  await done;
  assert.deepEqual(s.log, ["Chargement…", "écran complet"]);
});

test("settlesWithin : vrai si terminé à temps (même en erreur), faux sinon, sans rien annuler", async () => {
  const timers = fakeTimers();
  assert.equal(await settlesWithin(Promise.resolve(), 10, timers), true);
  assert.equal(await settlesWithin(Promise.reject(new Error("x")), 10, timers), true);
  let finished = false;
  let release;
  const slow = new Promise((ok) => { release = ok; }).then(() => { finished = true; });
  const waited = settlesWithin(slow, 2000, timers);
  await timers.advance(2000);
  assert.equal(await waited, false);
  release();
  await slow;
  assert.equal(finished, true, "la promesse a continué après le délai");
});
