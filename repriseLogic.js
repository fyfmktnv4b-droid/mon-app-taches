import { deviceTimeZone, localDateString } from "./localDate.js";

// Écran « À reprendre aujourd'hui » : tâches Important / Autres pas terminées,
// créées avant aujourd'hui (date LOCALE), et pas déjà récupérées aujourd'hui.
// Tout ici est pur (aucun réseau, aucun écran) pour être testé en Node.

// ---------------------------------------------------------------------------
// Dates "YYYY-MM-DD" : on calcule en UTC sur la chaîne elle-même, jamais sur
// une heure locale, pour qu'un changement d'heure ne décale pas d'un jour.
// ---------------------------------------------------------------------------

function dateParts(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  return [y, m, d];
}

export function previousDateString(dateString) {
  const [y, m, d] = dateParts(dateString);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function daysBetween(fromDate, toDate) {
  const [y1, m1, d1] = dateParts(fromDate);
  const [y2, m2, d2] = dateParts(toDate);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Écart (ms) entre l'heure affichée dans `timeZone` et l'UTC, à cet instant.
function timeZoneOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// Instant (ISO, UTC) correspondant à midi heure locale du jour `dateString`.
// Midi : loin des heures qui sautent ou se répètent au changement d'heure.
export function localNoonIso(dateString, timeZone = deviceTimeZone()) {
  const [y, m, d] = dateParts(dateString);
  const guess = Date.UTC(y, m - 1, d, 12);
  let instant = guess - timeZoneOffsetMs(guess, timeZone);
  instant = guess - timeZoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

// ---------------------------------------------------------------------------
// Sélection
// ---------------------------------------------------------------------------

function createdLocalDate(task, timeZone) {
  return localDateString(new Date(task.created_at), timeZone);
}

export function isPendingReprise(task, today, timeZone = deviceTimeZone()) {
  if (task.done) return false;
  if (task.important !== true && task.important !== false) return false;
  if (createdLocalDate(task, timeZone) >= today) return false;
  // Absent (tâche créée hors-ligne, pas encore relue du serveur) = jamais trié.
  const triaged = task.last_triaged_on ?? null;
  return triaged === null || triaged < today;
}

// Les plus anciennes d'abord ; à jour de création égal, Important avant Autres.
// `excludedIds` : tâches déjà traitées sur l'écran en cours (abandons pas
// encore exécutés, par exemple), à ne plus compter.
export function pendingReprise(tasks, today, timeZone = deviceTimeZone(), excludedIds = new Set()) {
  return tasks
    .filter((t) => !excludedIds.has(t.id) && isPendingReprise(t, today, timeZone))
    .map((t) => ({ task: t, day: createdLocalDate(t, timeZone) }))
    .sort((a, b) =>
      a.day.localeCompare(b.day)
      || Number(b.task.important) - Number(a.task.important)
      || String(a.task.created_at).localeCompare(String(b.task.created_at)))
    .map(({ task }) => task);
}

// ---------------------------------------------------------------------------
// Actions : chaque action est une liste ORDONNÉE de [champ, valeur] à écrire.
// L'ordre compte : une coupure réseau entre deux écritures ne doit laisser
// qu'un état sans danger.
// ---------------------------------------------------------------------------

// Rappel effacé d'abord : une coupure avant last_triaged_on laisse la tâche
// en attente, donc reproposée — sans danger.
export function recoverChanges(today) {
  return [["reminder_time", null], ["last_triaged_on", today]];
}

// Date d'abord : une coupure avant done=true ne laisse jamais une tâche
// terminée sans date.
export function validateChanges(today, timeZone = deviceTimeZone()) {
  return [["completed_at", localNoonIso(previousDateString(today), timeZone)], ["done", true]];
}

// Annuler : les mêmes champs, valeurs d'avant, dans l'ordre inverse (Valider
// annulé repasse d'abord done=false ; Récupérer annulé remet d'abord
// last_triaged_on, donc la tâche redevient en attente avant de retrouver son
// rappel).
export function undoChanges(taskBefore, changes) {
  return [...changes].reverse().map(([field]) => [field, taskBefore[field] ?? null]);
}

export function applyChanges(task, changes) {
  return changes.reduce((acc, [field, value]) => ({ ...acc, [field]: value }), task);
}

// Mutation de la file hors-ligne (même forme que sync.js / syncLogic.js).
export function changeToMutation(id, field, value) {
  return field === "reminder_time"
    ? { type: "setReminderTime", id, reminderTime: value }
    : { type: "setTag", id, tagName: field, value };
}

// Écrit les changements un par un, dans l'ordre. Dès que la file hors-ligne
// contient quelque chose (avant, ou parce qu'une écriture vient d'y tomber),
// les écritures suivantes y passent aussi : une écriture directe ne doit
// jamais doubler une écriture plus ancienne restée en file.
//   deps.hasPending()               -> Promise<boolean>
//   deps.writeNow(id, field, value) -> écriture directe (sync.js, qui met en
//                                      file elle-même si le réseau échoue)
//   deps.enqueue(mutation)          -> mise en file + mise à jour du cache
export async function writeChangesInOrder(id, changes, deps) {
  for (const [field, value] of changes) {
    if (await deps.hasPending()) await deps.enqueue(changeToMutation(id, field, value));
    else await deps.writeNow(id, field, value);
  }
}

// ---------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------

const NUMBER_WORDS = ["Zéro", "Une", "Deux", "Trois", "Quatre", "Cinq", "Six", "Sept", "Huit", "Neuf", "Dix"];

function numberWord(n) {
  return NUMBER_WORDS[n] ?? String(n);
}

export function introSentence(count) {
  return count === 1
    ? "Une tâche n'a pas été terminée. Choisis ce que tu en fais."
    : `${numberWord(count)} tâches n'ont pas été terminées. Choisis ce que tu en fais, une par une.`;
}

export function counterLabel(sortedCount, total) {
  return `${sortedCount} sur ${total} ${sortedCount > 1 ? "triées" : "triée"}`;
}

export function boxLabel(task) {
  return task.important ? "Important" : "Autres";
}

export function ageLabel(task, today, timeZone = deviceTimeZone()) {
  const days = daysBetween(createdLocalDate(task, timeZone), today);
  return days <= 1 ? "Hier" : `Il y a ${days} jours`;
}

export function bannerTitle(count) {
  return `${count} ${count > 1 ? "tâches" : "tâche"} à reprendre`;
}

// D'après la plus ancienne des tâches en attente.
export function bannerSubtitle(pendingTasks, today, timeZone = deviceTimeZone()) {
  const plural = pendingTasks.length > 1;
  const oldest = Math.max(...pendingTasks.map((t) => daysBetween(createdLocalDate(t, timeZone), today)));
  const since = oldest <= 1 ? "depuis hier" : `depuis ${oldest} jours`;
  return `${plural ? "Elles attendent" : "Elle attend"} ${since}`;
}

export function confirmationLabel(action, task) {
  if (action === "recover") return `Récupérée : retourne dans « ${boxLabel(task)} »`;
  if (action === "validate") return "Validée : comptée pour hier";
  return "Abandonnée";
}

// Récapitulatif de « Tout est trié », ex. « 2 récupérées · 1 validée ».
export function recapSummary({ recover = 0, validate = 0, abandon = 0 }) {
  const part = (n, one, many) => (n ? `${n} ${n > 1 ? many : one}` : null);
  return [
    part(recover, "récupérée", "récupérées"),
    part(validate, "validée", "validées"),
    part(abandon, "abandonnée", "abandonnées"),
  ].filter(Boolean).join(" · ");
}
