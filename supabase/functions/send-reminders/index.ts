// Déclenchée par pg_cron toutes les minutes (voir migration 0001, section
// notifications dans docs/superpowers/specs/2026-09-04-mon-app-taches-design.md).
// Envoie les rappels matinaux et les rappels par tâche dus, via Web Push.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  "mailto:contact@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const WINDOW_MINUTES = 5;

function isDueNow(
  target: string | null,
  timezone: string,
  now: Date,
  windowMinutes = WINDOW_MINUTES,
): boolean {
  if (!target) return false;
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const [h, m] = target.split(":").map(Number);
  const targetToday = new Date(localNow);
  targetToday.setHours(h, m, 0, 0);
  const diffMinutes = (localNow.getTime() - targetToday.getTime()) / 60000;
  return diffMinutes >= 0 && diffMinutes < windowMinutes;
}

async function sendPushToUser(userId: string, payload: Record<string, string>) {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);

  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Abonnement expiré ou app désinstallée sur cet appareil.
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }
}

Deno.serve(async () => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Rappels matinaux (récurrents, un par jour civil par utilisateur).
  const { data: settings } = await supabase
    .from("user_settings")
    .select("user_id, morning_reminder_time, timezone, last_morning_reminder_sent_date")
    .eq("notifications_enabled", true);

  const tzByUser = new Map<string, string>();

  for (const s of settings ?? []) {
    tzByUser.set(s.user_id, s.timezone);

    if (s.last_morning_reminder_sent_date === today) continue;
    if (!isDueNow(s.morning_reminder_time, s.timezone, now)) continue;

    await sendPushToUser(s.user_id, {
      title: "Tes priorités du jour",
      body: "Ouvre l'app pour voir tes tâches urgentes et importantes.",
    });
    await supabase
      .from("user_settings")
      .update({ last_morning_reminder_sent_date: today })
      .eq("user_id", s.user_id);
  }

  // Rappels par tâche (ponctuels). Pas d'embedding PostgREST vers
  // user_settings : aucune clé étrangère directe entre les deux tables,
  // donc jointure faite en mémoire via tzByUser construit ci-dessus.
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, user_id, text, reminder_time")
    .eq("done", false)
    .not("reminder_time", "is", null);

  for (const t of tasks ?? []) {
    const timezone = tzByUser.get(t.user_id) ?? "Europe/Paris";
    if (!isDueNow(t.reminder_time, timezone, now)) continue;

    await sendPushToUser(t.user_id, { title: "Rappel", body: t.text });
    await supabase.from("tasks").update({ reminder_time: null }).eq("id", t.id);
  }

  return new Response("ok");
});
