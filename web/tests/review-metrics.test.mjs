import assert from "node:assert/strict";
import test from "node:test";

import { calculateDeterministicReviewMetrics, REVIEW_METRICS_VERSION } from "../app/lib/reviewMetrics.ts";
import { createFxInstrumentEconomics } from "../app/lib/fxTrading.ts";

const bars = [
  { timestamp: 1, open: 100, high: 105, low: 98, close: 102 },
  { timestamp: 2, open: 102, high: 115, low: 97, close: 108 },
  { timestamp: 3, open: 108, high: 112, low: 106, close: 110 },
  { timestamp: 4, open: 110, high: 111, low: 100, close: 101 },
  { timestamp: 5, open: 101, high: 104, low: 95, close: 96 },
];

test("trade metrics calculate MFE, MAE, R and forward horizons from candle evidence", () => {
  const metrics = calculateDeterministicReviewMetrics({
    bars,
    initialCapital: 10_000,
    positions: [{
      id: "long-1", side: "long", qty: 10, entryPrice: 100, entryTimestamp: 1,
      status: "closed", exitPrice: 110, exitTimestamp: 3, grossRealizedPnl: 100,
      realizedPnl: 96, totalFees: 4, initialRisk: 50, exitReason: "take_profit",
    }],
  });
  const trade = metrics.trades[0];
  assert.equal(metrics.version, REVIEW_METRICS_VERSION);
  assert.equal(trade.mfe, 150);
  assert.equal(trade.mae, -30);
  assert.equal(trade.mfeTimestamp, 2);
  assert.equal(trade.maeTimestamp, 2);
  assert.equal(trade.rMultiple, 1.92);
  assert.equal(trade.mfeR, 3);
  assert.equal(trade.maeR, -0.6);
  assert.equal(trade.horizons[0].pnl, 80);
  assert.equal(trade.horizons[1].pnl, 10);
  assert.equal(trade.horizons[3].pnl, undefined);
  assert.equal(metrics.fees, 4);
  assert.equal(metrics.netPnl, 96);
});

test("summary reports expectancy, payoff, profit factor and consecutive losses", () => {
  const metrics = calculateDeterministicReviewMetrics({
    bars,
    initialCapital: 10_000,
    positions: [
      { id: "win", side: "long", qty: 10, entryPrice: 100, entryTimestamp: 1, status: "closed", exitPrice: 110, exitTimestamp: 3, realizedPnl: 100, initialRisk: 50 },
      { id: "loss-1", side: "long", qty: 10, entryPrice: 110, entryTimestamp: 3, status: "closed", exitPrice: 101, exitTimestamp: 4, realizedPnl: -90, initialRisk: 50 },
      { id: "loss-2", side: "long", qty: 10, entryPrice: 101, entryTimestamp: 4, status: "closed", exitPrice: 96, exitTimestamp: 5, realizedPnl: -50, initialRisk: 50 },
    ],
  });
  assert.equal(metrics.expectancy, -40 / 3);
  assert.equal(metrics.averageWin, 100);
  assert.equal(metrics.averageLoss, 70);
  assert.equal(metrics.payoffRatio, 100 / 70);
  assert.equal(metrics.profitFactor, 100 / 140);
  assert.equal(metrics.maxConsecutiveLosses, 2);
  assert.equal(metrics.totalR, -0.8);
  assert.equal(metrics.averageR, -0.8 / 3);
});

test("drawdown follows bar-by-bar marked equity and records evidence timestamps", () => {
  const metrics = calculateDeterministicReviewMetrics({
    bars,
    initialCapital: 1_000,
    positions: [{
      id: "open", side: "long", qty: 10, entryPrice: 100, entryTimestamp: 1,
      status: "open", entryFee: 2,
    }],
  });
  // Peak is 1098 at bar 3; the trough is 958 at bar 5.
  assert.equal(metrics.maxDrawdown, 140);
  assert.equal(metrics.maxDrawdownPct, 140 / 1098 * 100);
  assert.equal(metrics.maxDrawdownPeakTimestamp, 3);
  assert.equal(metrics.maxDrawdownTroughTimestamp, 5);
  assert.equal(metrics.maxUnderwaterBars, 2);
});

test("missing candle evidence is explicit instead of silently fabricating metrics", () => {
  const metrics = calculateDeterministicReviewMetrics({
    bars: bars.slice(2),
    initialCapital: 1_000,
    positions: [{ id: "old", side: "long", qty: 1, entryPrice: 100, entryTimestamp: 1, status: "closed", exitPrice: 110, exitTimestamp: 2, realizedPnl: 10 }],
  });
  assert.equal(metrics.evidenceComplete, false);
  assert.equal(metrics.trades[0].evidenceComplete, false);
  assert.equal(metrics.trades[0].holdingBars, 0);
});

test("profit-only review metrics remain JSON-safe while preserving infinite PF", () => {
  const metrics = calculateDeterministicReviewMetrics({
    bars,
    initialCapital: 10_000,
    positions: [{
      id: "only-win", side: "long", qty: 1, entryPrice: 100, entryTimestamp: 1,
      status: "closed", exitPrice: 110, exitTimestamp: 3, realizedPnl: 10,
    }],
  });
  assert.equal(metrics.profitFactor, null);
  assert.equal(metrics.profitFactorInfinite, true);
  const restored = JSON.parse(JSON.stringify(metrics));
  assert.equal(restored.profitFactor, null);
  assert.equal(restored.profitFactorInfinite, true);
});

test("intrabar conditional entries exclude unknown pre-fill extremes from MFE and MAE", () => {
  const metrics = calculateDeterministicReviewMetrics({
    bars: [
      { timestamp: 1, open: 90, high: 200, low: 50, close: 102 },
      { timestamp: 2, open: 102, high: 105, low: 99, close: 104 },
    ],
    initialCapital: 10_000,
    positions: [{
      id: "intrabar-limit", side: "long", qty: 1, entryPrice: 100, entryTimestamp: 1,
      entryIntrabar: true, status: "closed", exitPrice: 104, exitTimestamp: 2, realizedPnl: 4,
    }],
  });
  assert.equal(metrics.trades[0].mfe, 5);
  assert.equal(metrics.trades[0].mae, -1);
});

test("FX review metrics apply contract size, account conversion and Ask-side short exits", () => {
  const economics = createFxInstrumentEconomics("EURUSD.FX", { accountCurrency: "USD" });
  const metrics = calculateDeterministicReviewMetrics({
    bars: [
      { timestamp: 1, open: 1.1, high: 1.101, low: 1.099, close: 1.1 },
      { timestamp: 2, open: 1.1, high: 1.104, low: 1.095, close: 1.1 },
    ],
    initialCapital: 10_000,
    spreadBps: 10,
    positions: [{
      id: "fx-short",
      side: "short",
      qty: 0.1,
      entryPrice: 1.1,
      entryTimestamp: 1,
      status: "closed",
      exitPrice: 1.1011,
      exitTimestamp: 2,
      realizedPnl: -11,
      grossRealizedPnl: -11,
      instrumentEconomics: economics,
    }],
  });
  assert.ok(Math.abs(metrics.trades[0].mfe - 39.05) < 1e-8);
  assert.ok(Math.abs(metrics.trades[0].mae + 51.04) < 1e-8);
});
