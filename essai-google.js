// ESSAI JETABLE : à retirer après l'essai (avec essai-google.html, .css,
// essai-manifest.webmanifest et essaiGoogle.test.js).
//
// But : savoir, sur iPhone, où atterrit le retour de l'écran d'accord Google
// quand cette page est installée sur l'écran d'accueil (dans l'app installée,
// ou dans Safari, qui a une mémoire séparée).
//
// Promesses : aucun appel réseau (seule la redirection vers Google), le code
// renvoyé par Google n'est jamais lu en valeur (seulement « présent ou non »),
// jamais affiché, jamais écrit, et rien n'est stocké hormis le state et son
// marqueur de départ, effacés au retour. Aucune sortie dans la console.

export const CLIENT_ID = "590832587446-s8bvr6dp4q59ee3u4c8ckrf1c09gq71g.apps.googleusercontent.com";
export const REDIRECT_URI = "https://fyfmktnv4b-droid.github.io/mon-app-taches/essai-google.html";
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];
export const DEPART_KEY = "essai-google:depart";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const ERROR_MAX = 60;

// --- Départ ------------------------------------------------------------------

export function randomState(cryptoObj) {
  const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params}`;
}

export function startTrial(env) {
  const state = randomState(env.crypto);
  const marker = JSON.stringify({ state, at: env.now() });
  env.localStorage.setItem(DEPART_KEY, marker);
  env.sessionStorage.setItem(DEPART_KEY, marker);
  env.location.assign(buildAuthUrl(state));
}

// --- Retour ------------------------------------------------------------------

// Ne garde du code qu'un oui/non : sa valeur n'est jamais lue.
export function readReturn(search) {
  const params = new URLSearchParams(search);
  const rawError = params.has("error") ? params.get("error") : null;
  return {
    hasReturn: params.has("code") || params.has("error"),
    hasCode: params.has("code"),
    error: rawError === null ? null : rawError.replace(/[^\w. -]/g, "?").slice(0, ERROR_MAX),
    receivedState: params.has("state") ? params.get("state") : null,
  };
}

function readMarker(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(DEPART_KEY));
    return parsed && typeof parsed.state === "string" && Number.isFinite(parsed.at) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function hasSbKey(storage) {
  try {
    for (let i = 0; i < storage.length; i++) {
      if (String(storage.key(i)).startsWith("sb-")) return true;
    }
  } catch (_err) {
    // Stockage illisible : on dit « non », sans plus.
  }
  return false;
}

function isStandaloneDisplayMode(env) {
  try { return Boolean(env.matchMedia("(display-mode: standalone)").matches); } catch (_err) { return false; }
}

// Que des oui/non, des nombres et le texte de l'erreur : jamais le code, jamais
// la valeur du state, jamais la valeur d'une clé « sb- ».
export function collectReport(env, ret, nowMs) {
  const local = readMarker(env.localStorage);
  const session = readMarker(env.sessionStorage);
  const age = (marker) => (marker ? Math.round((nowMs - marker.at) / 1000) : null);
  return {
    standalone: { displayMode: isStandaloneDisplayMode(env), navigator: env.navigator.standalone === true },
    hasCode: ret.hasCode,
    error: ret.error,
    sameStateLocal: ret.receivedState !== null && local !== null && local.state === ret.receivedState,
    sameStateSession: ret.receivedState !== null && session !== null && session.state === ret.receivedState,
    markerLocal: local !== null,
    markerSession: session !== null,
    ageLocalSeconds: age(local),
    ageSessionSeconds: age(session),
    hasSbKey: hasSbKey(env.localStorage),
    time: new Date(nowMs).toLocaleTimeString("fr-FR"),
  };
}

const yesNo = (value) => (value ? "oui" : "non");
const markerLine = (label, found, age) => `${label} : ${found ? `retrouvé, âge ${age} s` : "non retrouvé"}`;

export function reportLines(r) {
  return [
    `Mode standalone (app installée) : ${yesNo(r.standalone.displayMode)} (display-mode) / ${yesNo(r.standalone.navigator)} (navigator.standalone)`,
    `Code renvoyé par Google : ${yesNo(r.hasCode)}`,
    `Erreur : ${r.error === null ? "aucune" : r.error}`,
    `State identique à celui du localStorage : ${yesNo(r.sameStateLocal)}`,
    `State identique à celui du sessionStorage : ${yesNo(r.sameStateSession)}`,
    markerLine("Marqueur de départ, localStorage", r.markerLocal, r.ageLocalSeconds),
    markerLine("Marqueur de départ, sessionStorage", r.markerSession, r.ageSessionSeconds),
    `Clé « sb- » dans le localStorage (session de l'app) : ${yesNo(r.hasSbKey)}`,
    `Heure : ${r.time}`,
  ];
}

function eraseMarker(storage) {
  try { storage.removeItem(DEPART_KEY); } catch (_err) { /* rien de plus à faire */ }
}

// --- Page --------------------------------------------------------------------

function show(env, view) {
  env.document.getElementById("accueil").hidden = view !== "accueil";
  env.document.getElementById("resultat").hidden = view !== "resultat";
}

export function run(env) {
  const ret = readReturn(env.location.search);
  env.document.getElementById("lancer").addEventListener("click", () => startTrial(env));
  env.document.getElementById("recommencer").addEventListener("click", () => show(env, "accueil"));

  if (!ret.hasReturn) {
    show(env, "accueil");
    return;
  }

  // D'abord effacer l'adresse : le code disparaît même si la suite échoue.
  env.history.replaceState(null, "", env.location.pathname);
  const report = collectReport(env, ret, env.now());
  eraseMarker(env.localStorage);
  eraseMarker(env.sessionStorage);

  const items = reportLines(report).map((line) => {
    const li = env.document.createElement("li");
    li.textContent = line;
    return li;
  });
  env.document.getElementById("lignes").replaceChildren(...items);
  show(env, "resultat");
}

if (typeof document !== "undefined") {
  run({
    document,
    location,
    history,
    localStorage,
    sessionStorage,
    navigator,
    matchMedia: (query) => window.matchMedia(query),
    crypto,
    now: () => Date.now(),
  });
}
