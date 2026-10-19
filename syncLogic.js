export function applyMutation(tasks, mutation) {
  switch (mutation.type) {
    case "create":
      return [...tasks, ...mutation.tasks];
    case "setTag":
      return tasks.map((t) =>
        t.id === mutation.id ? { ...t, [mutation.tagName]: mutation.value } : t
      );
    case "setReminderTime":
      return tasks.map((t) =>
        t.id === mutation.id ? { ...t, reminder_time: mutation.reminderTime } : t
      );
    case "setDone":
      return tasks.map((t) =>
        t.id === mutation.id ? { ...t, done: mutation.done, completed_at: mutation.completedAt } : t
      );
    case "delete":
      return tasks.filter((t) => t.id !== mutation.id);
    default:
      return tasks;
  }
}

export function resolveMutationIds(mutation, idMap) {
  // `mutation.id === undefined` couvre les mutations qui ne portent pas d'id de
  // tâche du tout (les coches de routine partagent cette file) : elles doivent
  // repartir inchangées, sans dépendre du fait que idMap.has(undefined) soit faux.
  if (mutation.type === "create" || mutation.id === undefined) return mutation;
  if (!idMap.has(mutation.id)) return mutation;
  return { ...mutation, id: idMap.get(mutation.id) };
}

// Longueur maximale d'un titre, identique à la contrainte tasks_text_length
// (migration 0003). Vérifiée avant l'envoi : une création refusée par la
// base resterait sinon en tête de la file hors-ligne et la bloquerait.
export const MAX_TASK_LENGTH = 1000;

// Longueur (en caractères, comme char_length côté Postgres) de la plus longue
// ligne qui dépasse MAX_TASK_LENGTH, ou 0 si toutes les lignes conviennent.
export function longestTooLongLine(rawText) {
  let longest = 0;
  for (const line of rawText.split("\n")) {
    const length = [...line.trim()].length;
    if (length > MAX_TASK_LENGTH && length > longest) longest = length;
  }
  return longest;
}

export function buildOptimisticTasks(rawText, userId, now = new Date().toISOString()) {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.map((text) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    text,
    urgent: null,
    important: null,
    done: false,
    completed_at: null,
    created_at: now,
  }));
}
