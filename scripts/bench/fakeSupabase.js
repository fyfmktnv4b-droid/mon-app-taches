// Serveurs locaux du banc. Trois écoutes, toutes sur 127.0.0.1 uniquement :
//   - « app »   : sert la COPIE de l'app (voir appCopy.js) ;
//   - « api »   : le FAUX Supabase (auth + REST), qui répond à la place du vrai ;
//   - « piege » : reçoit tout ce que Chrome tenterait d'envoyer ailleurs (Chrome
//                 est lancé avec ce serveur comme proxy, voir isolation.js). Il
//                 refuse tout et journalise : rien ne sort de la machine.
// Chaque requête est journalisée. Une requête vers une autre adresse que la
// sienne est refusée (403) et notée « ILLICITE ».
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";

export const REFUSED = "BENCH-REFUSED";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
  ".woff2": "font/woff2", ".svg": "image/svg+xml",
};
// Page vide, sans CSP, servie par le banc pour lancer les sondes du contrôle
// d'isolation : celui-ci teste le NAVIGATEUR, pas la CSP de l'app.
const PROBE_PAGE = "<!doctype html><meta charset=utf-8><title>sonde</title>";
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

class Unhandled extends Error {}

// Nom d'hôte d'une cible du piège : « http://h/chemin » (proxy) ou « h:443 » (CONNECT).
export const hostnameOf = (target) => (target.includes("://") ? new URL(target).hostname : target.replace(/:\d+$/, ""));

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

export async function startServers() {
  const entries = [];       // journal de toutes les requêtes vues
  const wantedProbes = [];  // fragments d'adresse que le contrôle d'isolation vise exprès
  const db = { tasks: [], user_settings: [], daily_routines: [], push_subscriptions: [] };
  const users = new Map();          // e-mail -> utilisateur
  const accessTokens = new Map();   // jeton d'accès -> id utilisateur
  const refreshTokens = new Map();  // jeton de renouvellement -> id utilisateur
  const sockets = new Set();
  let mode = "online";
  let appDir = null;
  const ports = {};

  // --- Journal ---------------------------------------------------------------

  function record(server, req, kind, target = `${req.headers.host ?? "?"}${req.url}`) {
    const entry = { server, method: req.method, host: req.headers.host ?? "", target, kind };
    if (kind === "ILLICITE") entry.voulu = wantedProbes.some((fragment) => target.includes(fragment));
    entries.push(entry);
  }

  const isOwnHost = (host, port, apiNames) => host === `127.0.0.1:${port}`
    || host === `localhost:${port}` || (apiNames && new RegExp(`^[a-z0-9-]+\\.supabase\\.co:${port}$`).test(host ?? ""));

  function reply(res, status, body, headers = {}) {
    res.writeHead(status, { "cache-control": "no-store", ...res.cors, ...headers });
    res.end(body);
  }

  // --- Piège (proxy) ---------------------------------------------------------

  const trap = http.createServer((req, res) => {
    const target = req.url.startsWith("http") ? req.url : `${req.headers.host}${req.url}`;
    record("piege", req, "ILLICITE", target);
    reply(res, 403, REFUSED, { "content-type": "text/plain", "access-control-allow-origin": "*" });
  });
  trap.on("connect", (req, socket) => {
    record("piege", { method: "CONNECT", headers: {}, url: req.url }, "ILLICITE", req.url);
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
  });

  // --- App copiée ------------------------------------------------------------

  const app = http.createServer(async (req, res) => {
    if (!isOwnHost(req.headers.host, ports.app, false)) {
      record("app", req, "ILLICITE");
      return reply(res, 403, REFUSED);
    }
    const { pathname } = new URL(req.url, "http://x");
    record("app", req, "ok");
    if (pathname === "/__bench/probe.html") return reply(res, 200, PROBE_PAGE, { "content-type": TYPES[".html"] });
    if (!appDir) return reply(res, 503, "copie de l'app pas prête");
    const file = resolve(join(appDir, pathname === "/" ? "index.html" : decodeURIComponent(pathname)));
    if (!file.startsWith(appDir + sep)) return reply(res, 403, REFUSED);
    try {
      reply(res, 200, await readFile(file), { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    } catch {
      reply(res, 404, "introuvable");
    }
  });

  // --- Faux Supabase ---------------------------------------------------------

  const publicUser = (user) => ({
    id: user.id, aud: "authenticated", role: "authenticated", email: user.email,
    email_confirmed_at: user.created_at, phone: "", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {}, identities: [], created_at: user.created_at, updated_at: user.created_at,
  });

  function createUser(email, password) {
    const user = { id: randomUUID(), email, password, created_at: new Date().toISOString() };
    users.set(email, user);
    db.user_settings.push({ user_id: user.id, morning_reminder_time: null, notifications_enabled: false, timezone: "Europe/Paris", last_morning_reminder_sent_date: null });
    return user;
  }

  // Jetons factices mais bien formés (le SDK lit la date d'expiration dedans).
  function sessionFor(user) {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: user.id, aud: "authenticated", role: "authenticated", email: user.email, iat: now, exp: now + 3600, jti: randomUUID() };
    const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.signature-factice-du-banc`;
    const refresh = randomBytes(8).toString("hex");
    accessTokens.set(access, user.id);
    refreshTokens.set(refresh, user.id);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: publicUser(user) };
  }

  const json = (res, status, body, headers = {}) => reply(res, status, JSON.stringify(body), { "content-type": "application/json; charset=utf-8", ...headers });
  const authError = (res, status, code, msg) => json(res, status, { code: status, error_code: code, msg });

  function handleAuth(req, res, url, body, userId) {
    const route = `${req.method} ${url.pathname.replace("/auth/v1", "")}`;
    const userById = (id) => [...users.values()].find((u) => u.id === id);
    if (route === "POST /token" && url.searchParams.get("grant_type") === "password") {
      const user = users.get(body?.email);
      if (!user || user.password !== body.password) return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      return json(res, 200, sessionFor(user));
    }
    if (route === "POST /token" && url.searchParams.get("grant_type") === "refresh_token") {
      if (mode === "refuse400") return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      const id = refreshTokens.get(body?.refresh_token);
      if (!id) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(body.refresh_token);
      return json(res, 200, sessionFor(userById(id)));
    }
    if (route === "POST /signup") {
      if (users.has(body?.email)) return authError(res, 422, "user_already_exists", "User already registered");
      return json(res, 200, sessionFor(createUser(body.email, body.password)));
    }
    if (route === "GET /user") {
      if (!userId) return authError(res, 401, "bad_jwt", "invalid JWT");
      return json(res, 200, publicUser(userById(userId)));
    }
    if (route === "POST /logout") return reply(res, 204, "");
    throw new Unhandled(route);
  }

  // Filtres PostgREST : eq, neq, is. Le reste est signalé plutôt que mal imité.
  function matcher(params) {
    const tests = [];
    for (const [key, value] of params) {
      if (RESERVED.has(key)) continue;
      const m = value.match(/^(eq|neq|is)\.(.*)$/);
      if (!m) throw new Unhandled(`filtre ${key}=${value}`);
      const [, op, wanted] = m;
      tests.push((row) => {
        if (op === "is") return wanted === "null" ? row[key] == null : String(row[key]) === wanted;
        return (String(row[key]) === wanted) === (op === "eq");
      });
    }
    return (row) => tests.every((test) => test(row));
  }

  function ordered(rows, order) {
    if (!order) return rows;
    const [column, direction] = order.split(",")[0].split(".");
    const sign = direction === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => (a[column] > b[column] ? sign : a[column] < b[column] ? -sign : 0));
  }

  const DEFAULTS = {
    tasks: () => ({ id: randomUUID(), urgent: null, important: null, done: false, reminder_time: null, created_at: new Date().toISOString(), completed_at: null, updated_at: new Date().toISOString() }),
    daily_routines: () => ({ checks: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    push_subscriptions: () => ({ id: randomUUID(), device_label: null, created_at: new Date().toISOString() }),
    user_settings: () => ({}),
  };
  const CONFLICT_KEYS = { tasks: ["id"], daily_routines: ["user_id", "local_date"], push_subscriptions: ["endpoint"], user_settings: ["user_id"] };

  function handleRest(req, res, url, body, userId) {
    if (!userId) return json(res, 401, { code: "PGRST301", message: "JWT required", details: null, hint: null });
    const parts = url.pathname.split("/"); // "", "rest", "v1", table, [fonction]
    const prefer = req.headers.prefer ?? "";
    const wantsRows = prefer.includes("return=representation");

    if (parts[3] === "rpc" && parts[4] === "set_routine_check" && req.method === "POST") {
      let row = db.daily_routines.find((r) => r.user_id === userId && r.local_date === body.p_local_date);
      if (!row) db.daily_routines.push(row = { ...DEFAULTS.daily_routines(), user_id: userId, local_date: body.p_local_date });
      row.checks = { ...row.checks, [body.p_key]: body.p_value };
      row.updated_at = new Date().toISOString();
      return json(res, 200, row);
    }

    const table = parts[3];
    if (!db[table]) throw new Unhandled(`table ${table}`);
    const mine = (row) => row.user_id === userId;
    const matches = matcher(url.searchParams);

    if (req.method === "GET") {
      let rows = ordered(db[table].filter((r) => mine(r) && matches(r)), url.searchParams.get("order"));
      const limit = url.searchParams.get("limit");
      if (limit) rows = rows.slice(0, Number(limit));
      const columns = url.searchParams.get("select");
      if (columns && columns !== "*" && /^[\w,]+$/.test(columns)) {
        rows = rows.map((r) => Object.fromEntries(columns.split(",").map((c) => [c, r[c]])));
      }
      if ((req.headers.accept ?? "").includes("vnd.pgrst.object+json")) {
        if (rows.length !== 1) return json(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null });
        return json(res, 200, rows[0]);
      }
      return json(res, 200, rows);
    }

    if (req.method === "POST") {
      const merge = prefer.includes("resolution=merge-duplicates");
      const saved = [];
      for (const input of Array.isArray(body) ? body : [body]) {
        const keys = CONFLICT_KEYS[table];
        const existing = db[table].find((r) => mine(r) && keys.every((k) => k === "user_id" || (input[k] !== undefined && r[k] === input[k])));
        if (existing && merge) { Object.assign(existing, input, { user_id: userId }); saved.push(existing); continue; }
        const row = { ...DEFAULTS[table](), ...input, user_id: userId };
        db[table].push(row);
        saved.push(row);
      }
      return wantsRows ? json(res, 201, saved) : reply(res, 201, "");
    }

    if (req.method === "PATCH") {
      const hit = db[table].filter((r) => mine(r) && matches(r));
      for (const row of hit) Object.assign(row, body, { user_id: userId, updated_at: new Date().toISOString() });
      return wantsRows ? json(res, 200, hit) : reply(res, 204, "");
    }

    if (req.method === "DELETE") {
      const gone = db[table].filter((r) => mine(r) && matches(r));
      db[table] = db[table].filter((r) => !gone.includes(r));
      return wantsRows ? json(res, 200, gone) : reply(res, 204, "");
    }
    throw new Unhandled(`${req.method} ${table}`);
  }

  function readBody(req) {
    return new Promise((done) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try { done(raw ? JSON.parse(raw) : undefined); } catch { done(undefined); }
      });
    });
  }

  const api = http.createServer(async (req, res) => {
    if (!isOwnHost(req.headers.host, ports.api, true)) {
      record("api", req, "ILLICITE");
      return reply(res, 403, REFUSED);
    }
    const url = new URL(req.url, "http://x");
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "access-control-expose-headers": "*",
    };
    if (url.pathname === "/__probe") {
      record("api", req, "sonde");
      res.cors = cors;
      return json(res, 200, { bench: "fake-supabase", host: req.headers.host });
    }
    // Modes de panne : la requête ne reçoit aucune réponse, ou la connexion saute.
    if (mode === "down") return req.socket.destroy();
    if (mode === "hang") return;
    res.cors = cors;
    if (req.method === "OPTIONS") return reply(res, 204, "");

    record("api", req, "ok");
    const body = await readBody(req);
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const userId = accessTokens.get(token);
    res.cors = cors; // ajoutés par reply() à toute réponse
    try {
      if (url.pathname.startsWith("/auth/v1/")) return handleAuth(req, res, url, body, userId);
      if (url.pathname.startsWith("/rest/v1/")) return handleRest(req, res, url, body, userId);
      throw new Unhandled(url.pathname);
    } catch (err) {
      if (!(err instanceof Unhandled)) throw err;
      record("api", req, "non-géré", `${req.method} ${err.message}`);
      return json(res, 404, { message: `banc : non géré (${err.message})` });
    }
  });

  // --- Démarrage / arrêt -----------------------------------------------------

  for (const [name, server] of Object.entries({ app, api, piege: trap })) {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {}); // Chrome coupe parfois d'un coup (RST) : sans importance ici
    });
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    ports[name] = server.address().port;
  }

  const seen = (server, fragment) => entries.some((e) => e.server === server && e.target.includes(fragment));

  return {
    ports,
    appOrigin: `http://127.0.0.1:${ports.app}`,
    entries,
    db,
    get mode() { return mode; },
    // "online" | "hang" (aucune réponse) | "down" (connexion coupée) | "refuse400" (renouvellement refusé)
    setMode(next) { mode = next; },
    setAppDir(dir) { appDir = resolve(dir); },
    seedUser({ email, password }) { return createUser(email, password); },
    // Le contrôle d'isolation déclare ses sondes : leurs échecs voulus ne sont pas comptés comme fuites.
    expectProbe(fragment) { wantedProbes.push(fragment); },
    // Fuites : requêtes de la PAGE vers une autre adresse (refusées), hors sondes voulues.
    // Une requête arrivée au piège sans que la page l'ait demandée vient de Chrome
    // lui-même (mises à jour, comptes…) : refusée aussi, comptée à part.
    illicit: (pageHosts) => entries.filter((e) => e.kind === "ILLICITE" && !e.voulu && (e.server !== "piege" || pageHosts.has(hostnameOf(e.target)))),
    browserOwn: (pageHosts) => entries.filter((e) => e.server === "piege" && !e.voulu && !pageHosts.has(hostnameOf(e.target))),
    wantedIllicit: () => entries.filter((e) => e.kind === "ILLICITE" && e.voulu),
    unhandled: () => entries.filter((e) => e.kind === "non-géré"),
    trapSaw: (fragment) => seen("piege", fragment),
    appSaw: (fragment) => seen("app", fragment),
    probeSeen: (host) => entries.some((e) => e.kind === "sonde" && e.host === host),
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([app, api, trap].map((server) => new Promise((ok) => server.close(ok))));
    },
  };
}
