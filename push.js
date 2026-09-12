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

// `navigator.serviceWorker.ready` never rejects — it only resolves once an
// active registration exists. If the worker never becomes ready (registration
// failed silently, private mode, worker unregistered via devtools), awaiting it
// hangs forever. Race it against a timeout so callers always get an answer.
async function readyRegistration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
}

export async function subscribeToPush() {
  // Must be the FIRST statement, before any await: Safari gates the permission
  // prompt on the click's transient user activation, which an intervening await
  // can consume. Safari also never prompts implicitly from subscribe().
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications refusées dans les réglages du navigateur.");
  }
  const registration = await readyRegistration();
  if (!registration) {
    throw new Error("Les notifications ne sont pas disponibles sur cet appareil/navigateur.");
  }
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
  const registration = await readyRegistration();
  if (!registration) return; // Nothing to unsubscribe if push was never available here.
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

// The account-wide `notifications_enabled` flag says what the user wants; this
// says whether THIS device is actually subscribed. Both must be true for the
// toggle to read "Désactiver".
export async function hasPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}
