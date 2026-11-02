// Fonctions pures de la routine quotidienne. Aucun accès réseau, aucun DOM :
// tout ce qui décide quoi afficher et comment fusionner les coches vit ici et
// est testé unitairement.
import { habitByKey, sessionLabel, weekdayFromLocalDate } from "./habits.js";

export { weekdayFromLocalDate };

export const MORNING_KEYS = ["wake", "wash", "meditate", "pray"];
export const DAY_KEYS = ["gym", "steps"];
export const SKIP_KEY = "skipped";

// Liste blanche partagée avec la fonction SQL set_routine_check : toute clé
// ajoutée ici doit l'être aussi là-bas (migration 0002).
export const CHECK_KEYS = [...MORNING_KEYS, ...DAY_KEYS, SKIP_KEY];

export const MORNING_LABELS = {
  wake: "Se lever",
  wash: "Se laver",
  meditate: "Méditer",
  pray: "Prier",
};

export function isCheckKey(key) {
  return CHECK_KEYS.includes(key);
}

// kind "rest" => pas de case du tout, juste le texte (dimanche).
// kind "planned" => séance du programme, libellée.
// kind "optional" => salle possible, mais rien d'attendu ce jour-là.
export function plannedSession(localDate) {
  const weekday = weekdayFromLocalDate(localDate);
  if (weekday === 0) return { kind: "rest", label: "Repos" };
  // Séances du programme : une seule liste, dans habits.js.
  const planned = sessionLabel(habitByKey("gym"), localDate);
  if (planned) return { kind: "planned", label: planned };
  return { kind: "optional", label: "Facultative" };
}

export function emptyRoutine(localDate) {
  return { local_date: localDate, checks: {} };
}

export function isChecked(checks, key) {
  return checks?.[key] === true;
}

export function countMorningDone(checks) {
  return MORNING_KEYS.filter((key) => isChecked(checks, key)).length;
}

export function isMorningDone(checks) {
  return countMorningDone(checks) === MORNING_KEYS.length;
}

// Ne gouverne que l'affichage AUTOMATIQUE au démarrage. « Passer » met
// skipped à true, ce qui évite qu'on redemande la routine — mais ne verrouille
// rien : on peut toujours rouvrir l'écran à la main et cocher plus tard.
export function shouldShowRoutine(checks) {
  if (isChecked(checks, SKIP_KEY)) return false;
  return !isMorningDone(checks);
}

// Fusion d'une coche dans une routine locale. Ne remplace QUE la clé visée :
// c'est l'invariant qui fait qu'une coche posée sur l'iPhone n'efface pas
// celle posée sur le Mac. Même forme que applyMutation() dans syncLogic.js —
// une mutation qui ne la concerne pas repart inchangée.
export function applyRoutineMutation(routine, mutation) {
  if (!mutation || mutation.type !== "routineCheck") return routine;
  if (mutation.localDate !== routine.local_date) return routine;
  if (!isCheckKey(mutation.key)) return routine;
  return { ...routine, checks: { ...routine.checks, [mutation.key]: mutation.value } };
}
