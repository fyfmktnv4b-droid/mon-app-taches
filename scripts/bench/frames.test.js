import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTransition, checkStaysOn } from "./frames.js";

// Images factices : seuls comptent t, complete, loading, desc et sig.
const frame = (t, { main = false, history = false, loading = false, sig = "s", desc = "?" } = {}) =>
  ({ t, loading, desc, sig, complete: { main, history, settings: false, bilan: false, routine: false } });
const spec = { from: "main", to: "history" };

test("écran de départ puis écran d'arrivée complet : en un coup", () => {
  const { problems, firstTo } = checkTransition([frame(0, { main: true }), frame(40, { history: true })], spec);
  assert.deepEqual(problems, []);
  assert.equal(firstTo, 40);
});

test("un titre seul entre les deux est un état intermédiaire", () => {
  const { problems } = checkTransition([
    frame(0, { main: true }),
    frame(20, { desc: "titre « Aujourd'hui », contenu VIDE" }),
    frame(60, { history: true }),
  ], spec);
  assert.deepEqual(problems, ["état intermédiaire à 20 ms : titre « Aujourd'hui », contenu VIDE"]);
});

test("l'écran complet qui bouge encore est un saut de page", () => {
  const { problems } = checkTransition([
    frame(0, { main: true }),
    frame(30, { history: true, sig: "a" }),
    frame(500, { history: true, sig: "b", desc: "plus haut" }),
  ], spec);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^saut de page à 500 ms/);
});

test("un écran lent sans « Chargement… » semble figé", () => {
  const { problems } = checkTransition([frame(0, { main: true }), frame(1200, { history: true })], spec);
  assert.deepEqual(problems, ["écran figé 1200 ms sans « Chargement… » (attendu vers 300 ms)"]);
});

test("« Chargement… » une fois vers 300 ms, puis l'écran complet : accepté", () => {
  const { problems, firstLoading } = checkTransition([
    frame(0, { main: true }), frame(310, { loading: true }), frame(1200, { history: true }),
  ], spec);
  assert.deepEqual(problems, []);
  assert.equal(firstLoading, 310);
});

test("« Chargement… » trop tôt, ou revenu après l'écran complet : refusé", () => {
  assert.match(checkTransition([frame(0, { main: true }), frame(16, { loading: true }), frame(900, { history: true })], spec).problems[0], /trop tôt/);
  const late = checkTransition([frame(0, { main: true }), frame(40, { history: true }), frame(400, { loading: true })], spec);
  assert.match(late.problems[0], /après l'écran complet/);
});

test("retour à l'écran de départ, ou arrivée jamais complète : refusé", () => {
  const back = checkTransition([frame(0, { main: true }), frame(310, { loading: true }), frame(400, { main: true }), frame(900, { history: true })], spec);
  assert.match(back.problems[0], /retour à l'écran de départ/);
  const never = checkTransition([frame(0, { main: true }), frame(20, { desc: "page vide" })], spec);
  assert.ok(never.problems.some((p) => p.startsWith("l'écran d'arrivée n'est jamais apparu complet")));
});

test("rendu sans changement d'écran : ni « Chargement… », ni état incomplet", () => {
  assert.deepEqual(checkStaysOn([frame(0, { main: true }), frame(900, { main: true, sig: "x" })], "main"), []);
  assert.deepEqual(checkStaysOn([frame(0, { main: true }), frame(300, { loading: true })], "main"), ["« Chargement… » affiché à 300 ms"]);
});
