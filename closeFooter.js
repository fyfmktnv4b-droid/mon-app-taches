// Bouton « Fermer » des écrans du menu (Bilan, Historique, Réglages, Ma routine
// ouverte depuis le menu) : un seul gabarit, en bas de l'écran, pleine largeur,
// sous un trait de séparation (style.css : .screen-footer, .screen-close).
// « Fermer » ramène toujours à « Aujourd'hui » (app.js : closeToToday).
export const CLOSE_LABEL = "Fermer";

export function closeFooterHtml() {
  return `<footer class="screen-footer"><button type="button" class="screen-close" data-close>${CLOSE_LABEL}</button></footer>`;
}
