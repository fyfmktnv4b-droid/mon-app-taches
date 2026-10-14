import { supabase } from "./supabaseClient.js";

// Lecture de la routine d'un jour. RLS filtre sur l'utilisateur : pas besoin
// de passer le user_id, et impossible de lire celle de quelqu'un d'autre.
// maybeSingle() renvoie null — et non une erreur — quand la journée n'a pas
// encore de ligne, ce qui est le cas normal au premier réveil.
export async function fetchRoutine(localDate) {
  const { data, error } = await supabase
    .from("daily_routines")
    .select("local_date, checks")
    .eq("local_date", localDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Écrit UNE case via la fonction SQL set_routine_check (migration 0002), qui
// ne remplace que cette clé — c'est ce qui permet à l'iPhone et au Mac de
// cocher des cases différentes le même jour sans s'écraser. Renvoie la ligne
// fusionnée telle que le serveur la voit.
export async function setRoutineCheck(localDate, key, value) {
  const { data, error } = await supabase.rpc("set_routine_check", {
    p_local_date: localDate,
    p_key: key,
    p_value: value,
  });
  if (error) throw error;
  // La fonction SQL renvoie une seule ligne composite ; selon la version,
  // PostgREST peut la livrer telle quelle ou enveloppée dans un tableau.
  // On normalise ici pour que les appelants n'aient qu'une forme à gérer.
  const row = Array.isArray(data) ? data[0] : data;
  return { local_date: row?.local_date ?? localDate, checks: row?.checks ?? {} };
}

export async function listRoutines() {
  const { data, error } = await supabase
    .from("daily_routines")
    .select("local_date, checks, created_at, updated_at")
    .order("local_date", { ascending: true });
  if (error) throw error;
  return data;
}
