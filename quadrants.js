export function getQuadrant(tasks, urgent, important) {
  return tasks.filter((t) => t.urgent === urgent && t.important === important);
}

export function getPriorityTasks(tasks) {
  return getQuadrant(tasks, true, true);
}

export function getUnsorted(tasks) {
  return tasks.filter((t) => t.urgent === null || t.important === null);
}

export function getSorted(tasks) {
  return tasks.filter((t) => t.urgent !== null && t.important !== null);
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
