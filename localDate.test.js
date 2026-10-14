import { test } from "node:test";
import assert from "node:assert/strict";
import { localDateString, deviceTimeZone } from "./localDate.js";

test("localDateString formats as YYYY-MM-DD", () => {
  assert.equal(localDateString(new Date("2026-10-13T12:00:00Z"), "Europe/Zurich"), "2026-10-13");
});

// Le bug que cette fonction existe pour éviter : à 00h30 heure locale, l'UTC
// est encore la veille, donc todayDateString() renverrait le mauvais jour.
test("localDateString returns the local day just after midnight, not the UTC day", () => {
  const justAfterMidnight = new Date("2026-10-14T00:30:00+02:00");
  assert.equal(justAfterMidnight.toISOString().slice(0, 10), "2026-10-13");
  assert.equal(localDateString(justAfterMidnight, "Europe/Zurich"), "2026-10-14");
});

test("localDateString returns the local day just before midnight, not the UTC day", () => {
  const justBeforeMidnight = new Date("2026-10-13T23:30:00-05:00");
  assert.equal(justBeforeMidnight.toISOString().slice(0, 10), "2026-10-14");
  assert.equal(localDateString(justBeforeMidnight, "America/Chicago"), "2026-10-13");
});

test("localDateString pads single-digit months and days", () => {
  assert.equal(localDateString(new Date("2026-01-05T12:00:00Z"), "Europe/Zurich"), "2026-01-05");
});

test("deviceTimeZone returns a usable IANA zone, with nothing hardcoded", () => {
  const zone = deviceTimeZone();
  assert.equal(typeof zone, "string");
  assert.ok(zone.length > 0);
  // Doit être acceptée par Intl — c'est tout ce qu'on exige : la valeur dépend
  // de la machine, donc on ne l'assertera jamais en dur.
  assert.doesNotThrow(() => localDateString(new Date(), zone));
});
