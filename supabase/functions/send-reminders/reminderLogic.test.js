import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localParts, isDueNow, cronGuard, secretsMatch, vapidSubjectProblem } from "./reminderLogic.js";
import {
  WEEKLY_REVIEW_SCHEDULE, WEEKLY_REVIEW_PAYLOAD, isWeeklyReviewTime, weeklyReviewDate, runWeeklyReview,
  WEEKLY_REVIEW_TIME_RANGE, effectiveWeeklyReviewTime, isWeeklyReviewEvening,
} from "./reminderLogic.js";
import { isClosingTime } from "../../../bilanLogic.js";

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

test("cronGuard refuses everything when CRON_SECRET is not configured (fail closed)", async () => {
  for (const provided of [null, "", "anything"]) {
    const r = await cronGuard(undefined, provided);
    assert.equal(r.status, 500);
    assert.match(r.body, /CRON_SECRET manquant/);
  }
  assert.equal((await cronGuard("", "")).status, 500);
});

test("cronGuard rejects a missing or wrong x-cron-secret with 401", async () => {
  assert.equal((await cronGuard("s3cret", null)).status, 401);
  assert.equal((await cronGuard("s3cret", "")).status, 401);
  assert.equal((await cronGuard("s3cret", "s3cre")).status, 401);
  assert.equal((await cronGuard("s3cret", "s3cret ")).status, 401);
  const r = await cronGuard("s3cret", "nope");
  assert.match(r.body, /^send-reminders : unauthorized/);
});

test("cronGuard lets the right secret through", async () => {
  assert.equal(await cronGuard("s3cret", "s3cret"), null);
});

test("secretsMatch compares whole values, whatever their length", async () => {
  assert.equal(await secretsMatch("abc", "abc"), true);
  assert.equal(await secretsMatch("abc", "abd"), false);
  assert.equal(await secretsMatch("abc", "abcd"), false);
  assert.equal(await secretsMatch("é", "é"), true);
});

test("localParts throws on an unknown timezone (why each user is isolated in send-reminders)", () => {
  assert.throws(() => localParts("Mars/Olympus", new Date()), RangeError);
});

test("vapidSubjectProblem accepts mailto: and https: subjects", () => {
  assert.equal(vapidSubjectProblem("mailto:rappels@example.org"), null);
  assert.equal(vapidSubjectProblem("https://example.org/contact"), null);
});

test("vapidSubjectProblem explains a missing or malformed subject", () => {
  assert.match(vapidSubjectProblem(undefined), /VAPID_SUBJECT manquant/);
  assert.match(vapidSubjectProblem(""), /VAPID_SUBJECT manquant/);
  for (const bad of ["rappels@example.org", "mailto:", "mailto:pas-une-adresse", "mailto: a@example.test", "mailto:<a@example.test>", "http://example.org"]) {
    assert.match(vapidSubjectProblem(bad), /VAPID_SUBJECT invalide/, bad);
  }
});

// ---------------------------------------------------------------------------
// Notification du dimanche
// ---------------------------------------------------------------------------

const ZONES = ["Europe/Zurich", "Europe/Paris"];

// Le jour du changement d'heure, 20:00 locale tombe à une autre heure UTC.
const SUNDAYS_AT_20 = [
  ["dimanche 29 mars 2026 (passage à l'heure d'été)", "2026-03-29", "18:00"],
  ["dimanche 25 octobre 2026 (passage à l'heure d'hiver)", "2026-10-25", "19:00"],
  ["dimanche 28 mars 2027 (passage à l'heure d'été)", "2027-03-28", "18:00"],
];

// Instant UTC décalé de `minutes` par rapport à "date heure".
const utc = (date, time, minutes = 0) => new Date(new Date(`${date}T${time}:00Z`).getTime() + minutes * 60000);

// Dimanche 8 novembre 2026, heure d'hiver : 20:00 à Zurich = 19:00 UTC.
const SUNDAY_8PM = utc("2026-11-08", "19:00");

const user = (fields = {}) => ({
  user_id: "user-1",
  timezone: "Europe/Zurich",
  notifications_enabled: true,
  weekly_review_enabled: true,
  last_weekly_review_sent_date: null,
  weekly_review_time: null,
  ...fields,
});

for (const zone of ZONES) {
  for (const [label, date, utcTime] of SUNDAYS_AT_20) {
    test(`isWeeklyReviewTime, ${zone}, ${label} : 19:59 non, 20:00 et 20:04 oui, 20:05 non`, () => {
      assert.equal(isWeeklyReviewTime(zone, utc(date, utcTime, -1)), false);
      assert.equal(isWeeklyReviewTime(zone, utc(date, utcTime)), true);
      assert.equal(isWeeklyReviewTime(zone, utc(date, utcTime, 4)), true);
      assert.equal(isWeeklyReviewTime(zone, utc(date, utcTime, 5)), false);
    });
  }

  test(`isWeeklyReviewTime, ${zone} : le 25 octobre 2026, 18:00 UTC vaut 19:00 locale (heure d'hiver), donc non`, () => {
    assert.equal(isWeeklyReviewTime(zone, utc("2026-10-25", "18:00")), false);
  });

  test(`isWeeklyReviewTime, ${zone} : un samedi à 20:00 locale, non`, () => {
    assert.equal(isWeeklyReviewTime(zone, utc("2026-03-28", "19:00")), false);
  });
}

test("isWeeklyReviewTime suit la date LOCALE, pas la date UTC", () => {
  // Dimanche 20:00 à Los Angeles (UTC-8 en novembre) : déjà lundi en UTC.
  assert.equal(isWeeklyReviewTime("America/Los_Angeles", utc("2026-11-09", "04:00")), true);
  // Samedi 20:00 à Los Angeles : déjà dimanche en UTC, mais pas sur place.
  assert.equal(isWeeklyReviewTime("America/Los_Angeles", utc("2026-11-08", "04:00")), false);
});

test("isWeeklyReviewTime obéit à la constante (celle qu'on modifie pour un essai réel)", () => {
  const thursday1842 = { weekday: 4, time: "18:42" };
  assert.equal(isWeeklyReviewTime("Europe/Zurich", utc("2026-11-05", "17:42"), thursday1842), true);
  assert.equal(isWeeklyReviewTime("Europe/Zurich", SUNDAY_8PM, thursday1842), false);
});

test("la constante du serveur est la fin de semaine de l'app (bilanLogic.js) : même jour, même heure", () => {
  // Du lundi 2 au dimanche 8 novembre 2026 : le jour de la constante, à son
  // heure. En UTC, pour comparer les règles sans dépendre d'un changement d'heure.
  const day = [2, 3, 4, 5, 6, 7, 8].map((d) => `2026-11-0${d}`)
    .find((date) => utc(date, "12:00").getUTCDay() === WEEKLY_REVIEW_SCHEDULE.weekday);
  const instant = utc(day, WEEKLY_REVIEW_SCHEDULE.time);
  assert.equal(isClosingTime(instant, "UTC"), true);
  assert.equal(isClosingTime(utc(day, WEEKLY_REVIEW_SCHEDULE.time, -1), "UTC"), false);
});

test("reminderLogic.js ne dépend d'aucun autre fichier : seuls lui et index.ts sont collés dans Supabase", () => {
  const source = readFileSync(new URL("./reminderLogic.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.doesNotMatch(source, /\bimport\(/);
});

test("le texte de la notification est celui validé", () => {
  assert.equal(WEEKLY_REVIEW_PAYLOAD.title, "Ta semaine est prête");
  assert.equal(WEEKLY_REVIEW_PAYLOAD.body, "Ton bilan est là, quand tu veux.");
  assert.equal(WEEKLY_REVIEW_PAYLOAD.open, "bilan");
});

test("le texte de la notification ne contient aucun chiffre ni allusion à un retard ou un échec", () => {
  const text = `${WEEKLY_REVIEW_PAYLOAD.title} ${WEEKLY_REVIEW_PAYLOAD.body}`;
  assert.doesNotMatch(text, /\d/);
  assert.doesNotMatch(text, /retard|échec|echec|manqu|raté|pas fait/i);
});

test("weeklyReviewDate renvoie la date locale du dimanche quand tout est réuni", () => {
  assert.equal(weeklyReviewDate(user(), true, SUNDAY_8PM), "2026-11-08");
});

test("weeklyReviewDate : une semaine où tout est fait ne change rien, aucune condition sur les tâches", () => {
  assert.equal(weeklyReviewDate(user({ tasks: [] }), true, SUNDAY_8PM), "2026-11-08");
});

test("weeklyReviewDate : envoyé le dimanche précédent, il repart", () => {
  assert.equal(weeklyReviewDate(user({ last_weekly_review_sent_date: "2026-11-01" }), true, SUNDAY_8PM), "2026-11-08");
});

test("weeklyReviewDate : déjà envoyé ce dimanche, rien", () => {
  assert.equal(weeklyReviewDate(user({ last_weekly_review_sent_date: "2026-11-08" }), true, SUNDAY_8PM), null);
});

test("weeklyReviewDate : interrupteur « Bilan du dimanche » coupé, rien", () => {
  assert.equal(weeklyReviewDate(user({ weekly_review_enabled: false }), true, SUNDAY_8PM), null);
});

test("weeklyReviewDate : colonne illisible (undefined), rien", () => {
  assert.equal(weeklyReviewDate(user({ weekly_review_enabled: undefined }), true, SUNDAY_8PM), null);
});

test("weeklyReviewDate : notifications coupées, rien", () => {
  assert.equal(weeklyReviewDate(user({ notifications_enabled: false }), true, SUNDAY_8PM), null);
});

test("weeklyReviewDate : aucun abonnement, rien", () => {
  assert.equal(weeklyReviewDate(user(), false, SUNDAY_8PM), null);
});

test("weeklyReviewDate : hors de la fenêtre, pas de rattrapage", () => {
  assert.equal(weeklyReviewDate(user(), true, utc("2026-11-08", "19:05")), null);
  assert.equal(weeklyReviewDate(user(), true, utc("2026-11-08", "22:00")), null);
});

// Les accès à la base sont remplacés par ces fausses fonctions, qui notent
// leurs appels. La logique, elle, est la vraie.
function weeklyRun(overrides = {}) {
  const calls = { loadTimes: [], loadRows: [], loadSubscribedUserIds: 0, claim: [], send: [], errors: [] };
  const rows = overrides.rows ?? [user()];
  const deps = {
    settings: rows.map(({ user_id, timezone, notifications_enabled }) => ({ user_id, timezone, notifications_enabled })),
    now: SUNDAY_8PM,
    loadTimes: async (userIds) => {
      calls.loadTimes.push(userIds);
      return rows.map(({ user_id, weekly_review_time }) => ({ user_id, weekly_review_time }));
    },
    loadRows: async (userIds) => {
      calls.loadRows.push(userIds);
      return rows.map(({ user_id, weekly_review_enabled, last_weekly_review_sent_date }) => ({
        user_id, weekly_review_enabled, last_weekly_review_sent_date,
      }));
    },
    loadSubscribedUserIds: async () => {
      calls.loadSubscribedUserIds++;
      return rows.map((row) => row.user_id);
    },
    claim: async (userId, date) => {
      calls.claim.push([userId, date]);
      return true;
    },
    send: async (userId, payload) => {
      calls.send.push([userId, payload]);
      return true;
    },
    logError: (...args) => calls.errors.push(args),
    ...overrides.deps,
  };
  return { calls, done: runWeeklyReview(deps) };
}

test("runWeeklyReview réclame la date locale puis envoie la notification", async () => {
  const { calls, done } = weeklyRun();
  await done;
  assert.deepEqual(calls.claim, [["user-1", "2026-11-08"]]);
  assert.deepEqual(calls.send, [["user-1", WEEKLY_REVIEW_PAYLOAD]]);
  assert.deepEqual(calls.errors, []);
});

test("runWeeklyReview : hors fenêtre, aucune requête en plus (le cron tourne chaque minute)", async () => {
  const { calls, done } = weeklyRun({ deps: { now: utc("2026-11-05", "19:00") } });
  await done;
  assert.deepEqual(calls.loadTimes, []);
  assert.deepEqual(calls.loadRows, []);
  assert.equal(calls.loadSubscribedUserIds, 0);
  assert.deepEqual(calls.claim, []);
  assert.deepEqual(calls.send, []);
});

test("runWeeklyReview : notifications coupées, aucune requête en plus", async () => {
  const { calls, done } = weeklyRun({ rows: [user({ notifications_enabled: false })] });
  await done;
  assert.deepEqual(calls.loadTimes, []);
  assert.deepEqual(calls.loadRows, []);
  assert.deepEqual(calls.send, []);
});

test("runWeeklyReview : interrupteur coupé, ni réclamation ni envoi", async () => {
  const { calls, done } = weeklyRun({ rows: [user({ weekly_review_enabled: false })] });
  await done;
  assert.deepEqual(calls.claim, []);
  assert.deepEqual(calls.send, []);
});

test("runWeeklyReview : déjà envoyé, ni réclamation ni envoi", async () => {
  const { calls, done } = weeklyRun({ rows: [user({ last_weekly_review_sent_date: "2026-11-08" })] });
  await done;
  assert.deepEqual(calls.claim, []);
  assert.deepEqual(calls.send, []);
});

test("runWeeklyReview : sans abonnement, la date n'est pas réclamée (un abonnement pris à 20:02 reçoit encore)", async () => {
  const { calls, done } = weeklyRun({ deps: { loadSubscribedUserIds: async () => [] } });
  await done;
  assert.deepEqual(calls.claim, []);
  assert.deepEqual(calls.send, []);
});

test("runWeeklyReview : réclamation perdue (autre invocation du cron), aucun envoi", async () => {
  const { calls, done } = weeklyRun({ deps: { claim: async () => false } });
  await done;
  assert.deepEqual(calls.send, []);
});

test("runWeeklyReview : colonne absente, l'erreur est consignée et rien ne remonte", async () => {
  const { calls, done } = weeklyRun({
    deps: { loadRows: async () => { throw new Error("column weekly_review_enabled does not exist"); } },
  });
  await assert.doesNotReject(done);
  assert.deepEqual(calls.send, []);
  assert.equal(calls.errors.length, 1);
});

test("runWeeklyReview : lecture des abonnements en panne, l'erreur est consignée et rien ne remonte", async () => {
  const { calls, done } = weeklyRun({
    deps: { loadSubscribedUserIds: async () => { throw new Error("panne"); } },
  });
  await assert.doesNotReject(done);
  assert.deepEqual(calls.send, []);
  assert.equal(calls.errors.length, 1);
});

test("runWeeklyReview : un fuseau invalide n'arrête que cette ligne", async () => {
  const rows = [user({ user_id: "user-bad", timezone: "Mars/Olympus" }), user({ user_id: "user-ok" })];
  const { calls, done } = weeklyRun({ rows });
  await assert.doesNotReject(done);
  assert.deepEqual(calls.send.map(([id]) => id), ["user-ok"]);
  assert.equal(calls.errors.length, 1);
});

test("runWeeklyReview : un envoi qui lève n'arrête que cet utilisateur", async () => {
  const sent = [];
  const rows = [user({ user_id: "user-a" }), user({ user_id: "user-b" })];
  const { calls, done } = weeklyRun({
    rows,
    deps: {
      send: async (id) => {
        if (id === "user-a") throw new Error("panne");
        sent.push(id);
        return true;
      },
    },
  });
  await assert.doesNotReject(done);
  assert.deepEqual(sent, ["user-b"]);
  assert.equal(calls.errors.length, 1);
});

test("runWeeklyReview : un envoi qui répond false est consigné", async () => {
  const { calls, done } = weeklyRun({ deps: { send: async () => false } });
  await done;
  assert.equal(calls.errors.length, 1);
});

test("runWeeklyReview : réglages illisibles (null), rien ne remonte", async () => {
  const { calls, done } = weeklyRun({ deps: { settings: null } });
  await assert.doesNotReject(done);
  assert.deepEqual(calls.send, []);
});

// index.ts tourne sous Deno et n'est pas exécuté ici : ces tests relisent son
// texte pour tenir les trois règles qui protègent les autres rappels.
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("index.ts : la lecture commune des réglages ne demande pas les colonnes du bilan", () => {
  // Elle ignore ses erreurs : une colonne absente y couperait TOUS les rappels.
  const shared = indexSource.match(/\.select\("user_id, morning_reminder_time[^"]*"\)/);
  assert.ok(shared, "lecture commune introuvable");
  assert.doesNotMatch(shared[0], /weekly/);
});

test("index.ts : la notification du dimanche passe après les rappels de tâches", () => {
  const tasks = indexSource.indexOf('.from("tasks")');
  const weekly = indexSource.indexOf("await runWeeklyReview(");
  assert.ok(tasks > 0 && weekly > tasks);
});

test("index.ts : les lectures du bilan signalent leurs erreurs à runWeeklyReview", () => {
  const block = indexSource.slice(indexSource.indexOf("await runWeeklyReview("));
  assert.equal(block.match(/if \(error\) throw error;/g)?.length, 4);
});

test("index.ts : la réclamation vérifie la date locale et les deux interrupteurs", () => {
  const block = indexSource.slice(indexSource.indexOf("await runWeeklyReview("));
  assert.match(block, /\.update\(\{ last_weekly_review_sent_date: localDate \}\)/);
  assert.match(block, /\.eq\("notifications_enabled", true\)/);
  assert.match(block, /\.eq\("weekly_review_enabled", true\)/);
  assert.match(block, /last_weekly_review_sent_date\.is\.null,last_weekly_review_sent_date\.neq\.\$\{localDate\}/);
});

test("index.ts n'importe aucun autre fichier local que reminderLogic.js", () => {
  const local = [...indexSource.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(local, ["./reminderLogic.js"]);
});

test("index.ts : l'heure du bilan est lue seule, à part des autres colonnes du bilan", () => {
  const block = indexSource.slice(indexSource.indexOf("await runWeeklyReview("));
  assert.match(block, /loadTimes: async[\s\S]*?\.select\("user_id, weekly_review_time"\)/);
  const rows = block.match(/loadRows: async[\s\S]*?\.select\("([^"]*)"\)/);
  assert.ok(rows);
  assert.doesNotMatch(rows[1], /weekly_review_time/);
});

// ---------------------------------------------------------------------------
// Heure du bilan choisie dans Réglages (migration 0007)
// ---------------------------------------------------------------------------

test("la plage de l'heure du bilan commence à l'heure par défaut, qui est la fin de semaine de l'app", () => {
  assert.equal(WEEKLY_REVIEW_TIME_RANGE.min, WEEKLY_REVIEW_SCHEDULE.time);
  assert.equal(WEEKLY_REVIEW_TIME_RANGE.max, "23:00");
});

test("la plage de l'heure du bilan est celle de la contrainte de la base (migration 0007)", () => {
  const migration = readFileSync(new URL("../../migrations/0007_weekly_review_time.sql", import.meta.url), "utf8");
  const m = migration.match(/weekly_review_time between time '(\d\d:\d\d)' and time '(\d\d:\d\d)'/);
  assert.ok(m);
  assert.deepEqual([m[1], m[2]], [WEEKLY_REVIEW_TIME_RANGE.min, WEEKLY_REVIEW_TIME_RANGE.max]);
});

test("la fenêtre de la dernière heure possible finit avant minuit : jamais de débordement sur lundi", () => {
  const [h, m] = WEEKLY_REVIEW_TIME_RANGE.max.split(":").map(Number);
  assert.ok(h * 60 + m + 5 <= 24 * 60);
});

test("effectiveWeeklyReviewTime garde une heure lisible dans la plage, bornes comprises", () => {
  for (const [value, expected] of [["20:00", "20:00"], ["20:00:00", "20:00"], ["21:30:00", "21:30"],
    ["22:55", "22:55"], ["23:00", "23:00"], ["23:00:00", "23:00"], ["23:00:00.000", "23:00"]]) {
    assert.equal(effectiveWeeklyReviewTime(value), expected, value);
  }
});

test("effectiveWeeklyReviewTime : valeur nulle, illisible ou hors plage, retour à 20:00 sans erreur", () => {
  for (const value of [null, undefined, "", 42, {}, "abc", "9:30", "19:59", "19:59:59", "23:01", "23:00:01",
    "24:00", "20:60", "21:30:61", " 21:30", "21h30"]) {
    assert.equal(effectiveWeeklyReviewTime(value), "20:00", String(value));
  }
});

test("isWeeklyReviewEvening : dimanche de 20:00 à 23:04, rien avant, après ni un autre jour", () => {
  const zurich = (date, time) => isWeeklyReviewEvening("Europe/Zurich", utc(date, time, -60)); // UTC+1 en novembre
  assert.equal(zurich("2026-11-08", "19:59"), false);
  assert.equal(zurich("2026-11-08", "20:00"), true);
  assert.equal(zurich("2026-11-08", "23:04"), true);
  assert.equal(zurich("2026-11-08", "23:05"), false);
  assert.equal(zurich("2026-11-09", "21:00"), false); // lundi
  assert.equal(zurich("2026-11-07", "21:00"), false); // samedi
});

// Dimanches testés : les trois changements d'heure, plus le 8 novembre 2026.
// [libellé, date, heure UTC de 20:00 locale]
const SUNDAYS = [...SUNDAYS_AT_20, ["dimanche 8 novembre 2026 (heure d'hiver)", "2026-11-08", "19:00"]];

// Envoyé ou non, pour une heure choisie, `minutes` après 20:00 locale ce dimanche-là.
async function sentAt(zone, date, utcAt20, time, minutes, fields = {}) {
  const { calls, done } = weeklyRun({
    rows: [user({ timezone: zone, weekly_review_time: time, ...fields })],
    deps: { now: utc(date, utcAt20, minutes) },
  });
  await done;
  assert.deepEqual(calls.errors, []);
  return calls.send.length === 1;
}

for (const zone of ZONES) {
  for (const [label, date, utcAt20] of SUNDAYS) {
    test(`heure choisie 22:55, ${zone}, ${label} : 22:54 non, 22:55 et 22:59 oui, 23:00 non`, async () => {
      assert.equal(await sentAt(zone, date, utcAt20, "22:55:00", 174), false);
      assert.equal(await sentAt(zone, date, utcAt20, "22:55:00", 175), true);
      assert.equal(await sentAt(zone, date, utcAt20, "22:55:00", 179), true);
      assert.equal(await sentAt(zone, date, utcAt20, "22:55:00", 180), false);
    });

    test(`heure choisie 23:00, ${zone}, ${label} : 22:59 non, 23:00 et 23:04 oui, 23:05 non, lundi non`, async () => {
      assert.equal(await sentAt(zone, date, utcAt20, "23:00:00", 179), false);
      assert.equal(await sentAt(zone, date, utcAt20, "23:00:00", 180), true);
      assert.equal(await sentAt(zone, date, utcAt20, "23:00:00", 184), true);
      assert.equal(await sentAt(zone, date, utcAt20, "23:00:00", 185), false);
      assert.equal(await sentAt(zone, date, utcAt20, "23:00:00", 240), false); // lundi 00:00
      assert.equal(await sentAt(zone, date, utcAt20, "23:00:00", 240 + 24 * 60 - 60), false); // lundi 23:00
    });

    test(`heure choisie 21:30, ${zone}, ${label} : rien à 20:00, envoi à 21:30`, async () => {
      assert.equal(await sentAt(zone, date, utcAt20, "21:30:00", 0), false);
      assert.equal(await sentAt(zone, date, utcAt20, "21:30:00", 90), true);
    });

    test(`aucune heure choisie, ${zone}, ${label} : envoi à 20:00 comme avant`, async () => {
      assert.equal(await sentAt(zone, date, utcAt20, null, 0), true);
      assert.equal(await sentAt(zone, date, utcAt20, null, 90), false);
    });
  }
}

test("heure illisible ou hors plage en base : envoi à 20:00, aucune erreur", async () => {
  const [, date, utcAt20] = SUNDAYS.at(-1);
  for (const bad of ["19:30:00", "23:30:00", "n'importe quoi", 7]) {
    assert.equal(await sentAt("Europe/Zurich", date, utcAt20, bad, 0), true, String(bad));
    assert.equal(await sentAt("Europe/Zurich", date, utcAt20, bad, 90), false, String(bad));
  }
});

test("heure changée le dimanche AVANT l'envoi : la nouvelle heure s'applique", async () => {
  // 20:00 → 22:00, changé à 19:30 : rien à 20:00, envoi à 22:00.
  const [, date, utcAt20] = SUNDAYS.at(-1);
  assert.equal(await sentAt("Europe/Zurich", date, utcAt20, "22:00:00", 0), false);
  assert.equal(await sentAt("Europe/Zurich", date, utcAt20, "22:00:00", 120), true);
});

test("heure changée le dimanche APRÈS l'envoi : rien ne repart (date déjà réservée)", async () => {
  const [, date, utcAt20] = SUNDAYS.at(-1);
  const sentToday = { last_weekly_review_sent_date: date };
  assert.equal(await sentAt("Europe/Zurich", date, utcAt20, "22:00:00", 120, sentToday), false);
});

test("heure changée le dimanche pour une heure déjà passée : pas de rattrapage", async () => {
  // À 21:30, on passe de 22:00 à 21:00 : la fenêtre de 21:00 est finie.
  const [, date, utcAt20] = SUNDAYS.at(-1);
  assert.equal(await sentAt("Europe/Zurich", date, utcAt20, "21:00:00", 90), false);
});

test("heure changée pour une heure qui vient de commencer : envoi à la minute suivante du cron", async () => {
  // À 21:32, on choisit 21:30 : encore dans la fenêtre [21:30, 21:35).
  const [, date, utcAt20] = SUNDAYS.at(-1);
  assert.equal(await sentAt("Europe/Zurich", date, utcAt20, "21:30:00", 92), true);
});

test("deux utilisateurs, deux heures : seul celui dont c'est l'heure est lu et servi", async () => {
  const rows = [user({ user_id: "a-20h", weekly_review_time: null }), user({ user_id: "b-21h30", weekly_review_time: "21:30:00" })];
  const { calls, done } = weeklyRun({ rows, deps: { now: utc("2026-11-08", "20:30") } }); // 21:30 à Zurich
  await done;
  assert.deepEqual(calls.loadTimes, [["a-20h", "b-21h30"]]);
  assert.deepEqual(calls.loadRows, [["b-21h30"]]);
  assert.deepEqual(calls.send.map(([id]) => id), ["b-21h30"]);
});

test("le soir du dimanche, personne à son heure : l'heure est lue, rien d'autre", async () => {
  const { calls, done } = weeklyRun({ deps: { now: utc("2026-11-08", "20:30") } }); // 21:30, heure par défaut
  await done;
  assert.equal(calls.loadTimes.length, 1);
  assert.deepEqual(calls.loadRows, []);
  assert.deepEqual(calls.send, []);
});

test("colonne weekly_review_time absente : erreur consignée une fois, envoi à 20:00 malgré tout", async () => {
  const { calls, done } = weeklyRun({
    rows: [user({ weekly_review_time: "22:00:00" })],
    deps: { loadTimes: async () => { throw new Error("column weekly_review_time does not exist"); } },
  });
  await assert.doesNotReject(done);
  assert.deepEqual(calls.send.map(([id]) => id), ["user-1"]);
  assert.equal(calls.errors.length, 1);
  assert.match(calls.errors[0][0], /default time used/);
});

test("colonne weekly_review_time absente, à 21:30 : rien n'est envoyé et rien ne remonte", async () => {
  const { calls, done } = weeklyRun({
    rows: [user({ weekly_review_time: "21:30:00" })],
    deps: { now: utc("2026-11-08", "20:30"), loadTimes: async () => { throw new Error("absente"); } },
  });
  await assert.doesNotReject(done);
  assert.deepEqual(calls.send, []);
});

test("lecture de l'heure qui renvoie null : envoi à 20:00", async () => {
  const { calls, done } = weeklyRun({ deps: { loadTimes: async () => null } });
  await done;
  assert.deepEqual(calls.send.map(([id]) => id), ["user-1"]);
  assert.deepEqual(calls.errors, []);
});

test("essai réel : jour de la constante changé (lundi), heure réglée par SQL à 21:30, envoi à 21:30", async () => {
  const monday = { ...WEEKLY_REVIEW_SCHEDULE, weekday: 1 };
  const run = (now) => {
    const r = weeklyRun({ rows: [user({ weekly_review_time: "21:30:00" })], deps: { now, schedule: monday } });
    return r.done.then(() => r.calls.send.length);
  };
  assert.equal(await run(utc("2026-11-09", "19:00")), 0); // lundi 20:00 Zurich
  assert.equal(await run(utc("2026-11-09", "20:30")), 1); // lundi 21:30 Zurich
  assert.equal(await run(utc("2026-11-08", "20:30")), 0); // dimanche 21:30
});
