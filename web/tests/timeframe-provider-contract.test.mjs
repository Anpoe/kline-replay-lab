import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAlpacaMultiSymbolUrl,
  fetchProviderChunk,
  resolveProviderSourceTimeframe,
} from "../app/lib/marketDataProviders.ts";
import { TIMEFRAME_IDS } from "../app/lib/timeframeCatalog.ts";

test("provider contract carries every catalog timeframe without changing its order", () => {
  assert.deepEqual([...TIMEFRAME_IDS], ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"]);
});

test("derived data-job targets resolve to a smaller direct provider timeframe", () => {
  assert.equal(resolveProviderSourceTimeframe("tushare", "15m"), "5m");
  assert.equal(resolveProviderSourceTimeframe("alpaca", "30m"), "5m");
  assert.equal(resolveProviderSourceTimeframe("alpaca", "4h"), "1h");
  assert.equal(resolveProviderSourceTimeframe("tushare", "1mo"), "1d");
  assert.equal(resolveProviderSourceTimeframe("tushare", "1d"), "1d");
});

test("data-job execution aggregates provider candles into derived targets", async () => {
  const source = await readFile(new URL("../app/api/data-jobs/run/route.ts", import.meta.url), "utf8");

  assert.match(source, /resolveProviderSourceTimeframe\(job\.provider, job\.timeframe\)/);
  assert.match(source, /aggregateCandlesToTimeframe\([\s\S]*?sourceChunk\.candles[\s\S]*?job\.timeframe/);
});

test("Alpaca rejects a derived timeframe instead of sending an undefined provider interval", () => {
  assert.throws(() => buildAlpacaMultiSymbolUrl({
    symbols: ["AAPL"],
    timeframe: "15m",
    startDate: "2026-01-01",
    endDate: "2026-01-02",
    feed: "sip",
  }), /Alpaca.*支持.*15m/);
});

test("Tushare rejects monthly direct download before invoking the network", async () => {
  await assert.rejects(() => fetchProviderChunk({
    provider: "tushare",
    vendorSymbol: "600519.SH",
    timeframe: "1mo",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    cursor: {},
  }, { tushareToken: "token" }, async () => {
    throw new Error("network should not be called");
  }), /Tushare.*支持.*1mo/);
});
