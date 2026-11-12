import { loadRoutine, toggleRoutineCheck } from "./sync.js";
import { localDateString } from "./localDate.js";
import { MORNING_KEYS, countMorningDone, isChecked, plannedSession } from "./routineLogic.js";

// Bloc autonome de l'écran des tâches : « Séance de salle » et « 10 000 pas ».
// Il lit (readRoutineBlock) et écrit lui-même la routine du jour. v44 : la
// lecture se fait AVANT le dessin de l'écran, en même temps que celle des
// tâches, et mountRoutineBlock dessine aussitôt (sans attente) : l'écran
// apparaît en un coup, routine comprise. Une erreur ici ne doit jamais gêner
// la liste des tâches : en cas d'échec de lecture, le bloc reste tel quel.
// Cases « en attente » (cochées mais pas encore validées). Au niveau du module
// pour survivre aux re-rendus de l'écran ; volontairement jamais écrites en
// base : seule la validation écrit, via la même fonction que l'écran de routine.
const pendingKeys = new Set();
let pendingDate = null;

// Routine du jour, ou null si la lecture échoue (loadRoutine a déjà ses replis :
// 2 s au plus, puis le cache).
export async function readRoutineBlock() {
  const localDate = localDateString();
  try {
    return { localDate, checks: (await loadRoutine(localDate)).checks ?? {} };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Dessine le bloc tout de suite, d'après `data` (readRoutineBlock).
export function mountRoutineBlock(container, data) {
  if (!data) return;
  const { localDate } = data;
  if (pendingDate !== localDate) {
    pendingKeys.clear();
    pendingDate = localDate;
  }
  let checks = data.checks;

  const session = plannedSession(localDate);

  // Une ligne : case + libellé, et « Validé ? » à droite tant qu'elle est en
  // attente. Validée => case cochée, verrouillée (définitif, côté interface
  // seulement) et texte plus clair.
  function itemHtml(key, labelHtml) {
    const validated = isChecked(checks, key);
    const pending = !validated && pendingKeys.has(key);
    return `
      <div class="routine-item ${validated ? "validated" : ""}">
        <label class="routine-check">
          <input type="checkbox" data-key="${key}" ${validated || pending ? "checked" : ""} ${validated ? 'disabled aria-disabled="true"' : ""}>
          <span>${labelHtml}</span>
        </label>
        ${pending ? `<button type="button" class="routine-validate" data-key="${key}">Validé ?</button>` : ""}
      </div>`;
  }

  async function write(key, value) {
    const updated = await toggleRoutineCheck(localDate, key, value);
    checks = updated.checks ?? {};
  }

  function render() {
    const gymRow = session.kind === "rest"
      ? `<p class="routine-rest">${session.label}</p>`
      : itemHtml("gym", `Salle <em>(${session.kind === "optional" ? "facultative" : session.label})</em>`);
    const done = countMorningDone(checks);
    const dashes = MORNING_KEYS
      .map((_, i) => `<i class="${i < done ? "on" : ""}"></i>`)
      .join("");
    container.innerHTML = `
      <div class="routine-block">
        <div class="routine-head">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18"/><path d="M6.5 19a5.5 5.5 0 0 1 11 0"/><path d="M12 6V4M4.9 9.9 3.5 8.5M19.1 9.9l1.4-1.4"/></svg>
          <strong>Routine du matin</strong>
          <span class="routine-progress" role="img" aria-label="${done} sur ${MORNING_KEYS.length}">${dashes}</span>
        </div>
        <div class="routine-row">
          ${gymRow}
          ${itemHtml("steps", "10 000 pas")}
        </div>
      </div>`;

    container.querySelectorAll("input[data-key]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.key;
        // Une ligne validée a une case désactivée : on ne passe jamais ici pour elle.
        if (isChecked(checks, key)) return;
        // Le tap met en attente, ou annule l'attente. Rien n'est enregistré.
        if (input.checked) pendingKeys.add(key); else pendingKeys.delete(key);
        render();
      });
    });
    container.querySelectorAll(".routine-validate").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.key;
        button.disabled = true;
        write(key, true)
          .then(() => {
            pendingKeys.delete(key);
            render();
          })
          .catch((err) => {
            console.error(err);
            button.disabled = false;
          });
      });
    });
  }
  render();
}
