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
  if (mutation.type === "create" || !idMap.has(mutation.id)) return mutation;
  return { ...mutation, id: idMap.get(mutation.id) };
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
