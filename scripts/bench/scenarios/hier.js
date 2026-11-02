// Scénario de la carte « Hier » : aucune ligne de routine pour hier et aucune
// tâche à reprendre. La carte s'ouvre quand même ; « Non » puis « Annuler »
// puis « Oui » écrit true pour la date d'hier (et rien avant la sortie de
// l'écran) ; une réponse « Non » écrit false et n'est plus jamais reposée.
import assert from "node:assert/strict";
import { localDateString } from "../../../localDate.js";
import { previousDateString } from "../../../repriseLogic.js";
import { expectedHabits } from "../../../habits.js";

export const name = "carte « Hier » (rien coché hier, aucune tâche à reprendre)";

const EMAIL = "hier@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur

const visible = (id) => `!document.getElementById(${JSON.stringify(id)}).hidden`;
const habit = (key, rest = "") => `#reprise [data-habit="${key}"]${rest}`;

// Page vide de la même origine : on y efface session, file et cache de l'app,
// pour que ce scénario ne dépende pas des autres (et ne les gêne pas).
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

// Accueil -> « Commencer » -> (routine du matin passée) -> écran suivant.
async function startDay(page) {
  await page.waitFor(`${visible("welcome")} && !document.getElementById("welcome-continue").disabled`, { label: "l'accueil (bouton Commencer actif)" });
  await page.tapSelector("#welcome-continue");
  await page.waitFor(`(() => {
    if (${visible("routine")}) document.getElementById("routine-skip").click();
    return ${visible("reprise")} || ${visible("app")};
  })()`, { label: "l'écran « À reprendre » ou l'écran principal" });
}

async function leaveReprise(page) {
  await page.tapSelector("#reprise [data-exit]");
  await page.waitFor(visible("app"), { label: "l'écran principal après « À reprendre »" });
}

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  await resetBrowser(page, appOrigin);
  try {
    const user = fake.seedUser({ email: EMAIL, password: PASSWORD });
    const yesterday = previousDateString(localDateString());
    const expected = expectedHabits(yesterday);
    const gym = expected.find((h) => h.key === "gym");
    const routine = () => fake.db.daily_routines.find((r) => r.user_id === user.id && r.local_date === yesterday);
    assert.equal(routine(), undefined, "il ne doit exister aucune ligne de routine pour hier");
    log(`hier = ${yesterday} ; attendu : ${expected.map((h) => h.key).join(", ")}`);

    await page.goto(`${appOrigin}/`);
    await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
    await page.tapSelector("#auth-email");
    await page.typeText(EMAIL);
    await page.tapSelector("#auth-password");
    await page.typeText(PASSWORD);
    await page.tapSelector("#auth-signin");

    // 1. Carte visible sans tâche à reprendre, ligne d'hier absente.
    await startDay(page);
    await page.waitFor(`${visible("reprise")} && !!document.querySelector("#reprise .hier-card")`, { label: "la carte « Hier »" });
    const shown = await page.evaluate(`({
      tasks: document.querySelectorAll("#reprise .reprise-card[data-id]").length,
      text: document.querySelector("#reprise .hier-card").textContent,
    })`);
    assert.equal(shown.tasks, 0, "aucune tâche ne devait être à reprendre");
    assert.ok(shown.text.includes("Hier, 10 000 pas ?"), "question des pas absente");
    if (gym) assert.ok(shown.text.includes(gym.session), `séance « ${gym.session} » absente`);
    else assert.ok(!shown.text.includes("salle"), "la salle ne doit pas être demandée un jour non officiel");
    log("carte « Hier » affichée sans aucune tâche à reprendre");

    // 2. « Non », « Annuler », puis « Oui » : rien n'est écrit avant la sortie.
    await page.tapSelector(habit("steps", ' [data-answer="no"]'));
    await page.waitFor(`!!document.querySelector('${habit("steps", ".hier-done")}')`, { label: "la confirmation du « Non »" });
    await page.tapSelector(habit("steps", " [data-undo]"));
    await page.waitFor(`!!document.querySelector('${habit("steps", ".hier-item")}')`, { label: "la question revenue après « Annuler »" });
    await page.tapSelector(habit("steps", ' [data-answer="yes"]'));
    if (gym) await page.tapSelector(habit("gym", ' [data-answer="no"]'));
    await page.waitFor(`!!document.querySelector('${habit("steps", ".hier-done")}')`, { label: "la confirmation du « Oui »" });
    assert.equal(routine(), undefined, "rien ne doit être écrit avant de quitter l'écran");
    await leaveReprise(page);
    assert.equal(routine()?.checks.steps, true, "« Oui » n'a pas écrit steps=true pour hier");
    if (gym) assert.equal(routine().checks.gym, false, "« Non » n'a pas écrit gym=false pour hier");
    log(`« Oui, fait » écrit pour ${yesterday} : ${JSON.stringify(routine().checks)}`);

    // 3. « Non » sur les pas (clé retirée côté serveur) : écrit false.
    delete routine().checks.steps;
    await page.goto(`${appOrigin}/`);
    await startDay(page);
    await page.waitFor(`!!document.querySelector('${habit("steps", ".hier-item")}')`, { label: "la question des pas reposée" });
    if (gym) assert.equal(await page.evaluate(`!!document.querySelector('${habit("gym")}')`), false, "la salle, déjà répondue « Non », est reposée");
    await page.tapSelector(habit("steps", ' [data-answer="no"]'));
    await leaveReprise(page);
    assert.equal(routine().checks.steps, false, "« Non » n'a pas écrit steps=false pour hier");
    log("« Non » écrit false pour hier");

    // 4. Nouvelle ouverture : tout est répondu, l'écran « À reprendre » ne s'ouvre plus.
    await page.goto(`${appOrigin}/`);
    await startDay(page);
    const after = await page.evaluate(`({ app: ${visible("app")}, reprise: ${visible("reprise")} })`);
    assert.deepEqual(after, { app: true, reprise: false }, "la carte « Hier » est reposée après « Non »");
    log("« Non » n'est plus reposé : arrivée directe sur l'écran principal");
  } finally {
    await resetBrowser(page, appOrigin);
  }
}
