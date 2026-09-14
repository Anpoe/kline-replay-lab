import assert from "node:assert/strict";
import test from "node:test";
import {
  countTradingSessions,
  countWeekdaySessions,
  isMarketSyncRunTerminal,
  planAlpacaBatches,
  splitSymbols,
} from "../app/lib/marketSync.ts";

test("批次都结束但仍有未终态任务时，市场同步不能提前标记完成", () => {
  assert.equal(isMarketSyncRunTerminal({
    queuedBatches: 0,
    runningBatches: 0,
    totalJobs: 2,
    completedJobs: 0,
    failedJobs: 0,
  }), false);
  assert.equal(isMarketSyncRunTerminal({
    queuedBatches: 0,
    runningBatches: 0,
    totalJobs: 2,
    completedJobs: 2,
    failedJobs: 0,
  }), true);
  assert.equal(isMarketSyncRunTerminal({
    queuedBatches: 0,
    runningBatches: 0,
    totalJobs: 2,
    completedJobs: 1,
    failedJobs: 1,
  }), true);
});

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

test("十年日线历史默认把三个品种放入同一批次", () => {
  const plans = planAlpacaBatches({
    symbols: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META"],
    startDate: "2016-01-01",
    endDate: "2026-09-11",
    sessionCount: 2791,
  });

  assert.deepEqual(plans.map((plan) => plan.symbols.length), [3, 3]);
  assert.ok(plans.every((plan) => plan.estimatedPoints <= 9500));
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
