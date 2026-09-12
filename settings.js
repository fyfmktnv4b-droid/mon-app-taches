import { supabase } from "./supabaseClient.js";

async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error("Session expirée, reconnecte-toi.");
  return user;
}

export async function getSettings() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("user_settings")
    .select("morning_reminder_time, notifications_enabled, timezone")
    .eq("user_id", user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function setMorningReminderTime(time) {
  const user = await requireUser();
  const { error } = await supabase
    .from("user_settings")
    .update({ morning_reminder_time: time })
    .eq("user_id", user.id);
  if (error) throw error;
}

export async function setNotificationsEnabled(enabled) {
  const user = await requireUser();
  const { error } = await supabase
    .from("user_settings")
    .update({ notifications_enabled: enabled })
    .eq("user_id", user.id);
  if (error) throw error;
}
