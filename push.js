import { supabase } from "./supabaseClient.js";

// Generated once via `npx web-push generate-vapid-keys` for this project.
// Public key only — safe to ship to the client by design (VAPID's whole
// point is that the private half never leaves the server). See Task 8 for
// where the matching private key lives (Supabase Edge Function secrets,
// never in this repo).
const VAPID_PUBLIC_KEY =
  "BDZI4YXGXEpAmM_f6Q3nJOyPBiWSkENx0UIcHtfnMDK_XaG3dBH3ZsR2F_e1-ekWWvxREcMfKUKrAnngoggUVrI";

// PushManager.subscribe() requires the VAPID key as a Uint8Array, but it's
// generated and stored as a URL-safe base64 string — this converts between
// the two. Standard, unavoidable boilerplate for the Push API.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function requireUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error("Session expirée, reconnecte-toi.");
  return user;
}

export async function subscribeToPush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const user = await requireUser();
  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}
