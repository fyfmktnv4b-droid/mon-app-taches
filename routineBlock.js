import { loadRoutine, toggleRoutineCheck } from "./sync.js";
import { localDateString } from "./localDate.js";
import { MORNING_KEYS, countMorningDone, isChecked, plannedSession } from "./routineLogic.js";

// Bloc autonome de l'écran des tâches : « Séance de salle » et « 10 000 pas ».
// Il lit et écrit lui-même la routine du jour ; l'appelant ne lui donne que
// l'élément où s'afficher. Une erreur ici ne doit jamais gêner la liste des
// tâches : en cas d'échec de lecture, le bloc reste simplement vide.
export async function mountRoutineBlock(container) {
  const localDate = localDateString();
  let checks;
  try {
    checks = (await loadRoutine(localDate)).checks ?? {};
  } catch (err) {
    console.error(err);
    return;
  }
  // L'écran a pu être re-rendu pendant la lecture : on n'écrit pas dans un
  // élément détaché.
  if (!container.isConnected) return;

  const session = plannedSession(localDate);

  function render() {
    const gymRow = session.kind === "rest"
      ? `<p class="routine-rest">${session.label}</p>`
      : `<label class="routine-check">
           <input type="checkbox" data-key="gym" ${isChecked(checks, "gym") ? "checked" : ""}>
           <span>Salle <em>(${session.kind === "optional" ? "facultative" : session.label})</em></span>
         </label>`;
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
          <label class="routine-check">
            <input type="checkbox" data-key="steps" ${isChecked(checks, "steps") ? "checked" : ""}>
            <span>10 000 pas</span>
          </label>
        </div>
      </div>`;
    container.querySelectorAll("input[data-key]").forEach((input) => {
      input.addEventListener("change", () => {
        const value = input.checked;
        toggleRoutineCheck(localDate, input.dataset.key, value)
          .then((updated) => {
            checks = updated.checks ?? {};
            render();
          })
          .catch((err) => {
            console.error(err);
            input.checked = !value;
          });
      });
    });
  }
  render();
}
