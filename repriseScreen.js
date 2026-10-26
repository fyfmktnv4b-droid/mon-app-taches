// Écran « À reprendre aujourd'hui » (rendu et clics). La logique est dans
// repriseLogic.js, les écritures dans reprise.js.
import {
  recoverChanges, validateChanges, undoChanges, introSentence, counterLabel,
  boxLabel, ageLabel, confirmationLabel, recapSummary,
} from "./repriseLogic.js";
import { writeChanges, commitAbandons } from "./reprise.js";

// Tâches traitées sur l'écran pendant cette ouverture de l'app : l'écran
// principal ne les compte plus comme « en attente », même si l'écriture n'est
// pas encore arrivée au serveur. Les abandons y restent cachés jusqu'à leur
// suppression réelle.
const handledIds = new Set();
export const abandonedIds = new Set();
let handledDay = null;

// Une app restée ouverte passé minuit doit reproposer le lendemain une tâche
// récupérée la veille : la liste ne vaut que pour le jour où elle a été remplie.
export function handledIdsFor(today) {
  if (today !== handledDay) handledIds.clear();
  return handledIds;
}

// Au-delà, on quitte l'écran sans attendre la fin des écritures (elles
// continuent en arrière-plan) : un réseau lent ne doit pas bloquer la sortie.
const EXIT_WAIT_MS = 3000;

const ICONS = {
  recover: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  validate: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  abandon: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const LABELS = { recover: "Récupérer", validate: "Valider", abandon: "Abandonner" };

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let root = null;
let state = null;

// items : [{ task (telle qu'avant toute action), action, changes }]
export function openRepriseScreen(section, { tasks, today, dateLabel, onExit }) {
  root = section;
  handledIdsFor(today);
  handledDay = today;
  state = {
    items: tasks.map((task) => ({ task, action: null, changes: null })),
    today, dateLabel, onExit,
    writes: Promise.resolve(),
    exiting: false,
  };
  if (!root.dataset.wired) {
    root.addEventListener("click", onClick);
    root.dataset.wired = "true";
  }
  render();
  window.scrollTo(0, 0);
}

function render() {
  const { items, today, dateLabel } = state;
  const sortedCount = items.filter((i) => i.action).length;
  const allSorted = sortedCount === items.length;
  const counts = {};
  for (const i of items) if (i.action) counts[i.action] = (counts[i.action] ?? 0) + 1;

  root.innerHTML = `
    <header class="reprise-head">
      <p class="reprise-date">${escapeHtml(dateLabel)}</p>
      <h1 class="reprise-title">${allSorted ? "Tout est trié" : "À reprendre aujourd'hui"}</h1>
      <p class="reprise-intro">${allSorted ? escapeHtml(recapSummary(counts)) : escapeHtml(introSentence(items.length))}</p>
    </header>
    <div class="reprise-list">
      ${items.map((item) => (item.action ? doneHtml(item) : cardHtml(item, today))).join("")}
    </div>
    <footer class="reprise-footer">
      <p class="reprise-counter">${counterLabel(sortedCount, items.length)}</p>
      ${allSorted
        ? '<button type="button" class="reprise-start" data-exit>Commencer la journée</button>'
        : '<button type="button" class="reprise-skip" data-exit>Passer pour l\'instant</button>'}
    </footer>
  `;
}

function cardHtml({ task }, today) {
  const box = task.important ? "important" : "others";
  return `
    <article class="reprise-card" data-id="${escapeHtml(task.id)}">
      <div class="reprise-meta">
        <span class="reprise-pill" data-box="${box}">${boxLabel(task)}</span>
        <span class="reprise-age">${ageLabel(task, today)}</span>
      </div>
      <p class="reprise-text">${escapeHtml(task.text)}</p>
      <div class="reprise-actions">
        ${["recover", "validate", "abandon"].map((a) => `
          <button type="button" class="reprise-btn" data-action="${a}">${icon(a)}<span>${LABELS[a]}</span></button>`).join("")}
      </div>
    </article>`;
}

function doneHtml({ task, action }) {
  return `
    <div class="reprise-done" data-id="${escapeHtml(task.id)}">
      <span class="reprise-done-icon">${icon(action)}</span>
      <span class="reprise-done-text">${escapeHtml(confirmationLabel(action, task))}</span>
      <button type="button" class="reprise-undo" data-undo>Annuler</button>
    </div>`;
}

// Les écritures sont enchaînées les unes derrière les autres : l'ordre des
// actions (et de leurs annulations) est celui dans lequel elles arrivent au
// serveur ou dans la file hors-ligne.
function queueWrite(id, changes) {
  state.writes = state.writes
    .then(() => writeChanges(id, changes))
    .catch((err) => console.error(err));
}

function onClick(event) {
  if (!state || state.exiting) return;
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-exit")) { exit(); return; }
  const id = button.closest("[data-id]")?.dataset.id;
  const item = state.items.find((i) => i.task.id === id);
  if (!item) return;

  if (button.dataset.action && !item.action) {
    const action = button.dataset.action;
    item.action = action;
    if (action === "recover") item.changes = recoverChanges(state.today);
    if (action === "validate") item.changes = validateChanges(state.today);
    // Abandonner : rien n'est écrit avant la sortie de l'écran.
    if (item.changes) queueWrite(id, item.changes);
    handledIds.add(id);
  } else if (button.hasAttribute("data-undo") && item.action) {
    if (item.changes) queueWrite(id, undoChanges(item.task, item.changes));
    item.action = null;
    item.changes = null;
    handledIds.delete(id);
  } else {
    return;
  }
  render();
}

async function exit() {
  state.exiting = true;
  root.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  const abandoned = state.items.filter((i) => i.action === "abandon").map((i) => i.task.id);
  abandoned.forEach((id) => abandonedIds.add(id));
  const work = state.writes
    .then(() => commitAbandons(abandoned))
    .catch((err) => console.error(err));
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, EXIT_WAIT_MS))]);
  const { onExit } = state;
  state = null;
  onExit();
}
