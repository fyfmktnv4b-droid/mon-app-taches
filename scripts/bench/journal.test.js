import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { journalSummary } from "./bench.js";
import { startServers } from "./fakeSupabase.js";

// Le tri « page » / « Chrome » du journal, sans Chrome : on joue le rôle du
// navigateur en envoyant au piège ce que le proxy recevrait.

const viaTrap = (fake, url) => new Promise((done, fail) => {
  const { host } = new URL(url);
  http.get({ host: "127.0.0.1", port: fake.ports.piege, path: url, headers: { host } }, (res) => { res.resume(); res.on("end", done); }).on("error", fail);
});

async function withFake(fn) {
  const fake = await startServers();
  try { await fn(fake); } finally { await fake.close(); }
}

test("a request the PAGE made to an external host fails the bench", () => withFake(async (fake) => {
  await viaTrap(fake, "http://198.51.100.9/collecte");
  const summary = journalSummary(fake, new Set(["198.51.100.9"])); // la page a demandé cet hôte
  assert.equal(summary.illicit.length, 1);
  assert.equal(summary.failed, true);
}));

test("the same request not made by the page is counted as Chrome's own and does not fail", () => withFake(async (fake) => {
  await viaTrap(fake, "http://198.51.100.9/collecte");
  const summary = journalSummary(fake, new Set());
  assert.equal(summary.illicit.length, 0);
  assert.equal(summary.browserOwn.length, 1);
  assert.equal(summary.failed, false);
}));

test("a deliberate probe of the isolation check never fails the bench", () => withFake(async (fake) => {
  fake.expectProbe("203.0.113.7");
  await viaTrap(fake, "http://203.0.113.7/__sonde");
  const summary = journalSummary(fake, new Set(["203.0.113.7"]));
  assert.deepEqual([summary.illicit.length, summary.browserOwn.length, summary.wanted.length, summary.failed], [0, 0, 1, false]);
}));

test("a wrong Host sent to the app or fake server fails the bench whoever sent it", () => withFake(async (fake) => {
  await new Promise((done) => http.get({ host: "127.0.0.1", port: fake.ports.api, headers: { host: "example.org" } }, (res) => { res.resume(); res.on("end", done); }));
  assert.equal(journalSummary(fake, new Set()).failed, true);
}));
