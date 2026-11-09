// Notification du dimanche : UNE seule constante, jour + heure locale de
// l'utilisateur (weekday : 0 = dimanche, 1 = lundi…). Doit rester la fin de
// semaine de l'app (bilanLogic.js) : reminderLogic.test.js le vérifie.
export const WEEKLY_REVIEW_SCHEDULE = { weekday: 0, time: "20:00" };

// Heure choisie dans Réglages (colonne weekly_review_time, migration 0007) :
// bornes comprises, les mêmes que la contrainte de la base et que l'app
// (settingsLogic.js) : reminderLogic.test.js le vérifie. Une valeur nulle,
// illisible ou hors plage donne l'heure de WEEKLY_REVIEW_SCHEDULE.
export const WEEKLY_REVIEW_TIME_RANGE = { min: "20:00", max: "23:00" };

// `open` : écran que le service worker doit ouvrir au toucher.
export const WEEKLY_REVIEW_PAYLOAD = {
  title: "Ta semaine est prête",
  body: "Ton bilan est là, quand tu veux.",
  open: "bilan",
};

// Extrait heure/minute/date locales via Intl.formatToParts — contrat garanti
// par la spec ECMAScript, contrairement à un aller-retour toLocaleString/Date.
export function localParts(timezone, now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutesOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const WINDOW_MINUTES = 5;

export function isDueNow(target, timezone, now, windowMinutes = WINDOW_MINUTES) {
  if (!target) return false;
  const [th, tm] = target.split(":").map(Number);
  const { minutesOfDay } = localParts(timezone, now);
  const diff = minutesOfDay - (th * 60 + tm);
  return diff >= 0 && diff < windowMinutes;
}

// Vrai pendant la fenêtre de la notification du dimanche, en heure locale.
export function isWeeklyReviewTime(timezone, now, schedule = WEEKLY_REVIEW_SCHEDULE) {
  const { dateKey } = localParts(timezone, now);
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay() === schedule.weekday
    && isDueNow(schedule.time, timezone, now);
}

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Heure "HH:MM" de la notification pour un utilisateur : la sienne si elle est
// lisible et dans la plage (Postgres renvoie "21:30:00"), sinon celle de la
// constante. Ne lève jamais.
export function effectiveWeeklyReviewTime(value, schedule = WEEKLY_REVIEW_SCHEDULE, range = WEEKLY_REVIEW_TIME_RANGE) {
  const match = typeof value === "string" && value.match(/^(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?$/);
  if (!match) return schedule.time;
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (h > 23 || m > 59 || s > 59) return schedule.time;
  const seconds = (h * 60 + m) * 60 + s;
  if (seconds < minutesOf(range.min) * 60 || seconds > minutesOf(range.max) * 60) return schedule.time;
  return `${match[1]}:${match[2]}`;
}

// Vrai si une notification du dimanche PEUT être due à cet instant, quelle que
// soit l'heure choisie : le bon jour local, entre le début de la plage et la
// fin de la fenêtre de sa dernière heure (ou dans la fenêtre de l'heure par
// défaut). Sert de premier tri, sans requête : le reste de la semaine,
// l'heure choisie n'est même pas lue.
export function isWeeklyReviewEvening(timezone, now, schedule = WEEKLY_REVIEW_SCHEDULE, range = WEEKLY_REVIEW_TIME_RANGE) {
  if (isWeeklyReviewTime(timezone, now, schedule)) return true;
  const { dateKey, minutesOfDay } = localParts(timezone, now);
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay() === schedule.weekday
    && minutesOfDay >= minutesOf(range.min)
    && minutesOfDay < minutesOf(range.max) + WINDOW_MINUTES;
}

// Date locale à réclamer si l'envoi est dû pour cet utilisateur, sinon null.
export function weeklyReviewDate(user, hasSubscription, now, schedule = WEEKLY_REVIEW_SCHEDULE) {
  if (user.notifications_enabled !== true || user.weekly_review_enabled !== true || !hasSubscription) return null;
  if (!isWeeklyReviewTime(user.timezone, now, schedule)) return null;
  const { dateKey } = localParts(user.timezone, now);
  return user.last_weekly_review_sent_date === dateKey ? null : dateKey;
}

// Déroulé complet de la notification du dimanche ; index.ts ne fournit que les
// accès à la base et l'envoi. Ne lève JAMAIS : les colonnes peuvent manquer
// (fonction déployée avant la migration) et cela ne doit gêner aucun autre
// rappel. Les colonnes de ce bilan sont lues ici, à part de la lecture commune,
// et seulement le soir du dimanche : aucune requête en plus le reste de la
// semaine. L'heure choisie est lue seule, avant le reste : si elle manque
// (fonction déployée avant la migration 0007), tout le monde garde 20:00.
export async function runWeeklyReview({
  settings, now, loadTimes, loadRows, loadSubscribedUserIds, claim, send, logError,
  schedule = WEEKLY_REVIEW_SCHEDULE, range = WEEKLY_REVIEW_TIME_RANGE,
}) {
  try {
    const evening = [];
    for (const s of settings ?? []) {
      try {
        if (s.notifications_enabled && isWeeklyReviewEvening(s.timezone, now, schedule, range)) evening.push(s);
      } catch (err) {
        logError(`weekly review skipped for user ${s.user_id}:`, err);
      }
    }
    if (evening.length === 0) return;

    let timeByUser = new Map();
    try {
      const times = await loadTimes(evening.map((s) => s.user_id));
      timeByUser = new Map((times ?? []).map((row) => [row.user_id, row.weekly_review_time]));
    } catch (err) {
      logError("weekly review time unreadable, default time used:", err);
    }

    const candidates = [];
    for (const s of evening) {
      try {
        const time = effectiveWeeklyReviewTime(timeByUser.get(s.user_id), schedule, range);
        const userSchedule = { ...schedule, time };
        if (isWeeklyReviewTime(s.timezone, now, userSchedule)) candidates.push({ s, userSchedule });
      } catch (err) {
        logError(`weekly review skipped for user ${s.user_id}:`, err);
      }
    }
    if (candidates.length === 0) return;

    const userIds = candidates.map(({ s }) => s.user_id);
    const [rows, subscribedIds] = await Promise.all([loadRows(userIds), loadSubscribedUserIds(userIds)]);
    const rowByUser = new Map(rows.map((row) => [row.user_id, row]));
    const subscribed = new Set(subscribedIds);

    for (const { s, userSchedule } of candidates) {
      try {
        const user = { ...s, ...rowByUser.get(s.user_id) };
        const localDate = weeklyReviewDate(user, subscribed.has(s.user_id), now, userSchedule);
        if (!localDate) continue;
        if (!(await claim(s.user_id, localDate))) continue;
        const ok = await send(s.user_id, WEEKLY_REVIEW_PAYLOAD);
        if (!ok) logError(`weekly review push failed for user ${s.user_id}`);
      } catch (err) {
        logError(`weekly review skipped for user ${s.user_id}:`, err);
      }
    }
  } catch (err) {
    logError("weekly review skipped:", err);
  }
}

// Garde d'entrée de send-reminders. Fermée par défaut : sans CRON_SECRET
// configuré côté serveur, on refuse tout (avant, l'absence du secret ouvrait
// la fonction à quiconque connaît la clé publique). Retourne null si l'appel
// est autorisé, sinon la réponse à renvoyer. Les messages commencent par
// « send-reminders » pour distinguer, dans un curl, notre refus de celui de
// la passerelle Supabase.
export async function cronGuard(expectedSecret, providedSecret) {
  if (!expectedSecret) {
    return { status: 500, body: "send-reminders : CRON_SECRET manquant côté serveur, appel refusé" };
  }
  if (!providedSecret || !(await secretsMatch(expectedSecret, providedSecret))) {
    return { status: 401, body: "send-reminders : unauthorized (x-cron-secret absent ou incorrect)" };
  }
  return null;
}

// Comparaison en temps constant : on compare les empreintes SHA-256 (même
// longueur quelle que soit l'entrée) sans s'arrêter au premier octet
// différent, pour ne rien révéler du secret par le temps de réponse.
export async function secretsMatch(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// VAPID_SUBJECT doit être « mailto:adresse@domaine » (ou une URL https:),
// sinon web-push lève une exception. Retourne null si la valeur convient,
// sinon un message d'erreur explicite.
export function vapidSubjectProblem(value) {
  if (!value) return "send-reminders : VAPID_SUBJECT manquant côté serveur (attendu : mailto:adresse@domaine)";
  if (/^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) || /^https:\/\/\S+$/.test(value)) return null;
  return "send-reminders : VAPID_SUBJECT invalide (attendu : mailto:adresse@domaine, sans espace ni chevrons)";
}
