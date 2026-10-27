// Repère « dernier utilisateur connecté » : identifiant + e-mail MASQUÉ + date.
// Jamais de jeton, jamais l'adresse complète. Fonctions pures ; la lecture et
// l'écriture dans localStorage sont dans lastUser.js.

// "benjamin@icloud.com" -> "b…@icloud.com". null si ce n'est pas une adresse.
export function maskEmail(email) {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return `${email[0]}…${email.slice(at)}`;
}

export function makeMarker(userId, email, now = new Date()) {
  return { userId, maskedEmail: maskEmail(email), at: now.toISOString() };
}

// Texte lu dans localStorage -> repère, ou null s'il est absent ou abîmé. Ne
// garde que les champs connus : une ancienne valeur ne peut rien y glisser.
export function parseMarker(raw) {
  if (typeof raw !== "string") return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (_err) {
    return null;
  }
  if (!value || typeof value.userId !== "string" || value.userId === "") return null;
  const maskedEmail = typeof value.maskedEmail === "string" && value.maskedEmail.includes("…")
    ? value.maskedEmail
    : null;
  return { userId: value.userId, maskedEmail, at: typeof value.at === "string" ? value.at : null };
}

// Propriétaire des tâches en cache (elles portent le user_id du serveur) :
// secours quand le repère manque, par exemple au premier démarrage après la
// mise à jour. null si le cache est vide ; MIXED_OWNERS (qui n'est l'id de
// personne) si plusieurs comptes s'y trouvent, pour forcer l'effacement.
export const MIXED_OWNERS = "mixed-owners";

export function cacheOwner(tasks) {
  const ids = new Set(tasks.map((t) => t.user_id).filter((id) => typeof id === "string" && id !== ""));
  if (ids.size === 0) return null;
  return ids.size === 1 ? [...ids][0] : MIXED_OWNERS;
}
