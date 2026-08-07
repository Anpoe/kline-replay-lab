import assert from "node:assert/strict";
import test from "node:test";
import {
  TwelveDataApiError,
  TwelveDataRateLimitError,
  buildTwelveDataTimeSeriesUrl,
  fetchTwelveDataOneMinuteChunk,
  normalizeTwelveDataFxSymbol,
} from "../app/lib/fx/twelveDataClient.ts";
import {
  calculateTwelveDataSyncWindow,
  getLastCompletedOneMinuteTimestamp,
  normalizeTwelveDataPayload,
} from "../app/lib/fx/twelveDataNormalize.ts";

const NOW = Date.parse("2026-08-06T10:12:00Z");

function value(datetime, price) {
  return {
    datetime,
    open: String(price),
    high: String(price + 0.0004),
    low: String(price - 0.0004),
    close: String(price + 0.0001),
  };
}

test("Twelve Data URL uses FX 1m UTC parameters and the injected API key", () => {
  const url = new URL(buildTwelveDataTimeSeriesUrl({
    apiKey: "test-key",
    symbol: "EURUSD.FX",
    startDate: Date.parse("2026-08-06T09:58:00Z"),
    endDate: Date.parse("2026-08-06T10:11:00Z"),
    outputsize: 12,
  }));

  assert.equal(url.hostname, "api.twelvedata.com");
  assert.equal(url.pathname, "/time_series");
  assert.equal(url.searchParams.get("symbol"), "EUR/USD");
  assert.equal(url.searchParams.get("interval"), "1min");
  assert.equal(url.searchParams.get("timezone"), "UTC");
  assert.equal(url.searchParams.get("order"), "asc");
  assert.equal(url.searchParams.get("outputsize"), "12");
  assert.equal(url.searchParams.get("start_date"), "2026-08-06T09:58:00Z");
  assert.equal(url.searchParams.get("end_date"), "2026-08-06T10:11:00Z");
  assert.equal(url.searchParams.get("apikey"), "test-key");
  assert.equal(normalizeTwelveDataFxSymbol("usd_jpy"), "USD/JPY");
});

test("reversed values are normalized to UTC milliseconds and incomplete bars are discarded", async () => {
  let calls = 0;
  const result = await fetchTwelveDataOneMinuteChunk({
    apiKey: "test-key",
    symbol: "EUR/USD",
    now: NOW,
    startDate: "2026-08-06T10:09:00Z",
    endDate: "2026-08-06T10:12:00Z",
  }, async (url) => {
    calls += 1;
    assert.equal(new URL(String(url)).searchParams.get("timezone"), "UTC");
    return Response.json({
      status: "ok",
      meta: { symbol: "EUR/USD", interval: "1min" },
      values: [
        value("2026-08-06 10:12:00", 1.1012),
        value("2026-08-06 10:11:00", 1.1011),
        value("2026-08-06 10:10:00", 1.1010),
        value("2026-08-06 10:09:00", 1.1009),
      ],
    });
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.candles.map((candle) => candle.timestamp), [
    Date.parse("2026-08-06T10:09:00Z"),
    Date.parse("2026-08-06T10:10:00Z"),
    Date.parse("2026-08-06T10:11:00Z"),
  ]);
  assert.equal(result.candles[0].volume, null);
  assert.equal(result.candles[0].turnover, null);
  assert.equal(result.filteredUncompleted, 1);
  assert.equal(result.quality.received, 4);
  assert.equal(result.quality.accepted, 3);
  assert.equal(result.latestCompletedTimestamp, Date.parse("2026-08-06T10:11:00Z"));
});

test("normalization follows the shared quality report semantics for duplicates and invalid OHLC", () => {
  const result = normalizeTwelveDataPayload({
    values: [
      value("2026-08-06 10:10:00", 1.1),
      { ...value("2026-08-06 10:10:00", 1.2), close: "1.2001" },
      { ...value("2026-08-06 10:11:00", 1.3), low: "1.4" },
    ],
  }, { now: NOW });

  assert.equal(result.candles.length, 1);
  assert.equal(result.candles[0].close, 1.2001);
  assert.equal(result.report.received, 3);
  assert.equal(result.report.accepted, 1);
  assert.equal(result.report.invalid, 1);
  assert.equal(result.report.duplicates, 1);
});

test("an empty values response is a successful empty chunk", async () => {
  const result = await fetchTwelveDataOneMinuteChunk({
    apiKey: "test-key",
    symbol: "GBPUSD",
    now: NOW,
    startDate: "2026-08-06T10:00:00Z",
    endDate: "2026-08-06T10:11:00Z",
  }, async () => Response.json({ status: "ok", meta: { symbol: "GBP/USD" }, values: [] }));

  assert.deepEqual(result.candles, []);
  assert.equal(result.complete, true);
  assert.equal(result.quality.received, 0);
});

test("HTTP and body-level provider errors are surfaced without real retries", async () => {
  await assert.rejects(
    () => fetchTwelveDataOneMinuteChunk({ apiKey: "bad", symbol: "EUR/USD", now: NOW }, async () => (
      Response.json({ status: "error", code: 401, message: "Invalid API key" }, { status: 401 })
    )),
    (error) => {
      assert.ok(error instanceof TwelveDataApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, 401);
      assert.equal(error.rateLimited, false);
      assert.match(error.message, /Invalid API key/);
      return true;
    },
  );

  await assert.rejects(
    () => fetchTwelveDataOneMinuteChunk({ apiKey: "test-key", symbol: "EUR/USD", now: NOW }, async () => (
      new Response(JSON.stringify({ status: "error", code: 429, message: "Rate limit exceeded" }), {
        status: 200,
        headers: { "content-type": "application/json", "retry-after": "3" },
      })
    )),
    (error) => {
      assert.ok(error instanceof TwelveDataRateLimitError);
      assert.equal(error.rateLimited, true);
      assert.equal(error.retryAfterMs, 3000);
      return true;
    },
  );
});

test("history boundary protects Dukascopy bars while exposing overlap for read-only comparison", async () => {
  const window = calculateTwelveDataSyncWindow({
    now: NOW,
    historyBoundary: Date.parse("2026-08-06T10:08:00Z"),
    lastCompletedTimestamp: Date.parse("2026-08-06T10:08:00Z"),
    overlapBars: 2,
  });
  assert.equal(window.requestStartTimestamp, Date.parse("2026-08-06T10:06:00Z"));
  assert.equal(window.writeFromTimestamp, Date.parse("2026-08-06T10:09:00Z"));

  let capturedUrl = "";
  const result = await fetchTwelveDataOneMinuteChunk({
    apiKey: "test-key",
    symbol: "EUR/USD",
    now: NOW,
    historyBoundary: Date.parse("2026-08-06T10:08:00Z"),
    lastCompletedTimestamp: Date.parse("2026-08-06T10:08:00Z"),
    overlapBars: 2,
  }, async (url) => {
    capturedUrl = String(url);
    return Response.json({
      values: [
        value("2026-08-06 10:09:00", 1.1009),
        value("2026-08-06 10:08:00", 1.1008),
        value("2026-08-06 10:07:00", 1.1007),
        value("2026-08-06 10:06:00", 1.1006),
      ],
    });
  });

  const url = new URL(capturedUrl);
  assert.equal(url.searchParams.get("start_date"), "2026-08-06T10:06:00Z");
  assert.equal(url.searchParams.get("end_date"), "2026-08-06T10:11:00Z");
  assert.deepEqual(result.overlapCandles.map((candle) => candle.timestamp), [
    Date.parse("2026-08-06T10:06:00Z"),
    Date.parse("2026-08-06T10:07:00Z"),
    Date.parse("2026-08-06T10:08:00Z"),
  ]);
  assert.deepEqual(result.candles.map((candle) => candle.timestamp), [
    Date.parse("2026-08-06T10:09:00Z"),
  ]);
  assert.equal(result.writeFromTimestamp, Date.parse("2026-08-06T10:09:00Z"));
});

test("a full page returns a date cursor for the next request", async () => {
  const result = await fetchTwelveDataOneMinuteChunk({
    apiKey: "test-key",
    symbol: "USD/JPY",
    now: NOW,
    startDate: "2026-08-06T10:09:00Z",
    endDate: "2026-08-06T10:11:00Z",
    outputsize: 2,
  }, async () => Response.json({
    values: [
      value("2026-08-06 10:09:00", 150.1),
      value("2026-08-06 10:10:00", 150.2),
    ],
  }));

  assert.deepEqual(result.cursor, { nextStartDate: "2026-08-06T10:11:00Z" });
  assert.equal(result.complete, false);
});

test("no API call is made for a window entirely after the last completed bar", async () => {
  let calls = 0;
  const result = await fetchTwelveDataOneMinuteChunk({
    apiKey: "test-key",
    symbol: "EUR/USD",
    now: NOW,
    startDate: "2026-08-06T10:12:00Z",
    endDate: "2026-08-06T10:15:00Z",
  }, async () => {
    calls += 1;
    throw new Error("should not call fetcher");
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.candles, []);
  assert.equal(result.complete, true);
  assert.equal(getLastCompletedOneMinuteTimestamp(NOW), Date.parse("2026-08-06T10:11:00Z"));
});
