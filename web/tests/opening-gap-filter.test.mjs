import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPENING_GAP_FILTER,
  evaluateOpeningGap,
  nextOpeningGapMode,
  normalizeOpeningGapFilter,
  openingGapThresholdFromPrice,
  openingGapThresholdPrice,
} from "../app/lib/openingGapFilter.ts";

test("cycles opening-gap protection through high, low, and off", () => {
  assert.equal(nextOpeningGapMode("off"), "high");
  assert.equal(nextOpeningGapMode("high"), "low");
  assert.equal(nextOpeningGapMode("low"), "off");
});

test("high mode only allows buys from the reference price up to the configured threshold", () => {
  const filter = { mode: "high", unit: "percent", threshold: 3.125 };
  assert.equal(evaluateOpeningGap(100, 103.125, filter).blocked, true);
  assert.equal(evaluateOpeningGap(100, 103.124, filter).blocked, false);
  assert.equal(evaluateOpeningGap(100, 100, filter).blocked, false);
  assert.equal(evaluateOpeningGap(100, 99.999, filter).blocked, true);
});

test("low mode only allows buys from the configured threshold up to the reference price", () => {
  const filter = { mode: "low", unit: "price", threshold: 2.345 };
  assert.equal(evaluateOpeningGap(100, 97.655, filter).blocked, true);
  assert.equal(evaluateOpeningGap(100, 97.656, filter).blocked, false);
  assert.equal(evaluateOpeningGap(100, 100, filter).blocked, false);
  assert.equal(evaluateOpeningGap(100, 100.001, filter).blocked, true);
});

test("disabled and invalid filters do not block an order", () => {
  assert.equal(evaluateOpeningGap(100, 140, DEFAULT_OPENING_GAP_FILTER).blocked, false);
  assert.deepEqual(normalizeOpeningGapFilter({ mode: "unknown", unit: "unknown", threshold: -1 }), DEFAULT_OPENING_GAP_FILTER);
  assert.equal(evaluateOpeningGap(0, 140, { mode: "high", unit: "percent", threshold: 1 }).blocked, false);
});

test("places the opening-gap guide at the directional threshold level", () => {
  assert.equal(openingGapThresholdPrice(100, { mode: "high", unit: "percent", threshold: 3.125 }), 103.125);
  assert.equal(openingGapThresholdPrice(100, { mode: "low", unit: "price", threshold: 2.345 }), 97.655);
  assert.equal(openingGapThresholdPrice(100, { mode: "off", unit: "percent", threshold: 3 }), undefined);
  assert.equal(openingGapThresholdPrice(1, { mode: "low", unit: "price", threshold: 2 }), undefined);
});

test("converts a dragged guide price back to a precise directional threshold", () => {
  assert.equal(openingGapThresholdFromPrice(100, 103.125, { mode: "high", unit: "percent" }), 3.125);
  assert.equal(openingGapThresholdFromPrice(100, 97.655, { mode: "low", unit: "price" }), 2.345);
  assert.equal(openingGapThresholdFromPrice(100, 103.123456, { mode: "high", unit: "percent" }), 3.1235);
  assert.equal(openingGapThresholdFromPrice(100, 99, { mode: "high", unit: "price" }), undefined);
  assert.equal(openingGapThresholdFromPrice(100, 101, { mode: "low", unit: "price" }), undefined);
});
