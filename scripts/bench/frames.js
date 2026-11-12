// Relevé image par image d'un changement d'écran (scénario enUnCoup.js).
// Dans la page, une boucle requestAnimationFrame note ce qui est affiché à
// chaque image (seulement quand ça change) ; ici, sans Chrome, on vérifie que
// la suite des images est : l'écran de départ complet, éventuellement
// « Chargement… » (une seule fois, vers 300 ms), puis l'écran d'arrivée
// complet, qui ne bouge plus. Tout le reste (titre seul, page vide, contenu
// incomplet, saut de page) est un échec.

export const LOADING_AFTER_MS = 300;
// Marge de mesure : une image dure ~16 ms, et la page est pilotée à distance.
const SLACK_MS = 150;

// Exécutée DANS la page (sérialisée par toString) : ce qui est à l'écran.
export function snapshotInPage() {
  const byId = (id) => document.getElementById(id);
  const vis = (id) => !!byId(id) && !byId(id).hidden;
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const shown = ["auth", "welcome", "routine", "reprise", "bilan", "app", "screen-loading"].filter(vis);
  const app = vis("app");
  const mv = byId("main-view");
  const title = text(byId("header-title"));
  const bilan = byId("bilan");
  const routineBox = !!mv.querySelector("#routine-block .routine-block");
  const routineInputs = document.querySelectorAll("#routine-checks input").length;
  const loading = vis("screen-loading") && text(byId("screen-loading")).includes("Chargement");
  const complete = {
    main: app && title === "Aujourd'hui" && mv.dataset.view === "main" && routineBox && vis("capture-form"),
    history: app && title === "Historique" && mv.dataset.view === "history" && !!mv.querySelector("#history-list"),
    settings: app && title === "Réglages" && mv.dataset.view === "settings" && !!mv.querySelector("#settings-form, p.empty"),
    bilan: vis("bilan") && !!bilan.querySelector(".bilan-hero") && !text(bilan).includes("Chargement"),
    routine: vis("routine") && routineInputs === 4,
  };
  const parts = [];
  if (app) {
    const blocks = mv.children.length;
    parts.push(`titre « ${title} », contenu ${blocks ? `${blocks} bloc(s)${routineBox ? " dont la routine" : mv.dataset.view === "main" ? ", sans la routine" : ""}` : "VIDE"}`);
  }
  if (vis("bilan")) parts.push(`Bilan « ${text(bilan.querySelector(".bilan-hero-title")) || "sans contenu"} »${text(bilan).includes("Chargement") ? " avec « Chargement… »" : ""}`);
  if (vis("routine")) parts.push(`Ma routine (${routineInputs} cases)`);
  if (loading) parts.push("« Chargement… »");
  if (!shown.length) parts.push("page vide");
  // Mise en page de l'écran visible (positions, hauteurs, longueur du texte) : un
  // changement après l'affichage complet est un saut.
  const box = app ? mv : vis("bilan") ? bilan : vis("routine") ? byId("routine") : null;
  const layout = box ? [...box.children].map((c) => {
    const r = c.getBoundingClientRect();
    return `${Math.round(r.top)}/${Math.round(r.height)}`;
  }).join(",") + `|${box.textContent.length}` : "";
  return { shown, loading, complete, desc: parts.join(" + "), sig: `${shown.join(",")}|${title}|${layout}` };
}

// Expression à évaluer dans la page : démarre le relevé, puis lance `action`
// (du code JS) dans la même tâche, pour que t = 0 soit le geste lui-même.
export function startRecording(action) {
  return `(() => {
    const snap = ${snapshotInPage.toString()};
    const rec = window.__frames = { t0: performance.now(), frames: [], last: null, lastChange: performance.now(), stopped: false };
    const tick = () => {
      if (rec.stopped) return;
      const s = snap();
      const key = JSON.stringify(s);
      if (key !== rec.last) {
        rec.last = key;
        rec.lastChange = performance.now();
        rec.frames.push({ t: Math.round(performance.now() - rec.t0), ...s });
      }
      requestAnimationFrame(tick);
    };
    tick();
    ${action};
    return true;
  })()`;
}

// Vrai quand la dernière image montre `to` complet et que rien n'a bougé depuis `quietMs`.
export const settledOn = (to, quietMs) => `(() => {
  const rec = window.__frames;
  const last = rec.frames[rec.frames.length - 1];
  return !!last && last.complete[${JSON.stringify(to)}] && performance.now() - rec.lastChange >= ${quietMs};
})()`;

export const STOP_RECORDING = `(() => { window.__frames.stopped = true; return window.__frames.frames; })()`;

// Calme pendant `ms` : vrai si rien n'a changé depuis.
export const quietFor = (ms) => `performance.now() - window.__frames.lastChange >= ${ms}`;

// Vérifie un changement d'écran `from` -> `to`. Renvoie { problems, firstTo, firstLoading }.
export function checkTransition(frames, { from, to, loadingAfterMs = LOADING_AFTER_MS }) {
  const problems = [];
  const kind = (f) => (f.complete[to] ? "to" : f.loading ? "loading" : f.complete[from] ? "from" : "other");
  let phase = "from";
  let firstTo = null;
  let firstLoading = null;
  let toSig = null;
  for (const f of frames) {
    const k = kind(f);
    if (k === "other") {
      problems.push(`état intermédiaire à ${f.t} ms : ${f.desc}`);
    } else if (k === "from") {
      if (phase !== "from") problems.push(`retour à l'écran de départ à ${f.t} ms : ${f.desc}`);
    } else if (k === "loading") {
      if (phase === "to") problems.push(`« Chargement… » après l'écran complet, à ${f.t} ms`);
      else if (phase === "from") { phase = "loading"; firstLoading = f.t; }
    } else if (phase !== "to") {
      phase = "to";
      firstTo = f.t;
      toSig = f.sig;
    } else if (f.sig !== toSig) {
      problems.push(`saut de page à ${f.t} ms (l'écran complet a encore changé) : ${f.desc}`);
      toSig = f.sig;
    }
  }
  if (firstTo === null) {
    problems.push(`l'écran d'arrivée n'est jamais apparu complet (dernier état : ${frames.at(-1)?.desc ?? "aucun"})`);
  } else {
    if (firstLoading === null && firstTo > loadingAfterMs + SLACK_MS) {
      problems.push(`écran figé ${firstTo} ms sans « Chargement… » (attendu vers ${loadingAfterMs} ms)`);
    }
    if (firstLoading !== null && firstLoading < loadingAfterMs - SLACK_MS / 3) {
      problems.push(`« Chargement… » trop tôt (${firstLoading} ms)`);
    }
    if (firstLoading !== null && firstLoading > loadingAfterMs + SLACK_MS) {
      problems.push(`« Chargement… » trop tard (${firstLoading} ms)`);
    }
  }
  return { problems, firstTo, firstLoading };
}

// Un rendu qui n'est PAS un changement d'écran (case validée, synchronisation,
// retour au premier plan) : l'écran `on` reste affiché, sans « Chargement… ».
export function checkStaysOn(frames, on) {
  const problems = [];
  for (const f of frames) {
    if (f.loading) problems.push(`« Chargement… » affiché à ${f.t} ms`);
    else if (!f.complete[on]) problems.push(`état intermédiaire à ${f.t} ms : ${f.desc}`);
  }
  return problems;
}
