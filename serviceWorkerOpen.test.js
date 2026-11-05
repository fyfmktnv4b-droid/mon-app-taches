import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeCaches } from "./fakeCaches.js";
import { OPEN_REQUEST_CACHE, OPEN_REQUEST_KEY, takeOpenRequest } from "./openRequest.js";

// Le vrai service-worker.js, exécuté avec un faux environnement : on déclenche
// ses événements à la main. Ce n'est pas un vrai navigateur (voir README du banc).
const source = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
const CACHE_NAME = `mon-app-taches-${source.match(/^const CACHE_VERSION = "([^"]+)";/m)[1]}`;
const ORIGIN = "https://app.example.test";

function loadWorker({ windows = [], caches = fakeCaches(), fetchImpl = async () => new Response("réseau") } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, listener) => { listeners[type] = listener; },
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: {
      claim: () => {},
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); },
    },
  };
  vm.runInNewContext(source, { self, caches, fetch: fetchImpl, URL, Response, console });

  async function fire(type, event = {}) {
    let waited = Promise.resolve();
    let responded;
    listeners[type]({
      ...event,
      waitUntil: (promise) => { waited = promise; },
      respondWith: (promise) => { responded = promise; },
    });
    await waited;
    return responded;
  }
  const click = (data) => fire("notificationclick", { notification: { data, close: () => {} } });
  const push = (payload) => fire("push", { data: { json: () => payload } });
  return { caches, shown, opened, fire, click, push };
}

function fakeWindow({ focusFails = false } = {}) {
  const client = {
    focused: 0,
    messages: [],
    postMessage: (message) => client.messages.push(message),
    focus: async () => {
      client.focused++;
      if (focusFails) throw new Error("focus refusé");
    },
  };
  return client;
}

async function mailboxSize(caches) {
  return caches.stores.get(OPEN_REQUEST_CACHE)?.entries.size ?? 0;
}

test("push : le texte reçu est affiché et la demande d'ouverture du Bilan est gardée", async () => {
  const worker = loadWorker();
  await worker.push({ title: "Ta semaine est prête", body: "Ton bilan est là, quand tu veux.", open: "bilan" });
  assert.equal(worker.shown[0].title, "Ta semaine est prête");
  assert.equal(worker.shown[0].options.body, "Ton bilan est là, quand tu veux.");
  assert.equal(worker.shown[0].options.data.open, "bilan");
});

test("push : rappel habituel, ou valeur inconnue dans open, aucune ouverture demandée", async () => {
  const worker = loadWorker();
  await worker.push({ title: "Rappel", body: "Pain" });
  await worker.push({ title: "Rappel", body: "Pain", open: "https://exemple.invalid/" });
  assert.equal(worker.shown[0].options.data.open, null);
  assert.equal(worker.shown[1].options.data.open, null);
});

test("clic sur le Bilan, app ouverte : marque déposée, app au premier plan, message envoyé", async () => {
  const window = fakeWindow();
  const worker = loadWorker({ windows: [window] });
  await worker.click({ open: "bilan" });
  assert.equal(window.focused, 1);
  assert.equal(window.messages.length, 1);
  assert.equal(window.messages[0].type, "open-request");
  assert.deepEqual(worker.opened, []);
  assert.equal(await takeOpenRequest(worker.caches), true);
});

test("clic sur le Bilan, app fermée : marque déposée, app ouverte sur son adresse habituelle", async () => {
  const worker = loadWorker();
  await worker.click({ open: "bilan" });
  assert.deepEqual(worker.opened, ["./"]);
  assert.equal(await takeOpenRequest(worker.caches), true);
});

test("clic sur le Bilan : un focus refusé n'empêche ni la marque ni le message", async () => {
  const window = fakeWindow({ focusFails: true });
  const worker = loadWorker({ windows: [window] });
  await worker.click({ open: "bilan" }).catch(() => {});
  assert.equal(window.messages.length, 1);
  assert.equal(await mailboxSize(worker.caches), 1);
});

test("clic sur le Bilan : stockage en panne, l'app s'ouvre quand même", async () => {
  const caches = { ...fakeCaches(), open: async () => { throw new Error("stockage indisponible"); } };
  const worker = loadWorker({ caches });
  await worker.click({ open: "bilan" });
  assert.deepEqual(worker.opened, ["./"]);
});

test("clic sur un rappel habituel : aucune marque, comportement inchangé", async () => {
  const window = fakeWindow();
  const open = loadWorker({ windows: [window] });
  await open.click(null);
  assert.equal(window.focused, 1);
  assert.deepEqual(window.messages, []);
  assert.equal(await mailboxSize(open.caches), 0);

  const closed = loadWorker();
  await closed.click({ open: null });
  assert.deepEqual(closed.opened, ["./"]);
  assert.equal(await mailboxSize(closed.caches), 0);
});

test("activate : les anciens caches sont effacés, la boîte aux lettres reste", async () => {
  const caches = fakeCaches();
  await caches.open("mon-app-taches-v40");
  await caches.open(CACHE_NAME);
  const mailbox = await caches.open(OPEN_REQUEST_CACHE);
  await mailbox.put(OPEN_REQUEST_KEY, new Response(JSON.stringify({ screen: "bilan", createdAt: Date.now() })));

  await loadWorker({ caches }).fire("activate");

  assert.deepEqual((await caches.keys()).sort(), [CACHE_NAME, OPEN_REQUEST_CACHE].sort());
  assert.equal(await takeOpenRequest(caches), true);
});

test("fetch : la boîte aux lettres ne répond à aucune requête de l'app et n'est jamais écrite", async () => {
  const caches = fakeCaches();
  const app = await caches.open(CACHE_NAME);
  await app.put(`${ORIGIN}/index.html`, new Response("page en cache"));
  const mailbox = await caches.open(OPEN_REQUEST_CACHE);
  await mailbox.put(OPEN_REQUEST_KEY, new Response("marque"));
  const worker = loadWorker({ caches });

  const cached = await worker.fire("fetch", { request: { url: `${ORIGIN}/index.html`, method: "GET" } });
  assert.equal(await cached.text(), "page en cache");

  const fetched = await worker.fire("fetch", { request: { url: `${ORIGIN}/autre.js`, method: "GET" } });
  assert.equal(await fetched.text(), "réseau");
  await new Promise((done) => setTimeout(done)); // l'écriture du cache n'est pas attendue par fetch

  assert.deepEqual([...mailbox.entries.keys()], [OPEN_REQUEST_KEY]);
  assert.ok(app.entries.has(`${ORIGIN}/autre.js`), "la réponse réseau va dans le cache de l'app");
});
