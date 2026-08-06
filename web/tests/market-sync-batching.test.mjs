import assert from "node:assert/strict";
import test from "node:test";
import {
  countTradingSessions,
  countWeekdaySessions,
  planAlpacaBatches,
  splitSymbols,
} from "../app/lib/marketSync.ts";

test("美股批次规划按交易日预算把完整历史切成约 3 个品种一批", () => {
  const plans = planAlpacaBatches({
    symbols: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOG"],
    startDate: "2016-01-01",
    endDate: "2026-01-01",
    sessionCount: 2500,
  });
  assert.deepEqual(plans.map((plan) => plan.symbols.length), [3, 3, 1]);
  assert.ok(plans.every((plan) => plan.estimatedPoints <= 8000));
});

test("单日批次受实际 URL 长度保护，而不是硬编码品种数", () => {
  const symbols = Array.from({ length: 2_000 }, (_, index) => "LONG" + index.toString().padStart(4, "0"));
  const plans = planAlpacaBatches({
    symbols,
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    sessionCount: 1,
  });
  assert.ok(plans.length > 1);
  assert.ok(plans.every((plan) => plan.urlLength <= 6_500));
  assert.equal(plans.flatMap((plan) => plan.symbols).length, symbols.length);
});

test("交易日计数支持缓存日历并在没有日历时提供工作日上界", () => {
  assert.equal(countTradingSessions("2026-08-03", "2026-08-07", [
    "2026-08-03",
    "2026-08-04",
    "2026-08-06",
  ]), 3);
  assert.equal(countWeekdaySessions("2026-08-03", "2026-08-09"), 5);
});

test("批次收到 414 或坏品种时可以二分定位", () => {
  assert.deepEqual(splitSymbols(["AAPL", "MSFT", "NVDA", "TSLA"]), [
    ["AAPL", "MSFT"],
    ["NVDA", "TSLA"],
  ]);
  assert.deepEqual(splitSymbols(["AAPL"]), [["AAPL"]]);
});
