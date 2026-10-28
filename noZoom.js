// Pas de zoom par pincement sur iOS : Safari ignore user-scalable=no (balise
// viewport) et touch-action pour le pincement, mais émet des événements
// « gesture » propres à WebKit qu'on peut annuler. Ils n'existent pas ailleurs :
// ce module est alors sans effet. preventDefault exige { passive: false }.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}
