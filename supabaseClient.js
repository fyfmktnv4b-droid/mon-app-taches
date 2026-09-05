import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

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

export function onAuthStateChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
