export function tasksToExportJson(tasks) {
  if (tasks.length === 0) return "[]";
  return JSON.stringify(tasks, null, 2);
}
