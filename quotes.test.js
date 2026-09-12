import { test } from "node:test";
import assert from "node:assert/strict";
import { pickQuoteForDate, QUOTES } from "./quotes.js";

test("pickQuoteForDate returns an entry from the given bank", () => {
  const bank = [
    { quote: "A", author: "X", verse: "va", reference: "ra" },
    { quote: "B", author: "Y", verse: "vb", reference: "rb" },
  ];
  const picked = pickQuoteForDate(new Date("2026-09-13T12:00:00"), bank);
  assert.ok(bank.includes(picked));
});

test("pickQuoteForDate returns the same entry for two times on the same calendar day", () => {
  const bank = [
    { quote: "A", author: "X", verse: "va", reference: "ra" },
    { quote: "B", author: "Y", verse: "vb", reference: "rb" },
    { quote: "C", author: "Z", verse: "vc", reference: "rc" },
  ];
  const morning = pickQuoteForDate(new Date("2026-09-13T06:00:00"), bank);
  const evening = pickQuoteForDate(new Date("2026-09-13T23:00:00"), bank);
  assert.equal(morning, evening);
});

test("pickQuoteForDate alternates across consecutive days with a two-item bank", () => {
  const bank = [
    { quote: "A", author: "X", verse: "va", reference: "ra" },
    { quote: "B", author: "Y", verse: "vb", reference: "rb" },
  ];
  const day1 = pickQuoteForDate(new Date("2026-09-13T12:00:00"), bank);
  const day2 = pickQuoteForDate(new Date("2026-09-14T12:00:00"), bank);
  const day3 = pickQuoteForDate(new Date("2026-09-15T12:00:00"), bank);
  assert.notEqual(day1, day2);
  assert.equal(day1, day3);
});

test("pickQuoteForDate defaults to the built-in QUOTES bank", () => {
  const picked = pickQuoteForDate(new Date("2026-09-13T12:00:00"));
  assert.ok(QUOTES.includes(picked));
});

test("QUOTES entries each pair a quote with an echoing Bible verse", () => {
  assert.ok(QUOTES.length >= 10);
  for (const entry of QUOTES) {
    assert.ok(entry.quote && entry.author);
    assert.ok(entry.verse && entry.reference);
  }
});
