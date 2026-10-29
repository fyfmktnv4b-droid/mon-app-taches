// Scénario de fumée : l'app démarre, on se connecte, l'accueil s'affiche, une
// tâche créée au doigt arrive dans le faux Supabase.
import assert from "node:assert/strict";

export const name = "fumée (démarrage, accueil, création d'une tâche)";

const EMAIL = "banc@example.test";
const PASSWORD = "mot-de-passe-du-banc"; // n'existe que dans le faux serveur
const TASK = "Tâche de fumée du banc";

export async function run({ page, fake, appOrigin, log }) {
  fake.setMode("online");
  fake.seedUser({ email: EMAIL, password: PASSWORD });
  const visible = (id) => `!document.getElementById(${JSON.stringify(id)}).hidden`;

  await page.goto(`${appOrigin}/`);
  await page.waitFor(visible("auth"), { label: "l'écran de connexion" });
  log("écran de connexion affiché");

  await page.tapSelector("#auth-email");
  await page.typeText(EMAIL);
  await page.tapSelector("#auth-password");
  await page.typeText(PASSWORD);
  await page.tapSelector("#auth-signin");

  await page.waitFor(`${visible("welcome")} && !document.getElementById("welcome-continue").disabled`, { label: "l'accueil (bouton Commencer actif)" });
  const welcome = await page.evaluate(`({
    day: document.getElementById("welcome-day").textContent.trim(),
    version: document.getElementById("welcome-version").textContent.trim(),
  })`);
  assert.ok(welcome.day.length > 0, "la date de l'accueil est vide");
  assert.match(welcome.version, /^v\d+$/);
  log(`accueil affiché (${welcome.day}, ${welcome.version})`);

  await page.tapSelector("#welcome-continue");
  // Routine du matin et écran « À reprendre » ne sont proposés que selon les données.
  await page.waitFor(`(() => {
    if (${visible("routine")}) document.getElementById("routine-skip").click();
    return ${visible("app")};
  })()`, { label: "l'écran principal" });
  log("écran principal affiché");

  await page.tapSelector("#capture-input");
  await page.typeText(TASK);
  await page.tapSelector("#capture-submit");

  await page.waitFor(`document.getElementById("main-view").textContent.includes(${JSON.stringify(TASK)})`, { label: "la tâche dans l'écran principal" });
  const stored = fake.db.tasks.filter((t) => t.text === TASK);
  assert.equal(stored.length, 1, "la tâche n'est pas arrivée dans le faux Supabase");
  assert.equal(stored[0].user_id, [...fake.db.user_settings][0].user_id);
  log("tâche créée à l'écran et reçue par le faux Supabase");
}
