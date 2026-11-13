import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  CLIENT_ID, DEPART_KEY, REDIRECT_URI, SCOPES,
  buildAuthUrl, collectReport, randomState, readReturn, run,
} from "./essai-google.js";

// ESSAI JETABLE (à retirer après l'essai, avec la page essai-google.*).
// Ces tests gardent trois promesses : aucun appel réseau, le code renvoyé par
// Google n'est jamais montré ni écrit nulle part, et l'app n'est pas touchée.

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const html = read("essai-google.html");
const js = read("essai-google.js");
const css = read("essai-google.css");

// Code sans ses commentaires (un commentaire peut parler de ce qu'on interdit).
const withoutComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .split("\n").map((line) => (line.trim().startsWith("//") ? "" : line)).join("\n");

const SECRET = "SECRET-A-NE-JAMAIS-VOIR";
const STATE = "etat-de-depart-0123456789abcdef";

// --- Faux navigateur -------------------------------------------------------

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  };
}

function fakeDocument() {
  const elements = new Map();
  const created = [];
  const make = () => {
    const el = {
      textContent: "", hidden: false, children: [], listeners: {},
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = [...nodes]; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
    };
    created.push(el);
    return el;
  };
  return {
    created,
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, make()); return elements.get(id); },
    createElement: () => make(),
  };
}

function fakeEnv({ search = "", local = {}, session = {}, standalone = true, nowMs = 1_000_000 } = {}) {
  const calls = { assigned: [], replaced: [] };
  const env = {
    document: fakeDocument(),
    location: { search, pathname: "/mon-app-taches/essai-google.html", assign: (url) => calls.assigned.push(url) },
    history: { replaceState: (...args) => calls.replaced.push(args) },
    localStorage: fakeStorage(local),
    sessionStorage: fakeStorage(session),
    navigator: { standalone },
    matchMedia: () => ({ matches: standalone }),
    crypto: globalThis.crypto,
    now: () => nowMs,
  };
  return { env, calls };
}

const depart = (state, at) => JSON.stringify({ state, at });
const allText = (doc) => doc.created.map((el) => el.textContent).join("\n");

// Espionne la console pendant un appel (aucune sortie ne doit y passer).
function withConsoleSpy(fn) {
  const names = ["log", "info", "warn", "error", "debug", "trace"];
  const saved = Object.fromEntries(names.map((n) => [n, console[n]]));
  const seen = [];
  for (const n of names) console[n] = (...args) => seen.push([n, ...args]);
  try { fn(); } finally { for (const n of names) console[n] = saved[n]; }
  return seen;
}

// --- 1. Aucun appel réseau --------------------------------------------------

test("the page makes no network call and loads nothing external", () => {
  const code = withoutComments(js);
  const markup = withoutComments(html);
  for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /EventSource/,
    /importScripts/, /\bimport\s*\(/, /serviceWorker/, /\bXDomainRequest\b/]) {
    assert.doesNotMatch(code, forbidden, String(forbidden));
  }
  assert.doesNotMatch(markup, /<form\b/i, "form");
  assert.doesNotMatch(markup, /<(?:img|iframe|link|script|source|video|audio)\b[^>]*\b(?:src|href)="(?:https?:)?\/\//i, "external resource");
  const hosts = new Set([...(code + markup).matchAll(/https?:\/\/([^/"'\s?]+)/g)].map((m) => m[1]));
  assert.deepEqual([...hosts].sort(), ["accounts.google.com", "fyfmktnv4b-droid.github.io", "www.googleapis.com"]);
});

// --- 2. Le code n'est jamais montré ni écrit ---------------------------------

test("the code is never read as a value: only its presence is tested", () => {
  const code = withoutComments(js);
  assert.doesNotMatch(code, /\.get\(\s*["'`]code["'`]/);
  assert.doesNotMatch(code, /\bconsole\b/, "no console output at all");
  assert.doesNotMatch(code, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write/, "text only, never HTML");
});

test("a return with a code: shows yes/no, never the code, and cleans the address first", () => {
  const { env, calls } = withEnvReturn(`?code=${SECRET}&state=${STATE}&scope=x`);
  const spied = withConsoleSpy(() => run(env));
  assert.deepEqual(spied, [], "nothing written to the console");
  assert.ok(!allText(env.document).includes(SECRET), "the code must never be displayed");
  assert.ok(!allText(env.document).includes(STATE), "the state value is not displayed either");
  assert.match(allText(env.document), /Code.*: oui/);
  assert.deepEqual(calls.replaced, [[null, "", "/mon-app-taches/essai-google.html"]]);
  assert.ok(![...env.localStorage.map.values(), ...env.sessionStorage.map.values()].join().includes(SECRET));
});

function withEnvReturn(search, extra = {}) {
  return fakeEnv({
    search,
    local: { [DEPART_KEY]: depart(STATE, 940_000) },
    session: { [DEPART_KEY]: depart(STATE, 940_000) },
    ...extra,
  });
}

test("a hostile error value is shown as plain text, cut short, never as HTML", () => {
  const { env } = withEnvReturn(`?error=${encodeURIComponent("<img src=x onerror=alert(1)>" + "a".repeat(200))}`);
  run(env);
  const shown = allText(env.document);
  assert.ok(!shown.includes("<"), "no angle bracket survives");
  assert.ok(!/a{61}/.test(shown), "error value is cut to 60 characters");
});

// --- 3. Adresse Google ------------------------------------------------------

test("the Google address carries exactly the requested parameters", () => {
  const url = new URL(buildAuthUrl(STATE));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const p = url.searchParams;
  assert.equal(p.get("client_id"), "590832587446-s8bvr6dp4q59ee3u4c8ckrf1c09gq71g.apps.googleusercontent.com");
  assert.equal(p.get("redirect_uri"), "https://fyfmktnv4b-droid.github.io/mon-app-taches/essai-google.html");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("scope"),
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly");
  assert.equal(p.get("state"), STATE);
  assert.equal(p.get("access_type"), "offline");
  assert.equal(p.get("prompt"), "consent");
  assert.deepEqual([...p.keys()].sort(), ["access_type", "client_id", "prompt", "redirect_uri", "response_type", "scope", "state"]);
  assert.equal(CLIENT_ID, p.get("client_id"));
  assert.equal(REDIRECT_URI, p.get("redirect_uri"));
  assert.deepEqual(SCOPES.length, 2);
});

test("the redirect address is the page's own address", () => {
  assert.match(REDIRECT_URI, /\/mon-app-taches\/essai-google\.html$/);
});

// --- 4. Départ : state et marqueur -------------------------------------------

test("the state is random each time", () => {
  const a = randomState(globalThis.crypto);
  const b = randomState(globalThis.crypto);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test("start: state and timestamped marker go to both storages, then to Google", () => {
  const { env, calls } = fakeEnv({ nowMs: 5000 });
  run(env); // pas de retour dans l'adresse : écran de départ
  env.document.getElementById("lancer").listeners.click();
  for (const storage of [env.localStorage, env.sessionStorage]) {
    const saved = JSON.parse(storage.getItem(DEPART_KEY));
    assert.match(saved.state, /^[0-9a-f]{32}$/);
    assert.equal(saved.at, 5000);
  }
  assert.equal(calls.assigned.length, 1);
  assert.equal(new URL(calls.assigned[0]).searchParams.get("state"), JSON.parse(env.localStorage.getItem(DEPART_KEY)).state);
});

test("with no return in the address, nothing is read, cleaned or erased", () => {
  const { env, calls } = fakeEnv({ local: { [DEPART_KEY]: depart(STATE, 1) } });
  run(env);
  assert.deepEqual(calls.replaced, []);
  assert.ok(env.localStorage.getItem(DEPART_KEY));
});

// --- 5. Rapport --------------------------------------------------------------

test("the report: standalone, same state, marker and its age, sb- key presence, time", () => {
  const { env } = withEnvReturn(`?code=${SECRET}&state=${STATE}`, {
    standalone: true,
    local: { [DEPART_KEY]: depart(STATE, 940_000), "sb-projet-auth-token": "VALEUR-SECRETE-DE-SESSION" },
  });
  const ret = readReturn(env.location.search);
  const report = collectReport(env, ret, 1_000_000);
  assert.equal(report.standalone.displayMode, true);
  assert.equal(report.standalone.navigator, true);
  assert.equal(report.hasCode, true);
  assert.equal(report.sameStateLocal, true);
  assert.equal(report.sameStateSession, true);
  assert.equal(report.markerLocal, true);
  assert.equal(report.markerSession, true);
  assert.equal(report.ageLocalSeconds, 60);
  assert.equal(report.ageSessionSeconds, 60);
  assert.equal(report.hasSbKey, true);
  assert.ok(!JSON.stringify(report).includes("VALEUR-SECRETE-DE-SESSION"), "never the value of the sb- key");
  assert.ok(!JSON.stringify(report).includes(SECRET), "never the code");
  assert.ok(!JSON.stringify(report).includes(STATE), "never the state value");
});

test("the report says 'different' and 'not found' when the storages differ or are empty", () => {
  const { env } = fakeEnv({
    search: `?code=${SECRET}&state=autre-etat`,
    local: { [DEPART_KEY]: depart(STATE, 1) },
    standalone: false,
  });
  const report = collectReport(env, readReturn(env.location.search), 10_000);
  assert.equal(report.sameStateLocal, false);
  assert.equal(report.markerSession, false);
  assert.equal(report.hasSbKey, false);
  assert.equal(report.standalone.displayMode, false);
});

test("an error return shows the error value; a broken marker does not crash", () => {
  const { env } = fakeEnv({ search: "?error=access_denied", local: { [DEPART_KEY]: "{pas du json" } });
  run(env);
  assert.match(allText(env.document), /access_denied/);
  assert.match(allText(env.document), /Code.*: non/);
});

test("the start marker is erased from both storages on return, and nothing else is stored", () => {
  const { env } = withEnvReturn(`?code=${SECRET}&state=${STATE}`);
  run(env);
  assert.equal(env.localStorage.getItem(DEPART_KEY), null);
  assert.equal(env.sessionStorage.getItem(DEPART_KEY), null);
  assert.equal(env.localStorage.length, 0);
  assert.equal(env.sessionStorage.length, 0);
});

test("a storage that throws does not stop the report", () => {
  const { env } = withEnvReturn(`?code=${SECRET}&state=${STATE}`);
  env.localStorage.getItem = () => { throw new Error("stockage bloqué"); };
  env.localStorage.removeItem = () => { throw new Error("stockage bloqué"); };
  run(env);
  assert.match(allText(env.document), /Code.*: oui/);
});

// --- 6. Page, CSP, manifeste -------------------------------------------------

test("the page is marked as disposable, with its trial number", () => {
  // Le manifeste est du JSON : il ne peut pas porter de commentaire.
  for (const [name, text] of [["essai-google.html", html], ["essai-google.js", js], ["essai-google.css", css]]) {
    assert.match(text.slice(0, 600), /jetable/i, `${name}: header comment`);
    assert.match(text.slice(0, 600), /retirer/i, `${name}: header comment says to remove it`);
  }
  assert.match(html, /<p id="essai-numero">Essai n° 1<\/p>/);
});

test("the CSP is strict, comes first, and forbids any connection", () => {
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(meta, "CSP meta tag missing");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<link"), "CSP before the first <link>");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<script"), "CSP before the first <script>");
  assert.doesNotMatch(meta[1], /unsafe-inline|unsafe-eval|\*/);
  const d = Object.fromEntries(meta[1].split(";").map((x) => x.trim().split(/\s+/)).map(([name, ...v]) => [name, v]));
  assert.deepEqual(d["default-src"], ["'none'"]);
  assert.deepEqual(d["script-src"], ["'self'"]);
  assert.deepEqual(d["style-src"], ["'self'"]);
  assert.deepEqual(d["connect-src"], ["'none'"]);
  assert.deepEqual(d["form-action"], ["'none'"]);
  assert.deepEqual(d["object-src"], ["'none'"]);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test("no inline script, inline style or inline event handler", () => {
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "inline <script>");
  assert.doesNotMatch(html, /<style\b/, "inline <style>");
  assert.doesNotMatch(html, /\sstyle="/, "style attribute");
  assert.doesNotMatch(html, /\son[a-z]+="/, "inline event handler");
});

test("the style uses only :root variables for colours, no red, and 44px touch targets", () => {
  const rules = css.replace(/:root\s*\{[^}]*\}/, "");
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, "colour outside :root");
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /\bred\b/i);
});

test("the manifest is its own: name, standalone, start_url and scope on the page", () => {
  const manifest = JSON.parse(read("essai-manifest.webmanifest"));
  assert.equal(manifest.name, "Essai Google");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./essai-google.html");
  assert.equal(manifest.scope, "./essai-google.html");
  for (const icon of manifest.icons) assert.ok(existsSync(new URL(`./${icon.src}`, import.meta.url)), icon.src);
  assert.match(html, /<link rel="manifest" href="essai-manifest\.webmanifest">/);
});

// --- 7. L'app n'est pas touchée ---------------------------------------------

test("the app does not know the trial page: no link, not cached, service worker untouched", () => {
  for (const file of ["index.html", "app.js", "service-worker.js", "manifest.json", "version.js"]) {
    assert.doesNotMatch(read(file), /essai-google|essai-manifest/, file);
  }
  const assets = read("service-worker.js").match(/const ASSETS = \[([\s\S]*?)\];/)[1];
  assert.doesNotMatch(assets, /essai/);
});
