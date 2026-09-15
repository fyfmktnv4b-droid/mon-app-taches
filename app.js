import { signUp, signIn, signOut, onAuthStateChange } from "./supabaseClient.js";
import { loadTasks, captureTasks, updateTag, updateDone, removeTask, updateReminderTime, flushQueue, initSync } from "./sync.js";
import { clearLocalData } from "./storage.js";
import { getQuadrant, getPriorityTasks, getUnsorted, getSorted, splitActiveAndArchived } from "./quadrants.js";
import { tasksToExportJson } from "./export.js";
import { getSettings, setMorningReminderTime, setNotificationsEnabled } from "./settings.js";
import { subscribeToPush, unsubscribeFromPush, hasPushSubscription } from "./push.js";
import { pickQuoteForDate } from "./quotes.js";
import { sceneForDay } from "./dayScenes.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

const authSection = document.getElementById("auth");
const welcomeSection = document.getElementById("welcome");
const welcomeDay = document.getElementById("welcome-day");
const welcomeQuote = document.getElementById("welcome-quote");
const welcomeVerse = document.getElementById("welcome-verse");
const welcomeScene = document.getElementById("welcome-scene");
const welcomeSceneFallback = document.getElementById("welcome-scene-fallback");
const welcomeContinue = document.getElementById("welcome-continue");
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
const navSettings = document.getElementById("nav-settings");

let currentView = "main";
let wasSignedIn = null; // sentinel: forces the first auth event through

function showWelcome() {
  authSection.hidden = true;
  appSection.hidden = true;
  welcomeSection.hidden = false;

  const now = new Date();
  const scene = sceneForDay(now);
  const { quote, author, verse, reference } = pickQuoteForDate(now);

  welcomeDay.textContent = scene.label;
  welcomeQuote.textContent = `« ${quote} » — ${author}`;
  welcomeVerse.textContent = `${verse} (${reference})`;
  // Never let both text blocks sit at full size together — whichever is
  // longer goes compact, so the day title and scene image (both fixed)
  // don't get squeezed off-screen by two tall blocks stacking.
  const quoteIsLonger = quote.length >= verse.length;
  welcomeQuote.classList.toggle("compact", quoteIsLonger);
  welcomeVerse.classList.toggle("compact", !quoteIsLonger);
  welcomeScene.alt = scene.alt;
  welcomeScene.hidden = false;
  welcomeSceneFallback.hidden = true;
  welcomeScene.onerror = () => {
    welcomeScene.hidden = true;
    welcomeSceneFallback.hidden = false;
    welcomeSceneFallback.textContent = scene.label;
  };
  welcomeScene.src = scene.file;
}

async function enterApp() {
  welcomeSection.hidden = true;
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
  welcomeSection.hidden = true;
  appSection.hidden = true;
  authSection.hidden = false;
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
      <input type="time" class="task-reminder" value="${task.reminder_time ? task.reminder_time.slice(0, 5) : ""}">
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
    row.querySelector(".task-reminder").addEventListener("change", (event) => {
      safely(() => updateReminderTime(id, event.target.value || null));
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
  // Read-only per spec — no wireTaskRows here.
}

async function renderSettingsView() {
  // getSettings() goes through supabase.auth.getUser() (network-dependent),
  // so offline it throws before anything is rendered — leaving the previous
  // screen on display. Degrade to a clear message instead.
  let settings;
  try {
    settings = await getSettings();
  } catch (_err) {
    mainView.innerHTML = `
      <h2>Réglages</h2>
      <p class="empty">Réglages indisponibles hors-ligne — reconnecte-toi au réseau.</p>
    `;
    return;
  }
  // The flag is account-wide; the subscription is per-device. Only claim
  // notifications are on when this device is actually subscribed too.
  const subscribed = await hasPushSubscription();
  const notificationsOn = settings.notifications_enabled && subscribed;
  mainView.innerHTML = `
    <h2>Réglages</h2>
    <form id="settings-form">
      <label>
        Heure du rappel matinal
        <input type="time" id="morning-reminder-time" value="${settings.morning_reminder_time ? settings.morning_reminder_time.slice(0, 5) : ""}">
      </label>
      <button type="submit">Enregistrer l'heure</button>
    </form>
    <button id="toggle-notifications">${notificationsOn ? "Désactiver" : "Activer"} les notifications</button>
  `;

  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = document.getElementById("morning-reminder-time").value;
    safely(() => setMorningReminderTime(value || null));
  });

  document.getElementById("toggle-notifications").addEventListener("click", () => {
    safely(async () => {
      if (notificationsOn) {
        await unsubscribeFromPush();
        await setNotificationsEnabled(false);
      } else {
        await subscribeToPush();
        await setNotificationsEnabled(true);
      }
    });
  });
}

async function render() {
  try {
    if (currentView === "main") await renderMainView();
    else if (currentView === "history") await renderHistoryView();
    else await renderSettingsView();
    clearAppError();
  } catch (err) {
    showAppError(err);
  }
}

welcomeContinue.addEventListener("click", enterApp);

navMain.addEventListener("click", () => {
  currentView = "main";
  navMain.dataset.active = "true";
  navHistory.dataset.active = "false";
  navSettings.dataset.active = "false";
  render();
});

navHistory.addEventListener("click", () => {
  currentView = "history";
  navMain.dataset.active = "false";
  navHistory.dataset.active = "true";
  navSettings.dataset.active = "false";
  render();
});

navSettings.addEventListener("click", () => {
  currentView = "settings";
  navMain.dataset.active = "false";
  navHistory.dataset.active = "false";
  navSettings.dataset.active = "true";
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
    await unsubscribeFromPush();
  } catch (err) {
    // Best-effort: never block sign-out on a push-unsubscribe failure (e.g.
    // no subscription existed, or the browser doesn't support Push).
    console.error(err);
  }
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
  // Only a true signed-in -> signed-out transition is a sign-out. The `null`
  // sentinel also lets a signed-out cold boot through, and that must NOT clear:
  // an expired session offline would otherwise wipe the cache and the unsynced queue.
  const isSignOut = wasSignedIn === true && !nowSignedIn;
  wasSignedIn = nowSignedIn;
  if (nowSignedIn) {
    showWelcome();
  } else {
    // Best-effort: a clear failure must not block getting back to the auth screen.
    if (isSignOut) clearLocalData().catch((err) => console.error(err));
    showAuth();
  }
});

initSync(() => {
  // Signed out, the RLS-filtered read returns [] rather than an error, which
  // would be cached as "no tasks" and wipe the offline cache. Only re-render
  // while the signed-in app view is actually showing.
  if (!appSection.hidden) render();
});
