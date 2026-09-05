import { signUp, signIn, signOut, getSession, onAuthStateChange } from "./supabaseClient.js";
import { createTasksFromLines, listTasks, setTag, setDone, deleteTask } from "./tasks.js";
import { getQuadrant, getPriorityTasks, getUnsorted, splitActiveAndArchived } from "./quadrants.js";

const authSection = document.getElementById("auth");
const appSection = document.getElementById("app");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const signUpButton = document.getElementById("auth-signup");
const signOutButton = document.getElementById("sign-out");
const mainView = document.getElementById("main-view");
const navMain = document.getElementById("nav-main");
const navHistory = document.getElementById("nav-history");

let currentView = "main";

function showApp() {
  authSection.hidden = true;
  appSection.hidden = false;
  render();
}

function showAuth() {
  authSection.hidden = false;
  appSection.hidden = true;
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

function quadrantHtml(title, tasks, extraClass = "") {
  return `
    <div class="quadrant ${extraClass}">
      <div class="quadrant-title">${title}</div>
      ${tasks.map(taskRowHtml).join("") || '<p class="empty">Rien ici</p>'}
    </div>
  `;
}

function wireTaskRows(container) {
  container.querySelectorAll(".task-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".task-done").addEventListener("change", async (event) => {
      await setDone(id, event.target.checked);
      render();
    });
    row.querySelector(".task-urgent").addEventListener("click", async () => {
      const active = row.querySelector(".task-urgent").dataset.active === "true";
      await setTag(id, "urgent", !active);
      render();
    });
    row.querySelector(".task-important").addEventListener("click", async () => {
      const active = row.querySelector(".task-important").dataset.active === "true";
      await setTag(id, "important", !active);
      render();
    });
    row.querySelector(".task-delete").addEventListener("click", async () => {
      await deleteTask(id);
      render();
    });
  });
}

async function renderMainView() {
  const allTasks = await listTasks();
  const { active } = splitActiveAndArchived(allTasks, todayDateString());
  const unsorted = getUnsorted(active);
  const sorted = active.filter((t) => t.urgent !== null && t.important !== null);
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

  document.getElementById("capture-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("capture-input");
    await createTasksFromLines(input.value);
    input.value = "";
    render();
  });

  wireTaskRows(mainView);
}

async function renderHistoryView() {
  const allTasks = await listTasks();
  const { archived } = splitActiveAndArchived(allTasks, todayDateString());
  archived.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

  mainView.innerHTML = `
    <h2>Historique</h2>
    <div id="history-list">${archived.map(taskRowHtml).join("") || '<p class="empty">Aucune tâche archivée</p>'}</div>
  `;
  wireTaskRows(mainView);
}

function render() {
  if (currentView === "main") renderMainView();
  else renderHistoryView();
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

signOutButton.addEventListener("click", () => signOut());

onAuthStateChange((session) => {
  if (session) showApp();
  else showAuth();
});

getSession().then((session) => {
  if (session) showApp();
  else showAuth();
});
