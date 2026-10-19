// Déclenchée par pg_cron toutes les minutes (voir migration 0001, section
// notifications dans docs/superpowers/specs/2026-09-04-mon-app-taches-design.md).
// Envoie les rappels matinaux et les rappels par tâche dus, via Web Push.

// Versions exactes : la fonction détient la clé service_role, on ne laisse
// donc pas un « @2 » flottant tirer au déploiement une version publiée la
// veille (risque de paquet compromis). supabase-js aligné sur vendor/.
import { createClient } from "npm:@supabase/supabase-js@2.115.0";
import webpush from "npm:web-push@3.6.7";
import { localParts, isDueNow, cronGuard, vapidSubjectProblem } from "./reminderLogic.js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Envoie à tous les appareils de l'utilisateur. Retourne false si au moins un
// envoi a échoué pour une raison inattendue (autre qu'abonnement expiré), pour
// que l'appelant puisse au moins logger l'échec au lieu de l'avaler en silence.
async function sendPushToUser(userId: string, payload: Record<string, string>): Promise<boolean> {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return true; // rien à envoyer, pas un échec

  let allOk = true;
  for (const sub of subs) {
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
      } else {
        allOk = false;
        console.error(`push failed for user ${userId}, subscription ${sub.id}:`, err);
      }
    }
  }
  return allOk;
}

Deno.serve(async (req) => {
  // Protège l'invocation au-delà de la clé anon (publique, visible dans le
  // bundle client) : seul l'appel pg_cron connaît ce secret.
  const refusal = await cronGuard(Deno.env.get("CRON_SECRET"), req.headers.get("x-cron-secret"));
  if (refusal) {
    if (refusal.status === 500) console.error(refusal.body);
    return new Response(refusal.body, { status: refusal.status });
  }

  // Adresse de contact VAPID lue depuis un secret serveur (le dépôt est
  // public). Vérifiée ici plutôt qu'au chargement du module : une exception
  // au chargement ferait échouer chaque appel sans aucun message lisible.
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const subjectProblem = vapidSubjectProblem(vapidSubject);
  if (subjectProblem) {
    console.error(subjectProblem);
    return new Response(subjectProblem, { status: 500 });
  }
  webpush.setVapidDetails(
    vapidSubject!,
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const now = new Date();

  // Une seule lecture de tous les réglages : sert à la fois pour les rappels
  // matinaux et comme table de correspondance user_id -> fuseau/activation
  // pour les rappels par tâche (pas d'embedding PostgREST possible, cf. spec).
  const { data: settings } = await supabase
    .from("user_settings")
    .select("user_id, morning_reminder_time, notifications_enabled, timezone, last_morning_reminder_sent_date");

  const tzByUser = new Map<string, string>();
  const enabledUsers = new Set<string>();
  for (const s of settings ?? []) {
    tzByUser.set(s.user_id, s.timezone);
    if (s.notifications_enabled) enabledUsers.add(s.user_id);
  }

  // Rappels matinaux (récurrents, une fois par jour civil LOCAL par utilisateur).
  // Chaque utilisateur (et plus bas chaque tâche) dans son propre try/catch :
  // une donnée invalide (ex. fuseau inconnu, qui fait lever Intl) ne doit
  // bloquer que cette ligne, pas les rappels de tous les autres.
  for (const s of settings ?? []) {
    try {
      if (!s.notifications_enabled) continue;
      if (!isDueNow(s.morning_reminder_time, s.timezone, now)) continue;

      const { dateKey: localToday } = localParts(s.timezone, now);

      // Claim atomique avant envoi : n'envoie que si pas déjà marqué pour ce
      // jour local, et évite le double-envoi si deux invocations du cron se
      // chevauchent.
      const { data: claimed } = await supabase
        .from("user_settings")
        .update({ last_morning_reminder_sent_date: localToday })
        .eq("user_id", s.user_id)
        .or(`last_morning_reminder_sent_date.is.null,last_morning_reminder_sent_date.neq.${localToday}`)
        .select("user_id");
      if (!claimed || claimed.length === 0) continue;

      const ok = await sendPushToUser(s.user_id, {
        title: "Tes priorités du jour",
        body: "Il est temps de consigner tes tâches !",
      });
      if (!ok) console.error(`morning reminder push failed for user ${s.user_id}`);
    } catch (err) {
      console.error(`morning reminder skipped for user ${s.user_id}:`, err);
    }
  }

  // Rappels par tâche (ponctuels), uniquement pour les utilisateurs ayant
  // activé les notifications.
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, user_id, text, reminder_time")
    .eq("done", false)
    .not("reminder_time", "is", null);

  for (const t of tasks ?? []) {
    try {
      if (!enabledUsers.has(t.user_id)) continue;
      const timezone = tzByUser.get(t.user_id) ?? "Europe/Paris";
      if (!isDueNow(t.reminder_time, timezone, now)) continue;

      // Claim atomique : ne remet à null (et donc n'envoie) que si la valeur
      // n'a pas déjà été réclamée par une autre invocation en chevauchement.
      const { data: claimed } = await supabase
        .from("tasks")
        .update({ reminder_time: null })
        .eq("id", t.id)
        .eq("reminder_time", t.reminder_time)
        .select("id");
      if (!claimed || claimed.length === 0) continue;

      const ok = await sendPushToUser(t.user_id, { title: "Rappel", body: t.text });
      if (!ok) console.error(`task reminder push failed for task ${t.id}`);
    } catch (err) {
      console.error(`task reminder skipped for task ${t.id}:`, err);
    }
  }

  return new Response("ok");
});
