import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previousDateString, daysBetween, localNoonIso, isPendingReprise, pendingReprise,
  sendsToUnsorted, pastWeekNote, PAST_WEEK_NOTE, recoverChanges, validateChanges, undoChanges, applyChanges, changeToMutation, writeChangesInOrder,
  introSentence, counterLabel, ageLabel, bannerTitle, bannerSubtitle, confirmationLabel, quotedBox, recapSummary,
  yesterdayQuestions, habitQuestion, habitConfirmation, screenIntro,
} from "./repriseLogic.js";
import { applyMutation } from "./syncLogic.js";
import { localDateString } from "./localDate.js";

const PARIS = "Europe/Paris";
const TODAY = "2026-10-22"; // heure d'été à Paris (UTC+2)

function task(overrides = {}) {
  return {
    id: "t1", text: "Recontacter Pierre", important: true, done: false,
    reminder_time: null, completed_at: null, last_triaged_on: null,
    created_at: "2026-10-20T08:00:00Z", ...overrides,
  };
}

test("dates: previous day and day differences cross month and year", () => {
  assert.equal(previousDateString("2026-03-01"), "2026-02-28");
  assert.equal(previousDateString("2026-01-01"), "2025-12-31");
  assert.equal(daysBetween("2026-10-20", "2026-10-22"), 2);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // nuit du changement d'heure au milieu
});

test("a task created today at 00:30 local time is excluded", () => {
  // 00:30 à Paris le 22 = 22:30 UTC le 21
  assert.equal(isPendingReprise(task({ created_at: "2026-10-21T22:30:00Z" }), TODAY, PARIS), false);
});

test("a task created yesterday at 23:50 local time is included", () => {
  // 23:50 à Paris le 21 = 21:50 UTC le 21
  assert.equal(isPendingReprise(task({ created_at: "2026-10-21T21:50:00Z" }), TODAY, PARIS), true);
});

test("done tasks and unsorted tasks (important = null) are excluded", () => {
  assert.equal(isPendingReprise(task({ done: true }), TODAY, PARIS), false);
  assert.equal(isPendingReprise(task({ important: null }), TODAY, PARIS), false);
  assert.equal(isPendingReprise(task({ important: false }), TODAY, PARIS), true);
});

test("last_triaged_on: today excluded, yesterday included, missing treated as never", () => {
  assert.equal(isPendingReprise(task({ last_triaged_on: TODAY }), TODAY, PARIS), false);
  assert.equal(isPendingReprise(task({ last_triaged_on: "2026-10-21" }), TODAY, PARIS), true);
  const offline = task();
  delete offline.last_triaged_on;
  assert.equal(isPendingReprise(offline, TODAY, PARIS), true);
});

test("the local date depends on the time zone, not on UTC", () => {
  // 11:30 UTC le 21 = 00:30 le 22 à Auckland (UTC+13)
  const t = task({ created_at: "2026-10-21T11:30:00Z" });
  assert.equal(isPendingReprise(t, "2026-10-22", "Pacific/Auckland"), false);
  assert.equal(isPendingReprise(t, "2026-10-22", PARIS), true);
});

test("daylight saving change: 23:30 the evening before still counts as yesterday", () => {
  // Passage à l'heure d'été le 29 mars 2026 ; 23:30 le 28 à Paris = 22:30 UTC
  const spring = task({ created_at: "2026-03-28T22:30:00Z" });
  assert.equal(isPendingReprise(spring, "2026-03-29", PARIS), true);
  assert.equal(ageLabel(spring, "2026-03-29", PARIS), "Hier");
  // Retour à l'heure d'hiver le 25 oct. 2026 ; 23:30 le 24 à Paris = 21:30 UTC
  const autumn = task({ created_at: "2026-10-24T21:30:00Z" });
  assert.equal(isPendingReprise(autumn, "2026-10-25", PARIS), true);
  assert.equal(ageLabel(autumn, "2026-10-25", PARIS), "Hier");
});

test("pendingReprise sorts oldest first, Important before Autres the same day, and skips excluded ids", () => {
  const tasks = [
    task({ id: "a", important: false, created_at: "2026-10-21T07:00:00Z" }),
    task({ id: "b", important: true, created_at: "2026-10-21T09:00:00Z" }),
    task({ id: "c", important: false, created_at: "2026-10-18T07:00:00Z" }),
    task({ id: "d", important: null, created_at: "2026-10-18T07:00:00Z" }),
    task({ id: "e", created_at: "2026-10-22T07:00:00Z" }),
  ];
  assert.deepEqual(pendingReprise(tasks, TODAY, PARIS).map((t) => t.id), ["c", "b", "a"]);
  assert.deepEqual(pendingReprise(tasks, TODAY, PARIS, new Set(["b"])).map((t) => t.id), ["c", "a"]);
});

test("local noon is right on both daylight saving days", () => {
  assert.equal(localNoonIso("2026-03-28", PARIS), "2026-03-28T11:00:00.000Z"); // UTC+1
  assert.equal(localNoonIso("2026-03-29", PARIS), "2026-03-29T10:00:00.000Z"); // jour du changement, UTC+2
  assert.equal(localNoonIso("2026-10-25", PARIS), "2026-10-25T11:00:00.000Z"); // jour du retour, UTC+1
  assert.equal(localNoonIso("2026-10-21", "Pacific/Auckland"), "2026-10-20T23:00:00.000Z"); // UTC+13
});

test("Recover clears the reminder first, then sets last_triaged_on to today", () => {
  assert.deepEqual(recoverChanges(task(), TODAY, PARIS), [{ reminder_time: null }, { last_triaged_on: TODAY }]);
  const after = applyChanges(task({ reminder_time: "09:30:00" }), recoverChanges(task(), TODAY, PARIS));
  assert.equal(after.reminder_time, null);
  assert.equal(isPendingReprise(after, TODAY, PARIS), false);
  assert.equal(isPendingReprise(after, "2026-10-23", PARIS), true); // reproposée demain
});

test("Validate writes completed_at (yesterday noon, local) before done = true", () => {
  const changes = validateChanges(TODAY, PARIS);
  assert.deepEqual(changes, [{ completed_at: "2026-10-21T10:00:00.000Z" }, { done: true }]);
  assert.equal(localDateString(new Date(changes[0].completed_at), PARIS), "2026-10-21");
  // Le lendemain du retour à l'heure d'hiver : midi du 25 = 11:00 UTC
  assert.equal(validateChanges("2026-10-26", PARIS)[0].completed_at, "2026-10-25T11:00:00.000Z");
});

test("Undo restores the task exactly, reminder included, in reverse order", () => {
  const before = task({ reminder_time: "18:15:00", last_triaged_on: "2026-10-20" });
  for (const changes of [recoverChanges(before, TODAY, PARIS), validateChanges(TODAY, PARIS)]) {
    const undo = undoChanges(before, changes);
    assert.deepEqual(undo.map(Object.keys), changes.map(Object.keys).reverse());
    assert.deepEqual(applyChanges(applyChanges(before, changes), undo), before);
  }
});

test("offline: action then undo, replayed from the queue, gives back the original task", async () => {
  const before = task({ reminder_time: "07:45:00" });
  const queue = [];
  const deps = {
    hasPending: async () => queue.length > 0,
    writeNow: async (id, step) => queue.push(changeToMutation(id, step)), // le réseau échoue : sync.js met en file
    enqueue: async (m) => queue.push(m),
  };
  for (const changes of [recoverChanges(before, TODAY, PARIS), validateChanges(TODAY, PARIS)]) {
    queue.length = 0;
    await writeChangesInOrder(before.id, changes, deps);
    await writeChangesInOrder(before.id, undoChanges(before, changes), deps);
    assert.equal(queue.length, changes.length * 2);
    assert.deepEqual(queue.reduce(applyMutation, [before]), [before]);
  }
});

test("once a write falls into the queue, the next ones are queued too (never overtake it)", async () => {
  const direct = [];
  const queued = [];
  let networkUp = false;
  const deps = {
    hasPending: async () => queued.length > 0,
    writeNow: async (id, step) => {
      if (networkUp) direct.push(...Object.keys(step)); else queued.push(changeToMutation(id, step));
      networkUp = true; // le réseau revient juste après la 1re écriture
    },
    enqueue: async (m) => queued.push(m),
  };
  await writeChangesInOrder("t1", validateChanges(TODAY, PARIS), deps);
  assert.deepEqual(direct, []);
  assert.deepEqual(queued.map((m) => m.tagName), ["completed_at", "done"]);
});

test("online with an empty queue, each change is written directly, in order", async () => {
  const direct = [];
  const deps = {
    hasPending: async () => false,
    writeNow: async (_id, step) => direct.push(...Object.keys(step)),
    enqueue: async () => assert.fail("nothing should be queued"),
  };
  await writeChangesInOrder("t1", recoverChanges(task(), TODAY, PARIS), deps);
  assert.deepEqual(direct, ["reminder_time", "last_triaged_on"]);
});

test("texts: singular / plural, counter, age, banner, confirmation, recap", () => {
  assert.equal(introSentence(1), "Une tâche n'a pas été terminée. Choisis ce que tu en fais.");
  assert.equal(introSentence(2), "Deux tâches n'ont pas été terminées. Choisis ce que tu en fais, une par une.");
  assert.equal(introSentence(12), "12 tâches n'ont pas été terminées. Choisis ce que tu en fais, une par une.");
  assert.equal(counterLabel(0, 3), "0 sur 3 triée");
  assert.equal(counterLabel(1, 3), "1 sur 3 triée");
  assert.equal(counterLabel(2, 3), "2 sur 3 triées");
  assert.equal(ageLabel(task({ created_at: "2026-10-21T08:00:00Z" }), TODAY, PARIS), "Hier");
  assert.equal(ageLabel(task({ created_at: "2026-10-19T08:00:00Z" }), TODAY, PARIS), "Il y a 3 jours");
  assert.equal(bannerTitle(1), "1 tâche à reprendre");
  assert.equal(bannerTitle(3), "3 tâches à reprendre");
  assert.equal(bannerSubtitle([task({ created_at: "2026-10-21T08:00:00Z" })], TODAY, PARIS), "Elle attend depuis hier");
  assert.equal(bannerSubtitle([task({ created_at: "2026-10-21T08:00:00Z" }), task({ created_at: "2026-10-19T08:00:00Z" })], TODAY, PARIS), "Elles attendent depuis 3 jours");
  assert.equal(confirmationLabel("recover", task({ important: false })), "Récupérée : retourne dans «\u00A0Autres\u00A0»");
  assert.equal(confirmationLabel("recover", task()), "Récupérée : retourne dans «\u00A0Important\u00A0»");
  assert.equal(confirmationLabel("validate", task()), "Validée : comptée pour hier");
  assert.equal(confirmationLabel("abandon", task()), "Abandonnée");
  assert.equal(recapSummary({ recover: 2, validate: 1 }), "2 récupérées · 1 validée");
  assert.equal(recapSummary({ abandon: 1 }), "1 abandonnée");
});

// --- Carte « Hier » : habitudes attendues hier, sans réponse ---

const SUNDAY = "2026-11-01";
const MONDAY = "2026-11-02";
const TUESDAY = "2026-11-03";

test("Hier: no daily_routines row at all (no checks) means no answer, so the card asks", () => {
  assert.deepEqual(yesterdayQuestions(MONDAY, undefined).map((q) => q.key), ["steps", "gym"]);
  assert.deepEqual(yesterdayQuestions(MONDAY, null).map((q) => q.key), ["steps", "gym"]);
  assert.deepEqual(yesterdayQuestions(MONDAY, {}).map((q) => q.key), ["steps", "gym"]);
});

test("Hier: steps always, gym only on an official day, with the day's session", () => {
  assert.deepEqual(yesterdayQuestions(SUNDAY, {}).map((q) => q.key), ["steps"]);
  assert.deepEqual(yesterdayQuestions(TUESDAY, {}).map((q) => q.key), ["steps"]);
  assert.equal(yesterdayQuestions(MONDAY, {})[1].session, "Haut du corps A");
});

test("Hier: a box already ticked, or already answered « Non » (false), is not asked again", () => {
  assert.deepEqual(yesterdayQuestions(MONDAY, { steps: true }).map((q) => q.key), ["gym"]);
  assert.deepEqual(yesterdayQuestions(MONDAY, { steps: false, gym: false }), []);
  assert.deepEqual(yesterdayQuestions(MONDAY, { gym: true }).map((q) => q.key), ["steps"]);
});

test("Hier: a skipped morning routine (skipped) does not stop the questions", () => {
  assert.deepEqual(yesterdayQuestions(MONDAY, { skipped: true, wake: false }).map((q) => q.key), ["steps", "gym"]);
});

test("Hier: yesterday is the LOCAL previous day, even just after midnight", () => {
  // 00:30 à Paris le 3 novembre = 23:30 UTC le 2 : hier = le 2, pas le 1er.
  const today = localDateString(new Date("2026-11-02T23:30:00Z"), PARIS);
  assert.equal(today, "2026-11-03");
  assert.equal(previousDateString(today), MONDAY);
});

test("Hier: texts", () => {
  const [steps, gym] = yesterdayQuestions(MONDAY, {});
  assert.equal(habitQuestion(steps), "Hier, 10 000 pas ?");
  assert.equal(habitQuestion(gym), "Hier, salle : Haut du corps A ?");
  assert.equal(habitConfirmation(true), "Noté : fait hier, bravo");
  assert.equal(habitConfirmation(false), "Noté. Aujourd'hui est un nouveau jour");
  assert.equal(screenIntro(0, 1), "Une petite question sur hier.");
  assert.equal(screenIntro(0, 2), "Deux petites questions sur hier.");
  assert.equal(screenIntro(2, 1), introSentence(2));
  assert.equal(recapSummary({ recover: 1, answer: 2 }), "1 récupérée · 2 réponses sur hier");
  assert.equal(recapSummary({ answer: 1 }), "1 réponse sur hier");
});

// --- Récupérer une tâche d'une semaine PASSÉE (bilanLogic.js, isFromPastWeek) ---
// Semaine du lundi 2 au dimanche 8 novembre 2026 (Paris en UTC+1).

const WED = "2026-11-04";
const MON = "2026-11-02";

function lastWeek(overrides = {}) {
  return task({
    id: "old", important: true, important_since: "2026-10-28", reminder_time: "08:00:00",
    last_triaged_on: "2026-10-29", created_at: "2026-10-27T08:00:00Z", ...overrides,
  });
}

test("past week, Important: Récupérer is ONE step sending it to À trier (all four fields at once)", () => {
  const before = lastWeek();
  assert.equal(sendsToUnsorted(before, WED, PARIS), true);
  const changes = recoverChanges(before, WED, PARIS);
  assert.deepEqual(changes, [{ important: null, important_since: null, reminder_time: null, last_triaged_on: WED }]);
  assert.deepEqual(changeToMutation("old", changes[0]), { type: "setFields", id: "old", fields: changes[0] });
  const after = applyChanges(before, changes);
  assert.equal(after.important, null);
  assert.equal(after.important_since, null);
  assert.equal(after.reminder_time, null);
  assert.equal(after.last_triaged_on, WED);
  assert.equal(after.created_at, before.created_at); // jamais modifié
  assert.equal(isPendingReprise(after, WED, PARIS), false);
  assert.equal(isPendingReprise(after, "2026-11-05", PARIS), false); // À trier : plus jamais « à reprendre »
});

test("past week, Important: Annuler restores EVERYTHING in one step, important = true and the old important_since included", () => {
  const before = lastWeek();
  const changes = recoverChanges(before, WED, PARIS);
  const undo = undoChanges(before, changes);
  assert.deepEqual(undo, [{ important: true, important_since: "2026-10-28", reminder_time: "08:00:00", last_triaged_on: "2026-10-29" }]);
  assert.deepEqual(applyChanges(applyChanges(before, changes), undo), before);
});

test("past week, Important, offline: Récupérer and Annuler are one setFields mutation each, replayed back to the original", async () => {
  const before = lastWeek();
  const queue = [];
  const deps = {
    hasPending: async () => queue.length > 0,
    writeNow: async (id, step) => queue.push(changeToMutation(id, step)),
    enqueue: async (m) => queue.push(m),
  };
  const changes = recoverChanges(before, WED, PARIS);
  await writeChangesInOrder(before.id, changes, deps);
  assert.equal(queue.length, 1);
  assert.equal(applyMutation([before], queue[0])[0].important, null);
  await writeChangesInOrder(before.id, undoChanges(before, changes), deps);
  assert.deepEqual(queue.map((m) => m.type), ["setFields", "setFields"]);
  assert.deepEqual(queue.reduce(applyMutation, [before]), [before]);
});

test("past week, Important, online: the grouped step is a single direct write", async () => {
  const calls = [];
  const deps = {
    hasPending: async () => false,
    writeNow: async (_id, step) => calls.push(step),
    enqueue: async () => assert.fail("nothing should be queued"),
  };
  await writeChangesInOrder("old", recoverChanges(lastWeek(), WED, PARIS), deps);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["important", "important_since", "last_triaged_on", "reminder_time"]);
});

test("past week, Autres: Récupérer keeps today's behaviour (back to Autres)", () => {
  const before = lastWeek({ important: false, important_since: null });
  assert.equal(sendsToUnsorted(before, WED, PARIS), false);
  assert.deepEqual(recoverChanges(before, WED, PARIS), [{ reminder_time: null }, { last_triaged_on: WED }]);
  assert.equal(applyChanges(before, recoverChanges(before, WED, PARIS)).important, false);
  assert.equal(confirmationLabel("recover", before, { toUnsorted: false }), "Récupérée : retourne dans «\u00A0Autres\u00A0»");
});

test("same week, Important: Récupérer keeps today's behaviour and important_since", () => {
  const before = lastWeek({ created_at: "2026-11-02T08:00:00Z", important_since: MON, last_triaged_on: null });
  assert.equal(sendsToUnsorted(before, WED, PARIS), false);
  const after = applyChanges(before, recoverChanges(before, WED, PARIS));
  assert.equal(after.important, true);
  assert.equal(after.important_since, MON);
});

test("born last week but already recovered this week: counts as this week, back to Important", () => {
  const before = lastWeek({ last_triaged_on: MON });
  assert.equal(sendsToUnsorted(before, WED, PARIS), false);
  assert.equal(pastWeekNote(before, WED, PARIS), null);
});

test("Monday's Récupérer: created Sunday 19:59 is from last week, Sunday 20:00 is not", () => {
  const at1959 = lastWeek({ created_at: "2026-11-01T18:59:00Z", last_triaged_on: null, important_since: "2026-11-01" });
  const at2000 = lastWeek({ created_at: "2026-11-01T19:00:00Z", last_triaged_on: null, important_since: "2026-11-01" });
  assert.equal(sendsToUnsorted(at1959, MON, PARIS), true);
  assert.equal(sendsToUnsorted(at2000, MON, PARIS), false);
  assert.equal(pastWeekNote(at1959, MON, PARIS), PAST_WEEK_NOTE);
  assert.equal(pastWeekNote(at2000, MON, PARIS), null);
  assert.equal(recoverChanges(at2000, MON, PARIS).length, 2);
});

test("note « Pas faite la semaine dernière »: any past-week task, whatever its age; none this week", () => {
  assert.equal(PAST_WEEK_NOTE, "Pas faite la semaine dernière");
  assert.equal(pastWeekNote(lastWeek(), WED, PARIS), PAST_WEEK_NOTE);
  assert.equal(pastWeekNote(lastWeek({ important: false }), WED, PARIS), PAST_WEEK_NOTE);
  assert.equal(pastWeekNote(lastWeek({ created_at: "2026-10-10T08:00:00Z", last_triaged_on: null }), WED, PARIS), PAST_WEEK_NOTE);
  assert.equal(pastWeekNote(task({ created_at: "2026-11-03T08:00:00Z" }), WED, PARIS), null);
});

test("confirmation: « Récupérée : elle va dans « À trier » » for a past-week Important task", () => {
  assert.equal(confirmationLabel("recover", lastWeek(), { toUnsorted: true }), "Récupérée : elle va dans «\u00A0À\u00A0trier\u00A0»");
  assert.equal(confirmationLabel("recover", lastWeek()), "Récupérée : retourne dans «\u00A0Important\u00A0»");
});

test("confirmation: no breakable space inside « … » nor inside the box name", () => {
  const labels = [
    confirmationLabel("recover", lastWeek(), { toUnsorted: true }),
    confirmationLabel("recover", task({ important: false })),
    confirmationLabel("recover", task()),
  ];
  assert.deepEqual(labels.map((l) => l.match(/«[^»]*»/)[0]), [
    "«\u00A0À\u00A0trier\u00A0»", "«\u00A0Autres\u00A0»", "«\u00A0Important\u00A0»",
  ]);
  for (const label of labels) assert.doesNotMatch(label.match(/«[^»]*»/)[0], / /, label);
  assert.equal(quotedBox("À trier"), "«\u00A0À\u00A0trier\u00A0»");
});
