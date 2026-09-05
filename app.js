import { signUp, signIn, signOut, getSession, onAuthStateChange } from "./supabaseClient.js";
import { createTasksFromLines, listTasks, setTag, setDone, deleteTask } from "./tasks.js";

const authSection = document.getElementById("auth");
const appSection = document.getElementById("app");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const signUpButton = document.getElementById("auth-signup");
const signOutButton = document.getElementById("sign-out");
const mainView = document.getElementById("main-view");

function showApp() {
  authSection.hidden = true;
  appSection.hidden = false;
  renderMain();
}

function showAuth() {
  authSection.hidden = false;
  appSection.hidden = true;
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

async function renderMain() {
  const tasks = await listTasks();
  mainView.innerHTML = `
    <form id="capture-form">
      <textarea id="capture-input" rows="3" placeholder="Une tâche par ligne..."></textarea>
      <button type="submit">Ajouter</button>
    </form>
    <div id="task-list">${tasks.map(taskRowHtml).join("")}</div>
  `;

  document.getElementById("capture-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("capture-input");
    await createTasksFromLines(input.value);
    input.value = "";
    renderMain();
  });

  document.querySelectorAll(".task-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".task-done").addEventListener("change", async (event) => {
      await setDone(id, event.target.checked);
      renderMain();
    });
    row.querySelector(".task-urgent").addEventListener("click", async () => {
      const active = row.querySelector(".task-urgent").dataset.active === "true";
      await setTag(id, "urgent", !active);
      renderMain();
    });
    row.querySelector(".task-important").addEventListener("click", async () => {
      const active = row.querySelector(".task-important").dataset.active === "true";
      await setTag(id, "important", !active);
      renderMain();
    });
    row.querySelector(".task-delete").addEventListener("click", async () => {
      await deleteTask(id);
      renderMain();
    });
  });
}

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
