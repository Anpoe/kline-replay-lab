import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPENING_GAP_FILTER,
  evaluateOpeningGap,
  nextOpeningGapMode,
  normalizeOpeningGapFilter,
} from "../app/lib/openingGapFilter.ts";

test("cycles opening-gap protection through high, low, and off", () => {
  assert.equal(nextOpeningGapMode("off"), "high");
  assert.equal(nextOpeningGapMode("high"), "low");
  assert.equal(nextOpeningGapMode("low"), "off");
});

test("blocks a high open at or above the configured percentage threshold", () => {
  const filter = { mode: "high", unit: "percent", threshold: 3 };
  assert.equal(evaluateOpeningGap(100, 103, filter).blocked, true);
  assert.equal(evaluateOpeningGap(100, 102.99, filter).blocked, false);
  assert.equal(evaluateOpeningGap(100, 97, filter).blocked, false);
});

test("blocks a low open at or below the configured price threshold", () => {
  const filter = { mode: "low", unit: "price", threshold: 2 };
  assert.equal(evaluateOpeningGap(100, 98, filter).blocked, true);
  assert.equal(evaluateOpeningGap(100, 98.01, filter).blocked, false);
  assert.equal(evaluateOpeningGap(100, 102, filter).blocked, false);
});

test("disabled and invalid filters do not block an order", () => {
  assert.equal(evaluateOpeningGap(100, 140, DEFAULT_OPENING_GAP_FILTER).blocked, false);
  assert.deepEqual(normalizeOpeningGapFilter({ mode: "unknown", unit: "unknown", threshold: -1 }), DEFAULT_OPENING_GAP_FILTER);
  assert.equal(evaluateOpeningGap(0, 140, { mode: "high", unit: "percent", threshold: 1 }).blocked, false);
});
