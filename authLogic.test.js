import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authTransition, authInput, serverGateOpen, offlineBannerText,
  OFFLINE_TEXT, SYNCING_TEXT, SYNCING_TEXT_MS,
  signOutStep, signOutSheetText, authStorageKey, isSdkAuthKey,
} from "./authLogic.js";

const STATES = ["booting", "verified", "offline", "signedOut"];
const A = "user-A";
const B = "user-B";
const session = (id) => ({ user: { id } });

// Toutes les entrées possibles, pour les invariants.
const INPUTS = [
  { kind: "session", userId: A },
  { kind: "session", userId: B },
  { kind: "signedOut", requested: false },
  { kind: "signedOut", requested: true },
  { kind: "noSession", networkFailure: false },
  { kind: "noSession", networkFailure: true },
];
const CONTEXTS = [
  { markerUserId: A, cacheOwnerId: A },
  { markerUserId: A, cacheOwnerId: null },
  { markerUserId: null, cacheOwnerId: A },
  { markerUserId: null, cacheOwnerId: B },
  { markerUserId: null, cacheOwnerId: null },
];

// --- Invariant 1 : tout événement portant une session ouvre la porte ---

test("every SDK event carrying a session opens the server gate", () => {
  for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED", "PASSWORD_RECOVERY", "MFA_CHALLENGE_VERIFIED"]) {
    const input = authInput(event, session(A));
    assert.deepEqual(input, { kind: "session", userId: A }, event);
    for (const state of STATES) {
      for (const context of CONTEXTS) {
        const out = authTransition(state, input, context);
        assert.equal(out.state, "verified", `${event} from ${state}`);
        assert.ok(serverGateOpen(out.state));
      }
    }
  }
});

test("the gate is open only in the verified state", () => {
  assert.equal(serverGateOpen("verified"), true);
  for (const state of ["booting", "offline", "signedOut"]) assert.equal(serverGateOpen(state), false);
});

test("authInput: no session gives signedOut or noSession", () => {
  assert.deepEqual(authInput("SIGNED_OUT", null), { kind: "signedOut", requested: false });
  assert.deepEqual(authInput("SIGNED_OUT", null, { signOutRequested: true }), { kind: "signedOut", requested: true });
  assert.deepEqual(authInput("INITIAL_SESSION", null), { kind: "noSession", networkFailure: false });
  assert.deepEqual(authInput("INITIAL_SESSION", null, { networkFailure: true }), { kind: "noSession", networkFailure: true });
});

// --- Invariant 3 : jamais d'effacement depuis "offline" sans session vérifiée ---

test("nothing is ever cleared from the offline state without a verified session of another account", () => {
  for (const input of INPUTS) {
    for (const context of CONTEXTS) {
      const out = authTransition("offline", input, context);
      const owner = context.markerUserId ?? context.cacheOwnerId;
      const verifiedOther = input.kind === "session" && owner !== null && owner !== input.userId;
      assert.equal(out.clear, verifiedOther, JSON.stringify({ input, context }));
      assert.equal(out.clearMarker, false);
    }
  }
});

// --- Invariant 4 (condition i) : un SIGNED_OUT du SDK n'efface jamais ---

test("a SIGNED_OUT the user did not ask for never clears anything, from any state", () => {
  for (const state of STATES) {
    for (const context of CONTEXTS) {
      const out = authTransition(state, { kind: "signedOut", requested: false }, context);
      assert.equal(out.clear, false, state);
      assert.equal(out.clearMarker, false, state);
    }
  }
});

test("clearing only happens on a requested sign-out or a verified session of another account", () => {
  for (const state of STATES) {
    for (const input of INPUTS) {
      for (const context of CONTEXTS) {
        const out = authTransition(state, input, context);
        if (!out.clear) continue;
        const owner = context.markerUserId ?? context.cacheOwnerId;
        const otherAccount = input.kind === "session" && owner !== null && owner !== input.userId;
        const requestedSignOut = input.kind === "signedOut" && input.requested && state === "verified";
        assert.ok(otherAccount || requestedSignOut, JSON.stringify({ state, input, context }));
      }
    }
  }
});

// --- Démarrage ---

test("boot with a session of the marker's account: welcome, no clear", () => {
  const out = authTransition("booting", { kind: "session", userId: A }, { markerUserId: A });
  assert.deepEqual(out, {
    state: "verified", clear: false, setMarker: true, clearMarker: false,
    screen: "welcome", expiredMessage: false, flush: false,
  });
});

test("boot after the update (no marker yet): the cache owner decides", () => {
  assert.equal(authTransition("booting", { kind: "session", userId: A }, { cacheOwnerId: A }).clear, false);
  assert.equal(authTransition("booting", { kind: "session", userId: A }, { cacheOwnerId: B }).clear, true);
  assert.equal(authTransition("booting", { kind: "session", userId: A }, {}).clear, false);
});

test("boot with a network failure and a marker: offline mode", () => {
  const out = authTransition("booting", { kind: "noSession", networkFailure: true }, { markerUserId: A });
  assert.equal(out.state, "offline");
  assert.equal(out.screen, "offline");
  assert.equal(out.clear, false);
});

test("boot with a network failure but no marker: sign-in screen as today", () => {
  const out = authTransition("booting", { kind: "noSession", networkFailure: true }, {});
  assert.equal(out.state, "signedOut");
  assert.equal(out.screen, "auth");
  assert.equal(out.expiredMessage, false);
});

test("boot refused by the server: sign-in screen with the message, nothing cleared", () => {
  for (const input of [{ kind: "signedOut", requested: false }, { kind: "noSession", networkFailure: false }]) {
    const out = authTransition("booting", input, { markerUserId: A });
    assert.equal(out.state, "signedOut");
    assert.equal(out.screen, "auth");
    assert.equal(out.expiredMessage, true);
    assert.equal(out.clear, false);
  }
});

test("a cold boot with nobody ever signed in shows sign-in without the message", () => {
  const out = authTransition("booting", { kind: "noSession", networkFailure: false }, {});
  assert.equal(out.screen, "auth");
  assert.equal(out.expiredMessage, false);
});

// --- Mode hors-ligne ---

test("offline: back online with the same account stays on screen and replays the queue", () => {
  const out = authTransition("offline", { kind: "session", userId: A }, { markerUserId: A });
  assert.equal(out.state, "verified");
  assert.equal(out.screen, "stay");
  assert.equal(out.flush, true);
  assert.equal(out.clear, false);
});

test("offline: still failing keeps the offline mode, no screen change", () => {
  const out = authTransition("offline", { kind: "noSession", networkFailure: true }, { markerUserId: A });
  assert.equal(out.state, "offline");
  assert.equal(out.screen, null);
});

test("offline: an explicit refusal goes to sign-in, keeping the queue", () => {
  for (const input of [{ kind: "signedOut", requested: false }, { kind: "noSession", networkFailure: false }]) {
    const out = authTransition("offline", input, { markerUserId: A });
    assert.equal(out.state, "signedOut");
    assert.equal(out.screen, "auth");
    assert.equal(out.expiredMessage, true);
    assert.equal(out.clear, false);
  }
});

// --- Faille B : reconnexion avec un autre compte ---

test("signing in with another account clears first; with the same account the queue stays", () => {
  const other = authTransition("signedOut", { kind: "session", userId: B }, { markerUserId: A });
  assert.equal(other.clear, true);
  assert.equal(other.screen, "welcome");
  const same = authTransition("signedOut", { kind: "session", userId: A }, { markerUserId: A });
  assert.equal(same.clear, false);
  assert.equal(same.state, "verified");
});

test("a cold boot signed out, then another account: cleared thanks to the cache owner", () => {
  const out = authTransition("signedOut", { kind: "session", userId: B }, { markerUserId: null, cacheOwnerId: A });
  assert.equal(out.clear, true);
});

// --- Session vérifiée ---

test("verified: a token refresh of the same account changes nothing visible", () => {
  const out = authTransition("verified", { kind: "session", userId: A }, { markerUserId: A });
  assert.equal(out.state, "verified");
  assert.equal(out.screen, null);
  assert.equal(out.clear, false);
  assert.equal(out.flush, false);
});

test("verified: the token lost during an outage switches to offline in place, nothing cleared", () => {
  const out = authTransition("verified", { kind: "noSession", networkFailure: true }, { markerUserId: A });
  assert.equal(out.state, "offline");
  assert.equal(out.screen, null);
  assert.equal(out.clear, false);
  assert.equal(out.clearMarker, false);
  assert.equal(serverGateOpen(out.state), false);
});

test("verified: a requested sign-out clears data and marker", () => {
  const out = authTransition("verified", { kind: "signedOut", requested: true }, { markerUserId: A });
  assert.equal(out.clear, true);
  assert.equal(out.clearMarker, true);
  assert.equal(out.screen, "auth");
});

test("verified: a refusal during use (revoked session) keeps the queue and explains", () => {
  const out = authTransition("verified", { kind: "signedOut", requested: false }, { markerUserId: A });
  assert.equal(out.state, "signedOut");
  assert.equal(out.screen, "auth");
  assert.equal(out.expiredMessage, true);
  assert.equal(out.clear, false);
});

test("signedOut: further events without a session change nothing", () => {
  for (const input of INPUTS.filter((i) => i.kind !== "session")) {
    const out = authTransition("signedOut", input, { markerUserId: A });
    assert.equal(out.state, "signedOut");
    assert.equal(out.screen, null);
    assert.equal(out.clear, false);
  }
});

// --- Texte du bandeau (condition N) ---

test("the banner says offline until an online event, then syncing for at most 90 s", () => {
  assert.equal(offlineBannerText(null, 0), OFFLINE_TEXT);
  assert.equal(offlineBannerText(1000, 1000), SYNCING_TEXT);
  assert.equal(offlineBannerText(1000, 1000 + SYNCING_TEXT_MS - 1), SYNCING_TEXT);
  assert.equal(offlineBannerText(1000, 1000 + SYNCING_TEXT_MS), OFFLINE_TEXT);
  assert.equal(SYNCING_TEXT_MS, 90000);
});

// --- Déconnexion (faille C, condition M) ---

test("sign-out: offline, a change still waiting needs the network; nothing waiting signs out locally", () => {
  assert.equal(signOutStep("offline", 2), "needsNetwork");
  assert.equal(signOutStep("offline", 1), "needsNetwork");
  assert.equal(signOutStep("offline", 0), "local");
});

test("sign-out: verified, changes still waiting after the flush ask for confirmation", () => {
  assert.equal(signOutStep("verified", 0), "server");
  assert.equal(signOutStep("verified", 3), "confirm");
});

test("sign-out: an unknown count never signs out without asking", () => {
  assert.equal(signOutStep("offline", null), "needsNetwork");
  assert.equal(signOutStep("verified", null), "confirm");
});

test("sign-out sheet texts, singular, plural and unknown count", () => {
  assert.equal(signOutSheetText("needsNetwork", 2), "La déconnexion demande le réseau. Tes 2 modifications seront envoyées à son retour.");
  assert.equal(signOutSheetText("needsNetwork", 1), "La déconnexion demande le réseau. Ta modification sera envoyée à son retour.");
  assert.equal(signOutSheetText("needsNetwork", null), "La déconnexion demande le réseau. Tes modifications seront envoyées à son retour.");
  assert.equal(signOutSheetText("confirm", 3), "3 modifications ne sont pas encore envoyées. Se déconnecter maintenant les supprimera.");
  assert.equal(signOutSheetText("confirm", 1), "1 modification n'est pas encore envoyée. Se déconnecter maintenant la supprimera.");
  assert.equal(signOutSheetText("confirm", null), "Des modifications ne sont peut-être pas encore envoyées. Se déconnecter maintenant les supprimerait.");
});

test("the SDK's storage key is derived from the project address like supabase-js does", () => {
  assert.equal(authStorageKey("https://abcd1234.supabase.co"), "sb-abcd1234-auth-token");
  assert.equal(authStorageKey("http://127.0.0.1:8788"), "sb-127-auth-token");
});

test("local sign-out removes every key of the SDK session, and only those", () => {
  const key = "sb-abcd-auth-token";
  for (const k of [key, `${key}-user`, `${key}-code-verifier`, `${key}-flow-x-code-verifier`]) {
    assert.equal(isSdkAuthKey(k, key), true, k);
  }
  for (const k of ["mon-app-taches.lastUser", "sb-other-auth-token", `${key}x`, "theme"]) {
    assert.equal(isSdkAuthKey(k, key), false, k);
  }
});
