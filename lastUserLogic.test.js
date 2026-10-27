import { test } from "node:test";
import assert from "node:assert/strict";
import { maskEmail, makeMarker, parseMarker, cacheOwner, MIXED_OWNERS } from "./lastUserLogic.js";

test("maskEmail keeps only the first letter and the domain", () => {
  assert.equal(maskEmail("benjamin.augsburger@icloud.com"), "b…@icloud.com");
  assert.equal(maskEmail("a@b.ch"), "a…@b.ch");
});

test("maskEmail refuses what is not an address", () => {
  for (const value of [undefined, null, "", "pas-une-adresse", "@icloud.com", "b@", 42]) {
    assert.equal(maskEmail(value), null, String(value));
  }
});

test("a marker never contains the full address", () => {
  const marker = makeMarker("user-A", "benjamin.augsburger@icloud.com", new Date("2026-10-27T10:00:00Z"));
  assert.deepEqual(marker, { userId: "user-A", maskedEmail: "b…@icloud.com", at: "2026-10-27T10:00:00.000Z" });
  assert.doesNotMatch(JSON.stringify(marker), /augsburger/);
});

test("parseMarker reads back a marker", () => {
  const marker = makeMarker("user-A", "b@icloud.com", new Date("2026-10-27T10:00:00Z"));
  assert.deepEqual(parseMarker(JSON.stringify(marker)), marker);
});

test("parseMarker returns null for missing or damaged values", () => {
  for (const raw of [null, undefined, "", "{", "null", "[]", "42", '{"userId":""}', '{"userId":12}', '{"at":"x"}']) {
    assert.equal(parseMarker(raw), null, String(raw));
  }
});

test("parseMarker keeps only known fields and never an unmasked address", () => {
  const parsed = parseMarker(JSON.stringify({
    userId: "user-A", maskedEmail: "benjamin@icloud.com", at: "2026-10-27", access_token: "secret",
  }));
  assert.deepEqual(parsed, { userId: "user-A", maskedEmail: null, at: "2026-10-27" });
});

test("cacheOwner finds the single owner of the cached tasks", () => {
  assert.equal(cacheOwner([]), null);
  assert.equal(cacheOwner([{ user_id: "user-A" }, { user_id: "user-A" }]), "user-A");
  assert.equal(cacheOwner([{ user_id: null }, { text: "x" }]), null);
});

test("cacheOwner flags a cache holding two accounts", () => {
  assert.equal(cacheOwner([{ user_id: "user-A" }, { user_id: "user-B" }]), MIXED_OWNERS);
  assert.notEqual(MIXED_OWNERS, "user-A");
});
