import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_PERSONAL_SOP_SAMPLES,
  evaluatePersonalSopEntry,
  evaluatePersonalSopManagement,
  deriveSopInstrumentContext,
  generatePersonalSopRecommendations,
  holdingBarsAtCursor,
  summarizePersonalSopScopes,
} from "../app/lib/performanceSop.ts";

const scope = { market: "US", timeframe: "1d", instrumentId: "AAPL" };
const decision = {
  marketState: "上升趋势",
  location: "突破位置",
  reasons: ["顺势", "关键位置"],
  score: 100,
  hasStop: true,
  hasTarget: true,
  hasNote: true,
  riskReward: 2.4,
  source: "pretrade",
};
const instrument = {
  market: "US",
  entryPrice: 24,
  averageDailyVolume: 1500000,
  averageDailyTurnover: 36000000,
  marketCap: 8000000000,
};

function trade(result, overrides = {}) {
  return {
    result,
    holdingBars: 2,
    scope,
    decision,
    patterns: ["上升突破"],
    instrument,
    ...overrides,
  };
}

test("returns an under-sampled personal SOP candidate with its progress status", () => {
  assert.equal(MIN_PERSONAL_SOP_SAMPLES, 15);
  const [candidate] = generatePersonalSopRecommendations(Array.from({ length: 14 }, (_, index) => trade(index + 1)));

  assert.equal(candidate.stats.samples, 14);
  assert.equal(candidate.eligible, false);
  assert.equal(candidate.adoptable, false);
  assert.equal(candidate.missingSamples, 1);
  assert.equal(candidate.stats.expectancy, 7.5);

  const status = summarizePersonalSopScopes(Array.from({ length: 14 }, (_, index) => trade(index + 1)), [scope]);
  assert.deepEqual(status, [{ ...scope, samples: 14, missingSamples: 1, eligible: false }]);
});

test("calculates expectancy and maximum drawdown from the closed-trade sequence", () => {
  const [candidate] = generatePersonalSopRecommendations([
    trade(-20, { closedTimestamp: 1 }),
    trade(5, { closedTimestamp: 2 }),
    trade(10, { closedTimestamp: 3 }),
  ]);

  assert.equal(candidate.stats.expectancy, -5 / 3);
  assert.equal(candidate.stats.maxDrawdown, 20);
});

test("returns the top three combinations even when they cannot be adopted yet", () => {
  const groups = [
    ["组合 A", 14, 2],
    ["组合 B", 13, 8],
    ["组合 C", 12, 1],
    ["组合 D", 11, 20],
  ];
  const trades = groups.flatMap(([pattern, count, result], groupIndex) => (
    Array.from({ length: count }, (_, index) => trade(result, {
      patterns: [pattern],
      closedTimestamp: groupIndex * 100 + index,
    }))
  ));

  const recommendations = generatePersonalSopRecommendations(trades, { limit: 3 });

  assert.deepEqual(recommendations.map((candidate) => candidate.conditions.patterns), [["组合 A"], ["组合 B"], ["组合 C"]]);
  assert.deepEqual(recommendations.map((candidate) => candidate.stats.samples), [14, 13, 12]);
  assert.ok(recommendations.every((candidate) => candidate.adoptable === false));
});

test("keeps a full-sample combination visible when its expectancy is not positive", () => {
  const [candidate] = generatePersonalSopRecommendations(
    Array.from({ length: 15 }, () => trade(-1)),
  );

  assert.equal(candidate.stats.samples, 15);
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.adoptable, false);
  assert.equal(candidate.stats.expectancy, -1);
});

test("builds one eligible candidate that manages every available performance dimension", () => {
  const recommendations = generatePersonalSopRecommendations(
    Array.from({ length: 15 }, (_, index) => trade(index % 2 ? 4 : 6, {
      holdingBars: index % 3 === 0 ? 3 : 2,
    })),
  );

  assert.equal(recommendations.length, 1);
  const [candidate] = recommendations;
  assert.equal(candidate.stats.samples, 15);
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.adoptable, true);
  assert.equal(candidate.scope.instrumentId, "AAPL");
  assert.deepEqual(candidate.conditions.patterns, ["上升突破"]);
  assert.equal(candidate.conditions.marketState, "上升趋势");
  assert.equal(candidate.conditions.location, "突破位置");
  assert.deepEqual(candidate.conditions.reasons, ["关键位置", "顺势"]);
  assert.deepEqual(candidate.conditions.plan, {});
  assert.equal(candidate.conditions.priceRange?.label, "美股 $10–30");
  assert.equal(candidate.conditions.volumeRange?.label, "日均成交量 50–200 万股");
  assert.equal(candidate.conditions.turnoverRange?.label, "日均成交额 1000 万–1 亿美元");
  assert.equal(candidate.conditions.marketCapRange?.label, "美股市值 20–100 亿美元");
  assert.equal(candidate.management.holdingBarsMin, 2);
  assert.equal(candidate.management.holdingBarsMax, 3);
  assert.deepEqual(
    candidate.managedDimensions.map((item) => item.key),
    ["market", "timeframe", "instrument", "patterns", "marketState", "location", "reasons", "price", "volume", "turnover", "marketCap", "holdingBars"],
  );
});

test("does not use plan habits in personal SOP screening", () => {
  const incompleteDecision = {
    ...decision,
    score: 60,
    hasStop: false,
    hasTarget: false,
    hasNote: false,
    riskReward: 0.5,
  };
  const [candidate] = generatePersonalSopRecommendations([
    ...Array.from({ length: 8 }, () => trade(2)),
    ...Array.from({ length: 7 }, () => trade(4, { decision: incompleteDecision })),
  ]);

  assert.equal(candidate.stats.samples, 15);
  assert.deepEqual(candidate.conditions.plan, {});
  assert.equal(candidate.managedDimensions.some((dimension) => dimension.key === "plan"), false);

  const evaluation = evaluatePersonalSopEntry({
    rule: candidate,
    scope,
    decision: incompleteDecision,
    patterns: ["上升突破"],
    instrument,
    riskReward: 0.5,
  });
  assert.equal(evaluation.blocking, false);
  assert.equal(evaluation.checks.some((check) => check.key === "plan"), false);
});

test("ranks eligible combinations by evidence-backed result and does not mix scopes", () => {
  const weakerScope = { market: "US", timeframe: "1d", instrumentId: "MSFT" };
  const trades = [
    ...Array.from({ length: 15 }, (_, index) => trade(index % 2 ? 2 : 3)),
    ...Array.from({ length: 15 }, (_, index) => trade(index % 2 ? 8 : 10, {
      scope: weakerScope,
      instrument: { ...instrument, entryPrice: 120 },
      patterns: ["回踩买入"],
    })),
  ];
  const recommendations = generatePersonalSopRecommendations(trades);

  assert.equal(recommendations.length, 2);
  assert.equal(recommendations[0].scope.instrumentId, "MSFT");
  assert.equal(recommendations[0].stats.averageResult, 9 + 1 / 15);
  assert.equal(recommendations[1].scope.instrumentId, "AAPL");
});

test("merges the same strategy across instruments and does not restrict the adopted rule to one symbol", () => {
  const otherInstrumentScope = { market: "US", timeframe: "1d", instrumentId: "MSFT" };
  const recommendations = generatePersonalSopRecommendations([
    ...Array.from({ length: 15 }, () => trade(4)),
    ...Array.from({ length: 15 }, () => trade(6, { scope: otherInstrumentScope })),
  ], { scope: { market: "US", timeframe: "1d" } });

  assert.equal(recommendations.length, 1);
  const [candidate] = recommendations;
  assert.equal(candidate.stats.samples, 30);
  assert.equal(candidate.scope.instrumentId, undefined);
  assert.equal(candidate.title.includes("AAPL"), false);
  assert.equal(candidate.title.includes("MSFT"), false);
  assert.deepEqual(
    candidate.managedDimensions.find((dimension) => dimension.key === "instrument"),
    {
      key: "instrument",
      label: "品种范围",
      mode: "ignore",
      coverage: 1,
      value: "不限制具体品种",
    },
  );

  const evaluation = evaluatePersonalSopEntry({
    rule: candidate,
    scope: otherInstrumentScope,
    decision,
    patterns: ["上升突破"],
    instrument,
    riskReward: 2.4,
  });
  assert.equal(evaluation.blocking, false);
  assert.equal(evaluation.checks.find((check) => check.key === "scope")?.status, "pass");
});

test("checks entry conditions separately and reports unavailable context as a warning", () => {
  const [rule] = generatePersonalSopRecommendations(Array.from({ length: 15 }, (_, index) => trade(index + 1, {
    holdingBars: index % 3 === 0 ? 3 : 2,
  })));
  const passing = evaluatePersonalSopEntry({
    rule,
    scope,
    decision,
    patterns: ["上升突破", "其他形态"],
    instrument,
    riskReward: 2.4,
  });
  assert.equal(passing.status, "pass");
  assert.equal(passing.blocking, false);
  assert.ok(passing.checks.every((check) => check.status === "pass"));

  const mismatch = evaluatePersonalSopEntry({
    rule,
    scope,
    decision: { ...decision, location: "区间中部" },
    patterns: ["上升突破"],
    instrument,
    riskReward: 2.4,
  });
  assert.equal(mismatch.status, "blocked");
  assert.equal(mismatch.blocking, true);
  assert.ok(mismatch.checks.some((check) => check.key === "location" && check.status === "mismatch"));

  const liquidityMismatch = evaluatePersonalSopEntry({
    rule,
    scope,
    decision,
    patterns: ["上升突破"],
    instrument: { ...instrument, averageDailyVolume: 9000000 },
    riskReward: 2.4,
  });
  assert.equal(liquidityMismatch.status, "blocked");
  assert.ok(liquidityMismatch.checks.some((check) => check.key === "volume" && check.status === "mismatch"));

  const missingContext = evaluatePersonalSopEntry({
    rule,
    scope,
    decision,
    patterns: ["上升突破"],
    riskReward: 2.4,
  });
  assert.equal(missingContext.status, "warning");
  assert.equal(missingContext.blocking, false);
  assert.ok(missingContext.checks.some((check) => check.key === "price" && check.status === "missing"));
});

test("uses revealed bar indexes for holding age and triggers only after the max", () => {
  const bars = [0, 1, 2, 3, 4].map((timestamp) => ({ timestamp }));
  assert.equal(holdingBarsAtCursor(bars, 2, 2), 1);
  assert.equal(holdingBarsAtCursor(bars, 3, 2), 2);
  assert.equal(holdingBarsAtCursor(bars, 4, 2), 3);

  const [rule] = generatePersonalSopRecommendations(Array.from({ length: 15 }, (_, index) => trade(index + 1, {
    holdingBars: index % 3 === 0 ? 3 : 2,
  })));
  assert.deepEqual(evaluatePersonalSopManagement(rule, 3), { status: "pass", overMax: false, underMin: false });
  assert.deepEqual(evaluatePersonalSopManagement(rule, 4), { status: "over", overMax: true, underMin: false });
});

test("derives current volume and turnover context from prior sessions for entry checks", () => {
  const bars = Array.from({ length: 6 }, (_, index) => ({
    timestamp: Date.parse(`2026-01-${String(index + 1).padStart(2, "0")}T12:00:00Z`),
    close: 10 + index,
    volume: (index + 1) * 100,
    turnover: (index + 1) * 1000,
  }));

  assert.deepEqual(
    deriveSopInstrumentContext(bars, 5, "UTC", "5m", {
      market: "US",
      entryPrice: 20,
    }),
    {
      market: "US",
      entryPrice: 20,
      averageDailyVolume: 300,
      averageDailyTurnover: 3000,
    },
  );
});
