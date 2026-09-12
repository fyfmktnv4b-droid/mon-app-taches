import { supabase } from "./supabaseClient.js";

export async function createTasksFromLines(rawText) {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Session expirée, reconnecte-toi.");
  const rows = lines.map((text) => ({ user_id: user.id, text }));
  const { data, error } = await supabase.from("tasks").insert(rows).select();
  if (error) throw error;
  return data;
}

export async function listTasks() {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function setTag(id, tagName, value) {
  const { error } = await supabase.from("tasks").update({ [tagName]: value }).eq("id", id);
  if (error) throw error;
}

export async function setReminderTime(id, reminderTime) {
  const { error } = await supabase.from("tasks").update({ reminder_time: reminderTime }).eq("id", id);
  if (error) throw error;
}

export async function setDone(id, done, completedAt = done ? new Date().toISOString() : null) {
  const { error } = await supabase
    .from("tasks")
    .update({ done, completed_at: completedAt })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}
