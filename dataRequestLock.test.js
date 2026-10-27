import { test } from "node:test";
import assert from "node:assert/strict";
import { dataRequestLock, NoUserTokenError } from "./supabaseClient.js";

// Le verrou ne regarde que les requêtes de données (/rest/v1) et seulement
// l'ABSENCE de jeton d'utilisateur.
const REST = "https://projet.test/rest/v1/";
const ANON = "cle-anonyme";

function setup() {
  const sent = [];
  let blocked = 0;
  const lockedFetch = dataRequestLock({
    restUrl: REST,
    anonKey: ANON,
    send: async (input, init) => { sent.push(String(input instanceof Request ? input.url : input)); return new Response("[]"); },
    onBlocked: () => { blocked++; },
  });
  return { lockedFetch, sent, blocked: () => blocked };
}

const withAuth = (value) => ({ headers: new Headers(value ? { apikey: ANON, Authorization: value } : { apikey: ANON }) });

test("a data request sent with the anonymous key is refused before sending", async () => {
  const { lockedFetch, sent, blocked } = setup();
  await assert.rejects(lockedFetch(`${REST}tasks?id=eq.1`, withAuth(`Bearer ${ANON}`)), NoUserTokenError);
  assert.deepEqual(sent, []);
  assert.equal(blocked(), 1);
});

test("a data request with no Authorization at all is refused too", async () => {
  const { lockedFetch, sent } = setup();
  await assert.rejects(lockedFetch(`${REST}rpc/set_routine_check`, withAuth(null)), NoUserTokenError);
  await assert.rejects(lockedFetch(new Request(`${REST}tasks`)), NoUserTokenError);
  assert.deepEqual(sent, []);
});

test("the refusal is named AbortError so PostgREST does not retry it", () => {
  assert.equal(new NoUserTokenError().name, "AbortError");
  assert.match(new NoUserTokenError().message, /Hors-ligne/);
});

test("a data request carrying a user token goes through, even an expired one", async () => {
  const { lockedFetch, sent, blocked } = setup();
  await lockedFetch(`${REST}tasks`, withAuth("Bearer eyJ.user-token.sig"));
  await lockedFetch(new Request(`${REST}tasks`, { headers: { Authorization: "Bearer eyJ.expired.sig" } }));
  assert.equal(sent.length, 2);
  assert.equal(blocked(), 0);
});

test("authentication requests are never touched, even with the anonymous key", async () => {
  const { lockedFetch, sent, blocked } = setup();
  for (const path of ["auth/v1/token?grant_type=refresh_token", "auth/v1/token?grant_type=password", "auth/v1/logout", "auth/v1/user"]) {
    await lockedFetch(`https://projet.test/${path}`, withAuth(`Bearer ${ANON}`));
  }
  assert.equal(sent.length, 4);
  assert.equal(blocked(), 0);
});

test("other addresses are not touched", async () => {
  const { lockedFetch, sent } = setup();
  await lockedFetch("https://projet.test/rest/v2/x", withAuth(null));
  await lockedFetch("https://autre.test/rest/v1/tasks", withAuth(null));
  assert.equal(sent.length, 2);
});
