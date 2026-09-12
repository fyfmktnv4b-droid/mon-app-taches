import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, isDueNow } from "./reminderLogic.js";

test("localParts extracts local date and minutes-of-day for a given timezone", () => {
  // 2026-09-12T07:05:00Z is 09:05 in Europe/Paris (UTC+2 in September, DST).
  const now = new Date("2026-09-12T07:05:00Z");
  const { dateKey, minutesOfDay } = localParts("Europe/Paris", now);
  assert.equal(dateKey, "2026-09-12");
  assert.equal(minutesOfDay, 9 * 60 + 5);
});

test("localParts can roll the local date forward relative to UTC", () => {
  // 2026-09-12T23:30:00Z is already 2026-09-13T11:30 in Pacific/Auckland
  // (UTC+12 in September — NZ daylight saving doesn't start until late
  // September, so this is NZST, not NZDT).
  const now = new Date("2026-09-12T23:30:00Z");
  const { dateKey, minutesOfDay } = localParts("Pacific/Auckland", now);
  assert.equal(dateKey, "2026-09-13");
  assert.equal(minutesOfDay, 11 * 60 + 30);
});

test("isDueNow returns false for a null target (no reminder set)", () => {
  const now = new Date("2026-09-12T07:05:00Z");
  assert.equal(isDueNow(null, "Europe/Paris", now), false);
});

test("isDueNow returns true exactly at the target minute", () => {
  const now = new Date("2026-09-12T07:00:00Z"); // 09:00 Europe/Paris
  assert.equal(isDueNow("09:00", "Europe/Paris", now), true);
});

test("isDueNow returns true within the default 5-minute window after the target", () => {
  const now = new Date("2026-09-12T07:04:00Z"); // 09:04 Europe/Paris
  assert.equal(isDueNow("09:00", "Europe/Paris", now), true);
});

test("isDueNow returns false once the default window has passed", () => {
  const now = new Date("2026-09-12T07:05:00Z"); // 09:05 Europe/Paris, window is [0,5)
  assert.equal(isDueNow("09:00", "Europe/Paris", now), false);
});

test("isDueNow returns false before the target time (never fires early)", () => {
  const now = new Date("2026-09-12T06:59:00Z"); // 08:59 Europe/Paris
  assert.equal(isDueNow("09:00", "Europe/Paris", now), false);
});

test("isDueNow respects a custom windowMinutes", () => {
  const now = new Date("2026-09-12T07:08:00Z"); // 09:08 Europe/Paris
  assert.equal(isDueNow("09:00", "Europe/Paris", now, 10), true);
  assert.equal(isDueNow("09:00", "Europe/Paris", now, 5), false);
});
