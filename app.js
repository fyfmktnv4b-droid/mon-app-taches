import { signUp, signIn, signOut, onAuthStateChange, sessionKeptButUnrenewable, recheckSession, onDataRequestWithoutUser, forgetSessionOnThisDevice } from "./supabaseClient.js";
import { loadTasks, captureTasks, updateFields, updateDone, removeTask, updateReminderTime, flushQueue, initSync, loadAllRoutines, loadRoutine, toggleRoutineCheck } from "./sync.js";
import { clearLocalData, getCachedTasks, getPendingMutations } from "./storage.js";
import { setServerGate } from "./authGate.js";
import { authTransition, authInput, serverGateOpen, offlineBannerText, SYNCING_TEXT_MS, signOutStep, signOutSheetText } from "./authLogic.js";
import { readMarker, writeMarker, clearMarker } from "./lastUser.js";
import { cacheOwner } from "./lastUserLogic.js";
import { MAX_TASK_LENGTH, longestTooLongLine, importanceFields } from "./syncLogic.js";
import { getImportant, getOthers, getUnsorted, getSorted, splitActiveAndArchived, splitOpenAndDone } from "./quadrants.js";
import { fullExportJson } from "./export.js";
import { getSettings, setReminderTimes, setNotificationsEnabled, setWeeklyReviewEnabled } from "./settings.js";
import {
  parseWeeklyReviewTime, weeklyReviewTimeForInput, SAVED_TIMES_MESSAGE, SAVED_SWITCH_MESSAGE,
} from "./settingsLogic.js";
import { subscribeToPush, unsubscribeFromPush, hasPushSubscription } from "./push.js";
import { pickQuoteForDate } from "./quotes.js";
import { sceneForDay } from "./dayScenes.js";
import { readRoutineBlock, mountRoutineBlock } from "./routineBlock.js";
import { localDateString, reminderTimeProblem, defaultReminderTime, noReminderTimeLeft, REMINDER_NO_TIME_LEFT_MESSAGE } from "./localDate.js";
import { splashScreen, splashWakeInMs } from "./splashLogic.js";
import { APP_VERSION } from "./version.js";
import "./noZoom.js";
import { pendingReprise, bannerTitle, bannerSubtitle } from "./repriseLogic.js";
import { loadTasksForReprise, loadYesterdayQuestions } from "./reprise.js";
import { openRepriseScreen, handledIdsFor, abandonedIds } from "./repriseScreen.js";
import { openBilanScreen } from "./bilanScreen.js";
import { closeFooterHtml } from "./closeFooter.js";
import { takeOpenRequest } from "./openRequest.js";
import { settlesWithin, showAfterLoading, createMenuSwap, FLUSH_WAIT_MS } from "./screenSwap.js";
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
const bilanSection = document.getElementById("bilan");
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
const navBilan = document.getElementById("nav-bilan");
const screenLoading = document.getElementById("screen-loading");

// Les écrans pleins : un seul visible à la fois (showOnly). L'écran de
// démarrage (#splash) a sa propre règle (hideSplash).
const SCREENS = [authSection, welcomeSection, routineSection, appSection, repriseSection, bilanSection, screenLoading];
function showOnly(section) {
  for (const screen of SCREENS) screen.hidden = screen !== section;
}

// « Fermer » (closeFooter.js) des écrans Historique et Réglages : sous la zone
// qui défile, à la place de la barre de saisie ; et celui de « Ma routine »,
// affiché seulement quand elle est ouverte depuis le menu.
mainView.insertAdjacentHTML("afterend", closeFooterHtml());
const viewFooter = mainView.nextElementSibling;
viewFooter.hidden = true;
routineSection.insertAdjacentHTML("beforeend", closeFooterHtml());
const routineFooter = routineSection.lastElementChild;
routineFooter.hidden = true;

// Écran DEMANDÉ (pas forcément encore affiché : l'écran précédent reste en
// place pendant les lectures du suivant). Vues de #app : "main", "history",
// "settings" ; écrans pleins : "bilan", "routine", "reprise", "welcome", "auth".
// Chaque rendu vérifie, après ses lectures, qu'il est toujours celui demandé.
let currentView = "main";
const APP_VIEWS = new Set(["main", "history", "settings"]);
let routineFromMenu = false; // « Ma routine » ouverte depuis le menu (et non au démarrage)
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
// Tâches de l'écran principal telles qu'au dernier rendu, par id : le
// classement a besoin de l'état d'avant pour savoir si la tâche ENTRE dans
// Important (voir importanceFields).
let shownTasks = new Map();
let doneOpen = false; // boîte « Terminé » dépliée ? (repliée par défaut) // tâches dont le panneau d'options est déplié
// État de connexion (voir authLogic.js) : "booting", "verified", "offline" ou
// "signedOut". La porte serveur (authGate.js) suit cet état.
let authState = "booting";
let signOutRequested = false; // vrai seulement pendant un clic sur « Se déconnecter »
let bilanRequested = false; // notification touchée : le Bilan attend le premier écran
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
  currentView = "welcome";
  showOnly(null);
  authInfo.textContent = "";
  repriseOffered = false;
  // Notification touchée : le Bilan prend la place de l'accueil, sans passer
  // par lui. « Fermer » mènera à « Aujourd'hui » (accueil et routine sautés cette fois).
  if (bilanRequested) {
    bilanRequested = false;
    showBilan();
    updateOfflineBanner();
    return;
  }
  welcomeSection.hidden = false;
  updateOfflineBanner();
  // Reset in case a previous sign-in's click left this disabled (see the
  // welcomeContinue click handler below) — a fresh welcome screen must
  // always start with a usable button.
  welcomeContinue.disabled = false;

  const now = new Date();
  const scene = sceneForDay(now);
  const { quote, author, verse, reference } = pickQuoteForDate(now);

  welcomeDay.textContent = scene.label;
  // Espaces insécables à l'intérieur des guillemets : jamais « ou » seul en bout de ligne.
  welcomeQuote.textContent = `«\u00A0${quote}\u00A0» — ${author}`;
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

// Entrée dans l'app (après l'accueil, la routine, « À reprendre », ou
// « Fermer » d'un écran plein). En un coup : l'écran affiché reste en place
// jusqu'à ce que « Aujourd'hui » soit prêt (« Chargement… » au-delà de 300 ms).
// L'écran n'est plus vidé ici : il l'est à la déconnexion et au changement de
// compte (forgetShownData). L'envoi de la file est attendu 2 s au plus : on
// cesse d'attendre, il continue en arrière-plan, jamais annulé ni relancé
// (flushQueue partage l'envoi en cours). Hors-ligne, render() prend le cache.
function enterApp() {
  if (!APP_VIEWS.has(currentView)) currentView = "main";
  return render({ loading: true, before: () => settlesWithin(flushQueue(), FLUSH_WAIT_MS) });
}

function showAuth() {
  hideSplash();
  currentView = "auth";
  showOnly(authSection);
  forgetShownData();
  updateOfflineBanner();
}

// Rien d'un compte ne reste dans la page pour le suivant, même caché : appelé
// à l'écran de connexion (déconnexion, session perdue) et quand les données
// locales d'un autre compte sont effacées. Indispensable depuis la v44 :
// enterApp ne vide plus l'écran, l'ancien contenu reste en place jusqu'au
// nouveau dessin.
function forgetShownData() {
  mainView.innerHTML = "";
  delete mainView.dataset.view;
  routineHost.innerHTML = "";
  bilanSection.innerHTML = "";
  repriseSection.innerHTML = "";
  shownTasks = new Map();
  draftDone.clear();
  openRows.clear();
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
  currentView = "routine";
  showOnly(routineSection);
  routineSkip.disabled = false;
  // Depuis le menu seulement : « Fermer » en bas. Au démarrage, rien ne change.
  routineFooter.hidden = !routineFromMenu;
  routineSection.classList.toggle("from-menu", routineFromMenu);
  renderRoutineChecks();
}

// Called from "Commencer". Checks the day's routine — server-first with an
// offline/slow-network fallback to the local cache (loadRoutine(), sync.js)
// — and skips straight to the task screen if it's already done or was
// skipped earlier today. Never blocks entry: if anything here goes wrong,
// fail open to the task screen rather than strand the user on a blank step.
async function maybeShowRoutine() {
  routineFromMenu = false;
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
// ouverture de l'app (après la routine), s'il y a des tâches en attente OU des
// questions sur les habitudes d'hier (carte « Hier »). Ensuite, seul le
// bandeau de l'écran principal le rouvre, pour les tâches seulement.
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
        const today = todayDateString();
        // En parallèle, chacune plafonnée à 2 s : pas d'attente en plus.
        const [tasks, hier] = await Promise.all([loadTasksForReprise(), loadYesterdayQuestions(today)]);
        const waiting = pendingReprise(tasks, today, undefined, handledIdsFor(today));
        repriseOffered = true;
        if (waiting.length || hier.questions.length) showReprise(waiting, hier); else await enterApp();
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

function showReprise(tasks, hier = { yesterday: null, questions: [] }) {
  currentView = "reprise";
  showOnly(repriseSection);
  openRepriseScreen(repriseSection, {
    tasks, habitQuestions: hier.questions, yesterday: hier.yesterday,
    today: todayDateString(), dateLabel: formatHeaderDate(new Date()), onExit: enterApp,
  });
}

// Bilan de la semaine : plein écran, en lecture seule, recalculé à chaque
// ouverture. « Fermer » ramène à « Aujourd'hui », d'où qu'il ait été ouvert
// (menu de n'importe quel écran, notification).
// En un coup : l'écran affiché reste en place pendant les lectures, puis le
// Bilan complet le remplace dans la même image. `loading: false` : simple
// rafraîchissement (retour au premier plan), jamais de « Chargement… ».
function showBilan({ loading = true } = {}) {
  currentView = "bilan";
  return swapScreen(() => openBilanScreen(bilanSection, {
    excludedIds: abandonedIds,
    onClose: closeToToday,
    isWanted: () => currentView === "bilan",
    reveal: () => showOnly(bilanSection),
  }), { view: "bilan", section: bilanSection, loading });
}

// Changement d'écran en un coup (screenSwap.js) : `work` lit puis dessine
// l'écran `view` (montré par `section`) s'il est toujours demandé. Au-delà de
// 300 ms, « Chargement… » (tout de suite si aucun écran n'est affiché).
// Seulement pour un changement d'écran (`loading`), jamais pour un redessin
// (case validée, synchronisation, retour au premier plan).
function swapScreen(work, { view, section, loading = true }) {
  if (!loading) return work();
  return showAfterLoading(work, {
    wanted: () => currentView === view,
    showLoading: () => showOnly(screenLoading),
    stillLoading: () => !screenLoading.hidden,
    giveUp: () => showOnly(section),
    immediately: SCREENS.every((screen) => screen.hidden),
  });
}

// Relève la boîte aux lettres (openRequest.js). Au chargement ou sur l'écran de
// connexion, le Bilan attend le premier écran (showWelcome) ; sinon il s'ouvre
// tout de suite, feuilles et menu refermés (ils réapparaîtraient après « Fermer »).
// Renvoie vrai si une demande a été prise.
async function honorOpenRequest() {
  if (!(await takeOpenRequest())) return false;
  if (!splashDone || !authSection.hidden) {
    bilanRequested = true;
    return true;
  }
  setMenuOpen(false);
  closeReminderSheet();
  closeTaskMenu();
  closeSignOutSheet();
  showBilan();
  return true;
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

// Lance une action : en cas d'erreur, l'affiche dans #app-error ; en cas de
// réussite, redessine l'écran. `redraw: false` (écran Réglages) : pas de
// redessin, l'écran reste tel quel et l'appelant affiche sa confirmation ;
// seule l'ancienne erreur est effacée, comme le ferait le redessin.
// Renvoie vrai si l'action a réussi.
async function safely(fn, { redraw = true } = {}) {
  try {
    await fn();
  } catch (err) {
    showAppError(err);
    return false;
  }
  if (redraw) render();
  else clearAppError();
  return true;
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

// Important (true) ou Autre (false) : important et important_since partent
// ensemble, en une seule écriture (directe ou en file).
function classifyTask(id, important) {
  const task = shownTasks.get(id) ?? { id, important: null };
  return updateFields(id, importanceFields(task, important, todayDateString()));
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
      safely(() => classifyTask(id, true));
    });
    row.querySelector(".task-other")?.addEventListener("click", () => {
      safely(() => classifyTask(id, false));
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

// Appelée par chaque vue au moment de son dessin (après ses lectures et sa
// garde « toujours demandée ? ») : titre, contenu et apparition de #app dans
// la même image.
function setHeader(title) {
  showOnly(appSection);
  headerDate.textContent = formatHeaderDate(new Date());
  headerTitle.textContent = title;
  captureForm.hidden = currentView !== "main";
  viewFooter.hidden = currentView === "main";
}

// « Fermer », sur tous les écrans du menu : toujours « Aujourd'hui », quel que
// soit l'écran précédent. Depuis Historique ou Réglages, simple changement de
// vue ; depuis un écran plein (Bilan, Ma routine), retour dans l'app.
function closeToToday() {
  routineFromMenu = false;
  currentView = "main";
  if (!appSection.hidden) return render({ loading: true });
  return enterApp();
}

async function renderMainView() {
  // La routine du matin est lue en même temps que les tâches et dessinée avec
  // elles : jamais d'« Aujourd'hui » sans sa routine, puis un saut.
  const [allTasks, routineData] = await Promise.all([loadTasks(), readRoutineBlock()]);
  if (currentView !== "main") return; // un autre écran a été demandé entre-temps (voir render)
  shownTasks = new Map(allTasks.map((t) => [t.id, t]));
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
  mountRoutineBlock(routineHost, routineData);

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
  if (currentView !== "history") return; // voir render
  const { archived } = splitActiveAndArchived(allTasks, todayDateString());
  archived.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

  setHeader("Historique");
  mainView.dataset.view = "history";
  mainView.innerHTML = `
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
    if (currentView !== "settings") return; // voir render
    setHeader("Réglages");
    mainView.dataset.view = "settings";
    mainView.innerHTML = `
      <p class="empty">Réglages indisponibles hors-ligne — reconnecte-toi au réseau.</p>
    `;
    return;
  }
  // The flag is account-wide; the subscription is per-device. Only claim
  // notifications are on when this device is actually subscribed too.
  const subscribed = await hasPushSubscription();
  if (currentView !== "settings") return; // voir render
  const notificationsOn = settings.notifications_enabled && subscribed;
  setHeader("Réglages");
  mainView.dataset.view = "settings";
  mainView.innerHTML = `
    <form id="settings-form">
      <label>
        Heure du rappel matinal
        <input type="time" id="morning-reminder-time" value="${settings.morning_reminder_time ? settings.morning_reminder_time.slice(0, 5) : ""}">
      </label>
      <label class="routine-check">
        <input type="checkbox" role="switch" id="weekly-review-enabled" ${settings.weekly_review_enabled ? "checked" : ""}>
        <span>Bilan du dimanche</span>
      </label>
      <p id="weekly-review-enabled-status" class="field-status" role="status"></p>
      <label>
        Heure du bilan
        <input type="time" id="weekly-review-time" value="${weeklyReviewTimeForInput(settings.weekly_review_time)}" aria-describedby="weekly-review-time-error" ${settings.weekly_review_enabled ? "" : "disabled"}>
      </label>
      <p id="weekly-review-time-error" class="field-error" role="alert"></p>
      <button type="submit" id="save-reminder-times">Enregistrer les heures</button>
      <p id="save-reminder-times-status" class="field-status" role="status"></p>
    </form>
    <button id="toggle-notifications">${notificationsOn ? "Désactiver" : "Activer"} les notifications</button>
  `;

  const weeklyReview = document.getElementById("weekly-review-enabled");
  const weeklyTime = document.getElementById("weekly-review-time");
  const weeklyTimeError = document.getElementById("weekly-review-time-error");
  const saveTimes = document.getElementById("save-reminder-times");
  const showWeeklyTimeError = (message) => {
    weeklyTimeError.textContent = message;
    if (message) weeklyTime.setAttribute("aria-invalid", "true");
    else weeklyTime.removeAttribute("aria-invalid");
  };
  weeklyTime.addEventListener("input", () => showWeeklyTimeError(""));

  // Confirmations : affichées après une réussite seulement, effacées dès la
  // modification suivante (un des trois champs) ou le prochain enregistrement.
  // `edits` compte les modifications : une réponse arrivée après une nouvelle
  // saisie ne confirme pas ce qui est maintenant à l'écran.
  const form = document.getElementById("settings-form");
  const switchStatus = document.getElementById("weekly-review-enabled-status");
  const timesStatus = document.getElementById("save-reminder-times-status");
  let edits = 0;
  // Heure du bilan enregistrée : le champ grisé (case décochée) l'affiche
  // toujours, jamais une saisie qui ne sera pas envoyée (le redessin le
  // faisait avant la v43).
  let storedWeeklyTime = weeklyReviewTimeForInput(settings.weekly_review_time);
  const clearSaved = () => {
    edits += 1;
    switchStatus.textContent = "";
    timesStatus.textContent = "";
  };
  // L'interrupteur efface lui-même, au début de son propre enregistrement.
  const onEdit = (event) => { if (event.target !== weeklyReview) clearSaved(); };
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);

  // « Enregistrer les heures » : tout ou rien. Une heure du bilan refusée
  // n'envoie rien, pas même l'heure du matin. Case décochée : l'heure du bilan
  // n'est ni vérifiée ni envoyée. En cas d'échec d'écriture, les saisies
  // restent à l'écran pour réessayer.
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSaved();
    const morning = document.getElementById("morning-reminder-time").value || null;
    let weeklyReviewTime;
    if (weeklyReview.checked) {
      const parsed = parseWeeklyReviewTime(weeklyTime.value);
      if (parsed.error) {
        showWeeklyTimeError(parsed.error);
        return;
      }
      weeklyReviewTime = parsed.value;
    }
    showWeeklyTimeError("");
    saveTimes.disabled = true;
    const startedAt = edits;
    // Pas de redessin : l'écran garde les saisies. Réussite ou échec, le
    // bouton est réactivé ; en cas d'échec, l'erreur habituelle et rien d'autre.
    const saved = await safely(() => setReminderTimes({ morning, weeklyReview: weeklyReviewTime }), { redraw: false });
    saveTimes.disabled = false;
    if (!saved) return;
    // Heure envoyée : c'est la nouvelle heure enregistrée. Champ vidé : NULL
    // enregistré, l'heure par défaut (20:00) affichée. Case décochée : l'heure
    // n'a pas été envoyée, le champ grisé reprend celle qui est enregistrée.
    if (weeklyReviewTime !== undefined) storedWeeklyTime = weeklyReviewTimeForInput(weeklyReviewTime);
    if (weeklyReviewTime == null) weeklyTime.value = storedWeeklyTime;
    if (edits === startedAt) timesStatus.textContent = SAVED_TIMES_MESSAGE;
  });

  // Enregistré dès le toucher. En cas d'échec, la case reprend son état :
  // elle ne doit jamais afficher autre chose que ce que le serveur connaît.
  // L'heure du bilan est grisée tant que la case est décochée.
  // Pas de redessin non plus : en cas de réussite, la case est réactivée et la
  // confirmation s'affiche sous elle.
  weeklyReview.addEventListener("change", async () => {
    const wanted = weeklyReview.checked;
    weeklyReview.disabled = true;
    weeklyTime.disabled = !wanted;
    if (!wanted) showWeeklyTimeError("");
    clearSaved();
    const startedAt = edits;
    const saved = await safely(async () => {
      try {
        await setWeeklyReviewEnabled(wanted);
      } catch (err) {
        weeklyReview.checked = !wanted;
        weeklyTime.disabled = wanted;
        throw err;
      }
    }, { redraw: false });
    weeklyReview.disabled = false;
    if (saved && !wanted) weeklyTime.value = storedWeeklyTime;
    if (saved && edits === startedAt) switchStatus.textContent = SAVED_SWITCH_MESSAGE;
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

// Chaque écran vérifie, après ses lectures, qu'il est toujours celui demandé :
// sinon un rendu lent (relancé par la synchronisation au retour du réseau,
// ou un écran ouvert juste avant « Fermer ») finirait après le suivant et le
// remplacerait (« Fermer » mènerait alors aux Réglages au lieu d'Aujourd'hui).
// `loading` : changement d'écran (menu, « Fermer », entrée dans l'app), avec
// « Chargement… » au-delà de 300 ms. Sans : simple redessin (case validée,
// synchronisation, retour au premier plan), jamais de « Chargement… ».
// `before` : à attendre avant les lectures (enterApp).
async function render({ loading = false, before = null } = {}) {
  if (!APP_VIEWS.has(currentView)) return; // un écran plein est demandé (Bilan, Ma routine…)
  const view = currentView;
  try {
    await swapScreen(async () => {
      if (before) await before();
      if (view === "main") await renderMainView();
      else if (view === "history") await renderHistoryView();
      else await renderSettingsView();
    }, { view, section: appSection, loading });
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

// Ouverte depuis le menu, « Continuer » et « Passer pour aujourd'hui » mènent à
// « Aujourd'hui », comme « Fermer ». Au démarrage, la suite habituelle.
const leaveRoutine = () => (routineFromMenu ? closeToToday() : enterAfterRoutine());

routineContinue.addEventListener("click", leaveRoutine);
routineFooter.addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) closeToToday();
});

// Manual reopen from the task screen: always shows the routine, even if it
// was completed or skipped today, so a box can still be checked later.
// En un coup : l'écran affiché reste en place pendant la lecture
// (« Chargement… » au-delà de 300 ms), puis Ma routine apparaît complète.
// Tout l'état (routineFromMenu, currentView) est posé DANS menuSwap.run : un
// geste ignoré pendant l'attente d'un autre écran ne modifie rien.
openRoutine.addEventListener("click", () => menuSwap.run(async () => {
  routineFromMenu = true;
  currentView = "routine";
  const localDate = localDateString();
  await swapScreen(async () => {
    let checks;
    try {
      checks = (await loadRoutine(localDate)).checks ?? {};
    } catch (err) {
      console.error(err);
      checks = {};
    }
    if (currentView !== "routine") return; // un autre écran a été demandé entre-temps
    routineLocalDate = localDate;
    routineState = checks;
    showRoutineScreen();
  }, { view: "routine", section: routineSection });
}));

routineSkip.addEventListener("click", () => {
  // A skip is just one more key in the same jsonb row (SKIP_KEY = "skipped").
  // It only suppresses today's automatic prompt — it never locks the
  // checkboxes, so reopening the routine later and checking a box still
  // writes through normally. No guilt copy, no confirmation.
  // Not awaited: a slow network must not hold the task screen back. The
  // write is queued locally if it fails.
  toggleRoutineCheck(routineLocalDate, SKIP_KEY, true).catch(console.error);
  leaveRoutine();
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

// Un écran touché depuis le menu : le menu reste ouvert jusqu'à son arrivée
// (screenSwap.js, createMenuSwap) ; voile, bouton du menu, Échap et seconde
// entrée sont ignorés pendant l'attente.
const menuSwap = createMenuSwap(() => setMenuOpen(false));
const MENU_SWAP_BUTTONS = new Set([navBilan, navHistory, navSettings, openRoutine]);

menuToggle.addEventListener("click", () => { if (!menuSwap.pending) setMenuOpen(menuPanel.hidden); });
menuScrim.addEventListener("click", () => { if (!menuSwap.pending) setMenuOpen(false); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!menuSwap.pending) setMenuOpen(false);
    closeReminderSheet(); closeTaskMenu(); closeSignOutSheet();
  }
});
// Les entrées qui changent d'écran ferment le menu à l'arrivée (menuSwap) ;
// toute autre action le referme tout de suite (la déconnexion / sauvegarde
// gardent leur handler).
menuPanel.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button && !MENU_SWAP_BUTTONS.has(button) && !menuSwap.pending) setMenuOpen(false);
});

// Une app restée ouverte passé minuit ne se met pas à jour toute seule : on
// redessine au retour au premier plan, ce qui sort les tâches d'hier de
// « Terminé » (elles passent dans l'Historique).
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  if (await honorOpenRequest()) return; // notification touchée, app en arrière-plan
  if (!appSection.hidden) render();
  // Bilan resté ouvert : nouveau jour, dimanche 20:00, données d'un autre appareil.
  // Simple rafraîchissement : il reste affiché jusqu'au nouveau dessin.
  else if (!bilanSection.hidden) showBilan({ loading: false });
});

// Notification touchée alors que l'app est déjà à l'écran : aucun retour au
// premier plan, seul le service worker peut la prévenir.
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "open-request") honorOpenRequest();
});

function showView(view) {
  currentView = view;
  return render({ loading: true });
}

navHistory.addEventListener("click", () => menuSwap.run(() => showView("history")));
navSettings.addEventListener("click", () => menuSwap.run(() => showView("settings")));
navBilan.addEventListener("click", () => menuSwap.run(() => showBilan()));
viewFooter.addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) closeToToday();
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
    forgetShownData();
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

// App fermée : la boîte aux lettres est relevée AVANT le premier écran, pour
// aller au Bilan sans montrer l'accueil (1 s au plus : le stockage ne doit
// jamais retenir le démarrage). iOS peut démarrer l'app avant que le service
// worker ait écrit, et un message peut se perdre à ce moment : d'où les
// relevés suivants, qui ne coûtent qu'une lecture locale.
const OPEN_REQUEST_RECHECK_MS = [500, 1500, 3000];
for (const delay of OPEN_REQUEST_RECHECK_MS) setTimeout(honorOpenRequest, delay);

// Les événements sont traités un par un, dans l'ordre d'arrivée.
let authEvents = settlesWithin(honorOpenRequest(), 1000);
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
