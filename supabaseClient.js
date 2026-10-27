// Vendored same-origin (see vendor/README.md): a cross-origin CDN import can
// never be service-worker cached, so it would break a cold offline boot.
import { createClient } from "./vendor/supabase-js.esm.js";
// Même module que celui chargé par supabase-js (déjà dans ASSETS) : le point
// d'entrée ne réexporte pas ce test d'erreur.
import { isAuthRetryableFetchError } from "./vendor/supabase-auth-js-2.115.0.js";
import { authStorageKey, isSdkAuthKey } from "./authLogic.js";

const SUPABASE_URL = "https://ifcrmvuvmirkgdhkkgiv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_c5F4xEjo1Gdg2tnTz-EUww_VzYzrLfW";

// Deuxième verrou, sous la porte serveur (authGate.js). Quand le SDK n'a pas
// de jeton d'utilisateur à fournir (jeton expiré, renouvellement en échec
// pendant ses 60 s de refroidissement), il envoie la requête avec la clé
// anonyme : la RLS la laisse « réussir » sans rien lire ni modifier, et une
// modification serait perdue. Une requête de DONNÉES (/rest/v1) sans jeton
// d'utilisateur est donc refusée avant l'envoi ; sync.js la traite comme une
// panne (file d'attente). Les requêtes d'authentification (/auth/v1) ne sont
// jamais touchées, et seule l'ABSENCE de jeton compte, pas son expiration.
export class NoUserTokenError extends Error {
  constructor() {
    super("Hors-ligne : la session n'est pas encore vérifiée.");
    // « AbortError » : PostgREST ne réessaie pas une requête annulée (sinon
    // ~7 s de nouvelles tentatives avant de se rabattre sur la copie locale).
    this.name = "AbortError";
  }
}

function headerOf(input, init, name) {
  if (init?.headers) return new Headers(init.headers).get(name);
  return input instanceof Request ? input.headers.get(name) : null;
}

export function dataRequestLock({ restUrl, anonKey, send, onBlocked }) {
  return function lockedFetch(input, init) {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(restUrl)) {
      const authorization = headerOf(input, init, "Authorization");
      if (!authorization || authorization === `Bearer ${anonKey}`) {
        onBlocked();
        return Promise.reject(new NoUserTokenError());
      }
    }
    return send(input, init);
  };
}

const blockedListeners = [];

// app.js y passe en mode hors-ligne (bandeau, porte fermée).
export function onDataRequestWithoutUser(callback) {
  blockedListeners.push(callback);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: dataRequestLock({
      restUrl: `${SUPABASE_URL}/rest/v1/`,
      anonKey: SUPABASE_ANON_KEY,
      send: (input, init) => fetch(input, init),
      onBlocked: () => blockedListeners.forEach((listener) => listener()),
    }),
  },
});

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Déconnexion sur cet appareil seulement : efface la session du SDK de
// localStorage, sans passer par lui (hors-ligne, son verrou peut être tenu par
// une requête qui ne répond pas). L'appelant recharge ensuite la page, ce qui
// coupe ces requêtes : l'une d'elles, aboutie plus tard, réécrirait ou
// effacerait la session, même celle d'une nouvelle connexion.
export function forgetSessionOnThisDevice() {
  const storageKey = authStorageKey(SUPABASE_URL);
  for (const key of Object.keys(localStorage)) {
    if (isSdkAuthKey(key, storageKey)) localStorage.removeItem(key);
  }
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Le nom de l'événement (INITIAL_SESSION, SIGNED_OUT, TOKEN_REFRESHED…) sert à
// distinguer un refus du serveur d'une simple absence de session.
export function onAuthStateChange(callback) {
  supabase.auth.onAuthStateChange((event, session) => callback(session, event));
}

// Après un INITIAL_SESSION vide : vrai si le SDK garde une session qu'il n'a
// pas pu renouveler faute de réseau (panne), faux s'il n'en a plus (refus,
// rien d'enregistré). Juste après l'échec, le SDK répond tout de suite (il
// garde l'échec en mémoire 60 s) ; le délai couvre une requête bloquée, et
// dans le doute on parie sur la panne : seul un refus explicite déconnecte.
export async function sessionKeptButUnrenewable(timeoutMs = 3000) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  const answer = supabase.auth.getSession().then(
    ({ data, error }) => (data.session ? "session" : isAuthRetryableFetchError(error) ? "network" : "none"),
    () => "network",
  );
  return (await Promise.race([answer, timeout])) !== "none";
}

// Relance une vérification de session au retour du réseau, sans l'attendre :
// la réponse arrive par onAuthStateChange (TOKEN_REFRESHED ou SIGNED_OUT).
export function recheckSession() {
  supabase.auth.getSession().catch(() => {});
}
