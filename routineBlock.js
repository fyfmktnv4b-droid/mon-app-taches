import { loadRoutine, toggleRoutineCheck } from "./sync.js";
import { localDateString } from "./localDate.js";
import { isChecked, plannedSession } from "./routineLogic.js";

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
           <span>Séance de salle — ${session.label}</span>
         </label>`;
    container.innerHTML = `
      <div class="routine-block">
        ${gymRow}
        <label class="routine-check">
          <input type="checkbox" data-key="steps" ${isChecked(checks, "steps") ? "checked" : ""}>
          <span>10 000 pas</span>
        </label>
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
