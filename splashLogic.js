// Écran de chargement du démarrage : décide quel écran montrer tant que le
// premier événement d'authentification n'est pas arrivé (supabase-js doit
// parfois renouveler le jeton par le réseau avant de l'émettre).

// Durée minimale d'affichage : seulement pour que l'écran ne clignote pas
// lui-même quand la réponse est instantanée.
export const MIN_SPLASH_MS = 300;
// Délai de sécurité : sans événement après ce temps, on laisse la place à la
// connexion plutôt que de rester bloqué.
export const SPLASH_TIMEOUT_MS = 5000;

// authEvent : undefined (rien reçu), "session" ou "none".
// Renvoie "wait", "welcome" ou "auth".
export function splashScreen(authEvent, elapsedMs) {
  if (authEvent === undefined) return elapsedMs >= SPLASH_TIMEOUT_MS ? "auth" : "wait";
  if (elapsedMs < MIN_SPLASH_MS) return "wait";
  return authEvent === "session" ? "welcome" : "auth";
}

// Dans combien de ms ré-évaluer, ou null si la décision est prise.
export function splashWakeInMs(authEvent, elapsedMs) {
  if (splashScreen(authEvent, elapsedMs) !== "wait") return null;
  const deadline = authEvent === undefined ? SPLASH_TIMEOUT_MS : MIN_SPLASH_MS;
  return Math.max(0, deadline - elapsedMs);
}
