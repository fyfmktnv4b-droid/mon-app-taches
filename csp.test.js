import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Garde-fous de la CSP (balise meta de index.html) : si l'un de ces tests
// casse, une fonction de l'app risque d'être bloquée en silence sur iPhone.
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);

function directives() {
  return Object.fromEntries(
    meta[1].split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]),
  );
}

test("index.html declares a CSP before any stylesheet or script", () => {
  assert.ok(meta, "CSP meta tag missing");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<link"), "CSP must come before the first <link>");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<script"), "CSP must come before the first <script>");
});

test("the CSP allows no inline code and no eval", () => {
  assert.doesNotMatch(meta[1], /unsafe-inline|unsafe-eval|\*/);
  assert.deepEqual(directives()["script-src"], ["'self'"]);
  assert.deepEqual(directives()["object-src"], ["'none'"]);
});

test("the CSP lets the app reach its own Supabase project", () => {
  const url = readFileSync(new URL("./supabaseClient.js", import.meta.url), "utf8")
    .match(/SUPABASE_URL = "([^"]+)"/)[1];
  assert.ok(directives()["connect-src"].includes(url), `connect-src must include ${url}`);
});

test("index.html has no inline script, inline style or inline event handler", () => {
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "inline <script>");
  assert.doesNotMatch(html, /<style\b/, "inline <style>");
  assert.doesNotMatch(html, /\sstyle="/, "style attribute");
  assert.doesNotMatch(html, /\son[a-z]+="/, "inline event handler");
});

test("the splash screen is the only section visible at startup", () => {
  assert.match(html, /<html[^>]*\sclass="loading"/, "html.loading missing");
  assert.match(html, /<section id="splash"(?![^>]*\bhidden\b)[^>]*>/, "splash must be visible by default");
  for (const id of ["auth", "welcome", "routine", "reprise", "app"]) {
    assert.match(html, new RegExp(`<section id="${id}"[^>]*\\bhidden\\b`), `#${id} must be hidden by default`);
  }
});

test("the splash shows the app icon and no text", () => {
  const splash = html.match(/<section id="splash"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.match(splash, /<img src="icons\/icon-192\.png" alt="">/);
  assert.equal(splash.replace(/<img[^>]*>/, "").trim(), "");
});
