import assert from "node:assert/strict";
import test from "node:test";

import { analyzePerformanceHabits, summarizePerformance } from "../app/lib/performance.ts";

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
  assert.equal(metrics.winningSessions, 1);
  assert.equal(metrics.losingSessions, 1);
  assert.equal(metrics.flatSessions, 0);
  assert.equal(metrics.sessionWinRate, 50);
  assert.equal(metrics.profitFactor, 150 / 90);
  assert.equal(metrics.averagePlanScore, 80);
  assert.equal(metrics.maxDrawdown, 40);
});

test("excludes flat trades and flat sessions from both win-rate denominators", () => {
  const metrics = summarizePerformance([
    {
      totalPnl: 0,
      realizedPnl: 0,
      floatingPnl: 0,
      status: "completed",
      closedTradePnls: [0, 10, -5],
      planScores: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      totalPnl: 20,
      realizedPnl: 20,
      floatingPnl: 0,
      status: "completed",
      closedTradePnls: [20, 0],
      planScores: [],
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ]);

  assert.equal(metrics.flatTrades, 2);
  assert.equal(metrics.winningTrades, 2);
  assert.equal(metrics.losingTrades, 1);
  assert.equal(metrics.winRate, 67);
  assert.equal(metrics.flatSessions, 1);
  assert.equal(metrics.winningSessions, 1);
  assert.equal(metrics.sessionWinRate, 100);
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

test("ranks holding periods, decision habits, patterns and complete combinations", () => {
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
  const analysis = analyzePerformanceHabits([
    { result: 8, holdingBars: 3, decision, patterns: ["上升突破"] },
    { result: 4, holdingBars: 2, decision, patterns: ["上升突破"] },
    {
      result: -3,
      holdingBars: 15,
      decision: { ...decision, marketState: "震荡", location: "区间中部", reasons: ["信号K确认"] },
      patterns: ["缩量整理"],
    },
  ]);

  assert.equal(analysis.holdingPeriods[0].label, "约 2–3 根 K 线");
  assert.equal(analysis.holdingPeriods[0].samples, 2);
  assert.equal(analysis.holdingPeriods[0].averageResult, 6);
  assert.equal(analysis.marketStates[0].label, "上升趋势");
  assert.equal(analysis.reasons[0].label, "关键位置");
  assert.equal(analysis.patterns[0].label, "上升突破");
  assert.equal(analysis.combinations[0].samples, 2);
  assert.ok(analysis.planTraits.some((item) => item.label === "计划盈亏比 2–3"));
  assert.equal(analysis.attributedTrades, 3);
  assert.equal(analysis.pretradeAttributedTrades, 3);
  assert.equal(analysis.backfilledAttributedTrades, 0);
});

test("keeps compatible backfilled decisions visible without mixing their provenance", () => {
  const analysis = analyzePerformanceHabits([{
    result: 6,
    holdingBars: 2,
    decision: {
      marketState: "趋势",
      location: "回调位置",
      reasons: ["顺势"],
      score: 70,
      hasStop: false,
      hasTarget: false,
      hasNote: true,
      source: "backfilled",
    },
    patterns: ["上升趋势"],
  }]);

  assert.equal(analysis.marketStates[0].label, "趋势");
  assert.equal(analysis.attributedTrades, 1);
  assert.equal(analysis.pretradeAttributedTrades, 0);
  assert.equal(analysis.backfilledAttributedTrades, 1);
});

test("does not crown a single observation as a reliable best habit", () => {
  const analysis = analyzePerformanceHabits([
    { result: 20, holdingBars: 1, patterns: ["单笔形态"] },
  ]);

  assert.equal(analysis.holdingPeriods[0].eligible, false);
  assert.equal(analysis.patterns[0].eligible, false);
  assert.equal(analysis.marketStates.length, 0);
});
