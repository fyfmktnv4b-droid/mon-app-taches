// Connexion : ce que fait l'app à chaque événement d'authentification du SDK.
// Fonction pure (ni réseau, ni stockage, ni page) : app.js applique le résultat.
//
// États :
//   "booting"   démarrage, aucune décision encore (l'écran de chargement attend)
//   "verified"  session vérifiée par le serveur : la porte serveur est ouverte
//   "offline"   hors-ligne sans session vérifiée : on travaille sur la copie
//               locale, les modifications vont dans la file
//   "signedOut" écran de connexion
//
// Règles de sécurité :
//   - seul un clic réussi sur « Se déconnecter » efface la copie locale et la file ;
//   - une session vérifiée d'un AUTRE compte efface aussi, pour ne jamais
//     mélanger deux comptes ;
//   - rien d'autre n'efface : ni l'état "offline", ni un SIGNED_OUT envoyé par
//     le SDK de lui-même (refus du serveur, session révoquée).

// La porte serveur (authGate.js) n'est ouverte que sur une session vérifiée.
export function serverGateOpen(state) {
  return state === "verified";
}

// Événement du SDK (onAuthStateChange) -> entrée de authTransition. Tout
// événement qui porte une session compte comme une session, quel que soit son
// nom (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED…).
export function authInput(event, session, { signOutRequested = false, networkFailure = false } = {}) {
  if (session?.user?.id) return { kind: "session", userId: session.user.id };
  if (event === "SIGNED_OUT") return { kind: "signedOut", requested: signOutRequested };
  return { kind: "noSession", networkFailure };
}

const NOTHING = {
  clear: false, setMarker: false, clearMarker: false, screen: null, expiredMessage: false, flush: false,
};

// input :
//   { kind: "session", userId }            événement portant une session
//                                          (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED…)
//   { kind: "signedOut", requested }       SIGNED_OUT ; requested = clic sur « Se déconnecter »
//   { kind: "noSession", networkFailure }  INITIAL_SESSION vide ; networkFailure = le SDK
//                                          garde sa session mais n'a pas pu la renouveler
// context :
//   markerUserId : repère « dernier utilisateur connecté », ou null
//   cacheOwnerId : propriétaire des tâches en cache (voir cacheOwner), ou null
//
// Renvoie { state, clear, setMarker, clearMarker, screen, expiredMessage, flush } :
//   screen : "welcome" | "offline" | "auth" (écran à montrer), "stay" (rester sur
//            l'écran actuel) ou null (rien à faire)
//   expiredMessage : afficher « session expirée, tes modifications sont gardées »
//   flush : rejouer la file tout de suite (retour du réseau)
export function authTransition(state, input, { markerUserId = null, cacheOwnerId = null } = {}) {
  if (input.kind === "session") {
    const owner = markerUserId ?? cacheOwnerId;
    const otherAccount = owner !== null && owner !== input.userId;
    // TOKEN_REFRESHED, USER_UPDATED… : on rafraîchit seulement le repère.
    if (state === "verified" && !otherAccount) return { ...NOTHING, state, setMarker: true };
    const backOnline = state === "offline" && !otherAccount;
    return {
      ...NOTHING,
      state: "verified",
      clear: otherAccount,
      setMarker: true,
      screen: backOnline ? "stay" : "welcome",
      flush: backOnline,
    };
  }

  if (state === "signedOut") return { ...NOTHING, state };

  if (input.kind === "signedOut" && input.requested && state === "verified") {
    return { ...NOTHING, state: "signedOut", clear: true, clearMarker: true, screen: "auth" };
  }

  if (input.kind === "noSession" && input.networkFailure && markerUserId !== null) {
    return { ...NOTHING, state: "offline", screen: state === "booting" ? "offline" : null };
  }

  // Refus du serveur, session révoquée, ou plus aucune session enregistrée par
  // le SDK : écran de connexion, copie locale et file gardées.
  return { ...NOTHING, state: "signedOut", screen: "auth", expiredMessage: markerUserId !== null };
}

// Après l'événement « online », on annonce une synchronisation… mais iOS peut
// signaler le réseau sans qu'il soit utilisable : passé ce délai sans session
// vérifiée, on revient au texte hors-ligne.
export const SYNCING_TEXT_MS = 90000;
export const OFFLINE_TEXT = "Mode hors-ligne · tes changements seront envoyés au retour du réseau";
export const SYNCING_TEXT = "Synchronisation en cours…";

// onlineSinceMs : moment du dernier événement « online » (null si aucun depuis
// le passage hors-ligne).
export function offlineBannerText(onlineSinceMs, nowMs) {
  if (onlineSinceMs === null || nowMs - onlineSinceMs >= SYNCING_TEXT_MS) return OFFLINE_TEXT;
  return SYNCING_TEXT;
}

// Clic sur « Se déconnecter ». pendingCount : modifications encore en file
// (après une tentative d'envoi si la session est vérifiée), null si illisible.
//   "server"       : déconnexion normale, auprès du serveur
//   "confirm"      : demander avant de supprimer des modifications non envoyées
//   "local"        : hors-ligne, rien en attente : déconnexion sur l'appareil
//   "needsNetwork" : hors-ligne avec des modifications : on refuse, on explique
// Un nombre inconnu n'est jamais traité comme zéro.
export function signOutStep(state, pendingCount) {
  if (state === "verified") return pendingCount === 0 ? "server" : "confirm";
  return pendingCount === 0 ? "local" : "needsNetwork";
}

export function signOutSheetText(step, pendingCount) {
  if (step === "needsNetwork") {
    const sent = pendingCount === 1 ? "Ta modification sera envoyée"
      : pendingCount === null ? "Tes modifications seront envoyées"
      : `Tes ${pendingCount} modifications seront envoyées`;
    return `La déconnexion demande le réseau. ${sent} à son retour.`;
  }
  if (pendingCount === null) {
    return "Des modifications ne sont peut-être pas encore envoyées. Se déconnecter maintenant les supprimerait.";
  }
  if (pendingCount === 1) {
    return "1 modification n'est pas encore envoyée. Se déconnecter maintenant la supprimera.";
  }
  return `${pendingCount} modifications ne sont pas encore envoyées. Se déconnecter maintenant les supprimera.`;
}

// Clé sous laquelle supabase-js range sa session dans localStorage (même
// calcul que le SDK, voir vendor/README.md).
export function authStorageKey(supabaseUrl) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

// La session et ses compagnons (« -user », « -code-verifier »…).
export function isSdkAuthKey(key, storageKey) {
  return key === storageKey || key.startsWith(`${storageKey}-`);
}
