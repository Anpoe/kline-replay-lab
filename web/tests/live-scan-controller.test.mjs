import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveScanRequest,
  normalizeLiveScanError,
  normalizeLiveScanLimit,
  selectLiveNavigatorIndex,
} from "../app/features/live/liveScanController.ts";

const results = [
  { instrumentId: "600519.SH" },
  { instrumentId: "AAPL" },
  { instrumentId: "MSFT" },
];

test("实时筛选数量限制在既有 UI 范围内", () => {
  assert.equal(normalizeLiveScanLimit(1), 50);
  assert.equal(normalizeLiveScanLimit(101.6), 102);
  assert.equal(normalizeLiveScanLimit(999), 500);
});

test("结果导航优先按品种身份恢复，其次才使用索引", () => {
  assert.equal(selectLiveNavigatorIndex(results, "AAPL", 0), 1);
  assert.equal(selectLiveNavigatorIndex(results, "MISSING", 2), 2);
  assert.equal(selectLiveNavigatorIndex([], "AAPL", 2), 0);
});

test("扫描请求由 feature 统一生成筛选 DTO", () => {
  assert.deepEqual(buildLiveScanRequest({
    market: "CN",
    presetIds: ["breakout"],
    presets: [],
    minPrice: "10",
    maxPrice: "",
    minVolume: "1000",
    sort: "turnover",
    limit: 100,
  }), {
    market: "CN",
    presetIds: ["breakout"],
    presets: [],
    filters: { minPrice: 10, minAverageVolume: 1000 },
    sort: "turnover",
    limit: 100,
  });
});

test("A 股扫描请求可携带排除涨停条件，美股不发送该条件", () => {
  const cnRequest = buildLiveScanRequest({
    market: "CN",
    presetIds: [],
    presets: [],
    minPrice: "",
    maxPrice: "",
    minVolume: "",
    excludeLimitUp: true,
    sort: "turnover",
    limit: 100,
  });
  assert.equal(cnRequest.filters.excludeLimitUp, true);

  const usRequest = buildLiveScanRequest({
    market: "US",
    presetIds: [],
    presets: [],
    minPrice: "",
    maxPrice: "",
    minVolume: "",
    excludeLimitUp: true,
    sort: "turnover",
    limit: 100,
  });
  assert.equal("excludeLimitUp" in usRequest.filters, false);
});

test("实时扫描错误统一为用户可见文本", () => {
  assert.equal(normalizeLiveScanError(new Error("离线")), "离线");
  assert.equal(normalizeLiveScanError(undefined), "实盘筛选失败");
});
