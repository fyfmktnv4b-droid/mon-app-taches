import { supabase } from "./supabaseClient.js";
import { createTasksFromLines, listTasks, setTag, setDone, deleteTask, setReminderTime } from "./tasks.js";
import { fetchRoutine, setRoutineCheck, listRoutines } from "./routines.js";
import {
  getCachedTasks, setCachedTasks, getPendingMutations, enqueueMutation, removeMutation,
  getCachedRoutine, getCachedRoutines, setCachedRoutine,
} from "./storage.js";
import { applyMutation, resolveMutationIds, buildOptimisticTasks } from "./syncLogic.js";
import { applyRoutineMutation, emptyRoutine } from "./routineLogic.js";
import { serverAllowed } from "./authGate.js";
import { offlineUserId } from "./lastUser.js";

export async function loadTasks() {
  try {
    const tasks = await listTasks();
    // Overlay still-unsynced mutations, so a fresh server read can't visibly
    // revert an optimistic offline edit that hasn't been flushed yet.
    const pending = await getPendingMutations();
    const merged = pending.reduce((acc, mutation) => applyMutation(acc, mutation), tasks);
    try {
      await setCachedTasks(merged);
    } catch (_cacheErr) {
      // Caching is best-effort — the freshly fetched data is still valid to show.
    }
    return merged;
  } catch (_networkErr) {
    return getCachedTasks();
  }
}

async function getCurrentUserId() {
  // Porte serveur fermée (session pas encore vérifiée, jeton expiré) :
  // getSession() échouerait ou attendrait ~25 s. Le repère local suffit pour
  // une tâche mise en file ; le vrai user_id vient du serveur au rejeu.
  if (!serverAllowed()) return offlineUserId();
  // getSession() reads the persisted session locally and works offline;
  // getUser() re-validates against the server and would fail offline —
  // wrong choice here, since this path only runs when we're already offline.
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) throw new Error("Session expirée, reconnecte-toi.");
  return session.user.id;
}

export async function captureTasks(rawText) {
  try {
    return await createTasksFromLines(rawText);
  } catch (_err) {
    const userId = await getCurrentUserId();
    const optimisticTasks = buildOptimisticTasks(rawText, userId);
    if (optimisticTasks.length === 0) return [];
    await enqueueMutation({ type: "create", rawText, tasks: optimisticTasks });
    const cached = await getCachedTasks();
    await setCachedTasks(applyMutation(cached, { type: "create", tasks: optimisticTasks }));
    return optimisticTasks;
  }
}

export async function updateTag(id, tagName, value) {
  try {
    await setTag(id, tagName, value);
  } catch (_err) {
    const mutation = { type: "setTag", id, tagName, value };
    await enqueueMutation(mutation);
    const cached = await getCachedTasks();
    await setCachedTasks(applyMutation(cached, mutation));
  }
}

export async function updateReminderTime(id, reminderTime) {
  try {
    await setReminderTime(id, reminderTime);
  } catch (_err) {
    const mutation = { type: "setReminderTime", id, reminderTime };
    await enqueueMutation(mutation);
    const cached = await getCachedTasks();
    await setCachedTasks(applyMutation(cached, mutation));
  }
}

export async function updateDone(id, done) {
  const completedAt = done ? new Date().toISOString() : null;
  try {
    await setDone(id, done, completedAt);
  } catch (_err) {
    const mutation = { type: "setDone", id, done, completedAt };
    await enqueueMutation(mutation);
    const cached = await getCachedTasks();
    await setCachedTasks(applyMutation(cached, mutation));
  }
}

export async function removeTask(id) {
  try {
    await deleteTask(id);
  } catch (_err) {
    const mutation = { type: "delete", id };
    await enqueueMutation(mutation);
    const cached = await getCachedTasks();
    await setCachedTasks(applyMutation(cached, mutation));
  }
}

// Au-delà de ce délai on n'attend plus le serveur et on prend le cache local.
// Un réseau très lent n'« échoue » pas : il fait attendre. Sans ce plafond, le
// tap sur « Commencer » pourrait figer l'écran plusieurs secondes dans le train.
const ROUTINE_READ_TIMEOUT_MS = 2000;

// Même motif que readyRegistration() dans push.js : la promesse perdante
// continue en arrière-plan, on cesse simplement de l'attendre.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

async function overlayPendingChecks(routine) {
  // Superpose les coches pas encore synchronisées, pour qu'une lecture serveur
  // fraîche ne puisse pas faire visuellement « sauter » une coche hors-ligne.
  // Les mutations de tâches de la même file traversent sans effet.
  let pending;
  try {
    pending = await getPendingMutations();
  } catch (_err) {
    return routine;
  }
  return pending.reduce((acc, mutation) => applyRoutineMutation(acc, mutation), routine);
}

async function cachedRoutineOrEmpty(localDate) {
  try {
    return (await getCachedRoutine(localDate)) ?? emptyRoutine(localDate);
  } catch (_err) {
    // Cache illisible (base occupée par un vieil onglet, mode privé...) :
    // une journée vierge reste préférable à un écran en erreur.
    return emptyRoutine(localDate);
  }
}

// Vérifie d'abord auprès du serveur si un autre appareil a déjà validé la
// journée, avec repli sur le cache local si le réseau est absent OU trop lent.
export async function loadRoutine(localDate) {
  let fromServer;
  try {
    fromServer = await withTimeout(fetchRoutine(localDate), ROUTINE_READ_TIMEOUT_MS);
  } catch (_err) {
    return overlayPendingChecks(await cachedRoutineOrEmpty(localDate));
  }
  const routine = fromServer
    ? { local_date: fromServer.local_date, checks: fromServer.checks ?? {} }
    : emptyRoutine(localDate);
  const merged = await overlayPendingChecks(routine);
  try {
    await setCachedRoutine(merged);
  } catch (_cacheErr) {
    // Mise en cache best-effort — la donnée fraîche reste valable à afficher.
  }
  return merged;
}

// Toutes les routines, pour l'export. Serveur d'abord (même plafond de 2 s),
// cache local sinon : un export hors-ligne reste possible mais ne contient que
// les jours déjà vus sur cet appareil.
export async function loadAllRoutines() {
  try {
    const rows = await withTimeout(listRoutines(), ROUTINE_READ_TIMEOUT_MS);
    return rows.map(({ local_date, checks }) => ({ local_date, checks: checks ?? {} }));
  } catch (_err) {
    try {
      const cached = await getCachedRoutines();
      return cached.sort((a, b) => a.local_date.localeCompare(b.local_date));
    } catch (_cacheErr) {
      return [];
    }
  }
}

// Coche ou décoche une case. Renvoie toujours la routine à afficher, pour que
// l'appelant n'ait pas à deviner si l'écriture est partie au serveur ou en file.
export async function toggleRoutineCheck(localDate, key, value) {
  const mutation = { type: "routineCheck", localDate, key, value };
  try {
    const row = await setRoutineCheck(localDate, key, value);
    const merged = { local_date: row.local_date, checks: row.checks ?? {} };
    try {
      await setCachedRoutine(merged);
    } catch (_cacheErr) {
      // Idem : best-effort.
    }
    return merged;
  } catch (_err) {
    await enqueueMutation(mutation);
    const next = applyRoutineMutation(await cachedRoutineOrEmpty(localDate), mutation);
    try {
      await setCachedRoutine(next);
    } catch (_cacheErr) {
      // Idem.
    }
    return next;
  }
}

let flushInFlight = null;

// Three callers can trigger a flush (sign-in, `online`, `focus`). Without this
// guard two overlapping runs read the same not-yet-removed queue entry and
// replay it twice, duplicating server-side writes. Concurrent callers share
// the one in-progress flush instead of starting a second.
export function flushQueue() {
  if (!flushInFlight) {
    flushInFlight = doFlush().finally(() => { flushInFlight = null; });
  }
  return flushInFlight;
}

async function doFlush() {
  const queue = await getPendingMutations();
  const isRoutine = (mutation) => mutation.type === "routineCheck";
  // Deux passes indépendantes : une mutation de tâche bloquée (son `break`
  // préserve l'ordre create -> setTag, qui est indispensable) ne doit pas
  // retenir les coches de routine derrière elle, et inversement.
  await flushTaskMutations(queue.filter((mutation) => !isRoutine(mutation)));
  await flushRoutineMutations(queue.filter(isRoutine));
}

async function flushTaskMutations(queue) {
  const idMap = new Map();
  for (const mutation of queue) {
    const resolved = resolveMutationIds(mutation, idMap);
    try {
      if (resolved.type === "create") {
        const created = await createTasksFromLines(resolved.rawText);
        resolved.tasks.forEach((optimisticTask, i) => {
          if (created[i]) idMap.set(optimisticTask.id, created[i].id);
        });
      } else if (resolved.type === "setTag") {
        await setTag(resolved.id, resolved.tagName, resolved.value);
      } else if (resolved.type === "setDone") {
        await setDone(resolved.id, resolved.done, resolved.completedAt);
      } else if (resolved.type === "delete") {
        await deleteTask(resolved.id);
      } else if (resolved.type === "setReminderTime") {
        await setReminderTime(resolved.id, resolved.reminderTime);
      }
      await removeMutation(mutation.queueId);
    } catch (_err) {
      break; // Still offline (or a real error) — stop, preserve remaining order for next attempt.
    }
  }
}

async function flushRoutineMutations(queue) {
  for (const mutation of queue) {
    try {
      // La RPC est idempotente, donc un rejeu après un échec partiel est sûr.
      await setRoutineCheck(mutation.localDate, mutation.key, mutation.value);
      await removeMutation(mutation.queueId);
    } catch (_err) {
      // L'ordre compte à l'intérieur d'une même case (cocher puis décocher),
      // donc on s'arrête ici plutôt que de sauter l'entrée.
      break;
    }
  }
}

export function initSync(afterSync) {
  const trigger = () => {
    flushQueue().catch(() => {}).then(afterSync);
  };
  window.addEventListener("online", trigger);
  window.addEventListener("focus", trigger);
}
