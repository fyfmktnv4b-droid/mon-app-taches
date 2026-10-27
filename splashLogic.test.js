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

// --- Mode hors-ligne (repère « dernier utilisateur connecté ») ---

const MARKER = { hasMarker: true, online: true };
const AIRPLANE = { hasMarker: true, online: false };

test("without options the decisions are exactly the previous ones", () => {
  for (const event of [undefined, "session", "none"]) {
    for (const t of [0, 999, 1000, 4999, 5000, 9000]) {
      assert.equal(splashScreen(event, t), splashScreen(event, t, { hasMarker: false, online: true }), `${event} ${t}`);
    }
  }
});

test("a network failure opens the offline mode only with a marker", () => {
  assert.equal(splashScreen("network", MIN_SPLASH_MS, MARKER), "offline");
  assert.equal(splashScreen("network", MIN_SPLASH_MS - 1, MARKER), "wait");
  assert.equal(splashScreen("network", MIN_SPLASH_MS, { hasMarker: false }), "auth");
});

test("a refusal or no session never opens the offline mode, even with a marker", () => {
  assert.equal(splashScreen("none", MIN_SPLASH_MS, MARKER), "auth");
  assert.equal(splashScreen("none", 4000, AIRPLANE), "auth");
});

test("a session wins over the marker", () => {
  assert.equal(splashScreen("session", MIN_SPLASH_MS, AIRPLANE), "welcome");
});

test("no answer after 5 s with a marker: provisional offline mode", () => {
  assert.equal(splashScreen(undefined, SPLASH_TIMEOUT_MS - 1, MARKER), "wait");
  assert.equal(splashScreen(undefined, SPLASH_TIMEOUT_MS, MARKER), "offline");
  assert.equal(splashScreen(undefined, SPLASH_TIMEOUT_MS, { hasMarker: false }), "auth");
});

test("airplane mode with a marker does not wait for the 5 s timeout", () => {
  assert.equal(splashScreen(undefined, MIN_SPLASH_MS - 1, AIRPLANE), "wait");
  assert.equal(splashScreen(undefined, MIN_SPLASH_MS, AIRPLANE), "offline");
  assert.equal(splashScreen(undefined, MIN_SPLASH_MS, { hasMarker: false, online: false }), "wait");
});

test("splashWakeInMs follows the offline deadlines", () => {
  assert.equal(splashWakeInMs(undefined, 200, AIRPLANE), MIN_SPLASH_MS - 200);
  assert.equal(splashWakeInMs(undefined, 200, MARKER), SPLASH_TIMEOUT_MS - 200);
  assert.equal(splashWakeInMs("network", 300, MARKER), MIN_SPLASH_MS - 300);
  assert.equal(splashWakeInMs(undefined, MIN_SPLASH_MS, AIRPLANE), null);
  assert.equal(splashWakeInMs("network", MIN_SPLASH_MS, MARKER), null);
});

test("with every option the decision still only moves forward", () => {
  const options = [{}, MARKER, AIRPLANE, { hasMarker: false, online: false }];
  for (const opts of options) {
    for (const event of [undefined, "session", "none", "network"]) {
      let settled = null;
      for (let t = 0; t <= 10000; t += 50) {
        const screen = splashScreen(event, t, opts);
        if (settled) assert.equal(screen, settled, `${event} ${JSON.stringify(opts)} at ${t}`);
        if (screen !== "wait") settled = screen;
        const wake = splashWakeInMs(event, t, opts);
        if (screen === "wait") assert.ok(wake > 0 && splashScreen(event, t + wake, opts) !== "wait", `${event} ${t}`);
      }
      assert.ok(settled);
    }
  }
});
