import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptsMarketDataResponse,
  createMarketDataRefreshNotice,
  normalizeMarketDataError,
} from "../app/features/market-data/marketDataController.ts";

test("只接受仍然对应当前市场的数据响应", () => {
  assert.equal(acceptsMarketDataResponse("CN", "CN"), true);
  assert.equal(acceptsMarketDataResponse("US", "CN"), false);
});

test("市场数据刷新通知只携带标准化的 feature 输出", () => {
  assert.deepEqual(createMarketDataRefreshNotice({
    market: "FX",
    reason: "sync",
    changed: true,
    message: "已更新",
  }), {
    market: "FX",
    reason: "sync",
    changed: true,
    message: "已更新",
  });
});

test("市场数据错误统一为用户可见文本", () => {
  assert.equal(normalizeMarketDataError(new Error("网络断开")), "网络断开");
  assert.equal(normalizeMarketDataError(new Error("Failed to fetch")), "网络连接失败，请检查网络或本机数据服务后重试");
  assert.equal(normalizeMarketDataError("凭证无效"), "凭证无效");
  assert.equal(normalizeMarketDataError({}), "市场数据操作失败");
});
