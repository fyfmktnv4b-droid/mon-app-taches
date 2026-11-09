import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Migration 0007 (heure du bilan du dimanche). Pas de Postgres dans les
// tests : on vérifie le texte des scripts que l'on colle dans Supabase.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sql = (path) => read(path).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const migration = sql("./migrations/0007_weekly_review_time.sql");
const rollback = sql("./rollback/0007_rollback.sql");
const verify = read("./checks/0007_verify.sql");

// Bornes écrites dans la contrainte CHECK : [min, max].
function checkBounds(source = migration) {
  const m = source.match(/weekly_review_time between time '(\d\d:\d\d)' and time '(\d\d:\d\d)'/);
  assert.ok(m, "contrainte CHECK introuvable");
  return [m[1], m[2]];
}

test("0007 : weekly_review_time a le même type que morning_reminder_time (time, nullable, sans défaut)", () => {
  const morning = sql("./migrations/0001_init.sql").match(/^\s*morning_reminder_time\s+(\w+)\s*,/m);
  assert.ok(morning);
  assert.match(migration, new RegExp(`add column if not exists weekly_review_time ${morning[1]};`));
  assert.doesNotMatch(migration, /weekly_review_time[^;]*\b(not null|default)\b/i);
});

test("0007 : la contrainte accepte NULL ou une heure entre 20:00 et 23:00, bornes comprises", () => {
  assert.match(migration, /check \(weekly_review_time is null\s+or weekly_review_time between/);
  assert.deepEqual(checkBounds(), ["20:00", "23:00"]);
});

test("0007 : relançable sans erreur et dans une transaction", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  const drop = migration.indexOf("drop constraint if exists user_settings_weekly_review_time_range");
  const add = migration.indexOf("add constraint user_settings_weekly_review_time_range");
  assert.ok(drop >= 0 && add > drop, "la contrainte est supprimée avant d'être recréée");
});

test("0007 : le retour en arrière retire la contrainte puis la colonne, sans rien d'autre", () => {
  const dropConstraint = rollback.indexOf("drop constraint if exists user_settings_weekly_review_time_range");
  const dropColumn = rollback.indexOf("drop column if exists weekly_review_time");
  assert.ok(dropConstraint >= 0 && dropColumn > dropConstraint);
  assert.equal((rollback.match(/\bdrop\b/g) ?? []).length, 2);
});

test("0007 : la vérification est en lecture seule et contrôle la colonne, le type, la contrainte et la plage", () => {
  assert.doesNotMatch(verify, /^\s*(insert|update|delete|alter|drop|create)\b/im);
  for (const label of ["colonne weekly_review_time", "même type que morning_reminder_time",
    "contrainte user_settings_weekly_review_time_range", "comptes avec une heure hors plage"]) {
    assert.ok(verify.includes(`'${label}'`), label);
  }
  const [min, max] = checkBounds();
  assert.ok(verify.includes(`not between time '${min}' and time '${max}'`));
});
