import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServers } from "./fakeSupabase.js";

// Le faux Supabase et ses refus, testés avec de simples requêtes Node (sans Chrome).

function call(port, { host, method = "GET", path = "/", headers = {}, body }) {
  return new Promise((done, fail) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.on("error", fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function withServers(fn) {
  const fake = await startServers();
  try { await fn(fake); } finally { await fake.close(); }
}

test("a request for another host is refused and logged as ILLICITE", () => withServers(async (fake) => {
  const api = await call(fake.ports.api, { host: "example.com" });
  const app = await call(fake.ports.app, { host: "203.0.113.7" });
  assert.deepEqual([api.status, app.status], [403, 403]);
  assert.equal(fake.illicit(new Set()).length, 2);
}));

test("sign-in, then create and list a task as that user", () => withServers(async (fake) => {
  fake.seedUser({ email: "a@example.test", password: "pw" });
  const host = `x.supabase.co:${fake.ports.api}`;
  const bad = await call(fake.ports.api, { host, method: "POST", path: "/auth/v1/token?grant_type=password", body: { email: "a@example.test", password: "no" } });
  assert.equal(bad.status, 400);
  const login = await call(fake.ports.api, { host, method: "POST", path: "/auth/v1/token?grant_type=password", body: { email: "a@example.test", password: "pw" } });
  const token = JSON.parse(login.text).access_token;
  const auth = { authorization: `Bearer ${token}`, prefer: "return=representation" };
  await call(fake.ports.api, { host, method: "POST", path: "/rest/v1/tasks", headers: auth, body: [{ text: "une" }] });
  const list = await call(fake.ports.api, { host, path: "/rest/v1/tasks?select=*&order=created_at.asc", headers: auth });
  assert.deepEqual(JSON.parse(list.text).map((t) => t.text), ["une"]);
  const noToken = await call(fake.ports.api, { host, path: "/rest/v1/tasks" });
  assert.equal(noToken.status, 401);
}));

test("the failure modes hang or cut the connection", () => withServers(async (fake) => {
  const host = `x.supabase.co:${fake.ports.api}`;
  fake.setMode("down");
  await assert.rejects(call(fake.ports.api, { host, path: "/rest/v1/tasks" }));
  fake.setMode("hang");
  const outcome = await Promise.race([call(fake.ports.api, { host, path: "/rest/v1/tasks" }), new Promise((ok) => setTimeout(() => ok("silence"), 300))]);
  assert.equal(outcome, "silence");
}));
