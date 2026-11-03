// Couche données de l'écran « À reprendre aujourd'hui ». Écrit uniquement par
// les fonctions existantes de sync.js et de storage.js : mêmes règles
// hors-ligne que le reste de l'app (file de mutations, last-write-wins). Seule
// la carte « Hier » lit en plus routines.js (voir loadYesterdayQuestions).
import { loadTasks, updateTag, updateFields, updateReminderTime, removeTask, toggleRoutineCheck } from "./sync.js";
import { fetchRoutine } from "./routines.js";
import { getCachedTasks, setCachedTasks, getPendingMutations, enqueueMutation } from "./storage.js";
import { applyMutation } from "./syncLogic.js";
import { applyRoutineMutation } from "./routineLogic.js";
import { writeChangesInOrder, previousDateString, yesterdayQuestions } from "./repriseLogic.js";

// Même plafond que la routine (sync.js) : un réseau lent ne doit pas figer le
// démarrage, on prend alors le cache local.
const READ_TIMEOUT_MS = 2000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS)),
  ]);
}

export async function loadTasksForReprise() {
  try {
    return await withTimeout(loadTasks());
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

// Carte « Hier » : seulement d'après une lecture FRAÎCHE du serveur. Un cache
// resté sur hier matin ne voit pas les pas cochés plus tard sur un autre
// appareil, et « Non » écraserait alors un vrai true. Hors-ligne, réseau lent
// ou porte fermée : pas de carte cette fois-ci (rien n'est perdu, la question
// revient à la prochaine ouverture du jour).
export async function loadYesterdayQuestions(today) {
  const yesterday = previousDateString(today);
  try {
    const row = await withTimeout(fetchRoutine(yesterday));
    // Une réponse encore en file (donnée hors-ligne) compte déjà comme répondue.
    const pending = await getPendingMutations().catch(() => []);
    const routine = pending.reduce(
      (acc, mutation) => applyRoutineMutation(acc, mutation),
      { local_date: yesterday, checks: row?.checks ?? {} },
    );
    return { yesterday, questions: yesterdayQuestions(yesterday, routine.checks) };
  } catch (_err) {
    return { yesterday, questions: [] };
  }
}

// Réponses de la carte « Hier », écrites à la sortie de l'écran (d'ici là,
// « Annuler » ne fait que les oublier). Même écriture que la routine :
// set_routine_check pour la date d'hier, ou la file si le réseau manque.
export async function commitHabitAnswers(yesterday, answers) {
  for (const [key, done] of answers) await toggleRoutineCheck(yesterday, key, done);
}

async function hasPending() {
  try {
    return (await getPendingMutations()).length > 0;
  } catch (_err) {
    return false;
  }
}

// Une étape d'un seul champ s'écrit comme avant ; une étape de plusieurs
// champs part en UNE requête (setFields), ou en une seule mutation de file.
function writeNow(id, step) {
  const fields = Object.keys(step);
  if (fields.length > 1) return updateFields(id, step);
  const [field] = fields;
  return field === "reminder_time" ? updateReminderTime(id, step[field]) : updateTag(id, field, step[field]);
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
