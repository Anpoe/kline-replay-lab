import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchProviderChunk,
  filterTradableUsAssets,
  normalizeAlpacaBars,
  normalizeTusharePayload,
  validateCandles,
} from "../app/lib/marketDataProviders.ts";

test("Alpaca 美股目录兼容官方 class 字段和旧 asset_class 字段", () => {
  const assets = filterTradableUsAssets([
    { symbol: "AAPL", class: "us_equity", status: "active", tradable: true },
    { symbol: "MSFT", asset_class: "us_equity", status: "active", tradable: true },
    { symbol: "OLD", class: "us_equity", status: "inactive", tradable: true },
    { symbol: "LOCKED", class: "us_equity", status: "active", tradable: false },
  ]);
  assert.deepEqual(assets.map((asset) => asset.symbol), ["AAPL", "MSFT"]);
});

test("Tushare 日线被标准化、排序，并把手和千元转换为股和元", () => {
  const result = normalizeTusharePayload({
    code: 0,
    data: {
      fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
      items: [
        ["600519.SH", "20260106", 101, 105, 99, 103, 12, 34],
        ["600519.SH", "20260105", 100, 103, 98, 101, 10, 30],
      ],
    },
  }, "1d");

  assert.equal(result.candles.length, 2);
  assert.ok(result.candles[0].timestamp < result.candles[1].timestamp);
  assert.equal(result.candles[0].volume, 1000);
  assert.equal(result.candles[0].turnover, 30000);
  assert.equal(result.report.invalid, 0);
});

test("Alpaca bars 去重并排除 OHLC 不合法的数据", () => {
  const result = normalizeAlpacaBars({
    bars: [
      { t: "2026-01-05T14:30:00Z", o: 10, h: 12, l: 9, c: 11, v: 100 },
      { t: "2026-01-05T14:30:00Z", o: 10, h: 13, l: 9, c: 12, v: 120 },
      { t: "2026-01-05T14:35:00Z", o: 10, h: 9, l: 8, c: 11, v: 90 },
    ],
  });

  assert.equal(result.candles.length, 1);
  assert.equal(result.candles[0].close, 12);
  assert.equal(result.report.duplicates, 1);
  assert.equal(result.report.invalid, 1);
});

test("通用校验按时间升序输出", () => {
  const result = validateCandles([
    { timestamp: 2, open: 2, high: 3, low: 1, close: 2, volume: null, turnover: null },
    { timestamp: 1, open: 2, high: 3, low: 1, close: 2, volume: null, turnover: null },
  ]);
  assert.deepEqual(result.candles.map((bar) => bar.timestamp), [1, 2]);
});

test("Alpaca 下载使用免费历史行情接口、认证头和分页游标", async () => {
  let capturedUrl = "";
  let capturedHeaders;
  const result = await fetchProviderChunk({
    provider: "alpaca",
    vendorSymbol: "AAPL",
    timeframe: "5m",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    cursor: { pageToken: "next-token" },
  }, {
    alpacaKeyId: "local-key",
    alpacaSecretKey: "local-secret",
  }, async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = init?.headers;
    return Response.json({
      bars: [{ t: "2026-01-05T14:30:00Z", o: 10, h: 12, l: 9, c: 11, v: 100 }],
      next_page_token: "page-2",
    });
  });

  const url = new URL(capturedUrl);
  assert.equal(url.hostname, "data.alpaca.markets");
  assert.equal(url.pathname, "/v2/stocks/AAPL/bars");
  assert.equal(url.searchParams.get("timeframe"), "5Min");
  assert.equal(url.searchParams.get("feed"), "iex");
  assert.equal(url.searchParams.get("page_token"), "next-token");
  assert.equal(capturedHeaders["APCA-API-KEY-ID"], "local-key");
  assert.deepEqual(result.cursor, { pageToken: "page-2" });
  assert.equal(result.complete, false);
});

test("数据源缺少本地凭证时不会发出网络请求", async () => {
  await assert.rejects(() => fetchProviderChunk({
    provider: "alpaca",
    vendorSymbol: "AAPL",
    timeframe: "1d",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    cursor: {},
  }, {}, async () => {
    throw new Error("不应调用");
  }), /APCA_API_KEY_ID/);
});
