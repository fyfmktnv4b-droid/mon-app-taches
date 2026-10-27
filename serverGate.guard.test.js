import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Garde-fou de la porte serveur (authGate.js) : la porte n'est sûre que si
// AUCUN appel vers Supabase ne la contourne. Ce test lit le code de l'app et
// échoue si un nouvel appel apparaît hors de la porte ou de la liste blanche.

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const APP_FILES = readdirSync(new URL("./", import.meta.url))
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && f !== "fakeIndexedDB.js");

// Code sans ses commentaires (un commentaire qui cite un appel n'en est pas un).
// Seuls les commentaires sur leur propre ligne sont retirés : un « // » dans
// une chaîne, comme une adresse https://, reste en place.
const code = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .filter((line) => !line.trim().startsWith("//"));

// Découpe un fichier en fonctions de premier niveau ; le reste est "<module>".
function chunks(file) {
  const out = [];
  let current = { name: "<module>", body: "" };
  out.push(current);
  for (const line of code(file)) {
    const fn = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (fn) {
      current = { name: fn[1], body: "" };
      out.push(current);
    } else if (/^[^\s}/]/.test(line)) {
      current = out[0];
    }
    current.body += `${line}\n`;
  }
  return out;
}

const SENSITIVE = [
  /supabase\.(?!auth\b)\w+/, // from, rpc, storage, channel, functions…
  /\.auth\.\w+\(/,
  /\brefreshSession\(/,
  /\bupdateUser\(/,
  /\bgetSession\(/,
  /\bfetch\(/,
  /supabase\.co\b/,
];

// Appels de données : doivent passer la porte avant le premier appel.
const DATA_CALL = /supabase\.(from|rpc)\(|\.auth\.getUser\(/;
const GATE = /requireServer\(\)|requireUser\(\)/;

// Appels volontairement hors porte, avec la raison.
const WHITELIST = {
  "supabaseClient.js": {
    "<module>": "adresse du projet et création du client",
    signUp: "action volontaire depuis l'écran de connexion",
    signIn: "action volontaire depuis l'écran de connexion",
    signOut: "encadré par la confirmation de déconnexion",
    getSession: "lecture locale de la session (exportée, inutilisée)",
    onAuthStateChange: "abonnement aux événements, sans réseau",
    sessionKeptButUnrenewable: "vérification de session : c'est elle qui ouvre la porte",
    recheckSession: "vérification de session au retour du réseau",
  },
  "sync.js": {
    getCurrentUserId: "getSession() seulement porte ouverte (testé ci-dessous)",
  },
  "service-worker.js": {
    "<module>": "le service worker relaie les requêtes, il n'appelle pas Supabase",
  },
};

test("every Supabase call in the app is behind the server gate or whitelisted", () => {
  const offenders = [];
  for (const file of APP_FILES) {
    for (const { name, body } of chunks(file)) {
      const hits = SENSITIVE.filter((re) => re.test(body));
      if (hits.length === 0) continue;
      if (WHITELIST[file]?.[name]) continue;
      const firstData = body.search(DATA_CALL);
      const gate = body.search(GATE);
      const gated = firstData !== -1 && gate !== -1 && gate < firstData
        && SENSITIVE.every((re) => re === SENSITIVE[0] || re === SENSITIVE[1] || !re.test(body));
      if (!gated) offenders.push(`${file} › ${name}: ${hits.map(String).join(", ")}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every requireUser() helper calls requireServer() before auth.getUser()", () => {
  for (const file of APP_FILES) {
    const helper = chunks(file).find((c) => c.name === "requireUser");
    if (!helper) continue;
    const gate = helper.body.indexOf("requireServer()");
    assert.ok(gate !== -1 && gate < helper.body.indexOf("auth.getUser("), file);
  }
});

test("sync.js only reads the SDK session once the gate is open", () => {
  const { body } = chunks("sync.js").find((c) => c.name === "getCurrentUserId");
  assert.ok(body.indexOf("if (!serverAllowed())") < body.indexOf("getSession("));
});

test("the whitelist names only functions that still exist", () => {
  for (const [file, names] of Object.entries(WHITELIST)) {
    const existing = new Set(chunks(file).map((c) => c.name));
    for (const name of Object.keys(names)) assert.ok(existing.has(name), `${file} › ${name}`);
  }
});

test("the Supabase client is imported only by the guarded data files", () => {
  const importers = APP_FILES.filter((f) => {
    const names = read(f).match(/import \{([^}]*)\} from "\.\/supabaseClient\.js"/)?.[1] ?? "";
    return names.split(",").map((n) => n.trim()).includes("supabase");
  });
  assert.deepEqual(importers.sort(), ["push.js", "routines.js", "settings.js", "sync.js", "tasks.js"]);
});

test("the guard does catch a call that bypasses the gate", () => {
  const body = "export async function sneaky() {\n  return supabase.from(\"tasks\").select();\n}\n";
  assert.ok(SENSITIVE.some((re) => re.test(body)));
  assert.equal(body.search(GATE), -1);
});
