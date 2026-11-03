// Bilan de la semaine : fonctions pures (aucun réseau, aucun écran), testées
// en Node. La semaine va du lundi au dimanche, en date LOCALE de l'appareil.
// Rien n'est enregistré : tout est recalculé à chaque ouverture de l'écran.
//
// Ce fichier sert aussi l'écran « À reprendre » : isFromPastWeek y décide si
// « Récupérer » renvoie une tâche Important dans « À trier ».
import { deviceTimeZone, localDateString, localMinutesOfDay } from "./localDate.js";
import { DEFAULT_HABITS, isOfficialDay, weekdayFromLocalDate } from "./habits.js";

// ---------------------------------------------------------------------------
// Fin de semaine : le dimanche à partir de 20:00 (heure locale). UNE seule
// constante pour trois règles :
//   - « Pas encore faites » devient « Pas faites » (closing) ;
//   - une tâche créée à partir de ce moment compte pour la semaine SUIVANTE
//     (on prépare souvent sa semaine le dimanche soir) ;
//   - donc « Récupérer », le lundi, ne la traite pas comme une tâche d'une
//     semaine passée.
// ---------------------------------------------------------------------------
export const WEEK_CLOSING_MINUTES = 20 * 60;

// ---------------------------------------------------------------------------
// Dates "YYYY-MM-DD" : calcul en UTC sur la chaîne elle-même (comme dans
// repriseLogic.js), pour qu'un changement d'heure ne décale jamais d'un jour.
// ---------------------------------------------------------------------------

export function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Lundi de la semaine qui contient `dateString`.
export function weekStart(dateString) {
  return addDays(dateString, -((weekdayFromLocalDate(dateString) + 6) % 7));
}

// Les 7 jours, du lundi au dimanche.
export function weekDates(dateString) {
  const monday = weekStart(dateString);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// Vrai le dimanche à partir de 20:00, heure locale, à l'instant `now`.
export function isClosingTime(now = new Date(), timeZone = deviceTimeZone()) {
  return weekdayFromLocalDate(localDateString(now, timeZone)) === 0
    && localMinutesOfDay(now, timeZone) >= WEEK_CLOSING_MINUTES;
}

// ---------------------------------------------------------------------------
// Appartenance d'une tâche à une semaine
// ---------------------------------------------------------------------------

// Jour qui compte pour la création : la date locale de created_at, sauf le
// dimanche à partir de 20:00, qui compte pour le lundi suivant.
export function createdDayForWeek(createdAt, timeZone = deviceTimeZone()) {
  const instant = new Date(createdAt);
  const day = localDateString(instant, timeZone);
  return isClosingTime(instant, timeZone) ? addDays(day, 1) : day;
}

// « Naissance » d'une tâche pas terminée : le plus récent entre le jour de
// création (ci-dessus) et last_triaged_on (une date sans heure, prise telle
// quelle). created_at n'est jamais modifié : la naissance se recalcule.
export function birthDate(task, timeZone = deviceTimeZone()) {
  const created = createdDayForWeek(task.created_at, timeZone);
  const triaged = task.last_triaged_on ?? null;
  return triaged && triaged > created ? triaged : created;
}

// Vrai si la tâche est née avant le lundi de la semaine de `today`.
export function isFromPastWeek(task, today, timeZone = deviceTimeZone()) {
  return birthDate(task, timeZone) < weekStart(today);
}

// Jour (local) de la semaine où la tâche compte, ou null si on ne peut pas la
// placer (terminée sans completed_at : jamais écrit ainsi par l'app).
//   terminée     -> date locale de completed_at ;
//   pas terminée -> sa naissance.
export function weekDayOf(task, timeZone = deviceTimeZone()) {
  if (task.done) return task.completed_at ? localDateString(new Date(task.completed_at), timeZone) : null;
  return birthDate(task, timeZone);
}

// ---------------------------------------------------------------------------
// Catégories de la semaine en cours
//   Faites à temps   : Important terminée le jour même de son entrée dans
//                      Important (ou avant : jamais de retard sans preuve),
//                      + toutes les Autres, + les terminées restées dans
//                      « À trier ». Aucune n'a de retard possible.
//   Faites en retard : Important terminée APRÈS son entrée dans Important.
//   Sans date        : Important terminée sans important_since (avant la
//                      migration 0005). Jamais comptée en retard.
//   Pas encore faites: toutes les tâches pas terminées de la semaine.
// ---------------------------------------------------------------------------

export function weekSummary(tasks, now = new Date(), timeZone = deviceTimeZone(), excludedIds = new Set()) {
  const today = localDateString(now, timeZone);
  const [start, end] = [weekStart(today), addDays(weekStart(today), 6)];
  const summary = {
    start, end, closing: isClosingTime(now, timeZone),
    total: 0, done: 0, onTime: 0, onTimeOthers: 0, late: 0, undated: 0, notDone: 0, notDoneOthers: 0,
  };
  for (const task of tasks) {
    if (excludedIds.has(task.id)) continue;
    const day = weekDayOf(task, timeZone);
    if (day === null || day < start || day > end) continue;
    if (!task.done) {
      summary.notDone += 1;
      if (task.important === false) summary.notDoneOthers += 1;
    } else if (task.important === true) {
      const since = task.important_since ?? null;
      if (!since) summary.undated += 1;
      else if (day > since) summary.late += 1;
      else summary.onTime += 1;
    } else {
      summary.onTime += 1;
      if (task.important === false) summary.onTimeOthers += 1;
    }
  }
  summary.done = summary.onTime + summary.late + summary.undated;
  summary.total = summary.done + summary.notDone;
  return summary;
}

// Segments de la barre (en % de la largeur, somme = 100). « Sans date »
// n'apparaît que s'il y en a. Barre vide (aucune tâche) : aucun segment.
export function barSegments(summary) {
  const parts = [
    { key: "onTime", count: summary.onTime },
    { key: "late", count: summary.late },
    ...(summary.undated ? [{ key: "undated", count: summary.undated }] : []),
    { key: "notDone", count: summary.notDone },
  ];
  if (summary.total === 0) return [];
  // Bornes arrondies au cumul : la somme fait exactement 100.
  let before = 0;
  let seen = 0;
  return parts.map(({ key, count }) => {
    seen += count;
    const after = Math.round((seen / summary.total) * 1000) / 10;
    const segment = { key, count, x: before, width: Math.round((after - before) * 10) / 10 };
    before = after;
    return segment;
  });
}

// ---------------------------------------------------------------------------
// Habitudes : cases de la semaine (daily_routines), du lundi à aujourd'hui.
// Objectifs, libellés et jours officiels viennent TOUJOURS de habits.js.
// ---------------------------------------------------------------------------

const DAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

// Ordre des cartes à l'écran (Salle, puis 10 000 pas) ; une habitude ajoutée
// plus tard dans habits.js s'affiche à la suite, sans rien changer ici.
const CARD_ORDER = ["gym", "steps"];

// `checksByDate` : { "YYYY-MM-DD": checks } pour les jours connus.
// state : "done" (case à true), "today" (aujourd'hui, pas encore cochée :
// en cours), "missed" (jour passé sans réponse ou à false : non fait, neutre),
// "future" (jour à venir).
export function habitWeek(habit, checksByDate, today) {
  const days = weekDates(today).map((date, i) => {
    let state;
    if (date > today) state = "future";
    else if (checksByDate[date]?.[habit.key] === true) state = "done";
    else if (date === today) state = "today";
    else state = "missed";
    return { date, letter: DAY_LETTERS[i], name: DAY_NAMES[i], state, official: isOfficialDay(habit, date) };
  });
  return {
    key: habit.key, label: habit.label, target: habit.weeklyTarget,
    done: days.filter((d) => d.state === "done").length,
    // Petit point « jour prévu » seulement si l'habitude a des jours officiels
    // PARTICULIERS (salle : lundi, mercredi, vendredi). Tous les jours
    // officiels (10 000 pas) ou aucun : pas de point.
    marksOfficialDays: days.some((d) => d.official) && days.some((d) => !d.official),
    days,
  };
}

export function habitsWeek(checksByDate, today, habits = DEFAULT_HABITS) {
  const rank = (habit) => {
    const i = CARD_ORDER.indexOf(habit.key);
    return i === -1 ? CARD_ORDER.length : i;
  };
  return [...habits]
    .sort((a, b) => rank(a) - rank(b))
    .map((habit) => habitWeek(habit, checksByDate, today));
}

// Jours AVANT aujourd'hui absents de `knownDates` : hors-ligne, les habitudes
// ne s'affichent que si cette liste est vide. Aujourd'hui n'est jamais exigé
// (absent = « en cours »).
export function missingPastDays(knownDates, today) {
  const known = new Set(knownDates);
  return weekDates(today).filter((date) => date < today && !known.has(date));
}

// ---------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------

const DAY_MONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

function dayMonth(dateString) {
  return DAY_MONTH.format(new Date(`${dateString}T00:00:00Z`));
}

// « 2 – 8 nov. », ou « 26 oct. – 1 nov. » quand la semaine change de mois.
export function weekRangeLabel(today) {
  const start = weekStart(today);
  const end = addDays(start, 6);
  const first = start.slice(5, 7) === end.slice(5, 7) ? String(Number(start.slice(8))) : dayMonth(start);
  return `${first} – ${dayMonth(end)}`;
}

export function titleLabel({ done, total }) {
  return `${done} sur ${total} ${total > 1 ? "tâches terminées" : "tâche terminée"}`;
}

export function othersDetail(count) {
  return count > 0 ? `dont ${count} Autres` : null;
}

export function notDoneLabel(closing) {
  return closing ? "Pas faites" : "Pas encore faites";
}

export function habitCountLabel({ done, target }) {
  return `${done} sur ${target}`;
}

// Lu par les lecteurs d'écran à la place de la barre.
export function barAriaLabel(summary) {
  if (summary.total === 0) return "Aucune tâche cette semaine";
  return [
    `${summary.onTime} faites à temps`,
    `${summary.late} faites en retard`,
    ...(summary.undated ? [`${summary.undated} sans date`] : []),
    `${summary.notDone} ${notDoneLabel(summary.closing).toLowerCase()}`,
  ].join(", ");
}

// « Tout est fait » l'emporte, même après dimanche 20:00.
export function endMessage({ total, done, closing }) {
  if (total === 0) return "Aucune tâche cette semaine.";
  if (done === total) return "Belle semaine. Tout est fait.";
  if (closing) return "Semaine terminée. Un nouveau bilan commence lundi.";
  return "Chaque tâche faite compte. La semaine n'est pas finie.";
}
