import { signUp, signIn, signOut, onAuthStateChange } from "./supabaseClient.js";
import { loadTasks, captureTasks, updateTag, updateDone, removeTask, flushQueue, initSync } from "./sync.js";
import { getQuadrant, getPriorityTasks, getUnsorted, getSorted, splitActiveAndArchived } from "./quadrants.js";
import { tasksToExportJson } from "./export.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

const authSection = document.getElementById("auth");
const appSection = document.getElementById("app");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const signUpButton = document.getElementById("auth-signup");
const signOutButton = document.getElementById("sign-out");
const exportButton = document.getElementById("export-json");
const appError = document.getElementById("app-error");
const mainView = document.getElementById("main-view");
const navMain = document.getElementById("nav-main");
const navHistory = document.getElementById("nav-history");

let currentView = "main";
let wasSignedIn = null;

async function showApp() {
  authSection.hidden = true;
  appSection.hidden = false;
  mainView.innerHTML = "";
  try {
    await flushQueue();
  } catch (_err) {
    // Still offline (or a real error) — render() falls back to cache as needed.
  }
  render();
}

function showAuth() {
  authSection.hidden = false;
  appSection.hidden = true;
  mainView.innerHTML = "";
}

function showAppError(err) {
  console.error(err);
  appError.textContent = (err && err.message) ? err.message : "Une erreur est survenue.";
}

function clearAppError() {
  appError.textContent = "";
}

async function safely(fn) {
  try {
    await fn();
  } catch (err) {
    showAppError(err);
    return;
  }
  render();
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function taskRowHtml(task) {
  return `
    <div class="task-row" data-id="${task.id}">
      <input type="checkbox" class="task-done" ${task.done ? "checked" : ""}>
      <span class="task-text">${escapeHtml(task.text)}</span>
      <button class="task-urgent" data-active="${task.urgent === true}">Urgent</button>
      <button class="task-important" data-active="${task.important === true}">Important</button>
      <button class="task-delete">×</button>
    </div>
  `;
}

function historyRowHtml(task) {
  const date = task.completed_at ? task.completed_at.slice(0, 10) : "";
  return `
    <div class="task-row">
      <span class="task-text">${escapeHtml(task.text)}</span>
      <span class="task-date">${date}</span>
    </div>
  `;
}

function quadrantHtml(title, tasks, extraClass = "") {
  return `
    <div class="quadrant ${extraClass}">
      <div class="quadrant-title">${title}</div>
      ${tasks.map(taskRowHtml).join("") || '<p class="empty">Rien ici</p>'}
    </div>
  `;
}

function wireTaskRows(container) {
  container.querySelectorAll(".task-row[data-id]").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".task-done").addEventListener("change", (event) => {
      safely(() => updateDone(id, event.target.checked));
    });
    row.querySelector(".task-urgent").addEventListener("click", () => {
      const active = row.querySelector(".task-urgent").dataset.active === "true";
      safely(() => updateTag(id, "urgent", !active));
    });
    row.querySelector(".task-important").addEventListener("click", () => {
      const active = row.querySelector(".task-important").dataset.active === "true";
      safely(() => updateTag(id, "important", !active));
    });
    row.querySelector(".task-delete").addEventListener("click", () => {
      safely(() => removeTask(id));
    });
  });
}

async function renderMainView() {
  const allTasks = await loadTasks();
  const { active } = splitActiveAndArchived(allTasks, todayDateString());
  const unsorted = getUnsorted(active);
  const sorted = getSorted(active);
  const priority = getPriorityTasks(sorted);
  const q2 = getQuadrant(sorted, false, true);
  const q3 = getQuadrant(sorted, true, false);
  const q4 = getQuadrant(sorted, false, false);

  mainView.innerHTML = `
    <form id="capture-form">
      <textarea id="capture-input" rows="3" placeholder="Une tâche par ligne..."></textarea>
      <button type="submit">Ajouter</button>
    </form>

    <h2>À trier (${unsorted.length})</h2>
    <div id="unsorted-list">${unsorted.map(taskRowHtml).join("") || '<p class="empty">Rien à trier</p>'}</div>

    <h2>★ Priorités du jour</h2>
    <div id="priority-list">${priority.map(taskRowHtml).join("") || '<p class="empty">Aucune priorité pour l’instant</p>'}</div>

    <h2>Matrice complète</h2>
    <div class="matrix">
      ${quadrantHtml("Urgent + Important", priority, "q1")}
      ${quadrantHtml("Important, pas urgent", q2)}
      ${quadrantHtml("Urgent, pas important", q3)}
      ${quadrantHtml("Ni urgent ni important", q4)}
    </div>
  `;

  document.getElementById("capture-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("capture-input");
    safely(() => captureTasks(input.value));
  });

  wireTaskRows(mainView);
}

async function renderHistoryView() {
  const allTasks = await loadTasks();
  const { archived } = splitActiveAndArchived(allTasks, todayDateString());
  archived.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

  mainView.innerHTML = `
    <h2>Historique</h2>
    <div id="history-list">${archived.map(historyRowHtml).join("") || '<p class="empty">Aucune tâche archivée</p>'}</div>
  `;
}

async function render() {
  try {
    if (currentView === "main") await renderMainView();
    else await renderHistoryView();
    clearAppError();
  } catch (err) {
    showAppError(err);
  }
}

navMain.addEventListener("click", () => {
  currentView = "main";
  navMain.dataset.active = "true";
  navHistory.dataset.active = "false";
  render();
});

navHistory.addEventListener("click", () => {
  currentView = "history";
  navMain.dataset.active = "false";
  navHistory.dataset.active = "true";
  render();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  try {
    await signIn(emailInput.value, passwordInput.value);
  } catch (err) {
    authError.textContent = err.message;
  }
});

signUpButton.addEventListener("click", async () => {
  authError.textContent = "";
  try {
    await signUp(emailInput.value, passwordInput.value);
  } catch (err) {
    authError.textContent = err.message;
  }
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut();
  } catch (err) {
    showAppError(err);
  }
});

exportButton.addEventListener("click", () => {
  safely(async () => {
    const tasks = await loadTasks();
    const json = tasksToExportJson(tasks);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mes-taches-${todayDateString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
});

onAuthStateChange((session) => {
  const nowSignedIn = !!session;
  if (nowSignedIn === wasSignedIn) return;
  wasSignedIn = nowSignedIn;
  if (nowSignedIn) showApp();
  else showAuth();
});

initSync(render);
