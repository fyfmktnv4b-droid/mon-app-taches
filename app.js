import { signUp, signIn, signOut, onAuthStateChange } from "./supabaseClient.js";
import { loadTasks, captureTasks, updateTag, updateDone, removeTask, updateReminderTime, flushQueue, initSync, loadAllRoutines, loadRoutine, toggleRoutineCheck } from "./sync.js";
import { clearLocalData } from "./storage.js";
import { MAX_TASK_LENGTH, longestTooLongLine } from "./syncLogic.js";
import { getImportant, getOthers, getUnsorted, getSorted, splitActiveAndArchived, splitOpenAndDone } from "./quadrants.js";
import { fullExportJson } from "./export.js";
import { getSettings, setMorningReminderTime, setNotificationsEnabled } from "./settings.js";
import { subscribeToPush, unsubscribeFromPush, hasPushSubscription } from "./push.js";
import { pickQuoteForDate } from "./quotes.js";
import { sceneForDay } from "./dayScenes.js";
import { mountRoutineBlock } from "./routineBlock.js";
import { localDateString, reminderTimeProblem, defaultReminderTime, noReminderTimeLeft, REMINDER_NO_TIME_LEFT_MESSAGE } from "./localDate.js";
import { splashScreen, splashWakeInMs } from "./splashLogic.js";
import { MORNING_KEYS, MORNING_LABELS, SKIP_KEY, isChecked, isMorningDone, shouldShowRoutine } from "./routineLogic.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

const splashSection = document.getElementById("splash");
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
const openRows = new Set();
// Cases cochées mais pas encore validées (Important / Autres) : brouillon local,
// jamais enregistré. « Validé ? » est la seule chose qui écrit done=true.
const draftDone = new Set();
let doneOpen = false; // boîte « Terminé » dépliée ? (repliée par défaut) // tâches dont le panneau d'options est déplié
let wasSignedIn = null; // sentinel: forces the first auth event through
let routineLocalDate = null; // the local day the routine screen is currently showing
let routineState = {}; // that day's checks, as last known (server, cache, or optimistic)

// Écran de chargement du démarrage : visible jusqu'au premier événement
// d'authentification (voir splashLogic.js), puis remplacé par l'accueil ou la
// connexion. Le minuteur de sécurité l'empêche de rester bloqué.
const splashStart = performance.now();
let splashAuthEvent; // undefined tant qu'aucun événement n'est arrivé
let splashTimer = null;
let splashDone = false;

function hideSplash() {
  splashDone = true;
  clearTimeout(splashTimer);
  splashSection.hidden = true;
  document.documentElement.classList.remove("loading");
}

function settleSplash() {
  if (splashDone) return;
  clearTimeout(splashTimer);
  const elapsed = performance.now() - splashStart;
  const screen = splashScreen(splashAuthEvent, elapsed);
  if (screen === "welcome") showWelcome();
  else if (screen === "auth") showAuth();
  else splashTimer = setTimeout(settleSplash, splashWakeInMs(splashAuthEvent, elapsed));
}

function showWelcome() {
  hideSplash();
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
  hideSplash();
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
  return localDateString();
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

// variant : "dark" (carte Important), "light" (boîte Autres), "unsorted"
// (liste « À trier » : ni case ni rappel, seulement Important / Autre) ou
// "done" (boîte Terminé : case verrouillée, menu « ••• »).
function taskRowHtml(task, variant = "light") {
  const time = reminderTime(task);
  const isOpen = openRows.has(task.id);
  const text = `<span class="task-text">${escapeHtml(task.text)}</span>`;

  if (variant === "unsorted") {
    return `
      <div class="task-row task-unsorted" data-id="${task.id}">
        <div class="task-main">
          ${text}
          <button class="task-more" aria-label="Options" aria-expanded="${isOpen}">•••</button>
        </div>
        <div class="task-sort">${tagButtonsHtml(task)}</div>
        <div class="task-actions" ${isOpen ? "" : "hidden"}>
          <button class="task-delete">Supprimer</button>
        </div>
      </div>
    `;
  }

  if (variant === "done") {
    return `
      <div class="task-row task-done-row" data-id="${task.id}">
        <div class="task-main">
          <input type="checkbox" class="task-done" aria-label="Terminée" checked disabled aria-disabled="true">
          ${text}
          <button class="task-menu-open" aria-label="Options" aria-haspopup="menu">•••</button>
        </div>
      </div>
    `;
  }

  const draft = draftDone.has(task.id);
  const pill = variant === "dark"
    ? `<button class="reminder-pill reminder-open ${time ? "set" : ""}" data-time="${time}" aria-label="Heure du rappel">${time || "+ Rappel"}</button>`
    : "";
  const reminderField = variant === "dark"
    ? ""
    : `<button class="reminder-btn reminder-open" data-time="${time}">${time ? `Rappel ${time}` : "+ Rappel"}</button>`;
  return `
    <div class="task-row task-${variant}" data-id="${task.id}" ${draft ? "data-draft" : ""}>
      <div class="task-main">
        <input type="checkbox" class="task-done" aria-label="Terminée" ${draft ? "checked" : ""}>
        ${text}
        ${pill}
        <button class="task-more" aria-label="Options" aria-expanded="${isOpen}">•••</button>
        ${draft ? '<button class="validate-btn">Validé ?</button>' : ""}
      </div>
      <div class="task-actions" ${isOpen ? "" : "hidden"}>
        ${tagButtonsHtml(task)}
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

function validateTask(id) {
  draftDone.delete(id);
  safely(() => updateDone(id, true));
}

function wireTaskRows(container) {
  container.querySelectorAll(".task-row[data-id]").forEach((row) => {
    const id = row.dataset.id;
    // Case : brouillon local uniquement (DOM seulement, pas de rendu, rien
    // d'enregistré). Les lignes de « À trier » et « Terminé » n'en ont pas /
    // l'ont verrouillée.
    row.querySelector(".task-done:not([disabled])")?.addEventListener("change", (event) => {
      if (event.target.checked) draftDone.add(id); else draftDone.delete(id);
      row.toggleAttribute("data-draft", event.target.checked);
      row.querySelector(".validate-btn")?.remove();
      if (event.target.checked) {
        const button = document.createElement("button");
        button.className = "validate-btn";
        button.textContent = "Validé ?";
        button.addEventListener("click", () => validateTask(id));
        row.querySelector(".task-main").append(button);
      }
    });
    row.querySelector(".validate-btn")?.addEventListener("click", () => validateTask(id));
    row.querySelector(".task-more")?.addEventListener("click", (event) => {
      const actions = row.querySelector(".task-actions");
      actions.hidden = !actions.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!actions.hidden));
      if (actions.hidden) openRows.delete(id); else openRows.add(id);
    });
    row.querySelector(".task-menu-open")?.addEventListener("click", (event) => {
      openTaskMenu(id, event.currentTarget);
    });
    row.querySelector(".reminder-open")?.addEventListener("click", (event) => {
      openReminderSheet(id, event.currentTarget.dataset.time);
    });
    row.querySelector(".task-important")?.addEventListener("click", () => {
      safely(() => updateTag(id, "important", true));
    });
    row.querySelector(".task-other")?.addEventListener("click", () => {
      safely(() => updateTag(id, "important", false));
    });
    row.querySelector(".task-delete")?.addEventListener("click", () => {
      openRows.delete(id);
      draftDone.delete(id);
      safely(() => removeTask(id));
    });
  });
}

// Petit menu « ••• » d'une tâche terminée : un seul élément partagé, ouvert et
// fermé sans aucun rendu de la liste.
const taskMenu = document.getElementById("task-menu");
const taskMenuScrim = document.getElementById("task-menu-scrim");
let taskMenuId = null;

function openTaskMenu(id, anchor) {
  taskMenuId = id;
  const appBox = appSection.getBoundingClientRect();
  const box = anchor.getBoundingClientRect();
  taskMenuScrim.hidden = false;
  taskMenu.hidden = false;
  const height = taskMenu.offsetHeight;
  const below = box.bottom - appBox.top + 4;
  const top = below + height > appBox.height ? box.top - appBox.top - height - 4 : below;
  taskMenu.style.top = `${Math.max(8, top)}px`;
  taskMenu.style.right = `${Math.max(8, appBox.right - box.right)}px`;
  taskMenu.querySelector("button").focus({ preventScroll: true });
}

function closeTaskMenu() {
  taskMenu.hidden = true;
  taskMenuScrim.hidden = true;
  taskMenuId = null;
}

taskMenuScrim.addEventListener("click", closeTaskMenu);
document.getElementById("task-undo").addEventListener("click", () => {
  const id = taskMenuId;
  closeTaskMenu();
  if (id) safely(() => updateDone(id, false)); // retourne dans sa boîte d'origine
});
document.getElementById("task-remove").addEventListener("click", () => {
  const id = taskMenuId;
  closeTaskMenu();
  if (id) safely(() => removeTask(id));
});

// Petit dégradé en bas de « À trier » tant qu'il reste de la liste à faire défiler.
function updateUnsortedFade() {
  const list = mainView.querySelector(".unsorted-list");
  const fade = mainView.querySelector(".unsorted-fade");
  if (!list || !fade) return;
  fade.dataset.visible = String(list.scrollHeight - list.scrollTop - list.clientHeight > 4);
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
  const { open, done } = splitOpenAndDone(active);
  const unsorted = getUnsorted(open);
  const sorted = getSorted(open);
  const important = getImportant(sorted);
  const others = getOthers(sorted);
  const nothingSorted = important.length === 0 && others.length === 0 && done.length === 0;
  // Un brouillon n'a de sens que pour une tâche encore ouverte.
  const openIds = new Set(open.map((t) => t.id));
  for (const id of [...draftDone]) if (!openIds.has(id)) draftDone.delete(id);

  // Un rendu reconstruit tout l'écran : on retient où on en était (défilement,
  // élément ayant le focus) pour que cocher une tâche ne bouge rien.
  const keepPosition = mainView.dataset.view === "main";
  const scrollTop = mainView.scrollTop;
  const unsortedScroll = mainView.querySelector(".unsorted-list")?.scrollTop ?? 0;
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
        <div class="unsorted-wrap" ${unsortedOpen ? "" : "hidden"}>
          <div class="unsorted-list">
            ${unsorted.map((t) => taskRowHtml(t, "unsorted")).join("")}
          </div>
          <div class="unsorted-fade" aria-hidden="true"></div>
        </div>
      </section>` : ""}

    ${others.length ? `
      <section class="others-card">
        <div class="others-head"><span>Autres</span><span>${others.length}</span></div>
        ${others.map((t) => taskRowHtml(t, "light")).join("")}
      </section>` : ""}

    ${done.length ? `
      <section class="done-card" data-open="${doneOpen}">
        <button class="done-toggle" aria-expanded="${doneOpen}">
          <span>Terminé <span class="count">· ${done.length}</span></span>
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="done-body" ${doneOpen ? "" : "hidden"}>
          ${done.map((t) => taskRowHtml(t, "done")).join("")}
        </div>
      </section>` : ""}

    ${nothingSorted ? '<p class="empty empty-all">Rien de trié pour l\'instant</p>' : ""}
  `;

  mainView.querySelector(".unsorted-toggle")?.addEventListener("click", (event) => {
    const banner = event.currentTarget.closest(".unsorted-banner");
    unsortedOpen = !unsortedOpen;
    banner.dataset.open = String(unsortedOpen);
    banner.querySelector(".unsorted-wrap").hidden = !unsortedOpen;
    updateUnsortedFade();
    event.currentTarget.setAttribute("aria-expanded", String(unsortedOpen));
  });

  mainView.querySelector(".done-toggle")?.addEventListener("click", (event) => {
    const card = event.currentTarget.closest(".done-card");
    doneOpen = !doneOpen;
    card.dataset.open = String(doneOpen);
    card.querySelector(".done-body").hidden = !doneOpen;
    event.currentTarget.setAttribute("aria-expanded", String(doneOpen));
  });

  wireTaskRows(mainView);
  mainView.querySelector("#routine-slot").replaceWith(routineHost);
  // Le contenu précédent reste affiché jusqu'à ce que le nouveau soit prêt.
  mountRoutineBlock(routineHost);

  const unsortedList = mainView.querySelector(".unsorted-list");
  if (unsortedList) {
    unsortedList.addEventListener("scroll", updateUnsortedFade, { passive: true });
    if (keepPosition) unsortedList.scrollTop = unsortedScroll;
    updateUnsortedFade();
  }

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
const reminderError = document.getElementById("reminder-error");
let reminderTaskId = null;
let reminderDraft = "";

// Une heure déjà passée est refusée (voir reminderTimeProblem dans
// localDate.js) : sans date, le rappel partirait le lendemain sans que l'app le
// dise. Valable pour la création et la modification, pas pour le rappel
// matinal des réglages. Sans rappel existant, la molette démarre sur une heure
// valide (defaultReminderTime), sinon valider sans y toucher serait refusé.
function openReminderSheet(taskId, currentTime) {
  reminderTaskId = taskId;
  reminderDraft = currentTime || defaultReminderTime() || "23:59";
  reminderInput.value = reminderDraft;
  reminderRemove.hidden = !currentTime;
  const noTimeLeft = noReminderTimeLeft();
  reminderError.textContent = noTimeLeft ? REMINDER_NO_TIME_LEFT_MESSAGE : "";
  reminderOk.disabled = noTimeLeft;
  reminderSheet.hidden = false;
}

function closeReminderSheet() {
  reminderSheet.hidden = true;
  reminderTaskId = null;
}

reminderInput.addEventListener("input", () => {
  reminderDraft = reminderInput.value; // brouillon seulement
  const noTimeLeft = noReminderTimeLeft();
  reminderError.textContent = noTimeLeft ? REMINDER_NO_TIME_LEFT_MESSAGE : "";
  reminderOk.disabled = !reminderDraft || noTimeLeft;
});
reminderOk.addEventListener("click", () => {
  const id = reminderTaskId;
  const value = reminderDraft;
  const problem = reminderTimeProblem(value);
  if (problem) {
    // La feuille reste ouverte, rien n'est enregistré.
    reminderError.textContent = problem;
    return;
  }
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
  if (event.key === "Escape") { setMenuOpen(false); closeReminderSheet(); closeTaskMenu(); }
});
// Toute action du menu le referme (la déconnexion / sauvegarde gardent leur handler).
menuPanel.addEventListener("click", (event) => {
  if (event.target.closest("button")) setMenuOpen(false);
});

// Une app restée ouverte passé minuit ne se met pas à jour toute seule : on
// redessine au retour au premier plan, ce qui sort les tâches d'hier de
// « Terminé » (elles passent dans l'Historique).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !appSection.hidden) render();
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
  const tooLong = longestTooLongLine(captureInput.value);
  if (tooLong) {
    // Le texte reste dans le champ pour pouvoir le raccourcir.
    showAppError(new Error(`Une tâche ne peut pas dépasser ${MAX_TASK_LENGTH} caractères (une ligne en fait ${tooLong}).`));
    return;
  }
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
  // Best-effort: a clear failure must not block getting back to the auth screen.
  if (isSignOut) clearLocalData().catch((err) => console.error(err));
  // Au démarrage, l'écran de chargement garde la main jusqu'à la décision de
  // splashScreen() ; ensuite chaque événement change d'écran tout de suite.
  if (!splashDone) {
    splashAuthEvent = nowSignedIn ? "session" : "none";
    settleSplash();
    return;
  }
  if (nowSignedIn) showWelcome(); else showAuth();
});

settleSplash();

initSync(() => {
  // Signed out, the RLS-filtered read returns [] rather than an error, which
  // would be cached as "no tasks" and wipe the offline cache. Only re-render
  // while the signed-in app view is actually showing.
  if (!appSection.hidden) render();
});
