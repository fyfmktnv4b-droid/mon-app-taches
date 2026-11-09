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

test("set_routine_check refuses an unknown key or a missing value, and accepts an explicit false", () => withServers(async (fake) => {
  fake.seedUser({ email: "a@example.test", password: "pw" });
  const host = `x.supabase.co:${fake.ports.api}`;
  const login = await call(fake.ports.api, { host, method: "POST", path: "/auth/v1/token?grant_type=password", body: { email: "a@example.test", password: "pw" } });
  const headers = { authorization: `Bearer ${JSON.parse(login.text).access_token}` };
  const rpc = (body) => call(fake.ports.api, { host, method: "POST", path: "/rest/v1/rpc/set_routine_check", headers, body });
  assert.equal((await rpc({ p_local_date: "2026-11-01", p_key: "nap", p_value: true })).status, 400);
  assert.equal((await rpc({ p_local_date: "2026-11-01", p_key: "steps", p_value: null })).status, 400);
  const ok = await rpc({ p_local_date: "2026-11-01", p_key: "steps", p_value: false });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.text).checks, { steps: false });
}));

test("gte / lte select an inclusive range of days, for the signed-in user only; other operators stay refused", () => withServers(async (fake) => {
  const me = fake.seedUser({ email: "a@example.test", password: "pw" });
  const other = fake.seedUser({ email: "b@example.test", password: "pw" });
  for (const local_date of ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-08", "2026-11-09"]) {
    fake.db.daily_routines.push({ user_id: me.id, local_date, checks: { steps: true } });
  }
  fake.db.daily_routines.push({ user_id: other.id, local_date: "2026-11-03", checks: { steps: true } });
  const host = `x.supabase.co:${fake.ports.api}`;
  const login = await call(fake.ports.api, { host, method: "POST", path: "/auth/v1/token?grant_type=password", body: { email: "a@example.test", password: "pw" } });
  const headers = { authorization: `Bearer ${JSON.parse(login.text).access_token}` };
  const week = await call(fake.ports.api, { host, headers, path: "/rest/v1/daily_routines?select=local_date,checks&local_date=gte.2026-11-02&local_date=lte.2026-11-08&order=local_date.asc" });
  assert.equal(week.status, 200);
  assert.deepEqual(JSON.parse(week.text).map((r) => r.local_date), ["2026-11-02", "2026-11-04", "2026-11-08"]);
  const refused = await call(fake.ports.api, { host, headers, path: "/rest/v1/daily_routines?local_date=gt.2026-11-02" });
  assert.notEqual(refused.status, 200);
  assert.equal(fake.unhandled().length, 1);
}));

test("user_settings.weekly_review_time: the fake refuses what the 0007 constraint refuses", () => withServers(async (fake) => {
  const me = fake.seedUser({ email: "a@example.test", password: "pw" });
  const host = `x.supabase.co:${fake.ports.api}`;
  const login = await call(fake.ports.api, { host, method: "POST", path: "/auth/v1/token?grant_type=password", body: { email: "a@example.test", password: "pw" } });
  const headers = { authorization: `Bearer ${JSON.parse(login.text).access_token}` };
  const row = () => fake.db.user_settings.find((r) => r.user_id === me.id);
  const patch = (body) => call(fake.ports.api, { host, method: "PATCH", path: `/rest/v1/user_settings?user_id=eq.${me.id}`, headers, body });
  assert.equal(row().weekly_review_time, null);
  for (const bad of ["19:59", "23:01", "23:00:01", "abc"]) {
    const r = await patch({ morning_reminder_time: "07:30", weekly_review_time: bad });
    assert.equal(r.status, 400, bad);
    assert.equal(JSON.parse(r.text).code, "23514");
  }
  assert.equal(row().morning_reminder_time, null, "rien n'est écrit quand la contrainte refuse");
  for (const good of ["20:00", "23:00", "21:30:00", null]) {
    assert.equal((await patch({ weekly_review_time: good })).status, 204, String(good));
    assert.equal(row().weekly_review_time, good);
  }
}));
