// Écran « Bilan de la semaine » (rendu et clics), en lecture seule : rien
// n'est écrit, tout est recalculé à chaque ouverture. Chiffres : bilanLogic.js ;
// données : bilan.js.
import { localDateString } from "./localDate.js";
import {
  isClosingTime, weekSummary, barSegments, habitsWeek, weekRangeLabel, titleLabel, othersDetail, notDoneLabel,
  habitCountLabel, barAriaLabel, endMessage,
} from "./bilanLogic.js";
import { DEFAULT_HABITS } from "./habits.js";
import { loadLocalTasks, loadFreshTasks, loadWeekHabits } from "./bilan.js";
import { closeFooterHtml } from "./closeFooter.js";

const LOADING = "Chargement…";
const HABITS_OFFLINE = "Indisponible hors-ligne";
const HABITS_FROM_CACHE = "Hors-ligne : d'après cet appareil";
const UNDATED_HINT = "Terminées avant que l'app note les dates";
const DAY_STATE_TEXT = { done: "fait", missed: "non fait", today: "aujourd'hui, en cours", future: "à venir" };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let root = null;
let state = null;
let openCount = 0; // une lecture lente d'une ouverture précédente ne doit rien afficher

// `excludedIds` : tâches abandonnées sur « À reprendre » dont la suppression
// n'est pas encore faite (repriseScreen.js, abandonedIds).
export function openBilanScreen(section, { excludedIds = new Set(), onClose }) {
  root = section;
  const openId = ++openCount;
  const now = new Date();
  state = { now, today: localDateString(now), tasks: null, habits: null, excludedIds, onClose };
  if (!root.dataset.wired) {
    root.addEventListener("click", onClick);
    root.dataset.wired = "true";
  }
  render();
  window.scrollTo(0, 0);

  const current = () => state && openId === openCount;
  // Tâches : le cache tout de suite, puis la lecture serveur (2 s au plus).
  loadLocalTasks().then((tasks) => {
    if (current() && state.tasks === null) { state.tasks = tasks; render(); }
  });
  loadFreshTasks().then((tasks) => {
    if (current()) { state.tasks = tasks; render(); }
  }).catch((err) => console.error(err));
  // Habitudes : se remplissent dès que la lecture répond (2 s au plus).
  loadWeekHabits(state.today).then((habits) => {
    if (current()) { state.habits = habits; render(); }
  }).catch((err) => {
    console.error(err);
    if (current()) { state.habits = { source: "unavailable" }; render(); }
  });
}

function onClick(event) {
  if (!state) return;
  if (!event.target.closest("[data-close]")) return;
  const { onClose } = state;
  state = null;
  openCount++;
  onClose();
}

function render() {
  const { now, today, tasks, habits, excludedIds } = state;
  // Tâches pas encore lues (tout début de l'ouverture) : aucun chiffre ni
  // phrase inventés, seulement « Chargement… » et des tirets.
  const summary = tasks === null ? null : weekSummary(tasks, now, undefined, excludedIds);
  const end = summary ? endMessage(summary) : null;
  root.innerHTML = `
    <header class="bilan-head">
      <p class="bilan-date">${escapeHtml(weekRangeLabel(today))}</p>
      <h1 class="bilan-title">Bilan de la semaine</h1>
    </header>
    <div class="bilan-list" ${tasks === null ? 'aria-busy="true"' : ""}>
      ${heroHtml(summary)}
      ${tilesHtml(summary, isClosingTime(now))}
      ${summary?.undated ? undatedHtml(summary.undated) : ""}
      ${habitsHtml(habits, today)}
      ${end ? `<p class="bilan-end">${escapeHtml(end)}</p>` : ""}
    </div>
    ${closeFooterHtml()}
  `;
}

// Barre : SVG à attributs (aucun style en ligne), couleurs par classes CSS.
function heroHtml(summary) {
  const segments = (summary ? barSegments(summary) : [])
    .filter((s) => s.width > 0)
    .map((s) => `<rect class="bilan-seg" data-seg="${s.key}" x="${s.x}" y="0" width="${s.width}" height="10"/>`)
    .join("");
  return `
    <section class="bilan-hero">
      <p class="bilan-hero-title">${escapeHtml(summary ? titleLabel(summary) : LOADING)}</p>
      <div class="bilan-bar">
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(summary ? barAriaLabel(summary) : LOADING)}">
          <rect class="bilan-track" x="0" y="0" width="100" height="10"/>${segments}
        </svg>
      </div>
    </section>`;
}

function tileHtml(key, count, label, detail) {
  return `
      <div class="bilan-tile" data-seg="${key}">
        <span class="bilan-swatch" data-seg="${key}" aria-hidden="true"></span>
        <p class="bilan-tile-count">${count}</p>
        <p class="bilan-tile-label">${escapeHtml(label)}</p>
        ${detail ? `<p class="bilan-tile-detail">${escapeHtml(detail)}</p>` : ""}
      </div>`;
}

function tilesHtml(summary, closing) {
  const count = (key) => (summary ? summary[key] : "–");
  const detail = (key) => (summary ? othersDetail(summary[key]) : null);
  return `
    <section class="bilan-tiles">
      ${tileHtml("onTime", count("onTime"), "Faites à temps", detail("onTimeOthers"))}
      ${tileHtml("late", count("late"), "Faites en retard", null)}
      ${tileHtml("notDone", count("notDone"), notDoneLabel(closing), detail("notDoneOthers"))}
    </section>`;
}

function undatedHtml(count) {
  return `
    <p class="bilan-undated">
      <span class="bilan-swatch" data-seg="undated" aria-hidden="true"></span>
      <span><strong>${count}</strong> sans date · <span class="bilan-undated-hint">${escapeHtml(UNDATED_HINT)}</span></span>
    </p>`;
}

function habitsHtml(habits, today) {
  // Avant la réponse (2 s au plus) et hors-ligne sans cache complet : les
  // cartes gardent leur titre, sans chiffre inventé.
  if (!habits || habits.source === "unavailable") {
    const message = habits ? HABITS_OFFLINE : LOADING;
    return habitsWeek({}, today, DEFAULT_HABITS).map((habit) => `
      <section class="bilan-habit" data-habit="${escapeHtml(habit.key)}" ${habits ? "" : 'aria-busy="true"'}>
        <div class="bilan-habit-head">
          <h2 class="bilan-habit-label">${escapeHtml(habit.label)}</h2>
        </div>
        <p class="bilan-habit-off">${escapeHtml(message)}</p>
      </section>`).join("");
  }
  const cards = habitsWeek(habits.checksByDate, today, DEFAULT_HABITS).map(habitCardHtml).join("");
  return cards + (habits.source === "cache" ? `<p class="bilan-note">${escapeHtml(HABITS_FROM_CACHE)}</p>` : "");
}

function habitCardHtml(habit) {
  const distinguish = habit.marksOfficialDays; // voir bilanLogic.js
  return `
      <section class="bilan-habit" data-habit="${escapeHtml(habit.key)}">
        <div class="bilan-habit-head">
          <h2 class="bilan-habit-label">${escapeHtml(habit.label)}</h2>
          <p class="bilan-habit-count">${escapeHtml(habitCountLabel(habit))}</p>
        </div>
        <ol class="bilan-days">
          ${habit.days.map((day) => `
          <li class="bilan-day" data-state="${day.state}" data-official="${distinguish && day.official}">
            <span class="bilan-day-letter" aria-hidden="true">${day.letter}</span>
            <span class="bilan-sr">${escapeHtml(`${day.name}${distinguish && day.official ? " (jour prévu)" : ""} : ${DAY_STATE_TEXT[day.state]}`)}</span>
          </li>`).join("")}
        </ol>
      </section>`;
}
