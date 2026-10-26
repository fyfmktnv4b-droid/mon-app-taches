// Couche données de l'écran « À reprendre aujourd'hui ». Ne passe que par les
// fonctions existantes de sync.js (inchangé) et de storage.js : mêmes règles
// hors-ligne que le reste de l'app (file de mutations, last-write-wins).
import { loadTasks, updateTag, updateReminderTime, removeTask } from "./sync.js";
import { getCachedTasks, setCachedTasks, getPendingMutations, enqueueMutation } from "./storage.js";
import { applyMutation } from "./syncLogic.js";
import { writeChangesInOrder } from "./repriseLogic.js";

// Même plafond que la routine (sync.js) : un réseau lent ne doit pas figer le
// démarrage, on prend alors le cache local.
const READ_TIMEOUT_MS = 2000;

export async function loadTasksForReprise() {
  try {
    return await Promise.race([
      loadTasks(),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS)),
    ]);
  } catch (_err) {
    try {
      return await getCachedTasks();
    } catch (_cacheErr) {
      return [];
    }
  }
}

// Même chose que le repli hors-ligne de sync.js : file + cache.
async function enqueue(mutation) {
  await enqueueMutation(mutation);
  const cached = await getCachedTasks();
  await setCachedTasks(applyMutation(cached, mutation));
}

async function hasPending() {
  try {
    return (await getPendingMutations()).length > 0;
  } catch (_err) {
    return false;
  }
}

function writeNow(id, field, value) {
  return field === "reminder_time" ? updateReminderTime(id, value) : updateTag(id, field, value);
}

export function writeChanges(id, changes) {
  return writeChangesInOrder(id, changes, { hasPending, writeNow, enqueue });
}

// Abandons : exécutés seulement à la sortie de l'écran. Même règle d'ordre :
// file non vide -> la suppression passe derrière.
export async function commitAbandons(ids) {
  for (const id of ids) {
    if (await hasPending()) await enqueue({ type: "delete", id });
    else await removeTask(id);
  }
}
