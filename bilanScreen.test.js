import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeIndexedDB } from "./fakeIndexedDB.js";

// Bilan de la semaine (v44) : tout est lu AVANT le dessin, qui se fait en une
// seule fois, sans « Chargement… » ni tiret provisoire. Hors-ligne, les mêmes
// messages qu'avant (« Indisponible hors-ligne », « Hors-ligne : d'après cet
// appareil »). Réseau réel coupé ; aucun navigateur : une fausse section.
globalThis.fetch = async () => {
  throw new TypeError("network disabled in tests");
};
globalThis.window = { scrollTo() {} };

const storage = await import("./storage.js");
const { setServerGate } = await import("./authGate.js");
const { openBilanScreen } = await import("./bilanScreen.js");
const { loadBilanData } = await import("./bilan.js");
const { localDateString } = await import("./localDate.js");

// Section factice : compte les dessins (chaque affectation de innerHTML).
function fakeSection() {
  const section = { draws: [], dataset: {}, addEventListener() {} };
  Object.defineProperty(section, "innerHTML", {
    get() { return this.draws.at(-1) ?? ""; },
    set(html) { this.draws.push(html); },
  });
  return section;
}

// Lecture contrôlée par le test.
function deferredLoad() {
  let resolve;
  const load = () => new Promise((ok) => { resolve = ok; });
  return { load, answer: (data) => resolve(data) };
}

const ONLINE_HABITS = { source: "server", checksByDate: {} };

beforeEach(() => {
  globalThis.indexedDB = fakeIndexedDB();
});

test("rien n'est dessiné pendant la lecture, puis un seul dessin complet, montré aussitôt", async () => {
  const section = fakeSection();
  const reveals = [];
  const { load, answer } = deferredLoad();
  const opened = openBilanScreen(section, { onClose() {}, load, reveal: () => reveals.push(section.draws.length) });
  await new Promise((ok) => setImmediate(ok));
  assert.equal(section.draws.length, 0, "l'écran précédent reste affiché pendant la lecture");
  answer({ tasks: [], habits: ONLINE_HABITS });
  assert.equal(await opened, true);
  assert.equal(section.draws.length, 1, "un seul dessin");
  assert.deepEqual(reveals, [1], "montré juste après ce dessin");
  assert.ok(!section.innerHTML.includes("Chargement"), "aucun « Chargement… » dans le Bilan");
  assert.ok(!section.innerHTML.includes("aria-busy"));
  assert.match(section.innerHTML, /Bilan de la semaine/);
});

test("une ouverture plus récente, ou un autre écran demandé : l'ancienne lecture ne dessine rien", async () => {
  const section = fakeSection();
  const first = deferredLoad();
  const second = deferredLoad();
  const reveal = () => { throw new Error("ne doit pas être montré"); };
  const old = openBilanScreen(section, { onClose() {}, load: first.load, reveal });
  const recent = openBilanScreen(section, { onClose() {}, load: second.load, reveal: () => {} });
  first.answer({ tasks: [], habits: ONLINE_HABITS });
  assert.equal(await old, false);
  assert.equal(section.draws.length, 0);
  second.answer({ tasks: [], habits: ONLINE_HABITS });
  assert.equal(await recent, true);
  assert.equal(section.draws.length, 1);

  const other = deferredLoad();
  const notWanted = openBilanScreen(section, { onClose() {}, load: other.load, isWanted: () => false, reveal });
  other.answer({ tasks: [], habits: ONLINE_HABITS });
  assert.equal(await notWanted, false);
  assert.equal(section.draws.length, 1);
});

test("hors-ligne sans cache complet des routines : « Indisponible hors-ligne », inchangé", async () => {
  const section = fakeSection();
  await openBilanScreen(section, { onClose() {}, load: async () => ({ tasks: [], habits: { source: "unavailable" } }) });
  assert.equal(section.innerHTML.match(/Indisponible hors-ligne/g).length, 2, "Salle et 10 000 pas");
  assert.ok(!section.innerHTML.includes("Chargement"));
});

test("hors-ligne avec le cache complet : « Hors-ligne : d'après cet appareil », inchangé", async () => {
  const section = fakeSection();
  await openBilanScreen(section, { onClose() {}, load: async () => ({ tasks: [], habits: { source: "cache", checksByDate: {} } }) });
  assert.match(section.innerHTML, /Hors-ligne : d&#39;après cet appareil/); // apostrophe échappée dans le HTML
  assert.ok(!section.innerHTML.includes("Indisponible hors-ligne"));
});

test("loadBilanData hors-ligne (porte serveur fermée) : tâches du cache, habitudes « indisponibles »", async () => {
  setServerGate(false);
  const cached = [{ id: "t1", text: "Tâche en cache", done: false, created_at: new Date().toISOString() }];
  await storage.setCachedTasks(cached);
  const { tasks, habits } = await loadBilanData(localDateString());
  assert.deepEqual(tasks.map((t) => t.id), ["t1"]);
  // Lundi : aucun jour passé à exiger, le cache (vide) suffit.
  const monday = new Date().getDay() === 1;
  assert.equal(habits.source, monday ? "cache" : "unavailable");
});
