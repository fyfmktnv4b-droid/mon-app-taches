import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localDateString, deviceTimeZone, localMinutesOfDay, noReminderTimeLeft, reminderTimeProblem, defaultReminderTime,
  REMINDER_PAST_MESSAGE, REMINDER_NO_TIME_LEFT_MESSAGE, REMINDER_INVALID_MESSAGE,
} from "./localDate.js";

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

// --- Rappel d'une tâche : heures passées refusées ---------------------------
// Fuseau fixé (Paris, UTC+2 en octobre) : les tests ne dépendent pas du Mac.
const TZ = "Europe/Paris";
const at = (hhmmss) => new Date(`2026-10-20T${hhmmss}+02:00`);

test("localMinutesOfDay reads the local clock and ignores seconds", () => {
  assert.equal(localMinutesOfDay(at("14:30:45"), TZ), 14 * 60 + 30);
  assert.equal(localMinutesOfDay(at("00:00:00"), TZ), 0);
  assert.equal(localMinutesOfDay(new Date("2026-10-20T21:59:00Z"), TZ), 23 * 60 + 59);
});

test("a time already past is refused with a clear message", () => {
  assert.equal(reminderTimeProblem("09:00", at("14:30:00"), TZ), REMINDER_PAST_MESSAGE);
  assert.equal(reminderTimeProblem("14:29", at("14:30:00"), TZ), REMINDER_PAST_MESSAGE);
});

test("a future time is accepted", () => {
  assert.equal(reminderTimeProblem("18:00", at("14:30:00"), TZ), null);
  assert.equal(reminderTimeProblem("23:59", at("14:30:00"), TZ), null);
});

test("the limit is the minute: the current minute is refused, the next one accepted", () => {
  assert.equal(reminderTimeProblem("14:30", at("14:30:00"), TZ), REMINDER_PAST_MESSAGE);
  assert.equal(reminderTimeProblem("14:30", at("14:30:59"), TZ), REMINDER_PAST_MESSAGE);
  assert.equal(reminderTimeProblem("14:31", at("14:30:00"), TZ), null);
  assert.equal(reminderTimeProblem("14:31", at("14:30:59"), TZ), null);
  assert.equal(reminderTimeProblem("14:31", at("14:31:00"), TZ), REMINDER_PAST_MESSAGE);
});

test("midnight is always refused: 00:00 is tomorrow", () => {
  assert.equal(reminderTimeProblem("00:00", at("00:00:00"), TZ), REMINDER_PAST_MESSAGE);
  assert.equal(reminderTimeProblem("00:00", at("00:00:30"), TZ), REMINDER_PAST_MESSAGE);
  assert.equal(reminderTimeProblem("00:00", at("12:00:00"), TZ), REMINDER_PAST_MESSAGE);
  assert.equal(reminderTimeProblem("00:01", at("00:00:30"), TZ), null);
});

test("at the very end of the day nothing is possible and the message says so", () => {
  assert.equal(noReminderTimeLeft(at("23:58:59"), TZ), false);
  assert.equal(reminderTimeProblem("23:59", at("23:58:59"), TZ), null);
  assert.equal(noReminderTimeLeft(at("23:59:00"), TZ), true);
  assert.equal(reminderTimeProblem("23:59", at("23:59:10"), TZ), REMINDER_NO_TIME_LEFT_MESSAGE);
  assert.equal(reminderTimeProblem("00:00", at("23:59:10"), TZ), REMINDER_NO_TIME_LEFT_MESSAGE);
});

test("an empty or malformed value is refused without throwing", () => {
  for (const bad of ["", null, undefined, "9:00", "24:00", "12:60", "12:30:15", "abc"]) {
    assert.equal(reminderTimeProblem(bad, at("10:00:00"), TZ), REMINDER_INVALID_MESSAGE, String(bad));
  }
});

test("the check follows the device clock's timezone, not UTC", () => {
  // 21:30Z = 23:30 à Paris (UTC+2) mais 21:30 à UTC.
  const now = new Date("2026-10-20T21:30:00Z");
  assert.equal(reminderTimeProblem("22:00", now, "Europe/Paris"), REMINDER_PAST_MESSAGE);
  assert.equal(reminderTimeProblem("22:00", now, "UTC"), null);
});

test("defaultReminderTime proposes the next quarter hour, at least 5 minutes ahead", () => {
  assert.equal(defaultReminderTime(at("14:32:00"), TZ), "14:45");
  assert.equal(defaultReminderTime(at("14:40:00"), TZ), "14:45"); // exactement 5 min
  assert.equal(defaultReminderTime(at("14:41:00"), TZ), "15:00");
  assert.equal(defaultReminderTime(at("14:39:59"), TZ), "14:45");
  assert.equal(defaultReminderTime(at("00:00:00"), TZ), "00:15");
});

test("defaultReminderTime falls back to the next minute at the end of the day, then to null", () => {
  assert.equal(defaultReminderTime(at("23:30:00"), TZ), "23:45");
  assert.equal(defaultReminderTime(at("23:44:00"), TZ), "23:45");
  assert.equal(defaultReminderTime(at("23:50:00"), TZ), "23:51");
  assert.equal(defaultReminderTime(at("23:58:00"), TZ), "23:59");
  assert.equal(defaultReminderTime(at("23:59:00"), TZ), null);
});

test("the default is always accepted by the rule, minute after minute, all day", () => {
  for (let m = 0; m < 24 * 60; m++) {
    const now = new Date(Date.UTC(2026, 9, 20, 0, 0) + m * 60000 - 2 * 3600000); // m-ième minute à Paris
    const value = defaultReminderTime(now, TZ);
    if (m >= 23 * 60 + 59) { assert.equal(value, null, `m=${m}`); continue; }
    assert.equal(reminderTimeProblem(value, now, TZ), null, `m=${m} default=${value}`);
  }
});
