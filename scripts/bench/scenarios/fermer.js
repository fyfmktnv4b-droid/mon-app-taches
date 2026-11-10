// Scénario « Fermer » (v43) : chaque écran du menu (Historique, Réglages, aussi
// hors-ligne, Bilan de la semaine, Ma routine ouverte depuis le menu) a
// exactement UN bouton « Fermer », le même partout (bas d'écran pleine
// largeur, style crème), et plus de lien « ‹ Aujourd'hui ». « Fermer » mène
// toujours à « Aujourd'hui », quel que soit l'écran précédent :
//   - depuis chaque écran ;
//   - Réglages -> menu -> Bilan -> Fermer, Historique -> menu -> Bilan -> Fermer ;
//   - Bilan ouvert par une notification pendant les Réglages ;
//   - Ma routine ouverte depuis les Réglages : « Fermer » (sans rien écrire),
//     « Passer pour aujourd'hui » et « Continuer » mènent à « Aujourd'hui » ;
//   - au démarrage du matin, la routine n'a pas de « Fermer ».
// Mesures à 320, 375 et 390 px (et 320 × 568 pour Ma routine).
//
// Avec BENCH_CAPTURE_DIR, écrit fermer-<écran>-<largeur>.png dans ce dossier.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { OPEN_REQUEST_CACHE, OPEN_REQUEST_KEY } from "../../../openRequest.js";

export const name = "« Fermer » sur chaque écran du menu (toujours vers « Aujourd'hui »)";

const EMAIL = "fermer@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur
const WIDTHS = [320, 375, 390];
const MIN_TOUCH = 44;

const visible = (id) => `!document.getElementById(${JSON.stringify(id)}).hidden`;
const frames = "new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))";
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Couleurs attendues : celles des variables de :root, lues dans la page.
const hexToRgb = (hex) => {
  const h = hex.trim().replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

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

const TODAY = `${visible("app")} && document.getElementById("header-title").textContent === "Aujourd'hui"
  && ${visible("capture-form")} && document.getElementById("main-view").dataset.view === "main"
  && document.querySelector("#app > .screen-footer").hidden`;

async function toMain(page) {
  await page.waitFor(`(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    if (shown("welcome")) { const b = document.getElementById("welcome-continue"); if (!b.disabled) b.click(); }
    if (shown("routine")) document.getElementById("routine-skip").click();
    if (shown("reprise")) document.querySelector("#reprise [data-exit]")?.click();
    return shown("app");
  })()`, { timeout: 20000, label: "l'écran principal" });
  await page.waitFor(TODAY, { label: "« Aujourd'hui »" });
}

async function openFromMenu(page, button) {
  await page.waitFor(TODAY, { label: "« Aujourd'hui » avant le menu" });
  await page.tapSelector("#menu-toggle");
  await page.waitFor(visible("menu-panel"), { label: "le menu" });
  await page.tapSelector(button);
}

// Le menu reste accessible sur Historique et Réglages : on le rouvre de là.
async function openFromMenuHere(page, button) {
  await page.tapSelector("#menu-toggle");
  await page.waitFor(visible("menu-panel"), { label: "le menu" });
  await page.tapSelector(button);
}

const SCREENS = {
  historique: { open: "#nav-history", ready: `${visible("app")} && document.getElementById("header-title").textContent === "Historique" && !!document.getElementById("history-list")` },
  reglages: { open: "#nav-settings", ready: `${visible("app")} && !!document.getElementById("settings-form") && !document.getElementById("save-reminder-times").disabled` },
  "reglages-hors-ligne": { open: "#nav-settings", ready: `${visible("app")} && document.getElementById("main-view").textContent.includes("Réglages indisponibles hors-ligne")` },
  bilan: { open: "#nav-bilan", ready: `${visible("bilan")} && !!document.querySelector("#bilan .bilan-hero-title")` },
  routine: { open: "#open-routine", ready: `${visible("routine")} && document.getElementById("routine").classList.contains("from-menu")` },
};

// Le « Fermer » visible de l'écran, ses mesures et son style.
const READ_CLOSE = `(() => {
  const shown = (el) => el.getClientRects().length > 0;
  const closes = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Fermer" && shown(b));
  const old = document.body.innerText.includes("‹") || !!document.querySelector(".back-link, #back-main")
    || [...document.querySelectorAll("button, a")].some((b) => shown(b) && b.textContent.trim().replace(/^‹\\s*/, "") === "Aujourd'hui");
  if (closes.length !== 1) return { count: closes.length, old };
  const button = closes[0];
  button.scrollIntoView({ block: "nearest" });
  const footer = button.closest(".screen-footer");
  const b = button.getBoundingClientRect();
  const f = footer.getBoundingClientRect();
  const cs = getComputedStyle(button);
  const fs = getComputedStyle(footer);
  const root = getComputedStyle(document.documentElement);
  return {
    count: 1, old, inFooter: !!footer, dataClose: button.hasAttribute("data-close"),
    button: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height },
    footer: { left: f.left, right: f.right, top: f.top, bottom: f.bottom, borderTop: fs.borderTopWidth + " " + fs.borderTopStyle + " " + fs.borderTopColor },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    style: {
      background: cs.backgroundColor, color: cs.color, fontWeight: cs.fontWeight, radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor, height: Math.round(b.height),
    },
    vars: { card: root.getPropertyValue("--card"), sageDeep: root.getPropertyValue("--sage-deep"), border: root.getPropertyValue("--border-warm") },
  };
})()`;

async function checkClose(page, label, width, dir, reference) {
  await page.evaluate(frames);
  const m = await page.evaluate(READ_CLOSE);
  if (dir) await page.screenshot(join(dir, `fermer-${label}-${width}${m.viewport && m.viewport.height !== 844 ? `x${m.viewport.height}` : ""}.png`));
  assert.equal(m.count, 1, `${label} ${width} px : exactement un « Fermer » (vu ${m.count})`);
  assert.equal(m.old, false, `${label} ${width} px : plus de lien « ‹ Aujourd'hui »`);
  assert.ok(m.inFooter && m.dataClose, `${label} : le gabarit commun`);
  const { button, footer, viewport } = m;
  assert.ok(button.height >= MIN_TOUCH, `${label} ${width} px : bouton de ${button.height} px`);
  assert.ok(Math.abs(footer.bottom - viewport.height) <= 1, `${label} ${width} px : en bas de l'écran (bas à ${footer.bottom}, écran ${viewport.height})`);
  const columnWidth = Math.min(viewport.width, 560);
  assert.ok(Math.abs(footer.right - footer.left - columnWidth) <= 1, `${label} ${width} px : bas d'écran pleine largeur`);
  assert.ok(Math.abs(button.left - footer.left - 16) <= 1 && Math.abs(footer.right - button.right - 16) <= 1,
    `${label} ${width} px : bouton pleine largeur (marges de 16 px)`);
  assert.equal(m.pageOverflow, false, `${label} ${width} px : la page déborde`);
  assert.equal(footer.borderTop, `1px solid ${hexToRgb(m.vars.border)}`, `${label} : trait de séparation`);
  assert.equal(m.style.background, hexToRgb(m.vars.card), `${label} : fond crème des cartes`);
  assert.equal(m.style.color, hexToRgb(m.vars.sageDeep), `${label} : texte vert foncé`);
  assert.equal(m.style.border, `1px solid ${hexToRgb(m.vars.border)}`, `${label} : bordure des cartes`);
  assert.equal(m.style.fontWeight, "700", `${label} : gras`);
  if (reference) assert.deepEqual(m.style, reference, `${label} : même bouton que sur les autres écrans`);
  return m.style;
}

// Touche « Fermer » sur l'écran affiché et attend « Aujourd'hui ».
async function tapClose(page, label) {
  const selector = await page.evaluate(`(() => {
    const shown = (el) => el.getClientRects().length > 0;
    const button = [...document.querySelectorAll("[data-close]")].find(shown);
    if (!button) return null;
    button.dataset.benchClose = "1";
    return "[data-bench-close]";
  })()`);
  assert.ok(selector, `${label} : « Fermer » introuvable`);
  await page.tapSelector(selector);
  await page.evaluate(`document.querySelectorAll("[data-bench-close]").forEach((el) => delete el.dataset.benchClose); true`);
  await page.waitFor(TODAY, { label: `« Aujourd'hui » après « Fermer » (${label})` });
}

const MARK_URL = `new URL(${JSON.stringify(OPEN_REQUEST_KEY)}, location.origin + "/").href`;
const dropMark = (page) => page.evaluate(`(async () => {
  const cache = await caches.open(${JSON.stringify(OPEN_REQUEST_CACHE)});
  await cache.put(${MARK_URL}, new Response(JSON.stringify({ screen: "bilan", createdAt: Date.now() })));
  return true;
})()`);

const routineWrites = (fake) => fake.entries
  .filter((e) => e.server === "api" && e.method === "POST" && e.target.includes("/rest/v1/rpc/set_routine_check")).length;

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  const dir = process.env.BENCH_CAPTURE_DIR || null;
  if (dir) await mkdir(dir, { recursive: true });

  await resetBrowser(page, appOrigin);
  const user = fake.seedUser({ email: EMAIL, password: PASSWORD });
  const startWidth = await page.evaluate("window.innerWidth");
  // Comme reglagesBilan.js : sans service worker, l'écran Réglages attendrait
  // indéfiniment navigator.serviceWorker.ready.
  const restorePush = await page.addInitScript("delete window.PushManager;");
  const clearRoutine = () => {
    for (let i = fake.db.daily_routines.length - 1; i >= 0; i--) {
      if (fake.db.daily_routines[i].user_id === user.id) fake.db.daily_routines.splice(i, 1);
    }
  };

  try {
    await page.goto(`${appOrigin}/`);
    await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
    await signIn(page);

    // 0. Au démarrage du matin, la routine n'a pas de « Fermer ».
    await page.waitFor(`${visible("welcome")} && !document.getElementById("welcome-continue").disabled`, { label: "l'accueil" });
    await page.tapSelector("#welcome-continue");
    await page.waitFor(visible("routine"), { label: "la routine du démarrage" });
    const startup = await page.evaluate(`({
      footerHidden: document.querySelector("#routine > .screen-footer").hidden,
      fromMenu: document.getElementById("routine").classList.contains("from-menu"),
      closes: [...document.querySelectorAll("#routine button")].filter((b) => b.textContent.trim() === "Fermer" && b.getClientRects().length > 0).length,
    })`);
    assert.deepEqual(startup, { footerHidden: true, fromMenu: false, closes: 0 }, "routine du démarrage inchangée");
    await toMain(page);
    log("routine du démarrage : pas de « Fermer », suite habituelle");

    // 1. Chaque écran du menu : un seul « Fermer », le même partout, vers « Aujourd'hui ».
    let reference = null;
    const widths = [...WIDTHS];
    for (const label of ["bilan", "historique", "reglages", "routine"]) {
      const before = routineWrites(fake);
      await openFromMenu(page, SCREENS[label].open);
      await page.waitFor(SCREENS[label].ready, { label: `l'écran ${label}` });
      for (const width of widths) {
        await page.resize(width);
        reference = await checkClose(page, label, width, dir, reference);
      }
      if (label === "routine") {
        // iPhone SE : tout tient, « Continuer » au-dessus du « Fermer ».
        await page.resize(320, 568);
        await checkClose(page, label, 320, dir, reference);
        const fit = await page.evaluate(`(() => {
          const h2 = document.querySelector("#routine h2").getBoundingClientRect();
          const skip = document.getElementById("routine-skip").getBoundingClientRect();
          const footer = document.querySelector("#routine > .screen-footer").getBoundingClientRect();
          return { top: h2.top, skipBottom: skip.bottom, footerTop: footer.top };
        })()`);
        assert.ok(fit.top >= 0 && fit.skipBottom <= fit.footerTop, `320 × 568 : la routine tient au-dessus du « Fermer » (${JSON.stringify(fit)})`);
        await page.resize(390);
      }
      await tapClose(page, label);
      if (label === "routine") assert.equal(routineWrites(fake), before, "« Fermer » de la routine n'écrit rien");
      log(`${label} : un seul « Fermer » (${WIDTHS.join(", ")} px), bas d'écran, crème, mène à « Aujourd'hui »`);
    }

    // 1 bis. Réglages hors-ligne : même « Fermer ».
    fake.setMode("down");
    try {
      await openFromMenu(page, SCREENS["reglages-hors-ligne"].open);
      await page.waitFor(SCREENS["reglages-hors-ligne"].ready, { label: "Réglages hors-ligne" });
      for (const width of WIDTHS) {
        await page.resize(width);
        await checkClose(page, "reglages-hors-ligne", width, dir, reference);
      }
      await tapClose(page, "Réglages hors-ligne");
    } finally {
      fake.setMode("online");
    }
    await page.resize(390);
    log("Réglages hors-ligne : même « Fermer », mène à « Aujourd'hui »");

    // 2. Réglages -> menu -> Bilan -> Fermer = « Aujourd'hui » (plus Réglages).
    for (const [from, ready] of [["reglages", SCREENS.reglages.ready], ["historique", SCREENS.historique.ready]]) {
      await openFromMenu(page, SCREENS[from].open);
      await page.waitFor(ready, { label: from });
      await openFromMenuHere(page, "#nav-bilan");
      await page.waitFor(SCREENS.bilan.ready, { label: `le Bilan depuis ${from}` });
      await tapClose(page, `Bilan ouvert depuis ${from}`);
      assert.equal(await page.evaluate(`!document.getElementById("settings-form") && !document.getElementById("history-list")`), true);
      log(`${from} -> menu -> Bilan -> Fermer : « Aujourd'hui »`);
    }

    // 3. Bilan ouvert par une notification pendant les Réglages.
    await pause(3300); // après les relevés du démarrage
    await openFromMenu(page, SCREENS.reglages.open);
    await page.waitFor(SCREENS.reglages.ready, { label: "Réglages" });
    await dropMark(page);
    await page.evaluate(`navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open-request" } }))`);
    await page.waitFor(SCREENS.bilan.ready, { label: "le Bilan de la notification" });
    await tapClose(page, "Bilan de la notification");
    log("notification pendant les Réglages -> Bilan -> Fermer : « Aujourd'hui »");

    // 4. Ma routine ouverte depuis les Réglages : Passer et Continuer -> « Aujourd'hui ».
    await openFromMenu(page, SCREENS.reglages.open);
    await page.waitFor(SCREENS.reglages.ready, { label: "Réglages" });
    await openFromMenuHere(page, "#open-routine");
    await page.waitFor(SCREENS.routine.ready, { label: "Ma routine depuis les Réglages" });
    let before = routineWrites(fake);
    await page.tapSelector("#routine-skip");
    await page.waitFor(TODAY, { label: "« Aujourd'hui » après « Passer pour aujourd'hui »" });
    assert.equal(routineWrites(fake) - before, 1, "« Passer » enregistre toujours le passage");
    log("Réglages -> Ma routine -> Passer pour aujourd'hui : « Aujourd'hui » (passage enregistré)");

    await openFromMenu(page, SCREENS.reglages.open);
    await page.waitFor(SCREENS.reglages.ready, { label: "Réglages" });
    await openFromMenuHere(page, "#open-routine");
    await page.waitFor(SCREENS.routine.ready, { label: "Ma routine depuis les Réglages" });
    await page.evaluate(`document.querySelectorAll("#routine .routine-check-input").forEach((box) => { if (!box.checked) box.click(); }); true`);
    await page.waitFor(`!document.getElementById("routine-continue").disabled`, { label: "« Continuer » actif" });
    await page.tapSelector("#routine-continue");
    await page.waitFor(TODAY, { label: "« Aujourd'hui » après « Continuer »" });
    log("Réglages -> Ma routine -> Continuer : « Aujourd'hui »");

    // 5. Après un passage par le menu, la routine du démarrage reste sans « Fermer ».
    clearRoutine();
    await page.goto(`${appOrigin}/`);
    await page.waitFor(`${visible("welcome")} && !document.getElementById("welcome-continue").disabled`, { label: "l'accueil" });
    await page.tapSelector("#welcome-continue");
    await page.waitFor(visible("routine"), { label: "la routine du démarrage" });
    assert.equal(await page.evaluate(`document.querySelector("#routine > .screen-footer").hidden && !document.getElementById("routine").classList.contains("from-menu")`), true,
      "routine du démarrage sans « Fermer »");
    await toMain(page);
    log("rechargement : routine du démarrage toujours sans « Fermer »");

    assert.deepEqual(page.errors.filter((e) => !e.includes("ServiceWorker")), [], "aucune erreur JS");
  } finally {
    fake.setMode("online");
    await restorePush();
    await page.resize(startWidth);
  }
}
