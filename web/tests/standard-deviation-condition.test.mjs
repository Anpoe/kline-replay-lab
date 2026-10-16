import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultPatternCondition, matchesPattern, normalizePatternPresets,
  patternConditionDefinitions, requiredPatternHistory,
} from "../app/lib/patternFilters.ts";
import { matchesLatestPattern } from "../local-data/pattern-scan.mjs";

const bars = (closes) => closes.map((close, timestamp) => ({ timestamp, open: close, high: close + 0.1, low: close - 0.1, close, volume: 100 }));
const preset = (parameters = {}, extra = []) => ({
  id: "custom-std", kind: "custom", name: "标准差组合", description: "Test", builtIn: false, parameters: {},
  conditions: [{ id: "std", kind: "standard_deviation", parameters: { period: 5, relation: "at_most", percentage: 1, window: "current", ...parameters } }, ...extra],
});

test("standard deviation is a discoverable standalone condition with restorable parameters and history", () => {
  const definition = patternConditionDefinitions.find((item) => item.kind === "standard_deviation");
  assert.equal(definition?.label, "标准差");
  assert.equal(definition.group, "量价与波幅");
  const condition = createDefaultPatternCondition("standard_deviation");
  assert.deepEqual(condition.parameters, { period: 20, window: "current", relation: "at_most", percentage: 2 });
  const normalized = normalizePatternPresets([preset({ period: 5, window: "previous", relation: "at_least", percentage: 0.5 })])[0];
  assert.deepEqual(normalized.conditions, preset({ period: 5, window: "previous", relation: "at_least", percentage: 0.5 }).conditions);
  assert.equal(requiredPatternHistory([normalized]), 5);
  assert.equal(requiredPatternHistory([preset()]), 4);
  const repaired = normalizePatternPresets([preset({ period: -1, window: "bad", relation: "bad", percentage: -5 })])[0];
  assert.deepEqual(repaired.conditions[0].parameters, { period: 2, window: "current", relation: "at_most", percentage: 0 });
});

for (const [name, evaluate] of [
  ["training", (candles, selected) => matchesPattern(candles, candles.length - 1, selected)],
  ["local scan", matchesLatestPattern],
]) {
  test(`${name}: population standard deviation is relative to mean and both comparisons include equality`, () => {
    const candles = bars([80, 120]); // mean 100, population std 20, ratio 20%.
    assert.equal(evaluate(candles, preset({ period: 2, percentage: 20 })), true);
    assert.equal(evaluate(candles, preset({ period: 2, percentage: 20, relation: "at_least" })), true);
    assert.equal(evaluate(candles, preset({ period: 2, percentage: 19.9 })), false);
    assert.equal(evaluate(candles, preset({ period: 2, percentage: 20.1, relation: "at_least" })), false);
    assert.equal(evaluate(bars([800, 1200]), preset({ period: 2, percentage: 20 })), true);
  });

  test(`${name}: window can exclude the breakout bar and all custom conditions must match`, () => {
    const candles = bars([100, 100, 100, 100, 100, 150]);
    const breakout = { id: "break", kind: "breakout", parameters: { lookback: 5, minimumPct: 0, direction: "up" } };
    assert.equal(evaluate(candles, preset()), false);
    assert.equal(evaluate(candles, preset({ window: "previous" })), true);
    assert.equal(evaluate(candles, preset({ window: "previous" }, [breakout])), true);
    assert.equal(evaluate(candles, preset({}, [breakout])), false);
    assert.equal(evaluate(candles, preset({ window: "previous" }, [{ ...breakout, parameters: { ...breakout.parameters, direction: "down" } }])), false);
  });

  test(`${name}: zero threshold means zero dispersion and unavailable price history fails closed`, () => {
    assert.equal(evaluate(bars([100, 100, 100, 100, 100]), preset({ percentage: 0 })), true);
    assert.equal(evaluate(bars([100, 101, 100, 100, 100]), preset({ percentage: 0 })), false);
    assert.equal(evaluate(bars([100, 100, 100, 100]), preset()), false);
    assert.equal(evaluate(bars([100, 100, 100, 100, 100]), preset({ window: "previous" })), false);
    for (const invalid of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(evaluate(bars([100, invalid, 100, 100, 100]), preset({ percentage: 100 })), false);
    }
  });
}

test("historical standard deviation reads only the configured window without future prices", () => {
  const candles = bars([100, 100, 100, 100, 100, 1000]);
  assert.equal(matchesPattern(candles, 4, preset({ percentage: 0 })), true);
  const withEarlier = bars([1000, 100, 100, 100, 100, 100]);
  assert.equal(matchesPattern(withEarlier, 5, preset({ percentage: 0 })), true);
});
