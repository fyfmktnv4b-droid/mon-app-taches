// Scénario « Bilan du dimanche » :
//   - l'interrupteur des Réglages : activé par défaut, juste sous l'heure du
//     rappel, enregistré dès le toucher, conservé après rechargement, qui revient
//     en arrière si l'écriture échoue, absent quand le serveur est coupé ;
//   - mesures et captures à 320, 375 et 390 px ;
//   - l'ouverture du Bilan au toucher : le banc n'a pas de service worker, il
//     dépose donc lui-même la marque dans la vraie boîte aux lettres (Cache
//     Storage de Chrome), puis vérifie ce que fait l'app : au démarrage, au
//     retour au premier plan, à l'arrivée tardive, déconnecté, marque périmée,
//     deux relevés simultanés.
//
// Avec BENCH_CAPTURE_DIR, les captures sont écrites dans ce dossier.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { OPEN_REQUEST_CACHE, OPEN_REQUEST_KEY, OPEN_REQUEST_TTL_MS } from "../../../openRequest.js";

export const name = "« Bilan du dimanche » (interrupteur des Réglages, ouverture au toucher)";

const EMAIL = "reglages-bilan@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur
const WIDTHS = [320, 375, 390];
const MIN_TOUCH = 44;
const SWITCH = "#weekly-review-enabled";
const SWITCH_LABEL = `label:has(${SWITCH})`;

const visible = (id) => `!document.getElementById(${JSON.stringify(id)}).hidden`;

async function resetBrowser(page, appOrigin) {
  await page.goto(`${appOrigin}/__bench/probe.html`);
  await page.evaluate(`(async () => {
    localStorage.clear();
    sessionStorage.clear();
    for (const db of await indexedDB.databases()) {
      await new Promise((done) => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = req.onerror = req.onblocked = done;
      });
    }
    return true;
  })()`);
}

async function signIn(page) {
  await page.tapSelector("#auth-email");
  await page.typeText(EMAIL);
  await page.tapSelector("#auth-password");
  await page.typeText(PASSWORD);
  await page.tapSelector("#auth-signin");
}

// Accueil -> écran principal, en passant les écrans éventuels (routine, « À reprendre »).
async function toMain(page) {
  await page.waitFor(`(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    if (shown("welcome")) { const b = document.getElementById("welcome-continue"); if (!b.disabled) b.click(); }
    if (shown("routine")) document.getElementById("routine-skip").click();
    if (shown("reprise")) document.querySelector("#reprise [data-exit]")?.click();
    return shown("app");
  })()`, { timeout: 20000, label: "l'écran principal" });
}

async function openSettings(page) {
  await page.tapSelector("#menu-toggle");
  await page.waitFor(visible("menu-panel"), { label: "le menu" });
  await page.tapSelector("#nav-settings");
}

async function waitForServer(check, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error(`Délai dépassé en attendant : ${label}`);
}

const switchReady = `!!document.querySelector(${JSON.stringify(SWITCH)}) && !document.querySelector(${JSON.stringify(SWITCH)}).disabled`;
const isChecked = (page) => page.evaluate(`document.querySelector(${JSON.stringify(SWITCH)}).checked`);

const MEASURE = `(() => {
  const label = document.querySelector(${JSON.stringify(SWITCH_LABEL)});
  const time = document.getElementById("morning-reminder-time");
  label.scrollIntoView({ block: "center" });
  const r = label.getBoundingClientRect();
  return {
    height: r.height, left: r.left, right: r.right,
    sameForm: document.getElementById("settings-form").contains(label) && document.getElementById("settings-form").contains(time),
    text: label.textContent.trim(),
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
  };
})()`;

// La clé est relative, résolue depuis le dossier de l'app (celui du service
// worker et de la page) : la page de sonde du banc est ailleurs, d'où l'adresse complète.
const MARK_URL = `new URL(${JSON.stringify(OPEN_REQUEST_KEY)}, location.origin + "/").href`;

// Ce que ferait le service worker au toucher. `age` : ancienneté de la marque (ms).
const dropMark = (page, age = 0) => page.evaluate(`(async () => {
  const cache = await caches.open(${JSON.stringify(OPEN_REQUEST_CACHE)});
  await cache.put(${MARK_URL}, new Response(JSON.stringify({ screen: "bilan", createdAt: Date.now() - ${age} })));
  return true;
})()`);
const MARK_LEFT = `caches.open(${JSON.stringify(OPEN_REQUEST_CACHE)}).then((c) => c.match(${MARK_URL})).then((r) => !!r)`;
const markLeft = (page) => page.evaluate(MARK_LEFT);
const bilanShown = `${visible("bilan")} && !!document.querySelector("#bilan .bilan-hero-title")`;

async function closeBilan(page) {
  await page.tapSelector("#bilan [data-close]");
  await page.waitFor(visible("app"), { label: "l'écran principal après « Fermer »" });
}

async function openRequests({ page, fake, appOrigin, log }) {
  // 1. App fermée : la marque est là au démarrage. Bilan direct, sans l'accueil.
  await page.goto(`${appOrigin}/__bench/probe.html`);
  await dropMark(page);
  await page.goto(`${appOrigin}/`);
  await page.waitFor(bilanShown, { label: "le Bilan au démarrage" });
  assert.equal(await page.evaluate(`document.getElementById("welcome").hidden && document.getElementById("splash").hidden`), true);
  assert.equal(await markLeft(page), false, "la marque est consommée");
  await new Promise((ok) => setTimeout(ok, 800));
  assert.equal(await page.evaluate(visible("bilan")), true, "le Bilan reste affiché");
  await closeBilan(page);
  log("app fermée : Bilan direct, « Fermer » mène aux tâches");

  // 2. Un rechargement ne le rouvre pas.
  await page.goto(`${appOrigin}/`);
  await page.waitFor(visible("welcome"), { label: "l'accueil après rechargement" });
  assert.equal(await page.evaluate(visible("bilan")), false);
  log("rechargement : accueil normal");

  // 3. Marque déposée juste après le démarrage (iPhone : l'app peut démarrer
  //    avant que le service worker ait écrit). Sans aucun autre signal.
  await page.goto(`${appOrigin}/`);
  await dropMark(page);
  await page.waitFor(bilanShown, { timeout: 5000, label: "le Bilan pour une marque arrivée après le démarrage" });
  await closeBilan(page);
  log("marque arrivée après le démarrage : relevée");

  // 4. App en arrière-plan : relevée au retour au premier plan, feuilles fermées.
  await page.goto(`${appOrigin}/`);
  await toMain(page);
  await new Promise((ok) => setTimeout(ok, 3300)); // après les relevés du démarrage
  await page.tapSelector("#menu-toggle");
  await page.waitFor(visible("menu-panel"), { label: "le menu" });
  await dropMark(page);
  await page.evaluate(`document.dispatchEvent(new Event("visibilitychange"))`);
  await page.waitFor(bilanShown, { label: "le Bilan au retour au premier plan" });
  await closeBilan(page);
  assert.equal(await page.evaluate(`document.getElementById("menu-panel").hidden`), true, "le menu ne réapparaît pas");
  log("arrière-plan : Bilan au retour, menu refermé");

  // 4 bis. App déjà à l'écran : aucun retour au premier plan, seul le message
  //        du service worker (simulé ici) la prévient.
  await dropMark(page);
  await page.evaluate(`navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open-request" } }))`);
  await page.waitFor(bilanShown, { label: "le Bilan sur message du service worker" });
  await closeBilan(page);
  log("app à l'écran : Bilan sur message du service worker");

  // 5. Marque périmée : ignorée et effacée.
  await page.goto(`${appOrigin}/__bench/probe.html`);
  await dropMark(page, OPEN_REQUEST_TTL_MS + 1000);
  await page.goto(`${appOrigin}/`);
  await page.waitFor(visible("welcome"), { label: "l'accueil pour une marque périmée" });
  await page.waitFor(`${MARK_LEFT}.then((left) => !left)`, { label: "la marque périmée effacée" });
  assert.equal(await page.evaluate(visible("bilan")), false);
  log("marque périmée : accueil normal");

  // 6. Deux relevés simultanés dans le vrai Cache Storage : un seul gagne.
  await new Promise((ok) => setTimeout(ok, 3300)); // après les relevés du démarrage
  await dropMark(page);
  const taken = await page.evaluate(`import("/openRequest.js").then(({ takeOpenRequest }) => Promise.all([takeOpenRequest(), takeOpenRequest()]))`);
  assert.deepEqual([...taken].sort(), [false, true]);
  log("deux relevés simultanés : un seul gagne");

  // 7. Déconnecté : la demande attend la connexion.
  await resetBrowser(page, appOrigin);
  await dropMark(page);
  await page.goto(`${appOrigin}/`);
  await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
  await signIn(page);
  await page.waitFor(bilanShown, { label: "le Bilan après la connexion" });
  await closeBilan(page);
  log("déconnecté : Bilan juste après la connexion");
}

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  const dir = process.env.BENCH_CAPTURE_DIR || null;
  if (dir) await mkdir(dir, { recursive: true });

  await resetBrowser(page, appOrigin);
  const user = fake.seedUser({ email: EMAIL, password: PASSWORD });
  const row = () => fake.db.user_settings.find((r) => r.user_id === user.id);
  const startWidth = await page.evaluate("window.innerWidth");
  // Sans service worker dans la copie, navigator.serviceWorker.ready ne répond
  // jamais : sans PushManager, l'écran Réglages sait que l'appareil n'est pas abonné.
  const restorePush = await page.addInitScript("delete window.PushManager;");

  try {
    await page.goto(`${appOrigin}/`);
    await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
    await signIn(page);
    await toMain(page);

    // 1. Activé par défaut, à côté de l'heure du rappel, à toutes les largeurs.
    await openSettings(page);
    await page.waitFor(switchReady, { label: "l'interrupteur" });
    assert.equal(await isChecked(page), true, "activé par défaut");
    for (const width of WIDTHS) {
      await page.resize(width);
      await page.evaluate("new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))");
      const m = await page.evaluate(MEASURE);
      if (dir) await page.screenshot(join(dir, `reglages-${width}.png`));
      assert.equal(m.text, "Bilan du dimanche");
      assert.ok(m.sameForm, "dans le bloc de l'heure du rappel");
      assert.ok(m.height >= MIN_TOUCH, `${width} px : zone tactile de ${m.height} px`);
      assert.ok(m.left >= 0 && m.right <= width, `${width} px : dépasse de l'écran`);
      assert.equal(m.pageOverflow, false, `${width} px : la page déborde`);
      log(`${width} px : zone tactile de ${Math.round(m.height)} px`);
    }

    // 2. Coupé au toucher, enregistré, conservé après rechargement.
    await page.tapSelector(SWITCH_LABEL);
    await waitForServer(() => row().weekly_review_enabled === false, "l'écriture de l'interrupteur coupé");
    await page.waitFor(switchReady, { label: "l'interrupteur après l'écriture" });
    assert.equal(await isChecked(page), false);
    await page.goto(`${appOrigin}/`);
    await toMain(page);
    await openSettings(page);
    await page.waitFor(switchReady, { label: "l'interrupteur après rechargement" });
    assert.equal(await isChecked(page), false, "conservé après rechargement");
    if (dir) await page.screenshot(join(dir, "reglages-coupe.png"));

    // 3. Réactivé.
    await page.tapSelector(SWITCH_LABEL);
    await waitForServer(() => row().weekly_review_enabled === true, "l'écriture de l'interrupteur activé");
    await page.waitFor(`${switchReady} && document.querySelector(${JSON.stringify(SWITCH)}).checked`, { label: "l'interrupteur réactivé" });
    log("coupé puis réactivé, conservé après rechargement");

    // 4. Écriture impossible : la case revient en arrière et l'erreur s'affiche.
    fake.setMode("down");
    await page.tapSelector(SWITCH_LABEL);
    await page.waitFor(`document.getElementById("app-error").textContent !== ""`, { label: "le message d'erreur" });
    await page.waitFor(switchReady, { label: "l'interrupteur de nouveau utilisable" });
    assert.equal(await isChecked(page), true, "la case revient en arrière");
    assert.equal(row().weekly_review_enabled, true, "rien n'a été écrit");
    log("écriture impossible : retour en arrière et message d'erreur");

    // 5. Serveur coupé à l'ouverture : message habituel, aucun interrupteur.
    await page.goto(`${appOrigin}/`);
    await toMain(page);
    await openSettings(page);
    await page.waitFor(`document.getElementById("main-view").textContent.includes("Réglages indisponibles hors-ligne")`, { label: "le message hors-ligne" });
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(SWITCH)}) === null`), true);
    log("serveur coupé : « Réglages indisponibles hors-ligne », aucun interrupteur");
    fake.setMode("online");

    await openRequests({ page, fake, appOrigin, log });
    assert.deepEqual(page.errors.filter((e) => !e.includes("ServiceWorker")), [], "aucune erreur JS");
  } finally {
    fake.setMode("online");
    await restorePush();
    await page.resize(startWidth);
  }
}
