import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Entrée dans l'app (enterApp) : l'envoi de la file est attendu 2 s au plus
// (settlesWithin, screenSwap.js). Le plafond arrête seulement d'ATTENDRE :
// l'envoi continue en arrière-plan, n'est jamais annulé, jamais doublé par un
// second envoi en parallèle, jamais relancé (un plafond qui relance a déjà
// failli créer une tâche en double). Faux Supabase, réseau réel coupé.
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new TypeError("network disabled in tests");
};
globalThis.indexedDB = fakeIndexedDB();

const { supabase } = await import("./supabaseClient.js");
const storage = await import("./storage.js");
const sync = await import("./sync.js");
const { setServerGate } = await import("./authGate.js");
const { settlesWithin } = await import("./screenSwap.js");

// Création de tâche qui ne répond que quand le test le décide.
let inserts = 0;
let answer = null;
supabase.auth.getUser = async () => ({ data: { user: { id: "user-A" } }, error: null });
supabase.from = (table) => ({
  insert: (rows) => ({
    select: () => {
      assert.equal(table, "tasks");
      inserts++;
      return new Promise((ok) => {
        answer = () => ok({ data: rows.map((row, i) => ({ ...row, id: `serveur-${i}` })), error: null });
      });
    },
  }),
});

test("le plafond de 2 s cesse d'attendre l'envoi sans l'annuler, le doubler ni le relancer", async () => {
  setServerGate(true);
  await storage.enqueueMutation({ type: "create", rawText: "Acheter du pain", tasks: [{ id: "provisoire-1", text: "Acheter du pain" }] });

  const first = sync.flushQueue();
  // Plafond court ici (le vrai est FLUSH_WAIT_MS) : on cesse d'attendre.
  assert.equal(await settlesWithin(first, 30), false);
  assert.equal(inserts, 1, "un seul envoi parti");
  assert.equal((await storage.getPendingMutations()).length, 1, "pas annulé : la mutation attend sa réponse");

  // Un second appel pendant l'envoi (entrée suivante, retour du réseau) le rejoint.
  const second = sync.flushQueue();
  assert.equal(second, first, "le même envoi, pas un second en parallèle");
  assert.equal(await settlesWithin(second, 30), false);
  assert.equal(inserts, 1, "aucun second envoi");

  // La réponse arrive après le plafond : l'envoi se termine en arrière-plan.
  answer();
  await first;
  assert.equal(inserts, 1);
  assert.deepEqual(await storage.getPendingMutations(), [], "envoyé une fois, retiré de la file");

  // Plus rien en file : aucun nouvel essai.
  await sync.flushQueue();
  assert.equal(inserts, 1, "jamais relancé");
  assert.equal(networkCalls, 0);
});
