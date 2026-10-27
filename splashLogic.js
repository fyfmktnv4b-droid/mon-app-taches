// Écran de chargement du démarrage : décide quel écran montrer tant que le
// premier événement d'authentification n'est pas arrivé (supabase-js doit
// parfois renouveler le jeton par le réseau avant de l'émettre — hors-ligne,
// il réessaie pendant ~25 s, voir vendor/README.md).

// Durée minimale d'affichage : seulement pour que l'écran ne clignote pas
// lui-même quand la réponse est instantanée.
export const MIN_SPLASH_MS = 1000;
// Délai de sécurité : sans événement après ce temps, on laisse la place à la
// connexion (ou au mode hors-ligne s'il existe un repère) plutôt que de rester bloqué.
export const SPLASH_TIMEOUT_MS = 5000;

// authEvent : undefined (rien reçu), "session", "none" (pas de session, ou
// refus du serveur) ou "network" (le SDK garde sa session mais n'a pas pu la
// renouveler : panne réseau).
// options : hasMarker = repère « dernier utilisateur connecté » présent ;
// online = navigator.onLine (false est fiable en mode avion, true ne prouve rien).
// Renvoie "wait", "welcome", "offline" ou "auth".
export function splashScreen(authEvent, elapsedMs, { hasMarker = false, online = true } = {}) {
  if (authEvent === undefined) {
    if (hasMarker && !online && elapsedMs >= MIN_SPLASH_MS) return "offline";
    if (elapsedMs < SPLASH_TIMEOUT_MS) return "wait";
    // Mode hors-ligne provisoire : seul un refus explicite du serveur le quittera.
    return hasMarker ? "offline" : "auth";
  }
  if (elapsedMs < MIN_SPLASH_MS) return "wait";
  if (authEvent === "session") return "welcome";
  if (authEvent === "network") return hasMarker ? "offline" : "auth";
  return "auth";
}

// Dans combien de ms ré-évaluer, ou null si la décision est prise.
export function splashWakeInMs(authEvent, elapsedMs, options = {}) {
  if (splashScreen(authEvent, elapsedMs, options) !== "wait") return null;
  const airplane = options.hasMarker && options.online === false;
  const deadline = authEvent === undefined && !airplane ? SPLASH_TIMEOUT_MS : MIN_SPLASH_MS;
  return Math.max(0, deadline - elapsedMs);
}
