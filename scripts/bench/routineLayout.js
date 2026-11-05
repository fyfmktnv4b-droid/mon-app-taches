// Règles de mise en page du bloc « Routine du matin » quand des boutons
// « Validé ? » sont affichés, vérifiées sur des rectangles DÉJÀ MESURÉS dans la
// page. Fonctions pures (aucun Chrome) : elles valent pour un nombre quelconque
// d'habitudes, et routineLayout.test.js les essaie sur des mesures inventées.
//
// Entrée : `rows`, une entrée par habitude dans l'ordre du DOM,
//   { label: Rect, button: Rect | null }  avec  Rect = { left, top, right, bottom, width, height }.
// Sortie : la liste des problèmes (texte), vide si tout est conforme.

export const ROW_GAP = 12; // écart vertical voulu entre deux habitudes (px)
export const MIN_TOUCH = 44; // hauteur tactile minimale d'un bouton (px)
const EPS = 0.75; // tolérance d'arrondi (px)

export function layoutProblems(rows, { blockRight = Infinity } = {}) {
  const problems = [];
  const withButton = rows.filter((row) => row.button);

  withButton.forEach((row, i) => {
    const { label, button } = row;
    if (button.height < MIN_TOUCH - EPS) problems.push(`bouton ${i + 1} : ${button.height.toFixed(1)} px de haut (minimum ${MIN_TOUCH})`);
    if (label.right > button.left + EPS) problems.push(`bouton ${i + 1} : chevauche ou passe sous son libellé`);
    const gap = Math.abs((label.top + label.bottom) / 2 - (button.top + button.bottom) / 2);
    if (gap > 1.5) problems.push(`bouton ${i + 1} : pas sur la ligne de son libellé (décalage vertical ${gap.toFixed(1)} px)`);
    if (button.right > blockRight + EPS) problems.push(`bouton ${i + 1} : dépasse du bloc à droite`);
  });

  const lefts = withButton.map((row) => row.button.left);
  const widths = withButton.map((row) => row.button.width);
  if (withButton.length > 1) {
    if (Math.max(...lefts) - Math.min(...lefts) > EPS) problems.push(`boutons : bords gauches différents (${lefts.map((n) => n.toFixed(1)).join(" / ")})`);
    if (Math.max(...widths) - Math.min(...widths) > EPS) problems.push(`boutons : largeurs différentes (${widths.map((n) => n.toFixed(1)).join(" / ")})`);
  }

  for (let i = 1; i < rows.length; i++) {
    const before = rows[i - 1];
    const after = rows[i];
    const bottom = Math.max(before.label.bottom, before.button?.bottom ?? -Infinity);
    const top = Math.min(after.label.top, after.button?.top ?? Infinity);
    if (top - bottom < ROW_GAP - EPS) problems.push(`habitudes ${i} et ${i + 1} : écart vertical ${(top - bottom).toFixed(1)} px (minimum ${ROW_GAP})`);
  }
  return problems;
}
