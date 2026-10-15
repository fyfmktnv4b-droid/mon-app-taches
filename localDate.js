// Date locale de l'appareil, au format "YYYY-MM-DD".
//
// Sert de « aujourd'hui » pour toute l'app (routine, écran du jour, Historique,
// nom du fichier d'export) : en UTC, entre minuit et 2h du matin en Europe, on
// serait encore la veille.
//
// Le fuseau est lu sur l'appareil via Intl — jamais écrit en dur — mais reste
// injectable pour que les tests soient déterministes.
export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function localDateString(now = new Date(), timeZone = deviceTimeZone()) {
  // en-CA formate nativement en YYYY-MM-DD : pas de parties à recomposer à la
  // main. Même approche que localParts() dans l'Edge Function des rappels.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
