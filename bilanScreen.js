// Écran « Bilan de la semaine » (rendu et clics), en lecture seule : rien
// n'est écrit, tout est recalculé à chaque ouverture. Chiffres : bilanLogic.js ;
// données : bilan.js.
import { localDateString } from "./localDate.js";
import {
  isClosingTime, weekSummary, barSegments, habitsWeek, weekRangeLabel, titleLabel, othersDetail, notDoneLabel,
  habitCountLabel, barAriaLabel, endMessage,
} from "./bilanLogic.js";
import { DEFAULT_HABITS } from "./habits.js";
import { loadBilanData } from "./bilan.js";
import { closeFooterHtml } from "./closeFooter.js";

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

// Ouvre (ou rafraîchit) le Bilan EN UN COUP : tout est lu d'abord (tâches et
// habitudes, 2 s au plus chacune, cache sinon), puis l'écran est dessiné une
// seule fois et `reveal()` le montre dans la même image. Pendant la lecture,
// l'écran précédent reste affiché (le « Chargement… » éventuel est géré par
// app.js). Renvoie faux, sans rien toucher, si une ouverture plus récente,
// « Fermer » ou un autre écran (`isWanted`) a pris la place entre-temps.
// `excludedIds` : tâches abandonnées sur « À reprendre » dont la suppression
// n'est pas encore faite (repriseScreen.js, abandonedIds).
export async function openBilanScreen(section, {
  excludedIds = new Set(), onClose, isWanted = () => true, reveal = () => {}, load = loadBilanData,
}) {
  const openId = ++openCount;
  const now = new Date();
  const today = localDateString(now);
  const { tasks, habits } = await load(today);
  if (openId !== openCount || !isWanted()) return false;
  root = section;
  state = { now, today, tasks, habits, excludedIds, onClose };
  if (!root.dataset.wired) {
    root.addEventListener("click", onClick);
    root.dataset.wired = "true";
  }
  render();
  reveal();
  window.scrollTo(0, 0);
  return true;
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
  const summary = weekSummary(tasks, now, undefined, excludedIds);
  const end = endMessage(summary);
  root.innerHTML = `
    <header class="bilan-head">
      <p class="bilan-date">${escapeHtml(weekRangeLabel(today))}</p>
      <h1 class="bilan-title">Bilan de la semaine</h1>
    </header>
    <div class="bilan-list">
      ${heroHtml(summary)}
      ${tilesHtml(summary, isClosingTime(now))}
      ${summary.undated ? undatedHtml(summary.undated) : ""}
      ${habitsHtml(habits, today)}
      ${end ? `<p class="bilan-end">${escapeHtml(end)}</p>` : ""}
    </div>
    ${closeFooterHtml()}
  `;
}

// Barre : SVG à attributs (aucun style en ligne), couleurs par classes CSS.
function heroHtml(summary) {
  const segments = barSegments(summary)
    .filter((s) => s.width > 0)
    .map((s) => `<rect class="bilan-seg" data-seg="${s.key}" x="${s.x}" y="0" width="${s.width}" height="10"/>`)
    .join("");
  return `
    <section class="bilan-hero">
      <p class="bilan-hero-title">${escapeHtml(titleLabel(summary))}</p>
      <div class="bilan-bar">
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(barAriaLabel(summary))}">
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
  const count = (key) => summary[key];
  const detail = (key) => othersDetail(summary[key]);
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
  // Hors-ligne sans cache complet : les cartes gardent leur titre, sans
  // chiffre inventé.
  if (habits.source === "unavailable") {
    return habitsWeek({}, today, DEFAULT_HABITS).map((habit) => `
      <section class="bilan-habit" data-habit="${escapeHtml(habit.key)}">
        <div class="bilan-habit-head">
          <h2 class="bilan-habit-label">${escapeHtml(habit.label)}</h2>
        </div>
        <p class="bilan-habit-off">${escapeHtml(HABITS_OFFLINE)}</p>
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
