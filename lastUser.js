// Repère « dernier utilisateur connecté », gardé dans localStorage : lu sans
// attendre au démarrage, et rangé au même endroit que la session du SDK (si iOS
// efface les données du site, les deux disparaissent ensemble). clearLocalData
// (storage.js) ne le touche pas : il est effacé seulement par clearMarker(),
// à une vraie déconnexion. Contenu : voir lastUserLogic.js (jamais de jeton).
import { makeMarker, parseMarker } from "./lastUserLogic.js";

const KEY = "mon-app-taches.lastUser";

// localStorage peut être absent ou refuser l'écriture (navigation privée) :
// sans repère, l'app se comporte simplement comme avant (écran de connexion).
export function readMarker() {
  try {
    return parseMarker(localStorage.getItem(KEY));
  } catch (_err) {
    return null;
  }
}

export function writeMarker(userId, email) {
  try {
    localStorage.setItem(KEY, JSON.stringify(makeMarker(userId, email)));
  } catch (err) {
    console.error(err);
  }
}

export function clearMarker() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    console.error(err);
  }
}

// Pour créer une tâche en file quand la porte serveur est fermée.
export function offlineUserId() {
  const marker = readMarker();
  if (!marker) throw new Error("Session expirée, reconnecte-toi.");
  return marker.userId;
}
