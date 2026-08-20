import assert from "node:assert/strict";
import test from "node:test";

import { createLiveGateway } from "../app/features/live/liveGateway.ts";

function response({ ok = true, payload = {} } = {}) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test("preserves live-state load and incremental-save request contracts", async () => {
  const requests = [];
  const gateway = createLiveGateway(async (input, init) => {
    requests.push({ input, init });
    return response({ payload: input === "/api/live-state" && !init?.method
      ? { portfolios: [], watchlist: [] }
      : { portfolioSkipped: 1, watchSkipped: 0 } });
  });
  const delta = {
    portfolioUpserts: [{ instrumentId: "AAPL.US" }],
    portfolioDeletes: [],
    watchlistUpserts: [],
    watchlistDeletes: [],
  };

  assert.deepEqual(await gateway.loadState(), { portfolios: [], watchlist: [] });
  assert.deepEqual(await gateway.saveState(delta), { portfolioSkipped: 1, watchSkipped: 0 });
  assert.deepEqual(requests[0], { input: "/api/live-state", init: { cache: "no-store" } });
  assert.deepEqual(requests[1], {
    input: "/api/live-state",
    init: {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(delta),
    },
  });
});

test("preserves scan and latest-price refresh payloads", async () => {
  const requests = [];
  const gateway = createLiveGateway(async (input, init) => {
    requests.push({ input, init });
    return response({ payload: input === "/api/live-scan" && !JSON.parse(init?.body ?? "{}").action
      ? { market: "CN", latestTimestamp: 1, scannedCount: 2, matchedCount: 1, results: [] }
      : { prices: [{ instrumentId: "600519.SH", timestamp: 2, open: 1, close: 1.1 }] } });
  });
  const scanRequest = { market: "CN", presetIds: [], filters: {}, sort: "turnover", limit: 100 };

  assert.equal((await gateway.scan(scanRequest)).matchedCount, 1);
  assert.deepEqual(await gateway.refreshPrices("CN", ["600519.SH"]), {
    prices: [{ instrumentId: "600519.SH", timestamp: 2, open: 1, close: 1.1 }],
  });
  assert.deepEqual(requests[0], {
    input: "/api/live-scan",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scanRequest),
    },
  });
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    action: "refresh",
    market: "CN",
    instrumentIds: ["600519.SH"],
  });
});

test("normalizes live gateway errors", async () => {
  const gateway = createLiveGateway(async () => response({ ok: false, payload: { error: "offline" } }));

  await assert.rejects(() => gateway.loadState(), { message: "读取实盘数据失败" });
  await assert.rejects(() => gateway.saveState({}), { message: "保存实盘数据失败" });
  await assert.rejects(() => gateway.scan({}), { message: "offline" });
  await assert.rejects(() => gateway.refreshPrices("US", []), { message: "offline" });
});
