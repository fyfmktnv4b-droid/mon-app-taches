// Porte serveur. Chaque fonction qui parle aux données Supabase (tasks.js,
// routines.js, settings.js, push.js) appelle requireServer() avant tout appel.
// La porte reste fermée tant que la session n'est pas vérifiée par le serveur
// (démarrage, mode hors-ligne, écran de connexion) : l'appel est alors rejeté
// tout de suite, sans réseau et sans passer par le SDK (qui peut attendre ~25 s
// quand le jeton est expiré, voir vendor/README.md).
//
// Pour sync.js ce rejet est un échec ordinaire, à réessayer : la modification
// va dans la file, y reste, et aucun message d'erreur n'est affiché. Sans
// cette porte, une écriture faite sans session « réussit » sans rien modifier
// (la RLS filtre, PostgREST ne renvoie pas d'erreur) et serait perdue.
let open = false;

export class ServerGateClosedError extends Error {
  constructor() {
    super("Hors-ligne : la session n'est pas encore vérifiée.");
    this.name = "ServerGateClosedError";
  }
}

// Seul app.js l'appelle, d'après serverGateOpen() (authLogic.js).
export function setServerGate(isOpen) {
  open = isOpen;
}

export function serverAllowed() {
  return open;
}

export function requireServer() {
  if (!open) throw new ServerGateClosedError();
}
