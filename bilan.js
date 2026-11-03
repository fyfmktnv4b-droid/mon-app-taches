// Couche données du « Bilan de la semaine » : lecture seule, rien n'est
// enregistré en base. Les chiffres viennent de bilanLogic.js, le rendu de
// bilanScreen.js.
//
// Tâches : d'abord le cache local (l'écran s'ouvre tout de suite), puis la
// lecture serveur de « À reprendre » (plafonnée à 2 s, cache sinon).
// Habitudes : lecture serveur de la semaine (2 s au plus). Si elle échoue,
// le cache des routines, mais seulement s'il connaît TOUS les jours avant
// aujourd'hui ; sinon « indisponible ».
import { loadTasksForReprise } from "./reprise.js";
import { listRoutinesBetween } from "./routines.js";
import { getCachedTasks, getCachedRoutines, setCachedRoutine, getPendingMutations } from "./storage.js";
import { applyRoutineMutation } from "./routineLogic.js";
import { weekStart, weekDates, missingPastDays } from "./bilanLogic.js";

const READ_TIMEOUT_MS = 2000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS)),
  ]);
}

export async function loadLocalTasks() {
  try {
    return await getCachedTasks();
  } catch (_err) {
    return [];
  }
}

export function loadFreshTasks() {
  return loadTasksForReprise();
}

async function pendingMutations() {
  try {
    return await getPendingMutations();
  } catch (_err) {
    return [];
  }
}

// Coches encore en file hors-ligne : elles comptent déjà (même règle que
// l'écran de la routine et la carte « Hier »).
function withPending(localDate, checks, pending) {
  return pending.reduce((acc, mutation) => applyRoutineMutation(acc, mutation), { local_date: localDate, checks: checks ?? {} });
}

// Jours du lundi à aujourd'hui (inclus).
function daysSoFar(today) {
  return weekDates(today).filter((date) => date <= today);
}

// Renvoie { source: "server" | "cache", checksByDate } ou { source: "unavailable" }.
export async function loadWeekHabits(today) {
  const days = daysSoFar(today);
  let rows;
  try {
    rows = await withTimeout(listRoutinesBetween(weekStart(today), today));
  } catch (_err) {
    return loadWeekHabitsFromCache(today);
  }
  const pending = await pendingMutations();
  const byDate = new Map((rows ?? []).map((row) => [row.local_date, row.checks]));
  const routines = days.map((date) => withPending(date, byDate.get(date), pending));
  // Jours AVANT aujourd'hui mis en cache, y compris sans ligne en base
  // (« connu, sans réponse ») : la prochaine ouverture hors-ligne les aura.
  // Aujourd'hui reste géré par loadRoutine (sync.js), qui peut avoir une
  // coche en cours d'envoi à ne pas écraser.
  await Promise.all(routines
    .filter((routine) => routine.local_date < today)
    .map((routine) => setCachedRoutine(routine).catch(() => {})));
  return { source: "server", checksByDate: Object.fromEntries(routines.map((r) => [r.local_date, r.checks])) };
}

async function loadWeekHabitsFromCache(today) {
  let cached;
  try {
    cached = await getCachedRoutines();
  } catch (_err) {
    return { source: "unavailable" };
  }
  const days = daysSoFar(today);
  const week = cached.filter((routine) => days.includes(routine.local_date));
  if (missingPastDays(week.map((routine) => routine.local_date), today).length > 0) return { source: "unavailable" };
  const pending = await pendingMutations();
  const byDate = new Map(week.map((routine) => [routine.local_date, routine.checks]));
  const checksByDate = Object.fromEntries(days.map((date) => [date, withPending(date, byDate.get(date), pending).checks]));
  return { source: "cache", checksByDate };
}
