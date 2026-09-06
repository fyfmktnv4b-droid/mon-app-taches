import { supabase } from "./supabaseClient.js";
import { createTasksFromLines, listTasks, setTag, setDone, deleteTask } from "./tasks.js";
import { getCachedTasks, setCachedTasks, getPendingMutations, enqueueMutation, removeMutation } from "./storage.js";
import { applyMutation, resolveMutationIds, buildOptimisticTasks } from "./syncLogic.js";

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
  const idMap = new Map();
  const queue = await getPendingMutations();
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
      }
      await removeMutation(mutation.queueId);
    } catch (_err) {
      break; // Still offline (or a real error) — stop, preserve remaining order for next attempt.
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
