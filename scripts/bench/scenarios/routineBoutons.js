// Scénario des boutons « Validé ? » de la carte « Routine du matin ».
//  1. Les vraies habitudes (salle, pas), 4 cas : aucune case, salle seule, pas
//     seuls, les deux ; un mercredi (« Salle (Jambes) »), un jeudi (« Salle
//     (facultative) », le libellé le plus long) et un dimanche (« Repos »).
//  2. 1 à 4 habitudes au total, avec des boutons sur certaines seulement : les
//     habitudes ne sont pas configurables, donc des lignes sont INJECTÉES dans la
//     page (banc seulement), avec le même balisage que routineBlock.js.
// Chaque cas est mesuré et vérifié à 320, 375 et 390 px. L'horloge de la PAGE est
// reculée jusqu'au jour voulu (jamais celle de la machine, jamais le vrai serveur).
//
// Avec BENCH_CAPTURE_DIR, les captures et un fichier de mesures sont écrits dans
// ce dossier, préfixés par BENCH_CAPTURE_LABEL (« avant », « apres »…). Les
// captures sont prises AVANT les vérifications, et les échecs sont tous
// rassemblés à la fin : une série « avant » est donc complète même si le CSS
// n'est pas encore corrigé.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { layoutProblems } from "../routineLayout.js";

export const name = "boutons « Validé ? » de la routine du matin (alignement, écarts, 1 à 4 habitudes)";

const EMAIL = "routine@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur
const WIDTHS = [320, 375, 390];
const DAYS = [
  { id: "mercredi", weekday: 3, cases: ["aucune", "salle", "deux", "pas"] },
  { id: "jeudi", weekday: 4, cases: ["aucune", "salle", "deux", "pas"] },
  { id: "dimanche", weekday: 0, cases: ["aucune", "pas"] }, // « Repos » : pas de case pour la salle
];
const TICKED = { aucune: [], salle: ["gym"], pas: ["steps"], deux: ["gym", "steps"] };

// B = coché, bouton affiché ; u = non coché ; v = validé (case verrouillée).
const EXTRA_PATTERNS = [
  ["B"],
  ["B", "u"], ["u", "B"], ["B", "B"],
  ["B", "v", "B"], ["u", "B", "u"],
  ["u", "B", "B", "v"], ["B", "B", "B", "B"],
];
const EXTRA_LABELS = ["Courte", "Une habitude au libellé nettement plus long", "Moyenne habitude", "10 000 pas"];

// Horloge de la page reculée de `ms` (le serveur factice garde la vraie heure).
const clockScript = (ms) => `(() => {
  const RealDate = Date, offset = ${ms};
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args) => (args.length ? new target(...args) : new target(target.now() + offset)),
    apply: (target) => new target(target.now() + offset).toString(),
    get: (target, prop) => (prop === "now" ? () => target.now() + offset : Reflect.get(target, prop)),
  });
})()`;
const msBackTo = (weekday) => -((new Date().getDay() - weekday + 7) % 7) * 86400000;

const MEASURE = `(() => {
  const host = document.getElementById("routine-block");
  const block = host.querySelector(".routine-block");
  const row = host.querySelector(".routine-row");
  block.scrollIntoView({ block: "center" });
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const items = [...row.children].map((child) => {
    const isItem = child.classList.contains("routine-item");
    const label = isItem ? child.querySelector(".routine-check") : child;
    const button = isItem ? child.querySelector(".routine-validate") : null;
    const input = isItem ? child.querySelector("input") : null;
    return { label: rect(label), button: button ? rect(button) : null, box: input ? rect(input) : null };
  });
  const b = rect(block);
  return {
    rowDisplay: getComputedStyle(row).display,
    block: b,
    row: rect(row),
    items,
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    clip: { x: 0, y: b.top + window.scrollY - 8, width: window.innerWidth, height: b.height + 16 },
  };
})()`;

const round = (value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);
const rounded = (node) => {
  if (Array.isArray(node)) return node.map(rounded);
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rounded(v)]));
  return round(node);
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

// Accueil -> écran principal, en passant les écrans éventuels (routine, « À reprendre »).
async function toMain(page) {
  await page.waitFor(`(() => {
    const visible = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
    if (visible("welcome")) { const b = document.getElementById("welcome-continue"); if (!b.disabled) b.click(); }
    if (visible("routine")) document.getElementById("routine-skip").click();
    if (visible("reprise")) document.querySelector("#reprise [data-exit]")?.click();
    return visible("app") && !!document.querySelector("#routine-block .routine-row");
  })()`, { timeout: 20000, label: "l'écran principal avec le bloc de routine" });
}

const settle = (page) => page.evaluate("new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))");

// Coche / décoche (au doigt) pour obtenir exactement `wanted` ; chaque case
// cochée affiche son bouton « Validé ? ». Renvoie le nombre de boutons attendus
// (le dimanche, la salle n'a pas de case : « Repos »).
async function setTicked(page, wanted) {
  let expected = 0;
  for (const key of ["gym", "steps"]) {
    const state = await page.evaluate(`(() => { const i = document.querySelector('#routine-block input[data-key="${key}"]'); return i ? i.checked : null; })()`);
    if (state === null) continue;
    if (wanted.includes(key)) expected++;
    if (state !== wanted.includes(key)) await page.tapSelector(`#routine-block input[data-key="${key}"]`);
  }
  await page.waitFor(`document.querySelectorAll("#routine-block .routine-validate").length === ${expected}`, { label: `${expected} bouton(s) « Validé ? »` });
  await settle(page);
  return expected;
}

function extraMarkup(pattern) {
  return pattern.map((kind, i) => {
    const label = EXTRA_LABELS[i % EXTRA_LABELS.length];
    const checked = kind === "B" || kind === "v";
    const locked = kind === "v";
    return `<div class="routine-item ${locked ? "validated" : ""}">
      <label class="routine-check"><input type="checkbox" data-key="extra${i}" ${checked ? "checked" : ""} ${locked ? 'disabled aria-disabled="true"' : ""}><span>${label}</span></label>
      ${kind === "B" ? `<button type="button" class="routine-validate" data-key="extra${i}">Validé ?</button>` : ""}
    </div>`;
  }).join("");
}

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  const dir = process.env.BENCH_CAPTURE_DIR || null;
  const label = process.env.BENCH_CAPTURE_LABEL || "mesure";
  if (dir) await mkdir(dir, { recursive: true });

  const measures = {};
  const failures = [];
  const touch = [];

  async function observe(group, widthPx, caseId, { expectButtons }) {
    const m = await page.evaluate(MEASURE);
    const key = `${group}/${widthPx}/${caseId}`;
    measures[key] = rounded({ rowDisplay: m.rowDisplay, block: m.block, row: m.row, items: m.items });
    if (dir) await page.screenshot(join(dir, `${label}-${group}-${widthPx}-${caseId}.png`), m.clip);

    const fail = (text) => failures.push(`${key} : ${text}`);
    const buttons = m.items.filter((item) => item.button).length;
    if (buttons !== expectButtons) fail(`${buttons} bouton(s) affiché(s), ${expectButtons} attendu(s)`);
    if (m.pageOverflow) fail("la page déborde en largeur");
    if (m.block.right > widthPx + 0.5 || m.block.left < -0.5) fail("le bloc dépasse de l'écran");
    if (buttons === 0) {
      // Rien ne doit changer sans bouton : la ligne reste celle d'origine (flex).
      if (m.rowDisplay !== "flex") fail(`sans bouton, la ligne devrait rester en flex (elle est en ${m.rowDisplay})`);
    } else {
      for (const problem of layoutProblems(m.items, { blockRight: m.block.right })) fail(problem);
    }
    return m;
  }

  // --- Connexion (sous l'horloge du premier jour) -------------------------------
  await resetBrowser(page, appOrigin);
  fake.seedUser({ email: EMAIL, password: PASSWORD });
  let removeClock = await page.addInitScript(clockScript(msBackTo(DAYS[0].weekday)));
  try {
    await page.goto(`${appOrigin}/`);
    await page.waitFor(`!document.getElementById("auth").hidden`, { label: "l'écran de connexion" });
    await page.tapSelector("#auth-email");
    await page.typeText(EMAIL);
    await page.tapSelector("#auth-password");
    await page.typeText(PASSWORD);
    await page.tapSelector("#auth-signin");
    await toMain(page);

    // --- 1. Les vraies habitudes, trois jours ---------------------------------
    for (const [index, day] of DAYS.entries()) {
      if (index > 0) {
        await removeClock();
        removeClock = await page.addInitScript(clockScript(msBackTo(day.weekday)));
        await page.goto(`${appOrigin}/`);
        await toMain(page);
      }
      const text = await page.evaluate(`document.querySelector("#routine-block .routine-row").textContent.replace(/\\s+/g, " ").trim()`);
      log(`${day.id} : « ${text} »`);
      for (const widthPx of WIDTHS) {
        await page.resize(widthPx);
        await settle(page);
        for (const caseId of day.cases) {
          const expectButtons = await setTicked(page, TICKED[caseId]);
          const m = await observe(day.id, widthPx, caseId, { expectButtons });
          if (caseId === "deux" && day.id === "mercredi") {
            const sizes = m.items.map((item) => `case ${item.box?.width.toFixed(0)}×${item.box?.height.toFixed(0)}, libellé ${item.label.width.toFixed(0)}×${item.label.height.toFixed(0)}, bouton ${item.button?.width.toFixed(0)}×${item.button?.height.toFixed(0)}`);
            touch.push(`${widthPx} px : ${sizes.join(" | ")}`);
          }
        }
        await setTicked(page, []);
      }
    }

    // --- 2. 1 à 4 habitudes (lignes injectées) --------------------------------
    for (const widthPx of WIDTHS) {
      await page.resize(widthPx);
      for (const pattern of EXTRA_PATTERNS) {
        await page.evaluate(`document.querySelector("#routine-block .routine-row").innerHTML = ${JSON.stringify(extraMarkup(pattern))}`);
        await settle(page);
        await observe(`${pattern.length}habitudes`, widthPx, pattern.join(""), { expectButtons: pattern.filter((kind) => kind === "B").length });
      }
    }
  } finally {
    await removeClock().catch(() => {});
    await page.resize(390);
    await resetBrowser(page, appOrigin); // session, file et cache effacés : les scénarios suivants repartent à neuf
  }

  if (dir) await writeFile(join(dir, `${label}-mesures.json`), JSON.stringify(measures, null, 1));
  for (const line of touch) log(`zones tactiles, mercredi, les deux cochées, ${line}`);
  log(`${Object.keys(measures).length} états mesurés${dir ? `, captures dans ${dir}` : ""}`);
  assert.equal(failures.length, 0, `${failures.length} problème(s) de mise en page :\n    ${failures.join("\n    ")}`);
}
