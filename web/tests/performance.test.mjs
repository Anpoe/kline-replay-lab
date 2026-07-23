import assert from "node:assert/strict";
import test from "node:test";

import { summarizePerformance } from "../app/lib/performance.ts";

test("summarizes a filtered training set without mixing session and trade win rates", () => {
  const metrics = summarizePerformance([
    {
      totalPnl: 120,
      realizedPnl: 100,
      floatingPnl: 20,
      status: "completed",
      closedTradePnls: [150, -50],
      planScores: [80, 100],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      totalPnl: -40,
      realizedPnl: -40,
      floatingPnl: 0,
      status: "active",
      closedTradePnls: [-40],
      planScores: [60],
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ]);

  assert.equal(metrics.sessions, 2);
  assert.equal(metrics.completedSessions, 1);
  assert.equal(metrics.completionRate, 50);
  assert.equal(metrics.totalPnl, 80);
  assert.equal(metrics.averagePnl, 40);
  assert.equal(metrics.closedTrades, 3);
  assert.equal(metrics.winRate, 33);
  assert.equal(metrics.profitFactor, 150 / 90);
  assert.equal(metrics.averagePlanScore, 80);
  assert.equal(metrics.maxDrawdown, 40);
});

test("handles an empty training set and a profit-only set", () => {
  const empty = summarizePerformance([]);
  assert.equal(empty.sessions, 0);
  assert.equal(empty.profitFactor, null);
  assert.equal(empty.maxDrawdown, 0);

  const profitOnly = summarizePerformance([{
    totalPnl: 25,
    realizedPnl: 25,
    floatingPnl: 0,
    status: "completed",
    closedTradePnls: [25],
    planScores: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  }]);
  assert.equal(profitOnly.profitFactor, Number.POSITIVE_INFINITY);
});
