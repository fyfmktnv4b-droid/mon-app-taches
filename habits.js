// Objectifs d'habitudes : UNE seule liste, lue par la carte « Hier » de
// l'écran « À reprendre » et, plus tard, par le bilan de la semaine. Aucun
// réseau, aucun écran : données et fonctions pures.
//
// Forme volontairement sérialisable en JSON (aucune fonction, jours en
// nombres) : elle pourra un jour venir de la base, par utilisateur. C'est
// pourquoi chaque fonction reçoit la liste en paramètre (DEFAULT_HABITS sinon).
//   key          : clé de la case dans daily_routines.checks. Doit être dans
//                  CHECK_KEYS (routineLogic.js) ET dans la liste blanche de
//                  set_routine_check (migrations 0002 et 0003).
//   label        : libellé court.
//   weeklyTarget : objectif sur une semaine.
//   officialDays : jours où l'habitude est ATTENDUE (0 = dimanche).
//   sessions     : libellé de la séance prévue, par jour officiel.
// Une case cochée un autre jour qu'un jour officiel compte quand même pour
// l'objectif : une séance de salle faite le mardi compte dans le 3 sur 3.
export const DEFAULT_HABITS = [
  {
    key: "steps",
    label: "10 000 pas",
    weeklyTarget: 7,
    officialDays: [0, 1, 2, 3, 4, 5, 6],
    sessions: {},
  },
  {
    key: "gym",
    label: "Salle",
    weeklyTarget: 3,
    officialDays: [1, 3, 5],
    sessions: { 1: "Haut du corps A", 3: "Jambes", 5: "Haut du corps B" },
  },
];

// Jour de la semaine déduit de la chaîne "YYYY-MM-DD" elle-même, en la lisant
// en UTC : le résultat ne dépend donc pas du fuseau de la machine, et reste
// cohérent avec la date qui sert de clé à la ligne en base.
export function weekdayFromLocalDate(localDate) {
  return new Date(`${localDate}T00:00:00Z`).getUTCDay();
}

export function habitByKey(key, habits = DEFAULT_HABITS) {
  return habits.find((habit) => habit.key === key) ?? null;
}

export function isOfficialDay(habit, localDate) {
  return habit.officialDays.includes(weekdayFromLocalDate(localDate));
}

// Libellé de la séance prévue ce jour-là, ou null.
export function sessionLabel(habit, localDate) {
  return habit.sessions?.[weekdayFromLocalDate(localDate)] ?? null;
}

// Habitudes attendues ce jour-là, avec la séance prévue s'il y en a une.
export function expectedHabits(localDate, habits = DEFAULT_HABITS) {
  return habits
    .filter((habit) => isOfficialDay(habit, localDate))
    .map((habit) => ({ key: habit.key, label: habit.label, session: sessionLabel(habit, localDate) }));
}

// Nombre de jours cochés pour cette habitude parmi `routines`
// ([{ local_date, checks }]), jours officiels ou non.
export function doneCount(routines, key) {
  return routines.filter((routine) => routine.checks?.[key] === true).length;
}
