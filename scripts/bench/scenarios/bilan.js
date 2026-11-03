// Scénario « Bilan de la semaine » (Menu -> Bilan), en lecture seule :
//   - en ligne : titre « N sur M », tuiles, « dont N Autres », « Sans date »,
//     barre à 4 segments, cartes Salle et 10 000 pas, rien d'écrit en base ;
//   - serveur coupé, cache complet : mêmes chiffres + « Hors-ligne : d'après
//     cet appareil » sous les habitudes ;
//   - serveur coupé, cache des routines vide : tâches affichées, habitudes
//     « Indisponible hors-ligne » (sauf un lundi : aucun jour passé à exiger).
import assert from "node:assert/strict";
import { localDateString } from "../../../localDate.js";
import { weekStart, weekDates, addDays, weekRangeLabel, notDoneLabel, isClosingTime, endMessage } from "../../../bilanLogic.js";

export const name = "« Bilan de la semaine » (en ligne, puis serveur coupé)";

const EMAIL = "bilan@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur

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

const morningOf = (dateString) => new Date(`${dateString}T10:00:00`).toISOString();

// Ce que l'écran affiche, lu dans le DOM.
const READ_SCREEN = `(() => {
  const q = (s) => document.querySelector("#bilan " + s);
  const tile = (key) => q('.bilan-tile[data-seg="' + key + '"]');
  const habit = (key) => q('.bilan-habit[data-habit="' + key + '"]');
  const tileData = (key) => ({
    count: tile(key).querySelector(".bilan-tile-count").textContent.trim(),
    label: tile(key).querySelector(".bilan-tile-label").textContent.trim(),
    detail: tile(key).querySelector(".bilan-tile-detail")?.textContent.trim() ?? null,
  });
  const habitData = (key) => ({
    count: habit(key).querySelector(".bilan-habit-count")?.textContent.trim() ?? null,
    off: habit(key).querySelector(".bilan-habit-off")?.textContent.trim() ?? null,
    states: [...habit(key).querySelectorAll(".bilan-day")].map((d) => d.dataset.state),
    officialDots: habit(key).querySelectorAll('.bilan-day[data-official="true"]').length,
  });
  return {
    date: q(".bilan-date").textContent.trim(),
    title: q(".bilan-hero-title").textContent.trim(),
    segments: [...document.querySelectorAll("#bilan .bilan-seg")].map((r) => r.dataset.seg),
    barLabel: q(".bilan-bar svg").getAttribute("aria-label"),
    onTime: tileData("onTime"), late: tileData("late"), notDone: tileData("notDone"),
    undated: q(".bilan-undated")?.textContent.replace(/\\s+/g, " ").trim() ?? null,
    habitOrder: [...document.querySelectorAll("#bilan .bilan-habit")].map((h) => h.dataset.habit),
    gym: habitData("gym"), steps: habitData("steps"),
    note: q(".bilan-note")?.textContent.trim() ?? null,
    end: q(".bilan-end").textContent.trim(),
  };
})()`;

const HABITS_SETTLED = `!document.querySelector('#bilan .bilan-habit[aria-busy="true"]')`;

async function openBilan(page) {
  await page.tapSelector("#menu-toggle");
  await page.waitFor(visible("menu-panel"), { label: "le menu" });
  await page.tapSelector("#nav-bilan");
  await page.waitFor(`${visible("bilan")} && !!document.querySelector("#bilan .bilan-hero-title")`, { label: "l'écran du bilan" });
}

async function closeBilan(page) {
  await page.tapSelector("#bilan [data-close]");
  await page.waitFor(visible("app"), { label: "l'écran principal après « Fermer »" });
}

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  await resetBrowser(page, appOrigin);
  try {
    const user = fake.seedUser({ email: EMAIL, password: PASSWORD });
    const today = localDateString();
    const monday = weekStart(today);
    const lastWeek = addDays(monday, -5);
    const justNow = new Date(Date.now() - 60_000).toISOString();
    const seed = (fields) => fake.db.tasks.push({
      id: crypto.randomUUID(), user_id: user.id, urgent: null, done: false, completed_at: null,
      reminder_time: null, last_triaged_on: null, important_since: null, updated_at: new Date().toISOString(), ...fields,
    });
    // Créées « aujourd'hui à 10:00 », sauf le dimanche soir où elles
    // compteraient pour la semaine suivante : alors lundi 10:00.
    const created = morningOf(today === addDays(monday, 6) ? monday : today);
    seed({ text: "Important à temps", important: true, important_since: today, done: true, completed_at: justNow, created_at: created });
    seed({ text: "Important en retard", important: true, important_since: lastWeek, done: true, completed_at: justNow, created_at: morningOf(lastWeek) });
    seed({ text: "Autre faite", important: false, done: true, completed_at: justNow, created_at: created });
    seed({ text: "Important sans date", important: true, done: true, completed_at: justNow, created_at: morningOf(lastWeek) });
    seed({ text: "Important pas faite", important: true, important_since: today, created_at: created });
    seed({ text: "Autre pas faite", important: false, created_at: created });
    seed({ text: "Pas faite la semaine passée", important: false, created_at: morningOf(lastWeek) }); // hors bilan
    fake.db.daily_routines.push({ user_id: user.id, local_date: monday, checks: { gym: true, steps: true } });
    const snapshot = () => JSON.stringify([fake.db.tasks, fake.db.daily_routines]);
    log(`aujourd'hui ${today}, semaine du ${monday}`);

    await page.goto(`${appOrigin}/`);
    await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
    await page.tapSelector("#auth-email");
    await page.typeText(EMAIL);
    await page.tapSelector("#auth-password");
    await page.typeText(PASSWORD);
    await page.tapSelector("#auth-signin");
    await page.waitFor(`${visible("welcome")} && !document.getElementById("welcome-continue").disabled`, { label: "l'accueil" });
    await page.tapSelector("#welcome-continue");
    await page.waitFor(`(() => {
      if (${visible("routine")}) document.getElementById("routine-skip").click();
      if (${visible("reprise")}) document.querySelector("#reprise [data-exit]")?.click();
      return ${visible("app")};
    })()`, { label: "l'écran principal" });

    // 1. En ligne.
    const before = snapshot();
    await openBilan(page);
    await page.waitFor(HABITS_SETTLED, { label: "les cartes d'habitudes" });
    const online = await page.evaluate(READ_SCREEN);
    const closing = isClosingTime(new Date());
    assert.equal(online.date, weekRangeLabel(today));
    assert.equal(online.title, "4 sur 6 tâches terminées");
    assert.deepEqual(online.onTime, { count: "2", label: "Faites à temps", detail: "dont 1 Autres" });
    assert.deepEqual(online.late, { count: "1", label: "Faites en retard", detail: null });
    assert.deepEqual(online.notDone, { count: "2", label: notDoneLabel(closing), detail: "dont 1 Autres" });
    assert.match(online.undated, /^1 sans date/);
    assert.deepEqual(online.segments, ["onTime", "late", "undated", "notDone"]);
    assert.match(online.barLabel, /^2 faites à temps, 1 faites en retard, 1 sans date, 2 pas/);
    assert.deepEqual(online.habitOrder, ["gym", "steps"]);
    assert.equal(online.gym.count, "1 sur 3");
    assert.equal(online.steps.count, "1 sur 7");
    assert.equal(online.gym.officialDots, 3, "salle : un point sous lundi, mercredi et vendredi");
    assert.equal(online.steps.officialDots, 0, "10 000 pas : tous les jours sont officiels, aucun point");
    assert.equal(online.steps.states[0], "done");
    // Jours après aujourd'hui = à venir ; aujourd'hui sans coche = en cours (sauf lundi, coché).
    const todayIndex = weekDates(today).indexOf(today);
    assert.equal(online.steps.states.filter((st) => st === "future").length, 6 - todayIndex);
    if (todayIndex > 0) assert.equal(online.steps.states[todayIndex], "today");
    assert.equal(online.note, null, "pas de mention « hors-ligne » quand le serveur a répondu");
    assert.equal(online.end, endMessage({ total: 6, done: 4, closing }));
    assert.equal(snapshot(), before, "le bilan ne doit rien écrire en base");
    log(`en ligne : « ${online.title} », salle ${online.gym.count}, pas ${online.steps.count}, barre ${online.segments.join("/")}`);
    await closeBilan(page);

    // 2. Serveur coupé, cache complet (rempli à l'ouverture précédente).
    fake.setMode("down");
    await openBilan(page);
    await page.waitFor(HABITS_SETTLED, { label: "les cartes d'habitudes (cache)" });
    const cached = await page.evaluate(READ_SCREEN);
    assert.equal(cached.title, online.title);
    assert.equal(cached.gym.count, "1 sur 3");
    assert.equal(cached.note, "Hors-ligne : d'après cet appareil");
    log("serveur coupé, cache complet : mêmes chiffres, « Hors-ligne : d'après cet appareil »");
    await closeBilan(page);

    // 3. Serveur coupé, cache des routines vidé.
    await page.evaluate(`(async () => {
      await new Promise((ok, ko) => {
        const req = indexedDB.open("mon-app-taches");
        req.onerror = ko;
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("routines_cache", "readwrite");
          tx.objectStore("routines_cache").clear();
          tx.oncomplete = () => { db.close(); ok(); };
          tx.onerror = ko;
        };
      });
      return true;
    })()`);
    await openBilan(page);
    await page.waitFor(HABITS_SETTLED, { label: "les cartes d'habitudes (sans cache)" });
    const empty = await page.evaluate(READ_SCREEN);
    assert.equal(empty.title, online.title, "les tâches doivent rester affichées hors-ligne");
    if (today > monday) {
      assert.equal(empty.gym.off, "Indisponible hors-ligne");
      assert.equal(empty.steps.off, "Indisponible hors-ligne");
      assert.equal(empty.note, null);
      log("serveur coupé, cache vide : tâches affichées, habitudes « Indisponible hors-ligne »");
    } else {
      assert.equal(empty.note, "Hors-ligne : d'après cet appareil");
      log("lundi : aucun jour passé à exiger, habitudes affichées « d'après cet appareil »");
    }
    await closeBilan(page);
    assert.equal(snapshot(), before, "le bilan ne doit rien écrire en base");
  } finally {
    fake.setMode("online");
    await resetBrowser(page, appOrigin);
  }
}
