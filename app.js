import { signUp, signIn, signOut, onAuthStateChange, sessionKeptButUnrenewable, recheckSession, onDataRequestWithoutUser, forgetSessionOnThisDevice } from "./supabaseClient.js";
import { loadTasks, captureTasks, updateTag, updateDone, removeTask, updateReminderTime, flushQueue, initSync, loadAllRoutines, loadRoutine, toggleRoutineCheck } from "./sync.js";
import { clearLocalData, getCachedTasks, getPendingMutations } from "./storage.js";
import { setServerGate } from "./authGate.js";
import { authTransition, authInput, serverGateOpen, offlineBannerText, SYNCING_TEXT_MS, signOutStep, signOutSheetText } from "./authLogic.js";
import { readMarker, writeMarker, clearMarker } from "./lastUser.js";
import { cacheOwner } from "./lastUserLogic.js";
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
import { APP_VERSION } from "./version.js";
import "./noZoom.js";
import { pendingReprise, bannerTitle, bannerSubtitle } from "./repriseLogic.js";
import { loadTasksForReprise } from "./reprise.js";
import { openRepriseScreen, handledIdsFor, abandonedIds } from "./repriseScreen.js";
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
const welcomeVersion = document.getElementById("welcome-version");
if (welcomeVersion) welcomeVersion.textContent = APP_VERSION;
const routineSection = document.getElementById("routine");
const routineChecks = document.getElementById("routine-checks");
const routineContinue = document.getElementById("routine-continue");
const routineSkip = document.getElementById("routine-skip");
const openRoutine = document.getElementById("open-routine");
const appSection = document.getElementById("app");
const repriseSection = document.getElementById("reprise");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const authInfo = document.getElementById("auth-info");
const offlineBanner = document.getElementById("offline-banner");
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
// État de connexion (voir authLogic.js) : "booting", "verified", "offline" ou
// "signedOut". La porte serveur (authGate.js) suit cet état.
let authState = "booting";
let signOutRequested = false; // vrai seulement pendant un clic sur « Se déconnecter »
let onlineSince = null; // dernier événement « online » vu en mode hors-ligne
let bannerTimer = null;
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
  const options = { hasMarker: readMarker() !== null, online: navigator.onLine };
  const screen = splashScreen(splashAuthEvent, elapsed, options);
  // Sans réponse du SDK à temps : mode hors-ligne provisoire (repère présent)
  // ou connexion. Seul un événement ultérieur pourra changer cet état.
  if (screen !== "wait" && authState === "booting") authState = screen === "offline" ? "offline" : "signedOut";
  if (screen === "welcome" || screen === "offline") showWelcome();
  else if (screen === "auth") showAuth();
  else splashTimer = setTimeout(settleSplash, splashWakeInMs(splashAuthEvent, elapsed, options));
}

function showWelcome() {
  hideSplash();
  authSection.hidden = true;
  routineSection.hidden = true;
  appSection.hidden = true;
  repriseSection.hidden = true;
  welcomeSection.hidden = false;
  authInfo.textContent = "";
  updateOfflineBanner();
  repriseOffered = false;
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
  repriseSection.hidden = true;
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
  repriseSection.hidden = true;
  authSection.hidden = false;
  mainView.innerHTML = "";
  updateOfflineBanner();
}

// Bandeau « Mode hors-ligne » : visible sur tous les écrans de l'app tant que
// la session n'est pas vérifiée, jamais sur le chargement ni la connexion.
function updateOfflineBanner() {
  clearTimeout(bannerTimer);
  const visible = authState === "offline" && splashDone && authSection.hidden;
  offlineBanner.hidden = !visible;
  document.documentElement.classList.toggle("offline-mode", visible);
  if (!visible) return;
  const now = Date.now();
  offlineBanner.textContent = offlineBannerText(onlineSince, now);
  // « Synchronisation en cours… » ne dure pas : on repasse au texte hors-ligne.
  if (onlineSince !== null) bannerTimer = setTimeout(updateOfflineBanner, Math.max(0, onlineSince + SYNCING_TEXT_MS - now) + 50);
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
  repriseSection.hidden = true;
  routineSection.hidden = false;
  routineSkip.disabled = false;
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
    await enterAfterRoutine();
    return;
  }
  routineState = routine.checks ?? {};
  if (shouldShowRoutine(routineState)) {
    showRoutineScreen();
  } else {
    await enterAfterRoutine();
  }
}

// « À reprendre aujourd'hui » : proposé automatiquement une seule fois par
// ouverture de l'app (après la routine), seulement s'il y a des tâches en
// attente. Ensuite, seul le bandeau de l'écran principal le rouvre.
let repriseOffered = false;
let startupInFlight = null; // évite un double passage sur un double tap

function enterAfterRoutine() {
  if (repriseOffered) return enterApp();
  if (!startupInFlight) {
    // Grisés pendant le chargement (jusqu'à 2 s sur un réseau lent).
    routineContinue.disabled = true;
    routineSkip.disabled = true;
    startupInFlight = (async () => {
      try {
        const tasks = await loadTasksForReprise();
        const today = todayDateString();
        const waiting = pendingReprise(tasks, today, undefined, handledIdsFor(today));
        repriseOffered = true;
        if (waiting.length) showReprise(waiting); else await enterApp();
      } catch (err) {
        // Comme maybeShowRoutine : en cas d'erreur, on entre quand même dans l'app.
        console.error(err);
        repriseOffered = true;
        await enterApp();
      }
    })().finally(() => {
      startupInFlight = null;
      routineContinue.disabled = !isMorningDone(routineState);
      routineSkip.disabled = false;
    });
  }
  return startupInFlight;
}

function showReprise(tasks) {
  welcomeSection.hidden = true;
  routineSection.hidden = true;
  authSection.hidden = true;
  appSection.hidden = true;
  repriseSection.hidden = false;
  openRepriseScreen(repriseSection, {
    tasks, today: todayDateString(), dateLabel: formatHeaderDate(new Date()), onExit: enterApp,
  });
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
  const today = todayDateString();
  const { active } = splitActiveAndArchived(allTasks, today);
  const { open: allOpen, done } = splitOpenAndDone(active);
  // Les tâches à reprendre (et les abandons pas encore supprimés) sont cachées
  // des boîtes : le bandeau rose rappelle qu'elles existent.
  const waiting = pendingReprise(allOpen, today, undefined, handledIdsFor(today));
  const hiddenIds = new Set([...waiting.map((t) => t.id), ...abandonedIds]);
  const open = allOpen.filter((t) => !hiddenIds.has(t.id));
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

    ${waiting.length ? `
      <button type="button" class="reprise-banner">
        <span class="reprise-banner-text">
          <span class="reprise-banner-title">${bannerTitle(waiting.length)}</span>
          <span class="reprise-banner-sub">${bannerSubtitle(waiting, today)}</span>
        </span>
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>` : ""}

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

    ${nothingSorted && !waiting.length ? '<p class="empty empty-all">Rien de trié pour l\'instant</p>' : ""}
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
  mainView.querySelector(".reprise-banner")?.addEventListener("click", () => showReprise(waiting));
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
  // Grisé pendant tout le démarrage (routine puis tâches à reprendre, jusqu'à
  // 2 s chacune sur un réseau lent) : évite un double tap et montre que ça charge.
  welcomeContinue.disabled = true;
  try {
    await maybeShowRoutine();
  } finally {
    // Jamais bloqué : réactivé même en cas d'erreur (l'écran a changé entre-temps).
    welcomeContinue.disabled = false;
  }
});

routineContinue.addEventListener("click", enterAfterRoutine);

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
  enterAfterRoutine();
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
  if (event.key === "Escape") { setMenuOpen(false); closeReminderSheet(); closeTaskMenu(); closeSignOutSheet(); }
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

// --- Se déconnecter ---
// Une modification non envoyée ne disparaît jamais sans que la personne l'ait
// accepté. Aucune étape n'attend le SDK ou le réseau sans limite : hors-ligne,
// une requête peut ne jamais répondre, et le bouton ne doit jamais rester figé.
const SIGN_OUT_FLUSH_MS = 5000;
const SIGN_OUT_SERVER_MS = 8000;
const PUSH_UNSUBSCRIBE_MS = 3000;
const signOutSheet = document.getElementById("signout-sheet");
const signOutText = document.getElementById("signout-text");
const signOutOk = document.getElementById("signout-ok");
const signOutAnyway = document.getElementById("signout-anyway");
let signingOut = false;

// Vrai si la promesse s'est terminée (réussie ou non) avant le délai ; sinon
// elle continue en arrière-plan, on cesse simplement de l'attendre.
function settlesWithin(promise, ms) {
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

async function pendingCount() {
  try {
    return (await getPendingMutations()).length;
  } catch (_err) {
    return null; // inconnu : signOutStep() ne le prend jamais pour zéro
  }
}

function openSignOutSheet(step, count) {
  signOutText.textContent = signOutSheetText(step, count);
  signOutOk.textContent = step === "confirm" ? "Rester connecté" : "Compris";
  signOutAnyway.hidden = step !== "confirm";
  signOutSheet.hidden = false;
}

function closeSignOutSheet() {
  signOutSheet.hidden = true;
}

const SIGNED_OUT_HERE_KEY = "mon-app-taches.signedOutHere";
const SERVER_NOT_TOLD = "Déconnexion faite sur cet appareil. Sans réseau, le serveur n'a pas pu être prévenu : ta session y reste valable jusqu'à son expiration.";

// Termine une déconnexion sans attendre le SDK : sa session et le repère sont
// effacés, puis la page est rechargée (voir forgetSessionOnThisDevice). Le
// message est retrouvé après le rechargement (sessionStorage, cet onglet seul).
function leaveWithoutSdk() {
  forgetSessionOnThisDevice();
  clearMarker();
  try {
    sessionStorage.setItem(SIGNED_OUT_HERE_KEY, "1");
  } catch (_err) {
    // Sans le message, la déconnexion reste faite.
  }
  location.reload();
}

// Session vérifiée : désabonnement des notifications (ligne serveur comprise),
// puis déconnexion auprès du serveur ; SIGNED_OUT fait le reste (handleAuthEvent).
async function signOutFromServer() {
  // Best-effort: never block sign-out on a push-unsubscribe failure (e.g.
  // no subscription existed, or the browser doesn't support Push).
  await settlesWithin(unsubscribeFromPush().catch((err) => console.error(err)), PUSH_UNSUBSCRIBE_MS);
  signOutRequested = true;
  const outcome = await Promise.race([
    signOut().then(() => "done", (err) => err),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), SIGN_OUT_SERVER_MS)),
  ]);
  if (outcome === "done") return;
  if (outcome === "timeout") {
    // Le serveur ne répond pas : la déconnexion demandée se termine sur
    // l'appareil, données locales comprises (comme après SIGNED_OUT).
    try {
      await clearLocalData();
    } catch (err) {
      console.error(err); // la copie reste protégée par cacheOwner()
    }
    leaveWithoutSdk();
    return;
  }
  // Erreur : supabase-js 2.115 efface quand même sa session, et son SIGNED_OUT
  // attend déjà dans la file (vendor/README.md). La demande doit rester vraie
  // pour lui, puis être retirée, par la même file.
  authEvents = authEvents.then(() => {
    signOutRequested = false;
    if (authSection.hidden) showAppError(outcome);
    else authInfo.textContent = SERVER_NOT_TOLD;
  });
}

// Hors-ligne, rien en attente : déconnexion sur cet appareil, sans le SDK.
// La copie locale n'est PAS effacée (jamais depuis le mode hors-ligne) : à la
// prochaine connexion, un autre compte la fera effacer (cacheOwner), le même
// compte la retrouvera.
async function signOutOnThisDevice() {
  // Désabonnement sur l'appareil seulement : la porte est fermée, la ligne
  // serveur reste (le serveur la constatera morte au prochain envoi).
  await settlesWithin(unsubscribeFromPush(), PUSH_UNSUBSCRIBE_MS);
  leaveWithoutSdk();
}

async function startSignOut() {
  // Session vérifiée : on tente d'abord d'envoyer ce qui attend.
  if (authState === "verified") await settlesWithin(flushQueue(), SIGN_OUT_FLUSH_MS);
  const count = await pendingCount();
  const step = signOutStep(authState, count);
  if (step === "server") await signOutFromServer();
  else if (step === "local") await signOutOnThisDevice();
  else openSignOutSheet(step, count);
}

// Passe par la même file que les événements du SDK : l'état ne change pas
// pendant la décision.
function runSignOut(action) {
  if (signingOut) return;
  signingOut = true;
  authEvents = authEvents.then(action).catch((err) => console.error(err))
    .finally(() => { signingOut = false; });
}

signOutButton.addEventListener("click", () => runSignOut(startSignOut));
signOutOk.addEventListener("click", closeSignOutSheet);
document.getElementById("signout-scrim").addEventListener("click", closeSignOutSheet);
signOutAnyway.addEventListener("click", () => {
  closeSignOutSheet();
  // L'état a pu changer pendant que la feuille était ouverte : on redécide.
  runSignOut(() => (authState === "verified" ? signOutFromServer() : startSignOut()));
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

// Message de l'écran de connexion quand la session n'a pas pu être gardée.
async function showExpiredMessage(marker) {
  let pending = 0;
  try {
    pending = (await getPendingMutations()).length;
  } catch (_err) {
    // Sans compte exact, on n'annonce simplement pas de nombre.
  }
  const account = marker?.maskedEmail ? ` avec ${marker.maskedEmail}` : "";
  const kept = pending === 0 ? ""
    : ` : ${pending === 1 ? "ta modification non envoyée est gardée et partira" : `tes ${pending} modifications non envoyées sont gardées et partiront`} dès la connexion`;
  authInfo.textContent = `Ta session a expiré. Reconnecte-toi${account}${kept}.`;
}

async function ownerOfCache() {
  try {
    return cacheOwner(await getCachedTasks());
  } catch (_err) {
    return null;
  }
}

// Applique authTransition() (authLogic.js) à un événement du SDK.
async function handleAuthEvent(session, event) {
  const marker = readMarker();
  // INITIAL_SESSION vide : panne réseau (le SDK garde sa session) ou plus de
  // session du tout ? Seulement utile s'il existe un repère.
  const networkFailure = !session && event !== "SIGNED_OUT" && marker !== null
    && (authState === "booting" || authState === "offline")
    && await sessionKeptButUnrenewable();
  const input = authInput(event, session, { signOutRequested, networkFailure });
  if (input.kind === "signedOut") signOutRequested = false;
  const out = authTransition(authState, input, {
    markerUserId: marker?.userId ?? null,
    cacheOwnerId: input.kind === "session" && !marker ? await ownerOfCache() : null,
  });
  authState = out.state;

  if (out.clear) {
    // Attendu AVANT d'ouvrir la porte ou d'afficher quoi que ce soit : les
    // données d'un autre compte ne doivent jamais apparaître ni être rejouées.
    try {
      await clearLocalData();
    } catch (err) {
      console.error(err);
      authState = "signedOut";
      setServerGate(false);
      showAuth();
      authError.textContent = "Impossible de préparer l'app pour ce compte. Ferme les autres onglets de l'app et réessaie.";
      signOut().catch(() => {});
      return;
    }
  }
  setServerGate(serverGateOpen(authState));
  if (out.clearMarker) clearMarker();
  if (out.setMarker) writeMarker(session.user.id, session.user.email);
  if (out.expiredMessage) await showExpiredMessage(marker);
  if (authState !== "offline") onlineSince = null;

  // Au démarrage, l'écran de chargement garde la main jusqu'à la décision de
  // splashScreen() ; ensuite chaque événement change d'écran tout de suite.
  if (!splashDone) {
    splashAuthEvent = { verified: "session", offline: "network", signedOut: "none" }[authState];
    settleSplash();
    return;
  }
  if (out.screen === "welcome" || out.screen === "offline") showWelcome();
  else if (out.screen === "auth") showAuth();
  else updateOfflineBanner();
  if (out.flush) {
    // Retour du réseau, même compte : on reste sur l'écran et la file repart.
    flushQueue().catch(() => {}).then(() => { if (!appSection.hidden) render(); });
  }
}

// Message d'une déconnexion faite juste avant le rechargement (leaveWithoutSdk).
try {
  if (sessionStorage.getItem(SIGNED_OUT_HERE_KEY)) {
    sessionStorage.removeItem(SIGNED_OUT_HERE_KEY);
    authInfo.textContent = SERVER_NOT_TOLD;
  }
} catch (_err) {
  // Stockage inaccessible : pas de message.
}

// Les événements sont traités un par un, dans l'ordre d'arrivée.
let authEvents = Promise.resolve();
onAuthStateChange((session, event) => {
  authEvents = authEvents.then(() => handleAuthEvent(session, event)).catch((err) => console.error(err));
});

// Le jeton a expiré pendant l'usage et le SDK n'a pas pu le renouveler (voir
// dataRequestLock dans supabaseClient.js) : comme une panne réseau, on passe
// en mode hors-ligne sur place. La suite arrive par onAuthStateChange
// (TOKEN_REFRESHED : retour sur place ; SIGNED_OUT : écran de connexion).
// Pendant une déconnexion demandée, le jeton manque parce que le SDK vient de
// l'effacer : son SIGNED_OUT doit trouver l'état "verified" pour tout effacer.
function handleUserTokenMissing() {
  if (authState !== "verified" || signOutRequested) return;
  const out = authTransition(authState, { kind: "noSession", networkFailure: true }, {
    markerUserId: readMarker()?.userId ?? null,
  });
  authState = out.state;
  setServerGate(serverGateOpen(authState));
  if (out.screen === "auth") showAuth();
  else updateOfflineBanner();
}
onDataRequestWithoutUser(() => {
  authEvents = authEvents.then(handleUserTokenMissing).catch((err) => console.error(err));
});

// En mode hors-ligne, chaque signe de réseau relance la vérification de la
// session ; la réponse arrive par onAuthStateChange.
function recheckIfOffline() {
  if (authState === "offline") recheckSession();
}
window.addEventListener("online", () => {
  if (authState === "offline") onlineSince = Date.now();
  updateOfflineBanner();
  recheckIfOffline();
});
window.addEventListener("offline", () => {
  onlineSince = null;
  updateOfflineBanner();
});
window.addEventListener("focus", recheckIfOffline);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") recheckIfOffline();
});

settleSplash();

initSync(() => {
  // Signed out, the RLS-filtered read returns [] rather than an error, which
  // would be cached as "no tasks" and wipe the offline cache. Only re-render
  // while the signed-in app view is actually showing.
  if (!appSection.hidden) render();
});
