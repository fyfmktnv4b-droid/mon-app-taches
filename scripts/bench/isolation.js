// Isolation du banc, au niveau du NAVIGATEUR (pas dans l'app) : trois couches
// et un contrôle qui les prouve à chaque lancement.
//
//   1. Résolveur : tout nom est « introuvable », sauf *.supabase.co (renvoyé vers
//      cette machine) et la boucle locale. Les règles s'appliquent dans l'ordre.
//   2. Proxy piège : tout le reste (noms, ADRESSES IP littérales, http et https)
//      est envoyé au piège local, qui refuse. Le résolveur seul ne verrait pas
//      une adresse IP écrite en chiffres ; le proxy, si.
//   3. Réécriture de l'app (appCopy.js) : l'adresse Supabase de la copie pointe
//      déjà vers le faux serveur.
import { REFUSED } from "./fakeSupabase.js";

export function isolationFlags({ trapPort, mapSupabase = true }) {
  const rules = [];
  if (mapSupabase) rules.push("MAP *.supabase.co 127.0.0.1");
  rules.push("MAP * ~NOTFOUND", "EXCLUDE 127.0.0.1", "EXCLUDE localhost");
  return [
    `--host-resolver-rules=${rules.join(", ")}`,
    `--proxy-server=http://127.0.0.1:${trapPort}`,
    // Ces hôtes ne passent pas par le piège : la boucle locale, et *.supabase.co
    // (résolu par la règle 1 vers le faux serveur).
    "--proxy-bypass-list=127.0.0.1;localhost;*.supabase.co",
  ];
}

// Adresses visées par la sonde 2 : une IP de la plage réservée à la
// documentation (RFC 5737, jamais attribuée) et un vrai nom en https.
export const EXTERNAL_PROBES = [
  { url: "http://203.0.113.7/__sonde", fragment: "203.0.113.7" },
  { url: "https://example.com/__sonde", fragment: "example.com:443" },
];

// Verdict à partir des observations brutes (pur, donc testable sans Chrome).
export function verdict({ supabase, external, serviceWorkers }) {
  const points = [];

  const reached = supabase.reached && supabase.seenByFake && /\.supabase\.co:\d+$/.test(supabase.host ?? "");
  points.push({
    n: 1, ok: reached,
    label: "une requête vers un sous-domaine *.supabase.co atterrit chez le faux serveur",
    detail: reached ? `Host vu par le faux serveur : ${supabase.host}` : `non atteint (${supabase.error ?? "le faux serveur n'a rien vu"})`,
  });

  const diverted = external.length > 0 && external.every((p) => p.divertedToTrap && !p.gotRealAnswer);
  points.push({
    n: 2, ok: diverted,
    label: "une requête vers une autre adresse externe est refusée par le navigateur",
    detail: external.length === 0 ? "aucune sonde exécutée"
      : external.map((p) => `${p.fragment} → ${p.gotRealAnswer ? "RÉPONSE REÇUE (fuite possible)" : p.divertedToTrap ? "détournée vers le piège local" : "ni piège ni refus constaté"}`).join(" ; "),
  });

  const noWorker = serviceWorkers === 0;
  points.push({
    n: 3, ok: noWorker,
    label: "aucun service worker actif dans la copie de l'app",
    detail: serviceWorkers === 0 ? "0 enregistrement" : `${serviceWorkers} enregistrement(s)`,
  });

  return { ok: points.every((p) => p.ok), points, text: formatReport(points) };
}

export function formatReport(points) {
  return ["Contrôle d'isolation", ...points.map((p) => `  Point ${p.n} — ${p.label} : ${p.ok ? "OK" : "ÉCHEC"}\n           ${p.detail}`)].join("\n");
}

const probeFetch = (url) => `fetch(${JSON.stringify(url)}, { cache: "no-store", signal: AbortSignal.timeout(8000) })
  .then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 80) }), (e) => ({ error: String(e) }))`;

// Lance les sondes dans la page `page` (contrôleur de chrome.js) et rend le verdict.
export async function runIsolationCheck({ page, fake }) {
  const apiPort = fake.ports.api;

  // Les pages de sonde n'ont pas la CSP de l'app : on teste le navigateur.
  await page.goto(`${fake.appOrigin}/__bench/probe.html`);

  const probeHost = `sonde-${Math.random().toString(36).slice(2, 8)}.supabase.co:${apiPort}`;
  const answer = await page.evaluate(probeFetch(`http://${probeHost}/__probe`));
  const supabase = {
    reached: answer.body ? JSON.parse(answer.body).bench === "fake-supabase" : false,
    host: answer.body ? JSON.parse(answer.body).host : null,
    seenByFake: fake.probeSeen(probeHost),
    error: answer.error,
  };

  const external = [];
  for (const { url, fragment } of EXTERNAL_PROBES) {
    fake.expectProbe(fragment);
    const result = await page.evaluate(probeFetch(url));
    external.push({
      fragment,
      divertedToTrap: fake.trapSaw(fragment),
      // Une vraie réponse = autre chose que le refus du piège (ou qu'une erreur réseau).
      gotRealAnswer: !result.error && result.body !== REFUSED,
    });
  }

  // L'app tente de s'enregistrer auprès du service worker au chargement. Un
  // enregistrement ne compte que s'il porte un worker : pendant la tentative
  // (script introuvable dans la copie) il existe brièvement à vide. On attend
  // la fin de la tentative avant de conclure à zéro.
  await page.goto(`${fake.appOrigin}/`);
  const count = () => page.evaluate("navigator.serviceWorker.getRegistrations().then((rs) => rs.filter((r) => r.active || r.installing || r.waiting).length)");
  let serviceWorkers = 0;
  for (let i = 0; i < 30 && serviceWorkers === 0 && !(fake.appSaw("/service-worker.js") && i > 3); i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    serviceWorkers = await count();
  }
  if (serviceWorkers === 0) {
    await new Promise((ok) => setTimeout(ok, 500));
    serviceWorkers = await count();
  }

  return verdict({ supabase, external, serviceWorkers });
}

export class IsolationError extends Error {
  constructor(report) {
    super(`ISOLATION NON PROUVÉE — aucun scénario n'est exécuté.\n${report.text}`);
    this.report = report;
  }
}
