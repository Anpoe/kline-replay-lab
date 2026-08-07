import assert from "node:assert/strict";
import test from "node:test";
import {
  DUKASCOPY_WIDGET_CONFIG_URL,
  DukascopyOfficialClient,
  formatDukascopyCsv,
} from "../app/lib/fx/dukascopyOfficialClient.ts";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const firstMinute = Date.UTC(2026, 0, 5);

function instrumentPayload() {
  return {
    code: "EUR/USD",
    histories: [{ period: "MINUTE", from: firstMinute }],
  };
}

function candlePayload() {
  return {
    timestamp: firstMinute,
    shift: 1,
    multiplier: 0.0001,
    open: 1.1,
    high: 1.1,
    low: 1.1,
    close: 1.1,
    times: [0, 60_000, 240_000],
    opens: [0, 1, 1],
    highs: [5, 2, 1],
    lows: [-1, 0, -2],
    closes: [1, 0, -1],
    volumes: [1, 2, 3],
  };
}

test("official client resolves Jetta config, decodes delta candles, and reuses the CSV parser", async () => {
  const requested = [];
  const fetcher = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed.toString());
    if (parsed.pathname === "/en/config.json") {
      return jsonResponse({ JETTA_SERVER_URL: "https://jetta.test.dukascopy.com" });
    }
    if (parsed.pathname === "/v1/instruments/EUR-USD") return jsonResponse(instrumentPayload());
    if (parsed.pathname === "/v1/candles/minute/EUR-USD/BID/2026/1/5") return jsonResponse(candlePayload());
    return jsonResponse({ error: "not found" }, 404);
  };

  const client = new DukascopyOfficialClient({ fetcher });
  const result = await client.downloadAndParseCsv({
    instrument: "EURUSD",
    start: "2026-01-05",
    end: "2026-01-05",
    timeframe: "1m",
  });

  assert.equal(requested[0], `${DUKASCOPY_WIDGET_CONFIG_URL}`);
  assert.equal(result.availableFrom, firstMinute);
  assert.equal(result.report.accepted, 3);
  assert.deepEqual(result.candles.map((candle) => candle.timestamp), [
    firstMinute,
    firstMinute + 60_000,
    firstMinute + 300_000,
  ]);
  assert.equal(result.candles[1].open, 1.1001);
  assert.equal(result.candles[0].volume, 1_000_000);
});

test("official client reports an empty range instead of treating pre-history as a provider failure", async () => {
  const requested = [];
  const client = new DukascopyOfficialClient({
    serverUrl: "https://jetta.dukascopy.com",
    fetcher: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed.pathname);
      if (parsed.pathname === "/v1/instruments/EUR-USD") return jsonResponse(instrumentPayload());
      return jsonResponse({ error: "not found" }, 404);
    },
  });

  const result = await client.downloadAndParseCsv({
    instrument: "EURUSD",
    start: "2000-01-01",
    end: "2000-01-31",
    timeframe: "1m",
  });

  assert.equal(result.candles.length, 0);
  assert.equal(result.report.accepted, 0);
  assert.equal(result.availableFrom, firstMinute);
  assert.deepEqual(requested, ["/v1/instruments/EUR-USD"]);
});

test("formats the built-in adapter result as a normal CSV response", () => {
  const csv = formatDukascopyCsv([{
    timestamp: firstMinute,
    open: 1.1,
    high: 1.2,
    low: 1,
    close: 1.15,
    volume: null,
    turnover: null,
  }]);
  assert.equal(csv, "timestamp,open,high,low,close,volume\n1767571200000,1.1,1.2,1,1.15,\n");
});

test("official client prefers production when widget config advertises a test host", async () => {
  const requested = [];
  const client = new DukascopyOfficialClient({
    timeoutMs: 20,
    fetcher: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed.toString());
      if (parsed.pathname === "/en/config.json") {
        return jsonResponse({ JETTA_SERVER_URL: "https://jetta.test.dukascopy.com" });
      }
      if (parsed.hostname === "jetta.test.dukascopy.com") throw new Error("Network connection lost.");
      if (parsed.pathname === "/v1/instruments/EUR-USD") return jsonResponse(instrumentPayload());
      if (parsed.pathname === "/v1/candles/minute/EUR-USD/BID/2026/1/5") return jsonResponse(candlePayload());
      return jsonResponse({ error: "not found" }, 404);
    },
  });

  const result = await client.downloadAndParseCsv({
    instrument: "EURUSD",
    start: "2026-01-05",
    end: "2026-01-05",
  });

  assert.equal(result.report.accepted, 3);
  assert.ok(!requested.some((url) => url.includes("jetta.test.dukascopy.com/v1/instruments/EUR-USD")));
  assert.ok(requested.some((url) => url.includes("jetta.dukascopy.com/v1/instruments/EUR-USD")));
  assert.ok(requested.some((url) => url.includes("/v1/candles/minute/EUR-USD/BID/2026/1/5")));
});

test("official client automatically retries a transient daily download failure", async () => {
  let candleAttempts = 0;
  const client = new DukascopyOfficialClient({
    serverUrl: "https://jetta.dukascopy.com",
    maxAttempts: 2,
    retryBaseDelayMs: 0,
    dailyConcurrency: 1,
    fetcher: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/v1/instruments/EUR-USD") return jsonResponse(instrumentPayload());
      if (parsed.pathname === "/v1/candles/minute/EUR-USD/BID/2026/1/5") {
        candleAttempts += 1;
        if (candleAttempts === 1) throw new Error("Network connection lost.");
        return jsonResponse(candlePayload());
      }
      return jsonResponse({ error: "not found" }, 404);
    },
  });

  const result = await client.downloadAndParseCsv({
    instrument: "EURUSD",
    start: "2026-01-05",
    end: "2026-01-05",
  });

  assert.equal(candleAttempts, 2);
  assert.equal(result.report.accepted, 3);
});

test("official client reuses successful instrument metadata across task chunks", async () => {
  let instrumentRequests = 0;
  const client = new DukascopyOfficialClient({
    serverUrl: "https://jetta.dukascopy.com",
    fetcher: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/v1/instruments/EUR-USD") {
        instrumentRequests += 1;
        return jsonResponse(instrumentPayload());
      }
      if (parsed.pathname.startsWith("/v1/candles/minute/EUR-USD/BID/2026/1/")) {
        return jsonResponse(candlePayload());
      }
      return jsonResponse({ error: "not found" }, 404);
    },
  });

  await client.downloadAndParseCsv({ instrument: "EURUSD", start: "2026-01-05", end: "2026-01-05" });
  await client.downloadAndParseCsv({ instrument: "EURUSD", start: "2026-01-06", end: "2026-01-06" });

  assert.equal(instrumentRequests, 1);
});

test("official client limits daily concurrency and keeps candles ordered", async () => {
  let activeDownloads = 0;
  let maximumActiveDownloads = 0;
  const client = new DukascopyOfficialClient({
    serverUrl: "https://jetta.dukascopy.com",
    dailyConcurrency: 2,
    fetcher: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/v1/instruments/EUR-USD") return jsonResponse(instrumentPayload());
      if (parsed.pathname.startsWith("/v1/candles/minute/EUR-USD/BID/2026/1/")) {
        activeDownloads += 1;
        maximumActiveDownloads = Math.max(maximumActiveDownloads, activeDownloads);
        await new Promise((resolve) => setTimeout(resolve, parsed.pathname.endsWith("/5") ? 12 : 2));
        activeDownloads -= 1;
        const day = Number(parsed.pathname.split("/").at(-1));
        return jsonResponse({
          data: [{
            timestamp: Date.UTC(2026, 0, day),
            open: 1.1,
            high: 1.2,
            low: 1,
            close: 1.15,
            volume: 1,
          }],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    },
  });

  const result = await client.downloadAndParseCsv({
    instrument: "EURUSD",
    start: "2026-01-05",
    end: "2026-01-07",
  });

  assert.equal(maximumActiveDownloads, 2);
  assert.deepEqual(result.candles.map((candle) => candle.timestamp), [
    Date.UTC(2026, 0, 5),
    Date.UTC(2026, 0, 6),
    Date.UTC(2026, 0, 7),
  ]);
});
