// Scénario « Récupérer » d'une tâche d'une semaine passée (écran « À reprendre ») :
//   - mention « Pas faite la semaine dernière » sur les cartes d'une semaine
//     passée, pas sur celle de la semaine en cours ;
//   - Important d'une semaine passée -> « À trier » (important, important_since,
//     rappel effacés, last_triaged_on = aujourd'hui), « Annuler » restaure tout ;
//   - Autres d'une semaine passée -> retour dans « Autres », comme avant ;
//   - Important de la semaine en cours -> retour dans « Important », important_since gardé ;
//   - serveur coupé : « Récupérer » met UNE mutation setFields à 4 champs en
//     file, rejouée telle quelle contre le faux serveur au retour du réseau.
import assert from "node:assert/strict";
import { localDateString } from "../../../localDate.js";
import { weekStart, addDays } from "../../../bilanLogic.js";

export const name = "« Récupérer » d'une tâche d'une semaine passée";

const EMAIL = "recuperer@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur
const NOTE = "Pas faite la semaine dernière";

const visible = (id) => `!document.getElementById(${JSON.stringify(id)}).hidden`;
const card = (id, rest = "") => `#reprise [data-id="${id}"]${rest}`;

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

// Le faux serveur est dans ce processus : on attend qu'une écriture y arrive.
async function until(check, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`délai dépassé : ${label}`);
}

// Instant (ISO) à 10:00 heure de la machine, le jour `dateString`.
const morningOf = (dateString) => new Date(`${dateString}T10:00:00`).toISOString();

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  await resetBrowser(page, appOrigin);
  try {
    const user = fake.seedUser({ email: EMAIL, password: PASSWORD });
    const today = localDateString();
    const monday = weekStart(today);
    const oldDay = addDays(monday, -5); // mercredi de la semaine passée
    const seed = (fields) => {
      const row = {
        id: crypto.randomUUID(), user_id: user.id, urgent: null, done: false, completed_at: null,
        reminder_time: null, last_triaged_on: null, updated_at: new Date().toISOString(), ...fields,
      };
      fake.db.tasks.push(row);
      return row;
    };
    const oldImportant = seed({ text: "Important de la semaine passée", important: true, important_since: oldDay, reminder_time: "08:00:00", created_at: morningOf(oldDay) });
    const oldOther = seed({ text: "Autre de la semaine passée", important: false, important_since: null, created_at: morningOf(oldDay) });
    // Une tâche « de la semaine » pas encore reprise n'existe que si aujourd'hui n'est pas lundi.
    const thisWeek = today > monday
      ? seed({ text: "Important de cette semaine", important: true, important_since: monday, created_at: morningOf(monday) })
      : null;
    const row = (t) => fake.db.tasks.find((r) => r.id === t.id);
    log(`aujourd'hui ${today}, semaine du ${monday} ; semaine passée : ${oldDay}${thisWeek ? "" : " (lundi : pas de tâche de la semaine à reprendre)"}`);

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
      return ${visible("reprise")} && !!document.querySelector('${card(oldImportant.id)}');
    })()`, { label: "l'écran « À reprendre » avec la tâche Important de la semaine passée" });

    // 1. Mentions.
    const note = (t) => page.evaluate(`document.querySelector('${card(t.id, " .reprise-week-note")}')?.textContent ?? null`);
    assert.equal(await note(oldImportant), NOTE);
    assert.equal(await note(oldOther), NOTE);
    if (thisWeek) assert.equal(await note(thisWeek), null, "la mention ne doit pas apparaître pour une tâche de la semaine");
    log("mention « Pas faite la semaine dernière » sur les seules tâches d'une semaine passée");

    // 2. Important de la semaine passée : « À trier », puis « Annuler » restaure tout.
    await page.tapSelector(card(oldImportant.id, ' [data-action="recover"]'));
    await page.waitFor(`document.querySelector('${card(oldImportant.id, " .reprise-done-text")}')?.textContent === "Récupérée : elle va dans « À trier »"`, { label: "la confirmation « À trier »" });
    await until(() => row(oldImportant).last_triaged_on === today, "l'écriture de « Récupérer »");
    assert.deepEqual(
      (({ important, important_since, reminder_time, last_triaged_on }) => ({ important, important_since, reminder_time, last_triaged_on }))(row(oldImportant)),
      { important: null, important_since: null, reminder_time: null, last_triaged_on: today },
    );
    log("Important de la semaine passée : envoyée dans « À trier » (4 champs écrits)");

    await page.tapSelector(card(oldImportant.id, " [data-undo]"));
    await page.waitFor(`!!document.querySelector('${card(oldImportant.id, ' [data-action="recover"]')}')`, { label: "la carte revenue après « Annuler »" });
    await until(() => row(oldImportant).important === true, "l'écriture de « Annuler »");
    assert.deepEqual(
      (({ important, important_since, reminder_time, last_triaged_on }) => ({ important, important_since, reminder_time, last_triaged_on }))(row(oldImportant)),
      { important: true, important_since: oldDay, reminder_time: "08:00:00", last_triaged_on: null },
    );
    log("« Annuler » : important, important_since, rappel et last_triaged_on restaurés");

    // 3. Serveur coupé : « Récupérer » part en file (une seule mutation
    //    setFields à 4 champs), puis est rejouée contre le faux serveur.
    fake.setMode("down");
    await page.tapSelector(card(oldImportant.id, ' [data-action="recover"]'));
    await page.waitFor(`document.querySelector('${card(oldImportant.id, " .reprise-done-text")}')?.textContent === "Récupérée : elle va dans « À trier »"`, { label: "la confirmation « À trier » (serveur coupé)" });
    const readQueue = () => page.evaluate(`(async () => {
      const db = await new Promise((ok, ko) => { const r = indexedDB.open("mon-app-taches"); r.onsuccess = () => ok(r.result); r.onerror = ko; });
      const rows = await new Promise((ok, ko) => { const r = db.transaction("pending_mutations").objectStore("pending_mutations").getAll(); r.onsuccess = () => ok(r.result); r.onerror = ko; });
      db.close();
      return rows.map(({ queueId, ...m }) => m);
    })()`);
    const queueEnd = Date.now() + 5000;
    let queue = await readQueue();
    while (queue.length === 0 && Date.now() < queueEnd) {
      await new Promise((r) => setTimeout(r, 50));
      queue = await readQueue();
    }
    assert.deepEqual(queue, [{
      type: "setFields", id: oldImportant.id,
      fields: { important: null, important_since: null, reminder_time: null, last_triaged_on: today },
    }], "une seule mutation setFields à 4 champs était attendue en file");
    assert.equal(row(oldImportant).important, true, "rien ne doit avoir atteint le serveur coupé");
    log("serveur coupé : une seule mutation setFields à 4 champs en file");

    fake.setMode("online");
    await page.evaluate(`window.dispatchEvent(new Event("online")); true`);
    await until(() => row(oldImportant).important === null, "le rejeu de la file");
    assert.deepEqual(
      (({ important, important_since, reminder_time, last_triaged_on }) => ({ important, important_since, reminder_time, last_triaged_on }))(row(oldImportant)),
      { important: null, important_since: null, reminder_time: null, last_triaged_on: today },
    );
    assert.deepEqual(await readQueue(), [], "la file doit être vide après le rejeu");
    log("rejeu contre le faux serveur : les 4 champs écrits ensemble, file vide");

    // 4. L'Autre et (si elle existe) celle de la semaine, en ligne.
    await page.tapSelector(card(oldOther.id, ' [data-action="recover"]'));
    await page.waitFor(`document.querySelector('${card(oldOther.id, " .reprise-done-text")}')?.textContent === "Récupérée : retourne dans « Autres »"`, { label: "la confirmation « Autres »" });
    if (thisWeek) {
      await page.tapSelector(card(thisWeek.id, ' [data-action="recover"]'));
      await page.waitFor(`document.querySelector('${card(thisWeek.id, " .reprise-done-text")}')?.textContent === "Récupérée : retourne dans « Important »"`, { label: "la confirmation « Important »" });
    }
    await until(() => row(oldOther).last_triaged_on === today && (!thisWeek || row(thisWeek).last_triaged_on === today) && row(oldImportant).important === null, "les écritures");
    assert.equal(row(oldOther).important, false);
    if (thisWeek) assert.deepEqual([row(thisWeek).important, row(thisWeek).important_since], [true, monday]);
    log("Autres de la semaine passée et Important de la semaine : comportement inchangé");

    // 5. Sortie : la tâche renvoyée est dans « À trier » sur l'écran principal.
    await page.tapSelector("#reprise [data-exit]");
    await page.waitFor(visible("app"), { label: "l'écran principal" });
    await page.waitFor(`!!document.querySelector(".unsorted-list") && document.querySelector(".unsorted-list").textContent.includes(${JSON.stringify(oldImportant.text)})`, { label: "la tâche dans « À trier »" });
    log("écran principal : la tâche est dans « À trier »");
  } finally {
    await resetBrowser(page, appOrigin);
  }
}
