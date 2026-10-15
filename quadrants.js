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

export function splitActiveAndArchived(tasks, todayDateString) {
  const active = [];
  const archived = [];
  for (const task of tasks) {
    const completedDate = task.completed_at ? task.completed_at.slice(0, 10) : null;
    const isOldCompleted = task.done && completedDate !== null && completedDate < todayDateString;
    (isOldCompleted ? archived : active).push(task);
  }
  return { active, archived };
}
