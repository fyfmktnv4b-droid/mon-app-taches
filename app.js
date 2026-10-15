import { signUp, signIn, signOut, onAuthStateChange } from "./supabaseClient.js";
import { loadTasks, captureTasks, updateTag, updateDone, removeTask, updateReminderTime, flushQueue, initSync, loadAllRoutines, loadRoutine, toggleRoutineCheck } from "./sync.js";
import { clearLocalData } from "./storage.js";
import { getImportant, getOthers, getUnsorted, getSorted, splitActiveAndArchived } from "./quadrants.js";
import { fullExportJson } from "./export.js";
import { getSettings, setMorningReminderTime, setNotificationsEnabled } from "./settings.js";
import { subscribeToPush, unsubscribeFromPush, hasPushSubscription } from "./push.js";
import { pickQuoteForDate } from "./quotes.js";
import { sceneForDay } from "./dayScenes.js";
import { mountRoutineBlock } from "./routineBlock.js";
import { localDateString } from "./localDate.js";
import { MORNING_KEYS, MORNING_LABELS, SKIP_KEY, isChecked, isMorningDone, shouldShowRoutine } from "./routineLogic.js";

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
const routineSection = document.getElementById("routine");
const routineChecks = document.getElementById("routine-checks");
const routineContinue = document.getElementById("routine-continue");
const routineSkip = document.getElementById("routine-skip");
const openRoutine = document.getElementById("open-routine");
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
const headerDate = document.getElementById("header-date");
const headerTitle = document.getElementById("header-title");
const menuToggle = document.getElementById("menu-toggle");
const menuPanel = document.getElementById("menu-panel");
const menuScrim = document.getElementById("menu-scrim");
const captureForm = document.getElementById("capture-form");
const captureInput = document.getElementById("capture-input");
const navHistory = document.getElementById("nav-history");
const navSettings = document.getElementById("nav-settings");

let currentView = "main";
let unsortedOpen = false; // bandeau « À trier » déplié ?
// Bande de routine : un seul élément, gardé d'un rendu à l'autre. Si on le
// recréait vide à chaque rendu, l'écran raccourcirait d'une centaine de px le
// temps que la routine soit relue, et le contenu « sauterait » vers le haut.
const routineHost = document.createElement("div");
routineHost.id = "routine-block";
const openRows = new Set(); // tâches dont le panneau d'options est déplié
let wasSignedIn = null; // sentinel: forces the first auth event through
let routineLocalDate = null; // the local day the routine screen is currently showing
let routineState = {}; // that day's checks, as last known (server, cache, or optimistic)

function showWelcome() {
  authSection.hidden = true;
  routineSection.hidden = true;
  appSection.hidden = true;
  welcomeSection.hidden = false;
  // Reset in case a previous sign-in's click left this disabled (see the
  // welcomeContinue click handler below) — a fresh welcome screen must
  // always start with a usable button.
  welcomeContinue.disabled = false;

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
  routineSection.hidden = true;
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
  routineSection.hidden = true;
  appSection.hidden = true;
  authSection.hidden = false;
  mainView.innerHTML = "";
}

// Builds the four morning checkboxes from routineState and wires each one to
// write through toggleRoutineCheck(). Re-run after every toggle so a box
// reflects the merged (not just locally-clicked) value, and so "Continuer"'s
// disabled state always matches what's actually been saved.
function renderRoutineChecks() {
  routineChecks.innerHTML = MORNING_KEYS.map((key) => `
    <label class="routine-check">
      <input type="checkbox" class="routine-check-input" data-key="${key}" ${isChecked(routineState, key) ? "checked" : ""}>
      <span>${MORNING_LABELS[key]}</span>
    </label>
  `).join("");

  routineChecks.querySelectorAll(".routine-check-input").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const value = input.checked;
      // Offline, toggleRoutineCheck() queues the write and returns the
      // optimistic result; it only rejects if the local queue fails too.
      toggleRoutineCheck(routineLocalDate, key, value).then((updated) => {
        routineState = updated.checks;
        routineContinue.disabled = !isMorningDone(routineState);
      }).catch((err) => {
        console.error(err);
        input.checked = !value;
      });
    });
  });

  routineContinue.disabled = !isMorningDone(routineState);
}

function showRoutineScreen() {
  welcomeSection.hidden = true;
  authSection.hidden = true;
  appSection.hidden = true;
  routineSection.hidden = false;
  renderRoutineChecks();
}

// Called from "Commencer". Checks the day's routine — server-first with an
// offline/slow-network fallback to the local cache (loadRoutine(), sync.js)
// — and skips straight to the task screen if it's already done or was
// skipped earlier today. Never blocks entry: if anything here goes wrong,
// fail open to the task screen rather than strand the user on a blank step.
async function maybeShowRoutine() {
  routineLocalDate = localDateString();
  let routine;
  try {
    routine = await loadRoutine(routineLocalDate);
  } catch (err) {
    console.error(err);
    await enterApp();
    return;
  }
  routineState = routine.checks ?? {};
  if (shouldShowRoutine(routineState)) {
    showRoutineScreen();
  } else {
    await enterApp();
  }
}

// Le champ grandit avec le texte (une tâche par ligne), jusqu'à ~4 lignes,
// puis défile.
function fitCaptureInput() {
  captureInput.style.height = "auto";
  captureInput.style.height = `${Math.min(captureInput.scrollHeight, 112)}px`;
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

function reminderTime(task) {
  return task.reminder_time ? task.reminder_time.slice(0, 5) : "";
}

// Un seul choix : Important ou Autre. Chaque bouton fixe la valeur (il ne
// bascule pas), ce qui sort aussi la tâche de « À trier ».
function tagButtonsHtml(task) {
  return `
    <button class="task-important" data-active="${task.important === true}">Important</button>
    <button class="task-other" data-active="${task.important === false}">Autre</button>
  `;
}

// variant : "dark" (carte Urgent + Important), "light" (accordéons) ou
// "unsorted" (liste « À trier », avec ses boutons Urgent ? / Important ?).
function taskRowHtml(task, variant = "light") {
  const time = reminderTime(task);
  const isOpen = openRows.has(task.id);
  const pill = variant === "dark"
    ? `<button class="reminder-pill reminder-open ${time ? "set" : ""}" data-time="${time}" aria-label="Heure du rappel">${time || "+ Rappel"}</button>`
    : "";
  const reminderField = variant === "dark"
    ? ""
    : `<button class="reminder-btn reminder-open" data-time="${time}">${time ? `Rappel ${time}` : "+ Rappel"}</button>`;
  return `
    <div class="task-row task-${variant}" data-id="${task.id}">
      <div class="task-main">
        <input type="checkbox" class="task-done" aria-label="Terminée" ${task.done ? "checked" : ""}>
        <span class="task-text">${escapeHtml(task.text)}</span>
        ${pill}
        <button class="task-more" aria-label="Options" aria-expanded="${isOpen}">•••</button>
      </div>
      ${variant === "unsorted" ? `<div class="task-sort">${tagButtonsHtml(task)}</div>` : ""}
      <div class="task-actions" ${isOpen ? "" : "hidden"}>
        ${variant === "unsorted" ? "" : tagButtonsHtml(task)}
        ${reminderField}
        <button class="task-delete">Supprimer</button>
      </div>
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

function wireTaskRows(container) {
  container.querySelectorAll(".task-row[data-id]").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".task-done").addEventListener("change", (event) => {
      safely(() => updateDone(id, event.target.checked));
    });
    row.querySelector(".task-more").addEventListener("click", (event) => {
      const actions = row.querySelector(".task-actions");
      actions.hidden = !actions.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!actions.hidden));
      if (actions.hidden) openRows.delete(id); else openRows.add(id);
    });
    row.querySelector(".reminder-open")?.addEventListener("click", (event) => {
      openReminderSheet(id, event.currentTarget.dataset.time);
    });
    row.querySelector(".task-important").addEventListener("click", () => {
      safely(() => updateTag(id, "important", true));
    });
    row.querySelector(".task-other").addEventListener("click", () => {
      safely(() => updateTag(id, "important", false));
    });
    row.querySelector(".task-delete").addEventListener("click", () => {
      openRows.delete(id);
      safely(() => removeTask(id));
    });
  });
}

function formatHeaderDate(date) {
  const text = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setHeader(title) {
  headerDate.textContent = formatHeaderDate(new Date());
  headerTitle.textContent = title;
  captureForm.hidden = currentView !== "main";
}

const BACK_BUTTON = '<button type="button" class="back-link" id="back-main">‹ Aujourd\'hui</button>';

function wireBackLink() {
  document.getElementById("back-main").addEventListener("click", () => showView("main"));
}

async function renderMainView() {
  const allTasks = await loadTasks();
  const { active } = splitActiveAndArchived(allTasks, todayDateString());
  const unsorted = getUnsorted(active);
  const sorted = getSorted(active);
  const important = getImportant(sorted);
  const others = getOthers(sorted);
  const nothingSorted = important.length === 0 && others.length === 0;

  // Un rendu reconstruit tout l'écran : on retient où on en était (défilement,
  // élément ayant le focus) pour que cocher une tâche ne bouge rien.
  const keepPosition = mainView.dataset.view === "main";
  const scrollTop = mainView.scrollTop;
  const focused = document.activeElement;
  const focusedRow = keepPosition && mainView.contains(focused) ? focused.closest(".task-row[data-id]") : null;
  const focusedSelector = focusedRow && focused.className
    ? `.task-row[data-id="${focusedRow.dataset.id}"] .${String(focused.className).split(" ")[0]}`
    : null;

  setHeader("Aujourd'hui");
  mainView.dataset.view = "main";
  mainView.innerHTML = `
    <div id="routine-slot"></div>

    ${important.length ? `
      <section class="priority-card">
        <div class="priority-head"><span>Important</span><span>${important.length}</span></div>
        ${important.map((t) => taskRowHtml(t, "dark")).join("")}
      </section>` : ""}

    ${unsorted.length ? `
      <section class="unsorted-banner" data-open="${unsortedOpen}">
        <button class="unsorted-toggle" aria-expanded="${unsortedOpen}">
          <span class="unsorted-title">${unsorted.length} ${unsorted.length > 1 ? "tâches" : "tâche"} à trier</span>
          <span class="unsorted-cta">Trier <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span>
        </button>
        <div class="unsorted-list" ${unsortedOpen ? "" : "hidden"}>
          ${unsorted.map((t) => taskRowHtml(t, "unsorted")).join("")}
        </div>
      </section>` : ""}

    ${others.length ? `
      <section class="others-card">
        <div class="others-head"><span>Autres</span><span>${others.length}</span></div>
        ${others.map((t) => taskRowHtml(t, "light")).join("")}
      </section>` : ""}

    ${nothingSorted ? '<p class="empty empty-all">Rien de trié pour l\'instant</p>' : ""}
  `;

  mainView.querySelector(".unsorted-toggle")?.addEventListener("click", (event) => {
    const banner = event.currentTarget.closest(".unsorted-banner");
    unsortedOpen = !unsortedOpen;
    banner.dataset.open = String(unsortedOpen);
    banner.querySelector(".unsorted-list").hidden = !unsortedOpen;
    event.currentTarget.setAttribute("aria-expanded", String(unsortedOpen));
  });

  wireTaskRows(mainView);
  mainView.querySelector("#routine-slot").replaceWith(routineHost);
  // Le contenu précédent reste affiché jusqu'à ce que le nouveau soit prêt.
  mountRoutineBlock(routineHost);

  if (keepPosition) {
    mainView.scrollTop = scrollTop;
    if (focusedSelector) mainView.querySelector(focusedSelector)?.focus({ preventScroll: true });
  }
}

async function renderHistoryView() {
  const allTasks = await loadTasks();
  const { archived } = splitActiveAndArchived(allTasks, todayDateString());
  archived.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

  setHeader("Historique");
  mainView.dataset.view = "history";
  mainView.innerHTML = `
    ${BACK_BUTTON}
    <div id="history-list">${archived.map(historyRowHtml).join("") || '<p class="empty">Aucune tâche archivée</p>'}</div>
  `;
  wireBackLink();
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
    setHeader("Réglages");
    mainView.dataset.view = "settings";
    mainView.innerHTML = `
      ${BACK_BUTTON}
      <p class="empty">Réglages indisponibles hors-ligne — reconnecte-toi au réseau.</p>
    `;
    wireBackLink();
    return;
  }
  // The flag is account-wide; the subscription is per-device. Only claim
  // notifications are on when this device is actually subscribed too.
  const subscribed = await hasPushSubscription();
  const notificationsOn = settings.notifications_enabled && subscribed;
  setHeader("Réglages");
  mainView.dataset.view = "settings";
  mainView.innerHTML = `
    ${BACK_BUTTON}
    <form id="settings-form">
      <label>
        Heure du rappel matinal
        <input type="time" id="morning-reminder-time" value="${settings.morning_reminder_time ? settings.morning_reminder_time.slice(0, 5) : ""}">
      </label>
      <button type="submit">Enregistrer l'heure</button>
    </form>
    <button id="toggle-notifications">${notificationsOn ? "Désactiver" : "Activer"} les notifications</button>
  `;

  wireBackLink();
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

welcomeContinue.addEventListener("click", async () => {
  // Guards against a double tap while loadRoutine() is in flight (up to the
  // 2s network timeout in sync.js) — the screen is about to change anyway,
  // so there's nothing to restore the label to afterwards.
  welcomeContinue.disabled = true;
  await maybeShowRoutine();
});

routineContinue.addEventListener("click", enterApp);

// Manual reopen from the task screen: always shows the routine, even if it
// was completed or skipped today, so a box can still be checked later.
openRoutine.addEventListener("click", async () => {
  routineLocalDate = localDateString();
  try {
    routineState = (await loadRoutine(routineLocalDate)).checks ?? {};
  } catch (err) {
    console.error(err);
    routineState = {};
  }
  showRoutineScreen();
});

routineSkip.addEventListener("click", () => {
  // A skip is just one more key in the same jsonb row (SKIP_KEY = "skipped").
  // It only suppresses today's automatic prompt — it never locks the
  // checkboxes, so reopening the routine later and checking a box still
  // writes through normally. No guilt copy, no confirmation.
  // Not awaited: a slow network must not hold the task screen back. The
  // write is queued locally if it fails.
  toggleRoutineCheck(routineLocalDate, SKIP_KEY, true).catch(console.error);
  enterApp();
});

// Feuille « Heure du rappel » : le choix reste un brouillon local tant qu'on
// n'a pas touché « Valider » — rien n'est enregistré sur input/change, pour que
// la molette d'iPhone puisse tourner librement.
const reminderSheet = document.getElementById("reminder-sheet");
const reminderInput = document.getElementById("reminder-input");
const reminderOk = document.getElementById("reminder-ok");
const reminderRemove = document.getElementById("reminder-remove");
let reminderTaskId = null;
let reminderDraft = "";

function openReminderSheet(taskId, currentTime) {
  reminderTaskId = taskId;
  reminderDraft = currentTime || "09:00";
  reminderInput.value = reminderDraft;
  reminderRemove.hidden = !currentTime;
  reminderOk.disabled = false;
  reminderSheet.hidden = false;
}

function closeReminderSheet() {
  reminderSheet.hidden = true;
  reminderTaskId = null;
}

reminderInput.addEventListener("input", () => {
  reminderDraft = reminderInput.value; // brouillon seulement
  reminderOk.disabled = !reminderDraft;
});
reminderOk.addEventListener("click", () => {
  const id = reminderTaskId;
  const value = reminderDraft;
  closeReminderSheet();
  if (id && value) safely(() => updateReminderTime(id, value));
});
reminderRemove.addEventListener("click", () => {
  const id = reminderTaskId;
  closeReminderSheet();
  if (id) safely(() => updateReminderTime(id, null));
});
document.getElementById("reminder-cancel").addEventListener("click", closeReminderSheet);
document.getElementById("reminder-scrim").addEventListener("click", closeReminderSheet);

function setMenuOpen(open) {
  menuPanel.hidden = !open;
  menuScrim.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
}

menuToggle.addEventListener("click", () => setMenuOpen(menuPanel.hidden));
menuScrim.addEventListener("click", () => setMenuOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { setMenuOpen(false); closeReminderSheet(); }
});
// Toute action du menu le referme (la déconnexion / sauvegarde gardent leur handler).
menuPanel.addEventListener("click", (event) => {
  if (event.target.closest("button")) setMenuOpen(false);
});

function showView(view) {
  currentView = view;
  render();
}

navHistory.addEventListener("click", () => showView("history"));
navSettings.addEventListener("click", () => showView("settings"));

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
    const routines = await loadAllRoutines();
    const json = fullExportJson(tasks, routines);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mes-taches-${todayDateString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
});

captureInput.addEventListener("input", fitCaptureInput);

captureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!captureInput.value.trim()) return;
  clearAppError();
  await safely(() => captureTasks(captureInput.value));
  // safely() avale l'erreur et l'affiche : on ne vide le champ que si ça a marché.
  if (!appError.textContent) {
    captureInput.value = "";
    fitCaptureInput();
  }
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
