import assert from "node:assert/strict";
import test from "node:test";
import {
  AlpacaApiError,
  fetchAlpacaMultiSymbolChunk,
  fetchProviderChunk,
  filterTradableUsAssets,
  normalizeAlpacaBars,
  normalizeTusharePayload,
  validateCandles,
} from "../app/lib/marketDataProviders.ts";

test("Tushare daily 仍保留为不复权旧接口并换算 A 股成交量单位", () => {
  const result = normalizeTusharePayload({
    code: 0,
    data: {
      fields: ["trade_date", "open", "high", "low", "close", "vol", "amount"],
      items: [["20260910", 10, 12, 9, 11, 100, 200]],
    },
  }, "1d");
  assert.equal(result.candles.length, 1);
  assert.equal(result.candles[0].volume, 10000);
  assert.equal(result.candles[0].turnover, 200000);
  assert.equal(result.report.accepted, 1);
});

test("Tushare 旧接口支持按时间游标逐批读取", async () => {
  let body;
  const result = await fetchProviderChunk({
    provider: "tushare",
    vendorSymbol: "000001.SZ",
    timeframe: "1d",
    startDate: "2026-01-01",
    endDate: "2026-01-02",
    cursor: {},
  }, { tushareToken: "local-token" }, async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({
      code: 0,
      data: {
        fields: ["trade_date", "open", "high", "low", "close", "vol", "amount"],
        items: [["20260101", 10, 12, 9, 11, 100, 200]],
      },
    });
  });
  assert.equal(body.api_name, "daily");
  assert.equal(body.token, "local-token");
  assert.equal(body.params.ts_code, "000001.SZ");
  assert.equal(result.source, "tushare");
  assert.equal(result.complete, true);
  assert.equal(result.candles.length, 1);
});

test("Alpaca 美股目录兼容官方 class 字段和旧 asset_class 字段", () => {
  const assets = filterTradableUsAssets([
    { symbol: "AAPL", class: "us_equity", status: "active", tradable: true },
    { symbol: "MSFT", asset_class: "us_equity", status: "active", tradable: true },
    { symbol: "OLD", class: "us_equity", status: "inactive", tradable: true },
    { symbol: "LOCKED", class: "us_equity", status: "active", tradable: false },
  ]);
  assert.deepEqual(assets.map((asset) => asset.symbol), ["AAPL", "MSFT"]);
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

test("Alpaca 多品种日线请求按 symbols 返回并保留分页游标", async () => {
  let capturedUrl = "";
  const result = await fetchAlpacaMultiSymbolChunk({
    symbols: ["AAPL", "MSFT"],
    timeframe: "1d",
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    feed: "iex",
    limit: 10000,
  }, {
    alpacaKeyId: "local-key",
    alpacaSecretKey: "local-secret",
  }, async (url) => {
    capturedUrl = String(url);
    return Response.json({
      bars: {
        AAPL: [{ t: "2026-08-03T04:00:00Z", o: 10, h: 12, l: 9, c: 11, v: 100 }],
        MSFT: [{ t: "2026-08-03T04:00:00Z", o: 20, h: 22, l: 19, c: 21, v: 200 }],
      },
      next_page_token: "page-2",
    });
  });

  const url = new URL(capturedUrl);
  assert.equal(url.pathname, "/v2/stocks/bars");
  assert.equal(url.searchParams.get("symbols"), "AAPL,MSFT");
  assert.equal(url.searchParams.get("timeframe"), "1Day");
  assert.equal(url.searchParams.get("feed"), "iex");
  assert.equal(url.searchParams.get("limit"), "10000");
  assert.equal(url.searchParams.get("adjustment"), "all");
  assert.deepEqual([...result.candlesBySymbol.keys()], ["AAPL", "MSFT"]);
  assert.equal(result.candlesBySymbol.get("MSFT")[0].close, 21);
  assert.deepEqual(result.cursor, { pageToken: "page-2", feed: "iex" });
  assert.equal(result.complete, false);
});

test("Alpaca 响应体读取卡住时也会触发请求超时", async () => {
  let aborted = false;
  const request = fetchAlpacaMultiSymbolChunk({
    symbols: ["AAPL"],
    timeframe: "1d",
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    feed: "sip",
    limit: 10000,
  }, {
    alpacaKeyId: "local-key",
    alpacaSecretKey: "local-secret",
  }, async (_url, init) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new AlpacaApiError("响应体读取超时", 400));
      }, { once: true });
    }),
  }), { timeoutMs: 10 });

  await assert.rejects(Promise.race([
    request,
    new Promise((_, reject) => setTimeout(() => reject(new Error("响应体超时未生效")), 100)),
  ]), /响应体读取超时/);
  assert.equal(aborted, true);
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
  assert.equal(url.searchParams.get("feed"), "sip");
  assert.equal(url.searchParams.get("page_token"), "next-token");
  assert.equal(capturedHeaders["APCA-API-KEY-ID"], "local-key");
  assert.deepEqual(result.cursor, { pageToken: "page-2", feed: "sip" });
  assert.equal(result.complete, false);
  assert.equal(result.source, "alpaca-sip");
});

test("Alpaca SIP 权限失败时直接暴露错误，不回退到 IEX", async () => {
  const feeds = [];
  await assert.rejects(() => fetchProviderChunk({
    provider: "alpaca",
    vendorSymbol: "ACT",
    timeframe: "1d",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    cursor: {},
  }, {
    alpacaKeyId: "local-key",
    alpacaSecretKey: "local-secret",
  }, async (url) => {
    feeds.push(new URL(String(url)).searchParams.get("feed"));
    return Response.json({ message: "subscription does not permit querying recent SIP data" }, { status: 403 });
  }), /subscription does not permit querying recent SIP data/);

  assert.deepEqual(feeds, ["sip"]);
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
