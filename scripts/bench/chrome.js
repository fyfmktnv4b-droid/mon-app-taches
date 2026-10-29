// Chrome sans fenêtre, piloté par CDP (Chrome DevTools Protocol) via le
// WebSocket natif de Node : rien à installer. Le profil est jetable, dans le
// dossier temporaire du système, et l'isolation vient de isolation.js.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolationFlags } from "./isolation.js";

export function findChrome() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean).find(existsSync) ?? null;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

class Cdp {
  #ws; #next = 1; #pending = new Map(); #listeners = new Set();

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error("CDP : connexion impossible")); });
    return new Cdp(ws);
  }

  constructor(ws) {
    this.#ws = ws;
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return this.#listeners.forEach((listener) => listener(message));
      const waiting = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) waiting.ko(new Error(`${waiting.method} : ${message.error.message}`));
      else waiting.ok(message.result);
    };
    ws.onclose = () => this.#pending.forEach((waiting) => waiting.ko(new Error("CDP : connexion fermée")));
  }

  send(method, params = {}, sessionId) {
    const id = this.#next++;
    return new Promise((ok, ko) => {
      this.#pending.set(id, { ok, ko, method });
      this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  onEvent(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  close() { this.#ws.close(); }
}

// Une page (onglet) pilotable : navigation, évaluation, gestes tactiles émulés.
async function openPage(cdp, { width = 390, height = 844 } = {}) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => cdp.send(method, params, sessionId);
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  // Un iPhone en gros : écran étroit, tactile, densité 3. Ce n'est PAS Safari.
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  const errors = [];
  const requestedHosts = new Set(); // noms d'hôte demandés par la PAGE (ni par Chrome lui-même)
  cdp.onEvent((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    }
    if (m.method === "Network.requestWillBeSent") {
      try { requestedHosts.add(new URL(m.params.request.url).hostname); } catch { /* data:, blob:… */ }
    }
  });

  const waitEvent = (name, timeout = 15000) => new Promise((ok, ko) => {
    const timer = setTimeout(() => { off(); ko(new Error(`CDP : « ${name} » n'est pas arrivé`)); }, timeout);
    const off = cdp.onEvent((m) => {
      if (m.sessionId === sessionId && m.method === name) { clearTimeout(timer); off(); ok(m.params); }
    });
  });

  const page = {
    errors,
    requestedHosts,

    async goto(url) {
      const loaded = waitEvent("Page.loadEventFired");
      await call("Page.navigate", { url });
      await loaded;
    },

    async evaluate(expression) {
      const { result, exceptionDetails } = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`evaluate : ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      return result.value;
    },

    // Attend qu'une expression JS devienne vraie.
    async waitFor(expression, { timeout = 10000, label = expression } = {}) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await page.evaluate(expression).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`Délai dépassé en attendant : ${label}`);
    },

    // Gestes tactiles : de vrais événements touch, pas des clics de souris.
    async tap(x, y) {
      await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },

    async swipe(from, to, { steps = 10, stepMs = 16 } = {}) {
      await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
        await sleep(stepMs);
      }
      await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },

    async tapSelector(selector) {
      const point = await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!point) throw new Error(`tapSelector : « ${selector} » introuvable`);
      await page.tap(point.x, point.y);
    },

    typeText: (text) => call("Input.insertText", { text }),

    // Mode avion de la page (le faux serveur a ses propres modes de panne).
    setOffline: (offline) => call("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
  };
  return page;
}

export async function launchChrome({ trapPort, mapSupabase = true, extraFlags = [] }) {
  const executable = findChrome();
  if (!executable) throw new Error("Chrome introuvable (indiquer son chemin dans la variable CHROME_PATH).");

  const profile = await mkdtemp(join(tmpdir(), "bench-chrome-"));
  const child = spawn(executable, [
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run", "--no-default-browser-check", "--password-store=basic", "--use-mock-keychain",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-default-apps", "--disable-domain-reliability", "--no-pings",
    // Chrome tente de lui-même de joindre Google (mises à jour, comptes, hameçonnage,
    // fuite de mots de passe…) : on coupe ce qui se coupe. Le reste, s'il tente
    // quand même, est refusé par le piège et compté dans le journal.
    "--disable-extensions", "--disable-component-extensions-with-background-pages",
    "--disable-client-side-phishing-detection", "--disable-breakpad", "--metrics-recording-only",
    "--safebrowsing-disable-auto-update", "--disable-search-engine-choice-screen",
    "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,PasswordLeakDetection,SafeBrowsingEnhancedProtection,GaiaServices,SigninInterceptBubble,ChromeLabs,NetworkTimeServiceQuerying",
    ...isolationFlags({ trapPort, mapSupabase }),
    ...extraFlags,
    "about:blank",
  ], { stdio: "ignore" });
  const exited = new Promise((ok) => child.once("exit", ok));
  const killNow = () => { try { child.kill("SIGKILL"); } catch { /* déjà arrêté */ } };
  process.once("exit", killNow);

  let cdp;
  try {
    // Chrome écrit le port de pilotage choisi dans le profil.
    let active;
    for (let i = 0; i < 150 && !active; i++) {
      active = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => null);
      if (!active) await sleep(100);
    }
    if (!active) throw new Error("Chrome n'a pas démarré (DevToolsActivePort absent après 15 s).");
    const [port, path] = active.trim().split("\n");
    cdp = await Cdp.connect(`ws://127.0.0.1:${port}${path}`);
  } catch (err) {
    killNow();
    await exited;
    await rm(profile, { recursive: true, force: true });
    throw err;
  }

  return {
    newPage: (size) => openPage(cdp, size),
    async close() {
      await Promise.race([cdp.send("Browser.close").catch(() => {}), sleep(2000)]);
      cdp.close();
      await Promise.race([exited, sleep(3000)]);
      killNow();
      await exited;
      process.removeListener("exit", killNow);
      await rm(profile, { recursive: true, force: true });
    },
  };
}
