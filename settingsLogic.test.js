import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WEEKLY_REVIEW_TIME_MIN, WEEKLY_REVIEW_TIME_MAX, WEEKLY_REVIEW_TIME_DEFAULT, WEEKLY_REVIEW_TIME_ERROR,
  weeklyReviewTimeForInput, parseWeeklyReviewTime,
} from "./settingsLogic.js";
import { WEEKLY_REVIEW_SCHEDULE, WEEKLY_REVIEW_TIME_RANGE } from "./supabase/functions/send-reminders/reminderLogic.js";
import { WEEK_CLOSING_MINUTES } from "./bilanLogic.js";

test("bornes de l'app = bornes du serveur = bornes de la contrainte de la base", () => {
  assert.deepEqual([WEEKLY_REVIEW_TIME_MIN, WEEKLY_REVIEW_TIME_MAX], [WEEKLY_REVIEW_TIME_RANGE.min, WEEKLY_REVIEW_TIME_RANGE.max]);
  const migration = readFileSync(new URL("./supabase/migrations/0007_weekly_review_time.sql", import.meta.url), "utf8");
  const m = migration.match(/weekly_review_time between time '(\d\d:\d\d)' and time '(\d\d:\d\d)'/);
  assert.deepEqual([m[1], m[2]], [WEEKLY_REVIEW_TIME_MIN, WEEKLY_REVIEW_TIME_MAX]);
});

test("l'heure par défaut est celle du serveur et la fin de semaine de l'app", () => {
  assert.equal(WEEKLY_REVIEW_TIME_DEFAULT, WEEKLY_REVIEW_SCHEDULE.time);
  assert.equal(WEEKLY_REVIEW_TIME_DEFAULT, WEEKLY_REVIEW_TIME_MIN);
  const [h, m] = WEEKLY_REVIEW_TIME_DEFAULT.split(":").map(Number);
  assert.equal(h * 60 + m, WEEK_CLOSING_MINUTES);
});

test("le message d'erreur est celui validé", () => {
  assert.equal(WEEKLY_REVIEW_TIME_ERROR, "Choisis une heure entre 20:00 et 23:00. Rien n'a été enregistré.");
});

test("parseWeeklyReviewTime accepte 20:00 à 23:00, bornes comprises", () => {
  for (const [input, value] of [["20:00", "20:00"], ["20:01", "20:01"], ["21:30", "21:30"], ["22:55", "22:55"],
    ["23:00", "23:00"], ["23:00:00", "23:00"], ["21:30:15", "21:30:15"], [" 21:30 ", "21:30"]]) {
    assert.deepEqual(parseWeeklyReviewTime(input), { value }, input);
  }
});

test("parseWeeklyReviewTime refuse avant 20:00, après 23:00 et l'illisible, avec le message", () => {
  for (const input of ["19:59", "19:30", "00:00", "08:00", "23:01", "23:00:01", "23:59", "24:00", "20:60", "9:30", "21h30", "abc"]) {
    assert.deepEqual(parseWeeklyReviewTime(input), { error: WEEKLY_REVIEW_TIME_ERROR }, input);
  }
});

test("parseWeeklyReviewTime : champ vidé, NULL sans erreur (donc 20:00)", () => {
  for (const input of ["", "   ", undefined, null]) {
    assert.deepEqual(parseWeeklyReviewTime(input), { value: null });
  }
});

test("weeklyReviewTimeForInput : l'heure enregistrée, sinon 20:00", () => {
  assert.equal(weeklyReviewTimeForInput("21:30:00"), "21:30");
  assert.equal(weeklyReviewTimeForInput("23:00"), "23:00");
  assert.equal(weeklyReviewTimeForInput(null), "20:00");
  assert.equal(weeklyReviewTimeForInput(undefined), "20:00");
  assert.equal(weeklyReviewTimeForInput(""), "20:00");
});
