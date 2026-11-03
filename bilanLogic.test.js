import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEEK_CLOSING_MINUTES, addDays, weekStart, weekDates, isClosingTime, createdDayForWeek, birthDate,
  isFromPastWeek, weekDayOf, weekSummary, barSegments, habitWeek, habitsWeek, missingPastDays,
  weekRangeLabel, titleLabel, othersDetail, notDoneLabel, habitCountLabel, barAriaLabel, endMessage,
} from "./bilanLogic.js";
import { DEFAULT_HABITS, habitByKey } from "./habits.js";
import { validateChanges, applyChanges } from "./repriseLogic.js";

const PARIS = "Europe/Paris";
// Semaine du lundi 2 au dimanche 8 novembre 2026 (Paris en UTC+1).
const MONDAY = "2026-11-02";
const WEDNESDAY = "2026-11-04";
const SUNDAY = "2026-11-08";
const LAST_SUNDAY = "2026-11-01";
const at = (iso) => new Date(iso);
const WEDNESDAY_NOON = at("2026-11-04T11:00:00Z");
const SUNDAY_2100 = at("2026-11-08T20:00:00Z");

function task(overrides = {}) {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    text: "t", important: true, important_since: MONDAY, done: false, completed_at: null,
    last_triaged_on: null, created_at: "2026-11-02T08:00:00Z", ...overrides,
  };
}

const summaryOf = (tasks, now = WEDNESDAY_NOON) => weekSummary(tasks, now, PARIS);

// --- Calendrier -------------------------------------------------------------

test("week: Monday to Sunday, Sunday belongs to the week started the Monday before", () => {
  assert.equal(weekStart(MONDAY), MONDAY);
  assert.equal(weekStart(SUNDAY), MONDAY);
  assert.equal(weekStart(LAST_SUNDAY), "2026-10-26");
  assert.deepEqual(weekDates(WEDNESDAY), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(weekStart("2027-01-01"), "2026-12-28"); // à cheval sur l'année
});

test("week: daylight saving weeks still have 7 days, Monday to Sunday", () => {
  assert.deepEqual(weekDates("2026-03-29"), ["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29"]);
  assert.equal(weekStart("2026-10-25"), "2026-10-19");
  assert.equal(weekStart("2026-10-26"), "2026-10-26");
});

test("closing time: Sunday from 20:00 local, one shared constant", () => {
  assert.equal(WEEK_CLOSING_MINUTES, 20 * 60);
  assert.equal(isClosingTime(at("2026-11-08T18:59:00Z"), PARIS), false); // dimanche 19:59
  assert.equal(isClosingTime(at("2026-11-08T19:00:00Z"), PARIS), true);  // dimanche 20:00
  assert.equal(isClosingTime(at("2026-11-08T22:59:00Z"), PARIS), true);  // dimanche 23:59
  assert.equal(isClosingTime(at("2026-11-08T23:00:00Z"), PARIS), false); // lundi 00:00
  assert.equal(isClosingTime(at("2026-11-07T20:00:00Z"), PARIS), false); // samedi 21:00
  // Jour du passage à l'heure d'été (dimanche 29 mars, UTC+2) : 20:00 = 18:00 UTC.
  assert.equal(isClosingTime(at("2026-03-29T17:59:00Z"), PARIS), false);
  assert.equal(isClosingTime(at("2026-03-29T18:00:00Z"), PARIS), true);
  // Jour du retour à l'heure d'hiver (dimanche 25 oct., UTC+1) : 20:00 = 19:00 UTC.
  assert.equal(isClosingTime(at("2026-10-25T18:59:00Z"), PARIS), false);
  assert.equal(isClosingTime(at("2026-10-25T19:00:00Z"), PARIS), true);
});

// --- Naissance d'une tâche --------------------------------------------------

test("birth: created Sunday 19:59 stays Sunday, 20:00 and later counts for the next Monday", () => {
  assert.equal(createdDayForWeek("2026-11-01T18:59:00Z", PARIS), LAST_SUNDAY);
  assert.equal(createdDayForWeek("2026-11-01T19:00:00Z", PARIS), MONDAY);
  assert.equal(createdDayForWeek("2026-11-01T22:59:00Z", PARIS), MONDAY);
  // Un samedi soir n'est pas concerné.
  assert.equal(createdDayForWeek("2026-10-31T21:00:00Z", PARIS), "2026-10-31");
});

test("birth: the most recent of creation day and last_triaged_on; created_at is never changed", () => {
  const recovered = task({ created_at: "2026-10-28T08:00:00Z", last_triaged_on: MONDAY });
  assert.equal(birthDate(recovered, PARIS), MONDAY);
  assert.equal(recovered.created_at, "2026-10-28T08:00:00Z");
  assert.equal(birthDate(task({ created_at: "2026-11-04T08:00:00Z", last_triaged_on: "2026-11-03" }), PARIS), WEDNESDAY);
  const offline = task({ created_at: "2026-11-03T08:00:00Z" });
  delete offline.last_triaged_on; // tâche créée hors-ligne, pas encore relue
  assert.equal(birthDate(offline, PARIS), "2026-11-03");
});

test("birth: last_triaged_on has no time, so a Sunday-evening recovery stays Sunday", () => {
  const t = task({ created_at: "2026-10-28T08:00:00Z", last_triaged_on: LAST_SUNDAY });
  assert.equal(birthDate(t, PARIS), LAST_SUNDAY);
  assert.equal(isFromPastWeek(t, MONDAY, PARIS), true);
});

test("isFromPastWeek: born before this Monday; Sunday 20:00+ creation is NOT from a past week on Monday", () => {
  assert.equal(isFromPastWeek(task({ created_at: "2026-11-01T18:59:00Z" }), MONDAY, PARIS), true);  // dimanche 19:59
  assert.equal(isFromPastWeek(task({ created_at: "2026-11-01T19:00:00Z" }), MONDAY, PARIS), false); // dimanche 20:00
  assert.equal(isFromPastWeek(task({ created_at: "2026-11-02T08:00:00Z" }), WEDNESDAY, PARIS), false);
  assert.equal(isFromPastWeek(task({ created_at: "2026-10-20T08:00:00Z", last_triaged_on: "2026-11-03" }), WEDNESDAY, PARIS), false);
});

// --- Appartenance à la semaine ------------------------------------------------

test("membership: a done task counts in the week of its LOCAL completion day (midnight edges)", () => {
  const sundayLate = task({ done: true, completed_at: "2026-11-01T22:59:00Z" });   // dim. 23:59 à Paris
  const mondayEarly = task({ done: true, completed_at: "2026-11-01T23:00:00Z" });  // lun. 00:00 à Paris
  assert.equal(weekDayOf(sundayLate, PARIS), LAST_SUNDAY);
  assert.equal(weekDayOf(mondayEarly, PARIS), MONDAY);
  assert.equal(summaryOf([sundayLate]).total, 0);
  assert.equal(summaryOf([mondayEarly]).total, 1);
  // Même instant, autre fuseau : 23:00 UTC le 1er = 12:00 le 2 à Auckland.
  assert.equal(weekDayOf(sundayLate, "Pacific/Auckland"), MONDAY);
});

test("membership: a done task without completed_at cannot be placed and is ignored", () => {
  const t = task({ done: true, completed_at: null });
  assert.equal(weekDayOf(t, PARIS), null);
  assert.equal(summaryOf([t]).total, 0);
});

test("membership: undone tasks count by birth, in Important, Autres or À trier", () => {
  const s = summaryOf([
    task({ important: true }),
    task({ important: false, important_since: null }),
    task({ important: null, important_since: null }),
    task({ created_at: "2026-10-28T08:00:00Z" }),                                  // semaine passée
    task({ created_at: "2026-10-28T08:00:00Z", last_triaged_on: "2026-11-03" }),   // récupérée cette semaine
  ]);
  assert.equal(s.notDone, 4);
  assert.equal(s.notDoneOthers, 1);
  assert.equal(s.total, 4);
});

test("membership: daylight saving week — completion just after midnight on the change day", () => {
  // Lundi 30 mars 2026 00:30 à Paris (UTC+2) = 29 mars 22:30 UTC.
  const t = task({ done: true, completed_at: "2026-03-29T22:30:00Z", important_since: "2026-03-30" });
  assert.equal(weekSummary([t], at("2026-03-30T10:00:00Z"), PARIS).onTime, 1);
  assert.equal(weekSummary([t], at("2026-03-29T10:00:00Z"), PARIS).total, 0);
});

// --- Catégories ---------------------------------------------------------------

test("categories: Important done the day it entered Important is on time", () => {
  const s = summaryOf([task({ done: true, important_since: "2026-11-03", completed_at: "2026-11-03T17:00:00Z" })]);
  assert.deepEqual([s.onTime, s.late, s.undated, s.notDone, s.done, s.total], [1, 0, 0, 0, 1, 1]);
});

test("categories: Important done after the day it entered Important is late", () => {
  const s = summaryOf([task({ done: true, important_since: MONDAY, completed_at: "2026-11-03T17:00:00Z" })]);
  assert.deepEqual([s.onTime, s.late], [0, 1]);
});

test("categories: born last week, done this week — late, even if important_since is last week", () => {
  const t = task({
    created_at: "2026-10-27T08:00:00Z", important_since: "2026-10-28",
    done: true, completed_at: "2026-11-03T09:00:00Z",
  });
  const s = summaryOf([t]);
  assert.deepEqual([s.late, s.total], [1, 1]);
});

test("categories: Important done without important_since is « Sans date », never late", () => {
  const s = summaryOf([task({ done: true, important_since: null, completed_at: "2026-11-03T09:00:00Z" })]);
  assert.deepEqual([s.undated, s.late, s.onTime, s.done], [1, 0, 0, 1]);
  const missing = task({ done: true, completed_at: "2026-11-03T09:00:00Z" });
  delete missing.important_since;
  assert.equal(summaryOf([missing]).undated, 1);
});

test("categories: Autres are never late and are detailed as « dont N Autres »", () => {
  const s = summaryOf([
    task({ important: false, important_since: null, done: true, completed_at: "2026-11-04T09:00:00Z", created_at: "2026-10-20T08:00:00Z" }),
    task({ done: true, important_since: "2026-11-03", completed_at: "2026-11-03T09:00:00Z" }),
  ]);
  assert.deepEqual([s.onTime, s.onTimeOthers, s.late], [2, 1, 0]);
});

test("categories: a done task left in À trier is on time, but not one of the Autres", () => {
  const s = summaryOf([task({ important: null, important_since: null, done: true, completed_at: "2026-11-03T09:00:00Z" })]);
  assert.deepEqual([s.onTime, s.onTimeOthers], [1, 0]);
});

test("categories: done BEFORE important_since (clock of another device) is on time, never late", () => {
  const s = summaryOf([task({ done: true, important_since: "2026-11-04", completed_at: "2026-11-03T09:00:00Z" })]);
  assert.deepEqual([s.onTime, s.late], [1, 0]);
});

test("categories: tasks handled on « À reprendre » but not written yet can be left out", () => {
  const t = task({ id: "gone" });
  assert.equal(weekSummary([t], WEDNESDAY_NOON, PARIS, new Set(["gone"])).total, 0);
});

// --- Dimanche 20:00 -----------------------------------------------------------

test("Sunday 21:00 view: task created 19:59 is « Pas faite », task created 20:00 waits for next week", () => {
  const before = task({ id: "a", created_at: "2026-11-08T18:59:00Z" });
  const after = task({ id: "b", created_at: "2026-11-08T19:00:00Z" });
  const s = weekSummary([before, after], SUNDAY_2100, PARIS);
  assert.equal(s.closing, true);
  assert.equal(s.notDone, 1);
  assert.equal(notDoneLabel(s.closing), "Pas faites");
  // Le lundi suivant, la tâche de 20:00 est dans la nouvelle semaine.
  const next = weekSummary([before, after], at("2026-11-09T09:00:00Z"), PARIS);
  assert.equal(next.notDone, 1);
  assert.equal(next.closing, false);
});

test("Sunday 19:59 the label still says « Pas encore faites »", () => {
  const s = weekSummary([task()], at("2026-11-08T18:59:00Z"), PARIS);
  assert.equal(s.closing, false);
  assert.equal(notDoneLabel(s.closing), "Pas encore faites");
});

// --- « Valider » de « À reprendre » le lundi ---------------------------------

test("Validate on Monday dates the task Sunday noon: it stays out of the new week's bilan", () => {
  const t = task({ created_at: "2026-10-30T08:00:00Z", important_since: "2026-10-30" });
  const validated = applyChanges(t, validateChanges(MONDAY, PARIS));
  assert.equal(weekDayOf(validated, PARIS), LAST_SUNDAY);
  assert.equal(weekSummary([validated], at("2026-11-02T09:00:00Z"), PARIS).total, 0);
});

test("created Sunday 21:00 then validated Monday (completed_at before created_at): harmless", () => {
  const t = task({ created_at: "2026-11-01T20:00:00Z", important_since: LAST_SUNDAY });
  const validated = applyChanges(t, validateChanges(MONDAY, PARIS));
  assert.ok(validated.completed_at < validated.created_at);
  // Bilan de la nouvelle semaine : absente.
  const monday = weekSummary([validated], at("2026-11-02T09:00:00Z"), PARIS);
  assert.deepEqual([monday.total, monday.done, monday.notDone], [0, 0, 0]);
  // Bilan de l'ancienne semaine (vu dimanche 23:00) : une tâche faite, à temps, rien de négatif.
  const sunday = weekSummary([validated], at("2026-11-01T22:00:00Z"), PARIS);
  assert.deepEqual([sunday.total, sunday.done, sunday.onTime, sunday.late, sunday.notDone], [1, 1, 1, 0, 0]);
});

// --- Barre ----------------------------------------------------------------------

test("bar: segments add up to 100, « Sans date » only when there is some", () => {
  const s = summaryOf([
    task({ done: true, important_since: "2026-11-03", completed_at: "2026-11-03T09:00:00Z" }),
    task({ done: true, completed_at: "2026-11-03T09:00:00Z" }),
    task(),
  ]);
  const bar = barSegments(s);
  assert.deepEqual(bar.map((b) => b.key), ["onTime", "late", "notDone"]);
  assert.equal(Math.round(bar.reduce((sum, b) => sum + b.width, 0) * 10) / 10, 100);
  assert.equal(bar.at(-1).x + bar.at(-1).width, 100);
  const withUndated = barSegments({ ...s, undated: 1, done: s.done + 1, total: s.total + 1 });
  assert.deepEqual(withUndated.map((b) => b.key), ["onTime", "late", "undated", "notDone"]);
  assert.deepEqual(barSegments(summaryOf([])), []);
});

// --- Habitudes ------------------------------------------------------------------

test("habits: targets, labels and official days come from habits.js", () => {
  const [gym, steps] = habitsWeek({}, WEDNESDAY);
  assert.equal(gym.key, "gym");
  assert.equal(gym.target, habitByKey("gym").weeklyTarget);
  assert.equal(gym.label, habitByKey("gym").label);
  assert.equal(steps.target, habitByKey("steps").weeklyTarget);
  assert.deepEqual(gym.days.filter((d) => d.official).map((d) => d.date), ["2026-11-02", "2026-11-04", "2026-11-06"]);
  assert.ok(steps.days.every((d) => d.official));
  assert.deepEqual(gym.days.map((d) => d.letter), ["L", "M", "M", "J", "V", "S", "D"]);
  // Une autre liste d'habitudes est suivie telle quelle (rien d'écrit en dur).
  const custom = [{ key: "read", label: "Lire", weeklyTarget: 5, officialDays: [2], sessions: {} }];
  const [read] = habitsWeek({ "2026-11-03": { read: true } }, WEDNESDAY, custom);
  assert.deepEqual([read.label, read.target, read.done], ["Lire", 5, 1]);
  assert.deepEqual(habitsWeek({}, WEDNESDAY, [...DEFAULT_HABITS, custom[0]]).map((h) => h.key), ["gym", "steps", "read"]);
});

test("habits: done / missed (no answer or false) / today in progress / future", () => {
  const checks = { "2026-11-02": { gym: true, steps: false }, "2026-11-03": {} };
  const gym = habitWeek(habitByKey("gym"), checks, WEDNESDAY);
  assert.deepEqual(gym.days.map((d) => d.state), ["done", "missed", "today", "future", "future", "future", "future"]);
  const steps = habitWeek(habitByKey("steps"), checks, WEDNESDAY);
  assert.deepEqual(steps.days.slice(0, 3).map((d) => d.state), ["missed", "missed", "today"]);
  // Aujourd'hui coché = fait.
  const ticked = habitWeek(habitByKey("steps"), { [WEDNESDAY]: { steps: true } }, WEDNESDAY);
  assert.equal(ticked.days[2].state, "done");
  assert.equal(ticked.done, 1);
});

test("habits: gym on a non-official day counts, and the real number is shown beyond the target", () => {
  const checks = Object.fromEntries(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((d) => [d, { gym: true }]));
  const gym = habitWeek(habitByKey("gym"), checks, "2026-11-05");
  assert.equal(gym.done, 4);
  assert.equal(habitCountLabel(gym), "4 sur 3");
});

test("habits: Sunday — nothing is in the future any more", () => {
  const steps = habitWeek(habitByKey("steps"), {}, SUNDAY);
  assert.deepEqual(steps.days.map((d) => d.state), ["missed", "missed", "missed", "missed", "missed", "missed", "today"]);
});

test("habits offline: only the days BEFORE today must be known; today is never required", () => {
  assert.deepEqual(missingPastDays([], MONDAY), []);
  assert.deepEqual(missingPastDays(["2026-11-02"], WEDNESDAY), ["2026-11-03"]);
  assert.deepEqual(missingPastDays(["2026-11-02", "2026-11-03"], WEDNESDAY), []);
  assert.deepEqual(missingPastDays(["2026-10-30", "2026-11-03"], WEDNESDAY), ["2026-11-02"]);
});

// --- Textes ---------------------------------------------------------------------

test("texts: week range, title, details, labels", () => {
  assert.equal(weekRangeLabel(WEDNESDAY), "2 – 8 nov.");
  assert.equal(weekRangeLabel("2026-10-28"), "26 oct. – 1 nov.");
  assert.equal(weekRangeLabel("2026-12-30"), "28 déc. – 3 janv.");
  assert.equal(titleLabel({ done: 3, total: 5 }), "3 sur 5 tâches terminées");
  assert.equal(titleLabel({ done: 0, total: 1 }), "0 sur 1 tâche terminée");
  assert.equal(titleLabel({ done: 0, total: 0 }), "0 sur 0 tâche terminée");
  assert.equal(othersDetail(2), "dont 2 Autres");
  assert.equal(othersDetail(0), null);
  assert.equal(habitCountLabel({ done: 2, target: 7 }), "2 sur 7");
});

test("texts: the bar reads its numbers aloud", () => {
  assert.equal(barAriaLabel({ total: 4, onTime: 2, late: 1, undated: 0, notDone: 1, closing: false }),
    "2 faites à temps, 1 faites en retard, 1 pas encore faites");
  assert.equal(barAriaLabel({ total: 3, onTime: 1, late: 0, undated: 1, notDone: 1, closing: true }),
    "1 faites à temps, 0 faites en retard, 1 sans date, 1 pas faites");
  assert.equal(barAriaLabel({ total: 0 }), "Aucune tâche cette semaine");
});

test("texts: end message — all done wins, even after Sunday 20:00", () => {
  assert.equal(endMessage({ total: 0, done: 0, closing: false }), "Aucune tâche cette semaine.");
  assert.equal(endMessage({ total: 0, done: 0, closing: true }), "Aucune tâche cette semaine.");
  assert.equal(endMessage({ total: 3, done: 3, closing: true }), "Belle semaine. Tout est fait.");
  assert.equal(endMessage({ total: 3, done: 3, closing: false }), "Belle semaine. Tout est fait.");
  assert.equal(endMessage({ total: 3, done: 1, closing: true }), "Semaine terminée. Un nouveau bilan commence lundi.");
  assert.equal(endMessage({ total: 3, done: 1, closing: false }), "Chaque tâche faite compte. La semaine n'est pas finie.");
});
