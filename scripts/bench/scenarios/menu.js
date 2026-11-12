// Scénario « Menu » (v45) : un écran touché DEPUIS LE MENU apparaît en un coup,
// menu compris. Le menu reste ouvert (avec son voile) jusqu'à ce que l'écran
// d'arrivée soit prêt ; ensuite menu fermé et écran d'arrivée apparaissent dans
// la MÊME image. Jamais l'écran de départ sans son menu (l'ancien « Aujourd'hui »
// vu 2 à 3 images). Relevé image par image (frames.js, checkMenuTransition).
//   1. Aujourd'hui -> Historique, Réglages, Bilan, Ma routine, puis
//      Réglages -> Bilan ; réseau à 0 ms, 150 ms (attente sans « Chargement… »)
//      et 1000 ms (« Chargement… » vers 300 ms, menu compris).
//   2. L'entrée de l'écran où l'on est déjà (Historique depuis Historique,
//      Réglages depuis Réglages) : le menu se ferme quand même.
//   3. Pendant l'attente : voile, bouton du menu, Échap et seconde entrée sont
//      IGNORÉS (le menu reste ouvert, l'écran choisi arrive) ; sous le doigt,
//      le menu ou son voile, jamais une ligne de l'écran de dessous.
//   4. Un autre écran prend la place pendant l'attente (demande d'ouverture
//      d'une notification ; « Fermer » vers Aujourd'hui) : le menu se ferme, ne
//      reste jamais ouvert ni bloqué (il se rouvre et marche ensuite).
//   5. Lecture en échec ; hors-ligne ; « Sauvegarder mes tâches » (ne change pas
//      d'écran) : le menu se ferme.
// Le banc ne mesure pas l'état « pressé » (:hover / :active d'iOS).
import { OPEN_REQUEST_CACHE, OPEN_REQUEST_KEY } from "../../../openRequest.js";
import { snapshotInPage, startRecording, settledOn, STOP_RECORDING, checkMenuTransition } from "../frames.js";

export const name = "Menu : l'écran touché arrive menu compris, en un coup";

const EMAIL = "menu-banc@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur
const SLOW_MS = 1000;
const QUIET_MS = 1200;

const visible = (id) => `!document.getElementById(${JSON.stringify(id)}).hidden`;
const snap = `(${snapshotInPage.toString()})()`;
const isComplete = (screen) => `${snap}.complete[${JSON.stringify(screen)}]`;
const menuClosed = `document.getElementById("menu-panel").hidden`;
const click = (id) => `document.getElementById(${JSON.stringify(id)}).click()`;
const CLOSE = `[...document.querySelectorAll("[data-close]")].find((b) => b.getClientRects().length > 0).click()`;
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

const MARK_URL = `new URL(${JSON.stringify(OPEN_REQUEST_KEY)}, location.origin + "/").href`;
const dropMark = (page) => page.evaluate(`(async () => {
  const cache = await caches.open(${JSON.stringify(OPEN_REQUEST_CACHE)});
  await cache.put(${MARK_URL}, new Response(JSON.stringify({ screen: "bilan", createdAt: Date.now() })));
  return true;
})()`);

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
  await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
  await page.tapSelector("#auth-email");
  await page.typeText(EMAIL);
  await page.tapSelector("#auth-password");
  await page.typeText(PASSWORD);
  await page.tapSelector("#auth-signin");
}

async function toMain(page) {
  await page.waitFor(`(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    if (shown("welcome")) { const b = document.getElementById("welcome-continue"); if (!b.disabled) b.click(); }
    if (shown("routine") && !document.getElementById("routine-skip").disabled) document.getElementById("routine-skip").click();
    if (shown("reprise")) document.querySelector("#reprise [data-exit]")?.click();
    return shown("app");
  })()`, { timeout: 20000, label: "l'écran principal" });
  await page.waitFor(isComplete("main"), { timeout: 15000, label: "« Aujourd'hui » complet" });
}

async function openMenu(page) {
  await page.tapSelector("#menu-toggle");
  await page.waitFor(visible("menu-panel"), { label: "le menu" });
}

// Va à `screen` ("history", "settings") par le menu, réseau rapide, sans relevé.
async function goTo(page, fake, screen, entry) {
  fake.setDelay(0);
  await openMenu(page);
  await page.evaluate(click(entry));
  await page.waitFor(isComplete(screen), { timeout: 15000, label: `« ${screen} » complet` });
  await page.waitFor(menuClosed, { label: "le menu fermé" });
}

async function backToMain(page) {
  // Déjà sur « Aujourd'hui » (un défaut a pu laisser l'écran demandé de côté) : rien à fermer.
  await page.evaluate(`${snap}.complete.main || ${CLOSE}`);
  await page.waitFor(isComplete("main"), { timeout: 15000, label: "« Aujourd'hui » complet" });
  await page.waitFor(menuClosed, { label: "le menu fermé sur Aujourd'hui" });
}

// Un changement d'écran touché depuis le menu, relevé image par image.
async function measureMenu(page, spec, action) {
  await page.waitFor(isComplete(spec.from), { timeout: 15000, label: `départ « ${spec.from} » complet` });
  await openMenu(page);
  await page.evaluate(startRecording(action));
  try {
    await page.waitFor(settledOn(spec.to, QUIET_MS), { timeout: 15000, label: `« ${spec.to} » complet et immobile` });
  } catch { /* le relevé dit ce qui manque */ }
  const frames = await page.evaluate(STOP_RECORDING);
  return { frames, problems: checkMenuTransition(frames, spec) };
}

const ENTRIES = [
  { to: "history", entry: "nav-history", label: "Historique" },
  { to: "settings", entry: "nav-settings", label: "Réglages" },
  { to: "bilan", entry: "nav-bilan", label: "Bilan" },
  { to: "routine", entry: "open-routine", label: "Ma routine" },
];

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  fake.setDelay(0);
  const failures = [];
  const fail = (label, problems) => { for (const p of problems) failures.push(`${label} : ${p}`); };
  const check = (label, ok, detail) => {
    log(`${label} : ${ok ? "ok" : `ÉCHEC (${detail})`}`);
    if (!ok) failures.push(`${label} : ${detail}`);
  };

  await resetBrowser(page, appOrigin);
  const user = fake.seedUser({ email: EMAIL, password: PASSWORD });
  const now = new Date().toISOString();
  for (let i = 1; i <= 5; i++) {
    fake.db.tasks.push({
      id: crypto.randomUUID(), user_id: user.id, urgent: null, important: i === 1, important_since: i === 1 ? now.slice(0, 10) : null,
      done: false, completed_at: null, reminder_time: null, created_at: now, updated_at: now, text: `Tâche du banc ${i}`,
    });
  }

  const startWidth = await page.evaluate("window.innerWidth");
  // Comme enUnCoup.js : sans service worker, Réglages attendrait navigator.serviceWorker.ready.
  const restorePush = await page.addInitScript("delete window.PushManager;");
  try {
    await page.resize(390, 844);
    await page.goto(`${appOrigin}/`);
    await signIn(page);
    await toMain(page);

    // 1. Chaque entrée du menu, trois vitesses de réseau.
    for (const delay of [0, 150, SLOW_MS]) {
      fake.setDelay(delay);
      for (const e of ENTRIES) {
        const spec = { from: "main", to: e.to };
        const { frames, problems } = await measureMenu(page, spec, click(e.entry));
        const loading = frames.find((f) => f.loading);
        log(`réseau ${delay} ms | Aujourd'hui -> ${e.label} : ${problems.length ? `ÉCHEC (${problems.length})` : "menu et écran en un coup"}${loading ? `, « Chargement… » à ${loading.t} ms` : ""}`);
        for (const p of problems) log(`    ${p}`);
        fail(`Aujourd'hui -> ${e.label} (réseau ${delay} ms)`, problems);
        fake.setDelay(0);
        await backToMain(page);
        fake.setDelay(delay);
      }
      // Depuis un autre écran du menu : Réglages -> Bilan.
      fake.setDelay(0);
      await goTo(page, fake, "settings", "nav-settings");
      fake.setDelay(delay);
      const { problems } = await measureMenu(page, { from: "settings", to: "bilan" }, click("nav-bilan"));
      log(`réseau ${delay} ms | Réglages -> Bilan : ${problems.length ? `ÉCHEC (${problems.length})` : "menu et écran en un coup"}`);
      for (const p of problems) log(`    ${p}`);
      fail(`Réglages -> Bilan (réseau ${delay} ms)`, problems);
      fake.setDelay(0);
      await backToMain(page);
    }

    // 2. L'entrée de l'écran où l'on est déjà : le menu se ferme quand même.
    for (const delay of [0, SLOW_MS]) {
      for (const e of ENTRIES.slice(0, 2)) {
        fake.setDelay(0);
        await goTo(page, fake, e.to, e.entry);
        fake.setDelay(delay);
        const { problems } = await measureMenu(page, { from: e.to, to: e.to, expectLoading: delay === SLOW_MS }, click(e.entry));
        log(`réseau ${delay} ms | ${e.label} touché depuis ${e.label} : ${problems.length ? `ÉCHEC (${problems.length})` : "menu fermé, écran intact"}`);
        for (const p of problems) log(`    ${p}`);
        fail(`${e.label} depuis ${e.label} (réseau ${delay} ms)`, problems);
        fake.setDelay(0);
        await backToMain(page);
      }
    }

    // 3. Pendant l'attente (réseau lent, 100 ms après le toucher, avant « Chargement… »).
    fake.setDelay(SLOW_MS);
    await openMenu(page);
    const tile = await page.evaluate(`(() => {
      const r = document.getElementById("nav-history").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await page.tap(tile.x, tile.y); // vrai toucher
    await pause(100);
    const during = await page.evaluate(`(async () => {
      const under = document.elementFromPoint(${tile.x}, ${tile.y});
      const before = { menuOpen: !document.getElementById("menu-panel").hidden, loading: ${snap}.loading,
        underMenu: !!under && !!under.closest("#menu-panel, #menu-scrim"), under: under ? (under.id || under.className || under.tagName) : null };
      document.getElementById("menu-scrim").click();
      document.getElementById("menu-toggle").click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.getElementById("nav-settings").click();
      await new Promise((ok) => setTimeout(ok, 50));
      return { ...before, stillOpen: !document.getElementById("menu-panel").hidden };
    })()`);
    check("pendant l'attente : le menu est encore ouvert 100 ms après le toucher", during.menuOpen, "menu déjà fermé");
    check("pendant l'attente : sous le doigt, le menu ou son voile (pas une ligne de l'écran de dessous)", during.underMenu, `sous le doigt : ${during.under}`);
    check("pendant l'attente : voile, bouton du menu, Échap et seconde entrée sont ignorés", during.stillOpen, "le menu s'est fermé ou a été annulé");
    // Attente tolérante : un défaut ne doit pas arrêter le scénario, il est rapporté ci-dessous.
    await page.waitFor(`${menuClosed} && !${snap}.loading`, { timeout: 15000, label: "le menu fermé, sans « Chargement… »" }).catch(() => {});
    await pause(4000); // les lectures lentes (1 s par requête) finissent
    const title = await page.evaluate(`document.getElementById("header-title").textContent.trim()`);
    check("pendant l'attente : l'écran choisi (Historique) arrive, pas la seconde entrée", title === "Historique", `titre : ${title}`);
    fake.setDelay(0);
    await backToMain(page);

    // 4. Un autre écran prend la place pendant l'attente : le menu ne reste ni ouvert ni bloqué.
    const takeOver = [
      ["demande d'ouverture d'une notification", `navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open-request" } }))`, "bilan", true],
      ["« Fermer » vers Aujourd'hui", `document.querySelector("#app [data-close]").click()`, "main", false],
    ];
    for (const [label, action, lands, needsMark] of takeOver) {
      fake.setDelay(0);
      await pause(3300); // après les relevés du démarrage (comme fermer.js)
      fake.setDelay(500); // « Chargement… » à 300 ms, lectures assez courtes pour finir vite
      await openMenu(page);
      await page.evaluate(click("nav-history"));
      await pause(100);
      if (needsMark) await dropMark(page);
      await page.evaluate(action);
      try {
        await page.waitFor(`${isComplete(lands)} && ${menuClosed}`, { timeout: 15000, label: `« ${lands} » complet, menu fermé` });
        await pause(1500); // l'Historique abandonné ne doit pas revenir
      } catch { /* le contrôle ci-dessous le dit */ }
      const end = await page.evaluate(`(() => { const s = ${snap}; return { menuClosed: ${menuClosed}, complete: s.complete, loading: s.loading, desc: s.desc }; })()`);
      check(`${label} pendant l'attente : arrive sur « ${lands} », menu fermé`, end.menuClosed && end.complete[lands] && !end.loading, end.desc);
      fake.setDelay(0);
      if (lands === "bilan") await backToMain(page);
      // Jamais bloqué : le menu se rouvre et une entrée marche encore.
      await openMenu(page);
      await page.evaluate(click("nav-history"));
      await page.waitFor(isComplete("history"), { timeout: 15000, label: "l'Historique après coup (menu pas bloqué)" });
      await page.waitFor(menuClosed, { label: "le menu fermé après coup" });
      log(`${label} : le menu se rouvre et marche ensuite`);
      await backToMain(page);
    }

    // 5. Lecture en échec, hors-ligne, entrée qui ne change pas d'écran.
    fake.setMode("down");
    await openMenu(page);
    await page.evaluate(click("nav-history"));
    await pause(500);
    await page.waitFor(`!${snap}.loading`, { timeout: 60000, label: "la fin de « Chargement… » (la lecture en échec réessaie ~7 s)" }).catch(() => {});
    const failed = await page.evaluate(`({ closed: ${menuClosed}, loading: ${snap}.loading, shown: ${snap}.shown, desc: ${snap}.desc })`);
    check("lecture en échec : menu fermé, aucun « Chargement… » qui reste", failed.closed && !failed.loading && failed.shown.length === 1, `état : ${failed.desc}`);
    fake.setMode("online");
    await backToMain(page);

    await page.setOffline(true);
    for (const e of [ENTRIES[0], ENTRIES[1], ENTRIES[2]]) {
      const { problems } = await measureMenu(page, { from: "main", to: e.to }, click(e.entry));
      log(`hors-ligne | Aujourd'hui -> ${e.label} : ${problems.length ? `ÉCHEC (${problems.length})` : "menu et écran en un coup"}`);
      for (const p of problems) log(`    ${p}`);
      fail(`Aujourd'hui -> ${e.label} (hors-ligne)`, problems);
      await backToMain(page);
    }
    await page.setOffline(false);

    await openMenu(page);
    await page.evaluate(click("export-json"));
    await page.waitFor(menuClosed, { timeout: 5000, label: "le menu fermé par « Sauvegarder mes tâches »" })
      .then(() => log("« Sauvegarder mes tâches » : menu fermé, écran inchangé"))
      .catch(() => check("« Sauvegarder mes tâches » : menu fermé", false, "le menu est resté ouvert"));
  } finally {
    fake.setDelay(0);
    fake.setMode("online");
    await page.setOffline(false).catch(() => {});
    await restorePush();
    await page.resize(startWidth);
  }

  if (failures.length) throw new Error(`${failures.length} problème(s) :\n    ${failures.join("\n    ")}`);
}
