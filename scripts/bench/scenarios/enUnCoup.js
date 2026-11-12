// Scénario « En un coup » (v44) : chaque changement d'écran passe de l'écran
// de départ COMPLET à l'écran d'arrivée COMPLET, sans image intermédiaire
// (titre seul, page vide, Aujourd'hui sans sa routine, Bilan « Chargement… »),
// et sans saut de page ensuite. Relevé image par image (frames.js).
//   1. Aujourd'hui <-> Historique, Réglages, Bilan, Ma routine (menu, puis
//      « Fermer »), réseau rapide puis lent (1 s par requête). Lent : un état
//      « Chargement… » stable, une seule fois, vers 300 ms ; rapide : aucun.
//   2. Rendus qui ne changent PAS d'écran (réseau lent) : « Validé ? » d'une
//      tâche, synchronisation (focus), retour au premier plan sur Aujourd'hui
//      et sur le Bilan. Jamais de « Chargement… » ni d'état incomplet.
//   3. Changement de compte : après la déconnexion de A, aucune tâche de A
//      n'est visible, même un instant (relevé à chaque modification du DOM),
//      ni présente dans la page une fois B sur « Aujourd'hui ».
// Les temps mesurés (geste -> écran complet) sont écrits dans le journal.
//
// Avec BENCH_CAPTURE_DIR, écrit chargement-390.png, bilan-complet-390.png et
// aujourdhui-routine-390.png (390 × 844) dans ce dossier.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { snapshotInPage, startRecording, settledOn, STOP_RECORDING, quietFor, checkTransition, checkStaysOn } from "../frames.js";

export const name = "« En un coup » : chaque écran apparaît complet, sans état intermédiaire";

const EMAIL_A = "en-un-coup-a@example.test";
const EMAIL_B = "en-un-coup-b@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur
const SECRET = "Tâche privée du compte A";
const SLOW_MS = 1000;
const QUIET_MS = 1200;

const visible = (id) => `!document.getElementById(${JSON.stringify(id)}).hidden`;
const isComplete = (screen) => `(${snapshotInPage.toString()})().complete[${JSON.stringify(screen)}]`;
const isLoading = `(${snapshotInPage.toString()})().loading`;

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

async function signIn(page, email) {
  await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
  await page.evaluate(`document.getElementById("auth-email").value = ""; document.getElementById("auth-password").value = ""; true`);
  await page.tapSelector("#auth-email");
  await page.typeText(email);
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

const click = (id) => `document.getElementById(${JSON.stringify(id)}).click()`;
const CLOSE = `[...document.querySelectorAll("[data-close]")].find((b) => b.getClientRects().length > 0).click()`;

const TRANSITIONS = [
  { label: "Aujourd'hui -> Historique", from: "main", to: "history", menu: true, action: click("nav-history") },
  { label: "Historique -> Aujourd'hui (Fermer)", from: "history", to: "main", action: CLOSE },
  { label: "Aujourd'hui -> Réglages", from: "main", to: "settings", menu: true, action: click("nav-settings") },
  { label: "Réglages -> Aujourd'hui (Fermer)", from: "settings", to: "main", action: CLOSE },
  { label: "Aujourd'hui -> Bilan", from: "main", to: "bilan", menu: true, action: click("nav-bilan") },
  { label: "Bilan -> Aujourd'hui (Fermer)", from: "bilan", to: "main", action: CLOSE },
  { label: "Aujourd'hui -> Ma routine", from: "main", to: "routine", menu: true, action: click("open-routine") },
  { label: "Ma routine -> Aujourd'hui (Fermer)", from: "routine", to: "main", action: CLOSE },
];

async function openMenu(page) {
  await page.tapSelector("#menu-toggle");
  await page.waitFor(visible("menu-panel"), { label: "le menu" });
}

// Un changement d'écran, relevé image par image. Renvoie { problems, firstTo, firstLoading }.
async function measure(page, t) {
  await page.waitFor(isComplete(t.from), { timeout: 15000, label: `départ « ${t.from} » complet` });
  if (t.menu) await openMenu(page);
  await page.evaluate(startRecording(t.action));
  try {
    await page.waitFor(settledOn(t.to, QUIET_MS), { timeout: 15000, label: `« ${t.to} » complet et immobile` });
  } catch { /* le relevé dit ce qui manque */ }
  return checkTransition(await page.evaluate(STOP_RECORDING), t);
}

// Un rendu sans changement d'écran : relevé pendant `ms` au moins, jusqu'au calme.
async function measureStay(page, on, action, ms = 3000) {
  await page.waitFor(isComplete(on), { timeout: 15000, label: `« ${on} » complet` });
  await page.evaluate(startRecording(action));
  await page.waitFor(`performance.now() - window.__frames.t0 >= ${ms} && ${quietFor(QUIET_MS)}`, { timeout: 15000, label: "le calme après le rendu" });
  return checkStaysOn(await page.evaluate(STOP_RECORDING), on);
}

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  fake.setDelay(0);
  const dir = process.env.BENCH_CAPTURE_DIR || null;
  if (dir) await mkdir(dir, { recursive: true });
  const failures = [];
  const fail = (label, problems) => { for (const p of problems) failures.push(`${label} : ${p}`); };

  await resetBrowser(page, appOrigin);
  const userA = fake.seedUser({ email: EMAIL_A, password: PASSWORD });
  fake.seedUser({ email: EMAIL_B, password: PASSWORD });
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const seed = (fields) => fake.db.tasks.push({
    id: crypto.randomUUID(), user_id: userA.id, urgent: null, important: null, important_since: null, done: false,
    completed_at: null, reminder_time: null, created_at: now, updated_at: now, ...fields,
  });
  seed({ text: SECRET, important: true, important_since: now.slice(0, 10) });
  for (let i = 1; i <= 4; i++) seed({ text: `Autre tâche ${i}`, important: false });
  seed({ text: "Tâche d'hier, terminée", important: false, done: true, completed_at: yesterday });

  const startWidth = await page.evaluate("window.innerWidth");
  // Comme fermer.js : sans service worker, Réglages attendrait navigator.serviceWorker.ready.
  const restorePush = await page.addInitScript("delete window.PushManager;");
  try {
    await page.resize(390, 844);
    await page.goto(`${appOrigin}/`);
    await signIn(page, EMAIL_A);
    await toMain(page);

    // 1. Changements d'écran, réseau rapide puis lent.
    for (const [speed, delay] of [["rapide", 0], ["lent", SLOW_MS]]) {
      fake.setDelay(delay);
      for (const t of TRANSITIONS) {
        const { problems, firstTo, firstLoading } = await measure(page, t);
        const timing = firstTo === null ? "jamais complet" : `${firstTo} ms`;
        const loading = firstLoading === null ? "" : `, « Chargement… » à ${firstLoading} ms`;
        log(`${speed} | ${t.label} : ${timing}${loading} -> ${problems.length ? `ÉCHEC (${problems.length})` : "en un coup"}`);
        for (const p of problems) log(`    ${p}`);
        fail(`${t.label} (réseau ${speed})`, problems);
        if (firstTo === null) throw new Error(`${t.label} (réseau ${speed}) : écran jamais complet, suite impossible`);
      }
    }

    // 2. Rendus sans changement d'écran (réseau lent) : jamais de « Chargement… ».
    fake.setDelay(SLOW_MS);
    const stays = [
      ["« Validé ? » d'une tâche", "main", `(() => {
        const box = document.querySelector(".task-row.task-light .task-done:not([disabled])");
        box.click();
        box.closest(".task-row").querySelector(".validate-btn").click();
      })()`],
      ["synchronisation (focus)", "main", `window.dispatchEvent(new Event("focus"))`],
      ["retour au premier plan (Aujourd'hui)", "main", `document.dispatchEvent(new Event("visibilitychange"))`],
    ];
    for (const [label, on, action] of stays) {
      const problems = await measureStay(page, on, action);
      log(`lent | ${label} : ${problems.length ? `ÉCHEC (${problems.length})` : "aucun « Chargement… », écran intact"}`);
      for (const p of problems) log(`    ${p}`);
      fail(label, problems);
    }
    fake.setDelay(0);
    await openMenu(page);
    await page.evaluate(click("nav-bilan"));
    await page.waitFor(isComplete("bilan"), { timeout: 15000, label: "le Bilan complet" });
    fake.setDelay(SLOW_MS);
    const bilanStay = await measureStay(page, "bilan", `document.dispatchEvent(new Event("visibilitychange"))`, 3500);
    log(`lent | retour au premier plan (Bilan) : ${bilanStay.length ? `ÉCHEC (${bilanStay.length})` : "aucun « Chargement… », écran intact"}`);
    for (const p of bilanStay) log(`    ${p}`);
    fail("retour au premier plan (Bilan)", bilanStay);
    fake.setDelay(0);
    await page.evaluate(CLOSE);
    await page.waitFor(isComplete("main"), { timeout: 15000, label: "« Aujourd'hui » après le Bilan" });

    // Captures à taille d'iPhone (390 × 844).
    if (dir) {
      await page.evaluate("new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))");
      await page.screenshot(join(dir, "aujourdhui-routine-390.png"));
      await openMenu(page);
      await page.evaluate(click("nav-bilan"));
      await page.waitFor(isComplete("bilan"), { timeout: 15000, label: "le Bilan complet" });
      await page.screenshot(join(dir, "bilan-complet-390.png"));
      await page.evaluate(CLOSE);
      await page.waitFor(isComplete("main"), { timeout: 15000, label: "« Aujourd'hui »" });
      fake.setDelay(1500);
      await openMenu(page);
      await page.evaluate(click("nav-history"));
      try {
        await page.waitFor(isLoading, { timeout: 1200, label: "« Chargement… »" });
        await page.screenshot(join(dir, "chargement-390.png"));
      } catch {
        log("aucun état « Chargement… » à capturer");
      }
      await page.waitFor(isComplete("history"), { timeout: 15000, label: "l'Historique" });
      fake.setDelay(0);
      await page.evaluate(CLOSE);
      await page.waitFor(isComplete("main"), { timeout: 15000, label: "« Aujourd'hui »" });
      log(`captures écrites dans ${dir}`);
    }

    // 3. Changement de compte : rien de A, même un instant.
    fake.setDelay(0);
    await openMenu(page);
    await page.tapSelector("#sign-out");
    await page.waitFor(visible("auth"), { timeout: 15000, label: "l'écran de connexion après la déconnexion de A" });
    await page.evaluate(`(() => {
      const leak = window.__leak = [];
      const ids = ["app", "bilan", "routine", "reprise", "welcome", "auth", "screen-loading"];
      const check = (when) => {
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el && !el.hidden && el.textContent.includes(${JSON.stringify(SECRET)})) leak.push(when + " : #" + id);
        }
      };
      check("au départ");
      new MutationObserver(() => check("modification du DOM")).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      const tick = () => { check("image"); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      return true;
    })()`);
    await signIn(page, EMAIL_B);
    await toMain(page);
    const leak = await page.evaluate(`({ seen: window.__leak.slice(0, 5), count: window.__leak.length, inPage: document.body.textContent.includes(${JSON.stringify(SECRET)}) })`);
    const leakProblems = [
      ...(leak.count ? [`tâche de A visible ${leak.count} fois (${leak.seen.join(", ")})`] : []),
      ...(leak.inPage ? ["tâche de A encore présente dans la page (cachée) une fois B sur « Aujourd'hui »"] : []),
    ];
    log(`changement de compte A -> B : ${leakProblems.length ? "ÉCHEC" : "aucune tâche de A, ni affichée ni dans la page"}`);
    for (const p of leakProblems) log(`    ${p}`);
    fail("changement de compte", leakProblems);
  } finally {
    fake.setDelay(0);
    fake.setMode("online");
    await restorePush();
    await page.resize(startWidth);
  }

  if (failures.length) throw new Error(`${failures.length} problème(s) :\n    ${failures.join("\n    ")}`);
}
