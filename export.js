export function tasksToExportJson(tasks) {
  if (tasks.length === 0) return "[]";
  return JSON.stringify(tasks, null, 2);
}

// Export complet : tâches + routines quotidiennes. Un objet à deux clés plutôt
// qu'un tableau, pour que le format puisse encore s'étendre.
export function fullExportJson(tasks, routines) {
  return JSON.stringify({ tasks, routines }, null, 2);
}
