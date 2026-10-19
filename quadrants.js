import { deviceTimeZone, localDateString } from "./localDate.js";

// Deux catégories seulement : seule la colonne `important` compte. La colonne
// `urgent` reste en base (pas de migration) mais l'app ne la lit plus.
// important=true -> Important ; false -> Autres ; null -> à trier.
export function getImportant(tasks) {
  return tasks.filter((t) => t.important === true);
}

export function getOthers(tasks) {
  return tasks.filter((t) => t.important === false);
}

export function getUnsorted(tasks) {
  return tasks.filter((t) => t.important === null);
}

export function getSorted(tasks) {
  return tasks.filter((t) => t.important !== null);
}

// « Aujourd'hui » = la date LOCALE de l'appareil : on convertit aussi
// completed_at (un instant UTC) en date locale avant de comparer, sinon une
// tâche validée entre minuit et 2 h du matin en Europe compterait comme « hier ».
export function splitActiveAndArchived(tasks, todayDateString, timeZone = deviceTimeZone()) {
  const active = [];
  const archived = [];
  for (const task of tasks) {
    const completedDate = task.completed_at
      ? localDateString(new Date(task.completed_at), timeZone)
      : null;
    // Terminée sans date (ligne modifiée à la main en base) : on ne peut pas
    // dire qu'elle l'a été aujourd'hui, donc Historique plutôt que de rester
    // indéfiniment dans « Terminé ».
    const isOldCompleted = task.done && (completedDate === null || completedDate < todayDateString);
    (isOldCompleted ? archived : active).push(task);
  }
  return { active, archived };
}

// Sépare les tâches actives en « ouvertes » (celles des boîtes À trier /
// Important / Autres) et « terminées aujourd'hui » (la boîte Terminé, la plus
// récente d'abord). Une tâche terminée n'apparaît dans aucune autre boîte.
export function splitOpenAndDone(activeTasks) {
  const open = activeTasks.filter((t) => !t.done);
  const done = activeTasks
    .filter((t) => t.done)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return { open, done };
}
