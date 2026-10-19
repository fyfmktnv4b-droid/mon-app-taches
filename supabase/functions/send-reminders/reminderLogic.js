// Extrait heure/minute/date locales via Intl.formatToParts — contrat garanti
// par la spec ECMAScript, contrairement à un aller-retour toLocaleString/Date.
export function localParts(timezone, now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutesOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const WINDOW_MINUTES = 5;

export function isDueNow(target, timezone, now, windowMinutes = WINDOW_MINUTES) {
  if (!target) return false;
  const [th, tm] = target.split(":").map(Number);
  const { minutesOfDay } = localParts(timezone, now);
  const diff = minutesOfDay - (th * 60 + tm);
  return diff >= 0 && diff < windowMinutes;
}

// Garde d'entrée de send-reminders. Fermée par défaut : sans CRON_SECRET
// configuré côté serveur, on refuse tout (avant, l'absence du secret ouvrait
// la fonction à quiconque connaît la clé publique). Retourne null si l'appel
// est autorisé, sinon la réponse à renvoyer. Les messages commencent par
// « send-reminders » pour distinguer, dans un curl, notre refus de celui de
// la passerelle Supabase.
export async function cronGuard(expectedSecret, providedSecret) {
  if (!expectedSecret) {
    return { status: 500, body: "send-reminders : CRON_SECRET manquant côté serveur, appel refusé" };
  }
  if (!providedSecret || !(await secretsMatch(expectedSecret, providedSecret))) {
    return { status: 401, body: "send-reminders : unauthorized (x-cron-secret absent ou incorrect)" };
  }
  return null;
}

// Comparaison en temps constant : on compare les empreintes SHA-256 (même
// longueur quelle que soit l'entrée) sans s'arrêter au premier octet
// différent, pour ne rien révéler du secret par le temps de réponse.
export async function secretsMatch(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// VAPID_SUBJECT doit être « mailto:adresse@domaine » (ou une URL https:),
// sinon web-push lève une exception. Retourne null si la valeur convient,
// sinon un message d'erreur explicite.
export function vapidSubjectProblem(value) {
  if (!value) return "send-reminders : VAPID_SUBJECT manquant côté serveur (attendu : mailto:adresse@domaine)";
  if (/^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) || /^https:\/\/\S+$/.test(value)) return null;
  return "send-reminders : VAPID_SUBJECT invalide (attendu : mailto:adresse@domaine, sans espace ni chevrons)";
}
