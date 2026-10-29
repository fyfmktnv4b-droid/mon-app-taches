import { test } from "node:test";
import assert from "node:assert/strict";
import { isolationFlags, verdict } from "./isolation.js";

// Tests SANS Chrome du contrôle d'isolation : la logique du verdict et les
// drapeaux. Les tests avec Chrome sont dans isolation.chrome.test.js.

const good = () => ({
  supabase: { reached: true, host: "sonde-x.supabase.co:4000", seenByFake: true },
  external: [
    { fragment: "203.0.113.7", divertedToTrap: true, gotRealAnswer: false },
    { fragment: "example.com:443", divertedToTrap: true, gotRealAnswer: false },
  ],
  serviceWorkers: 0,
});
const failedPoints = (observed) => verdict(observed).points.filter((p) => !p.ok).map((p) => p.n);

test("verdict: all three points hold when the isolation is complete", () => {
  const result = verdict(good());
  assert.equal(result.ok, true);
  assert.deepEqual(result.points.map((p) => p.n), [1, 2, 3]);
});

test("verdict: point 1 fails when *.supabase.co does not reach the fake server", () => {
  assert.deepEqual(failedPoints({ ...good(), supabase: { reached: false, error: "TypeError: Failed to fetch" } }), [1]);
  assert.deepEqual(failedPoints({ ...good(), supabase: { ...good().supabase, seenByFake: false } }), [1]);
});

test("verdict: point 2 fails when an external probe gets a real answer or is not diverted", () => {
  const leak = good();
  leak.external[0].gotRealAnswer = true;
  assert.deepEqual(failedPoints(leak), [2]);
  const lost = good();
  lost.external[1].divertedToTrap = false;
  assert.deepEqual(failedPoints(lost), [2]);
});

test("verdict: point 2 cannot pass without any probe", () => {
  assert.deepEqual(failedPoints({ ...good(), external: [] }), [2]);
});

test("verdict: point 3 fails as soon as one service worker is registered", () => {
  assert.deepEqual(failedPoints({ ...good(), serviceWorkers: 1 }), [3]);
});

test("flags: resolver, trap proxy and bypass list are all present", () => {
  const flags = isolationFlags({ trapPort: 5555 }).join(" ");
  assert.match(flags, /--host-resolver-rules=MAP \*\.supabase\.co 127\.0\.0\.1, MAP \* ~NOTFOUND, EXCLUDE 127\.0\.0\.1, EXCLUDE localhost/);
  assert.match(flags, /--proxy-server=http:\/\/127\.0\.0\.1:5555/);
  assert.match(flags, /--proxy-bypass-list=127\.0\.0\.1;localhost;\*\.supabase\.co/);
});

test("flags: without the Supabase mapping, only that rule disappears", () => {
  const flags = isolationFlags({ trapPort: 5555, mapSupabase: false }).join(" ");
  assert.doesNotMatch(flags, /MAP \*\.supabase\.co/);
  assert.match(flags, /MAP \* ~NOTFOUND/);
  assert.match(flags, /--proxy-server=/);
});
