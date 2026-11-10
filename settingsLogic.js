// Heure du bilan du dimanche (écran Réglages). Bornes comprises, les mêmes
// que la contrainte de la base (migration 0007) et que send-reminders
// (WEEKLY_REVIEW_TIME_RANGE) : settingsLogic.test.js le vérifie. Le défaut
// est la fin de semaine de l'app (WEEK_CLOSING_MINUTES, bilanLogic.js).
export const WEEKLY_REVIEW_TIME_MIN = "20:00";
export const WEEKLY_REVIEW_TIME_MAX = "23:00";
export const WEEKLY_REVIEW_TIME_DEFAULT = "20:00";

export const WEEKLY_REVIEW_TIME_ERROR = "Choisis une heure entre 20:00 et 23:00. Rien n'a été enregistré.";

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Valeur affichée dans le champ : l'heure enregistrée ("21:30:00" -> "21:30"),
// sinon (NULL) l'heure par défaut.
export function weeklyReviewTimeForInput(stored) {
  return typeof stored === "string" && /^\d\d:\d\d/.test(stored) ? stored.slice(0, 5) : WEEKLY_REVIEW_TIME_DEFAULT;
}

// Saisie du champ -> { value } à enregistrer, ou { error } à afficher.
// Un champ vidé enregistre NULL (donc l'heure par défaut), sans erreur.
export function parseWeeklyReviewTime(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (text === "") return { value: null };
  const match = text.match(/^(\d\d):(\d\d)(?::(\d\d))?$/);
  if (!match) return { error: WEEKLY_REVIEW_TIME_ERROR };
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (h > 23 || m > 59 || s > 59) return { error: WEEKLY_REVIEW_TIME_ERROR };
  const seconds = (h * 60 + m) * 60 + s;
  if (seconds < minutesOf(WEEKLY_REVIEW_TIME_MIN) * 60 || seconds > minutesOf(WEEKLY_REVIEW_TIME_MAX) * 60) {
    return { error: WEEKLY_REVIEW_TIME_ERROR };
  }
  return { value: s === 0 ? `${match[1]}:${match[2]}` : text };
}

// Confirmations de l'écran Réglages (zones role="status"), après une réussite.
export const SAVED_TIMES_MESSAGE = "Ces paramètres sont enregistrés.";
export const SAVED_SWITCH_MESSAGE = "Ce réglage est enregistré.";
