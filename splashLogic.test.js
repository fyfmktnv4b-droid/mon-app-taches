import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SPLASH_MS, SPLASH_TIMEOUT_MS, splashScreen, splashWakeInMs } from "./splashLogic.js";

test("while no auth event has arrived, the splash waits", () => {
  assert.equal(splashScreen(undefined, 0), "wait");
  assert.equal(splashScreen(undefined, 700), "wait");
  assert.equal(splashScreen(undefined, SPLASH_TIMEOUT_MS - 1), "wait");
});

test("the safety timeout hands over to the sign-in screen", () => {
  assert.equal(splashScreen(undefined, SPLASH_TIMEOUT_MS), "auth");
  assert.equal(splashScreen(undefined, 60000), "auth");
});

test("an instant answer still keeps the splash for the minimum time", () => {
  assert.equal(splashScreen("session", 0), "wait");
  assert.equal(splashScreen("none", MIN_SPLASH_MS - 1), "wait");
});

test("a session goes to the welcome screen, no session to sign-in", () => {
  assert.equal(splashScreen("session", MIN_SPLASH_MS), "welcome");
  assert.equal(splashScreen("session", 1500), "welcome");
  assert.equal(splashScreen("none", MIN_SPLASH_MS), "auth");
  assert.equal(splashScreen("none", 4000), "auth");
});

test("a slow answer is never delayed further", () => {
  assert.equal(splashScreen("session", 1500), "welcome");
  assert.equal(splashWakeInMs("session", 1500), null);
});

test("splashWakeInMs gives the time left before the next decision", () => {
  assert.equal(splashWakeInMs("session", 100), MIN_SPLASH_MS - 100);
  assert.equal(splashWakeInMs("none", 0), MIN_SPLASH_MS);
  assert.equal(splashWakeInMs(undefined, 0), SPLASH_TIMEOUT_MS);
  assert.equal(splashWakeInMs(undefined, 1200), SPLASH_TIMEOUT_MS - 1200);
  assert.equal(splashWakeInMs(undefined, SPLASH_TIMEOUT_MS), null);
});

test("the decision only moves forward: wait, then one final screen", () => {
  for (const event of [undefined, "session", "none"]) {
    let settled = false;
    for (let t = 0; t <= 10000; t += 50) {
      const screen = splashScreen(event, t);
      if (settled) assert.notEqual(screen, "wait", `${event} at ${t}`);
      if (screen !== "wait") settled = true;
    }
    assert.ok(settled);
  }
});
