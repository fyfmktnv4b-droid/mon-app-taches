// Vendored same-origin (see vendor/README.md): a cross-origin CDN import can
// never be service-worker cached, so it would break a cold offline boot.
import { createClient } from "./vendor/supabase-js.esm.js";
// Même module que celui chargé par supabase-js (déjà dans ASSETS) : le point
// d'entrée ne réexporte pas ce test d'erreur.
import { isAuthRetryableFetchError } from "./vendor/supabase-auth-js-2.115.0.js";

const SUPABASE_URL = "https://ifcrmvuvmirkgdhkkgiv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_c5F4xEjo1Gdg2tnTz-EUww_VzYzrLfW";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
