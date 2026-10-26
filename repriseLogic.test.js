import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previousDateString, daysBetween, localNoonIso, isPendingReprise, pendingReprise,
  recoverChanges, validateChanges, undoChanges, applyChanges, changeToMutation, writeChangesInOrder,
  introSentence, counterLabel, ageLabel, bannerTitle, bannerSubtitle, confirmationLabel, recapSummary,
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
  assert.deepEqual(recoverChanges(TODAY), [["reminder_time", null], ["last_triaged_on", TODAY]]);
  const after = applyChanges(task({ reminder_time: "09:30:00" }), recoverChanges(TODAY));
  assert.equal(after.reminder_time, null);
  assert.equal(isPendingReprise(after, TODAY, PARIS), false);
  assert.equal(isPendingReprise(after, "2026-10-23", PARIS), true); // reproposée demain
});

test("Validate writes completed_at (yesterday noon, local) before done = true", () => {
  const changes = validateChanges(TODAY, PARIS);
  assert.deepEqual(changes, [["completed_at", "2026-10-21T10:00:00.000Z"], ["done", true]]);
  assert.equal(localDateString(new Date(changes[0][1]), PARIS), "2026-10-21");
  // Le lendemain du retour à l'heure d'hiver : midi du 25 = 11:00 UTC
  assert.equal(validateChanges("2026-10-26", PARIS)[0][1], "2026-10-25T11:00:00.000Z");
});

test("Undo restores the task exactly, reminder included, in reverse order", () => {
  const before = task({ reminder_time: "18:15:00", last_triaged_on: "2026-10-20" });
  for (const changes of [recoverChanges(TODAY), validateChanges(TODAY, PARIS)]) {
    const undo = undoChanges(before, changes);
    assert.deepEqual(undo.map(([f]) => f), changes.map(([f]) => f).reverse());
    assert.deepEqual(applyChanges(applyChanges(before, changes), undo), before);
  }
});

test("offline: action then undo, replayed from the queue, gives back the original task", async () => {
  const before = task({ reminder_time: "07:45:00" });
  const queue = [];
  const deps = {
    hasPending: async () => queue.length > 0,
    writeNow: async (id, field, value) => queue.push(changeToMutation(id, field, value)), // le réseau échoue : sync.js met en file
    enqueue: async (m) => queue.push(m),
  };
  for (const changes of [recoverChanges(TODAY), validateChanges(TODAY, PARIS)]) {
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
    writeNow: async (id, field, value) => {
      if (networkUp) direct.push(field); else queued.push(changeToMutation(id, field, value));
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
    writeNow: async (_id, field) => direct.push(field),
    enqueue: async () => assert.fail("nothing should be queued"),
  };
  await writeChangesInOrder("t1", recoverChanges(TODAY), deps);
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
  assert.equal(confirmationLabel("recover", task({ important: false })), "Récupérée : retourne dans « Autres »");
  assert.equal(confirmationLabel("recover", task()), "Récupérée : retourne dans « Important »");
  assert.equal(confirmationLabel("validate", task()), "Validée : comptée pour hier");
  assert.equal(confirmationLabel("abandon", task()), "Abandonnée");
  assert.equal(recapSummary({ recover: 2, validate: 1 }), "2 récupérées · 1 validée");
  assert.equal(recapSummary({ abandon: 1 }), "1 abandonnée");
});
