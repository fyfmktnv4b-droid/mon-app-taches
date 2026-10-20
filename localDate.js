// Date locale de l'appareil, au format "YYYY-MM-DD".
//
// Sert de « aujourd'hui » pour toute l'app (routine, écran du jour, Historique,
// nom du fichier d'export) : en UTC, entre minuit et 2h du matin en Europe, on
// serait encore la veille.
//
// Le fuseau est lu sur l'appareil via Intl — jamais écrit en dur — mais reste
// injectable pour que les tests soient déterministes.
export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function localDateString(now = new Date(), timeZone = deviceTimeZone()) {
  // en-CA formate nativement en YYYY-MM-DD : pas de parties à recomposer à la
  // main. Même approche que localParts() dans l'Edge Function des rappels.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// ---------------------------------------------------------------------------
// Rappel d'une tâche : l'heure est stockée sans date et la tâche appartient à
// la journée en cours. Une heure qui n'est pas dans le futur est donc refusée
// (elle partirait le lendemain sans que l'app le dise).
// ---------------------------------------------------------------------------

export const REMINDER_PAST_MESSAGE = "Cette heure est déjà passée. Choisis une heure à venir.";
export const REMINDER_NO_TIME_LEFT_MESSAGE = "Il n'y a plus d'heure à venir aujourd'hui.";
export const REMINDER_INVALID_MESSAGE = "Choisis une heure pour le rappel.";

const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

// Minutes écoulées depuis minuit, heure locale (secondes ignorées).
export function localMinutesOfDay(now = new Date(), timeZone = deviceTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get("hour") * 60 + get("minute");
}

// Plus aucune heure future possible aujourd'hui (23:59 et après).
export function noReminderTimeLeft(now = new Date(), timeZone = deviceTimeZone()) {
  return localMinutesOfDay(now, timeZone) >= LAST_MINUTE_OF_DAY;
}

// Retourne null si `value` ("HH:MM") est strictement dans le futur (au moins
// la minute suivante), sinon le message d'erreur à afficher.
export function reminderTimeProblem(value, now = new Date(), timeZone = deviceTimeZone()) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return REMINDER_INVALID_MESSAGE;
  const nowMinutes = localMinutesOfDay(now, timeZone);
  if (nowMinutes >= LAST_MINUTE_OF_DAY) return REMINDER_NO_TIME_LEFT_MESSAGE;
  return Number(match[1]) * 60 + Number(match[2]) > nowMinutes ? null : REMINDER_PAST_MESSAGE;
}

// Heure proposée à l'ouverture de la feuille quand la tâche n'a pas encore de
// rappel : le prochain quart d'heure plein, à au moins 5 minutes d'ici ; en fin
// de journée (ce quart d'heure tomberait demain), la minute suivante ; null à
// 23:59 et après, où plus rien n'est possible.
export function defaultReminderTime(now = new Date(), timeZone = deviceTimeZone()) {
  const nowMinutes = localMinutesOfDay(now, timeZone);
  let target = Math.ceil((nowMinutes + 5) / 15) * 15;
  if (target > LAST_MINUTE_OF_DAY) target = nowMinutes + 1;
  if (target > LAST_MINUTE_OF_DAY) return null;
  return `${String(Math.floor(target / 60)).padStart(2, "0")}:${String(target % 60).padStart(2, "0")}`;
}
