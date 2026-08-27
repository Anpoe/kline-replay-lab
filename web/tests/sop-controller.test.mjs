import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateDisciplineGate,
  filterPersonalSopRecommendations,
  findBuiltinSopProfile,
  personalSopScopeKey,
} from "../app/features/sop/sopController.ts";

const baseDecision = {
  marketState: "上升趋势",
  location: "突破位置",
  reasons: ["顺势", "关键位置"],
  stop: "95",
  target: "115",
  note: "突破后回踩不破",
  score: 100,
};

const baseInput = {
  strictModeEnabled: true,
  requirePretradePlan: true,
  requiredPretradeFields: ["marketState", "location", "reasons", "stop", "target"],
  sopCheckEnabled: false,
  personalSopCheckEnabled: false,
  activePersonalSopRule: null,
  scope: { market: "US", timeframe: "1d", instrumentId: "AAPL" },
  decision: baseDecision,
  patterns: ["上升突破"],
};

test("keeps strict mode off as a non-blocking mode", () => {
  const result = evaluateDisciplineGate({
    ...baseInput,
    strictModeEnabled: false,
    decision: { ...baseDecision, marketState: "", stop: "" },
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.checks, []);
});

test("checks only the selected planning-card fields", () => {
  const result = evaluateDisciplineGate({
    ...baseInput,
    requiredPretradeFields: ["marketState", "stop"],
    decision: { ...baseDecision, location: "", stop: "", target: "", note: "" },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.checks.length, 1);
  assert.match(result.checks[0].message, /止损/);
  assert.doesNotMatch(result.checks[0].message, /位置/);
});

test("does not let disabled planning fields reappear in built-in SOP checks", () => {
  const result = evaluateDisciplineGate({
    ...baseInput,
    requiredPretradeFields: ["marketState", "location"],
    sopCheckEnabled: true,
    decision: { ...baseDecision, reasons: [], stop: "", target: "" },
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.checks, [
    { id: "pretrade-plan", status: "pass", message: "事前规划卡字段已完成" },
    { id: "builtin-sop", status: "pass", message: "美股日线版检查通过" },
  ]);
});

test("keeps built-in SOP checking independent from the planning card", () => {
  const result = evaluateDisciplineGate({
    ...baseInput,
    requirePretradePlan: false,
    sopCheckEnabled: true,
    decision: { ...baseDecision, reasons: ["顺势"] },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.checks[0].id, "builtin-sop");
  assert.match(result.checks[0].message, /至少两个交易理由/);
});

test("keeps personal SOP checking independent and warns when no adopted rule exists", () => {
  const result = evaluateDisciplineGate({
    ...baseInput,
    requirePretradePlan: false,
    personalSopCheckEnabled: true,
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.checks, [{ id: "personal-sop", status: "warning", message: "尚未采用满足 15 笔门槛的个人 SOP" }]);
});

test("provides the three built-in market/timeframe profiles", () => {
  assert.equal(findBuiltinSopProfile({ market: "US", timeframe: "1d" })?.id, "us-daily-v1");
  assert.equal(findBuiltinSopProfile({ market: "CN", timeframe: "1d" })?.id, "cn-daily-v1");
  assert.equal(findBuiltinSopProfile({ market: "FX", timeframe: "5m" })?.id, "eurusd-5m-v1");
  assert.equal(findBuiltinSopProfile({ market: "US", timeframe: "5m" }), undefined);
});

test("filters personal SOP recommendations by the selected market and timeframe", () => {
  const recommendations = [
    { id: "us-rule", scope: { market: "US", timeframe: "1d", instrumentId: "AAPL" } },
    { id: "fx-rule", scope: { market: "FX", timeframe: "5m", instrumentId: "EURUSD.FX" } },
  ];

  assert.equal(personalSopScopeKey({ market: "FX", timeframe: "5m" }), "FX|5m");
  assert.deepEqual(
    filterPersonalSopRecommendations(recommendations, { market: "FX", timeframe: "5m" }).map((item) => item.id),
    ["fx-rule"],
  );
});
