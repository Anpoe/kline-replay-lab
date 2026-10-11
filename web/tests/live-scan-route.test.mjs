import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as patterns from "../app/lib/patternFilters.ts";
import * as lookback from "../app/lib/liveScanLookback.mjs";

const source = ts.transpileModule(readFileSync(new URL("../app/api/live-scan/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function createRoute(t, localFetch) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE instruments (id TEXT, symbol TEXT, name TEXT, market TEXT);
    CREATE TABLE candle_coverage (instrument_id TEXT, timeframe TEXT, bar_count INTEGER, source TEXT, adjustment_type TEXT, last_timestamp INTEGER);
    CREATE TABLE candles (instrument_id TEXT, timeframe TEXT, adjustment_type TEXT, timestamp INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, turnover REAL);`);
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    const bound = (args) => ({ async all() { return { results: statement.all(...args) }; } });
    return { ...bound([]), bind(...args) { return bound(args); } };
  } };
  const route = {};
  const require = (id) => {
    if (id === "../../../db/runtime") return { ensureSchema: async () => {}, getRawDb: () => db };
    if (id === "../../lib/localDataService") return { fetchLocalData: localFetch };
    if (id === "../../lib/patternFilters") return patterns;
    if (id === "../../lib/liveScanLookback.mjs") return lookback;
    if (id === "../../lib/liveExecutionAdapter") return {};
    throw new Error(`Unexpected dependency: ${id}`);
  };
  new Function("require", "exports", source)(require, route);
  return { route, sqlite };
}

const post = (route, body) => route.POST(new Request("http://localhost/api/live-scan", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

function seed(sqlite) {
  const days = [Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 8), Date.UTC(2026, 9, 9)];
  for (const [id, prices] of [["AAPL", [10, 11, 10]], ["MSFT", [10, 10, 10]]]) {
    sqlite.prepare("INSERT INTO instruments VALUES (?, ?, ?, 'US')").run(id, id, id);
    sqlite.prepare("INSERT INTO candle_coverage VALUES (?, '1d', 3, 'alpaca-sip', 'all', ?)").run(id, days[2]);
    prices.forEach((price, index) => sqlite.prepare("INSERT INTO candles VALUES (?, '1d', 'all', ?, ?, ?, ?, ?, 100, 1000)")
      .run(id, days[index], price, price + 1, price - 1, price));
  }
  return days;
}

test("US route finds historical full-filter hits but returns latest market prices", async (t) => {
  const { route, sqlite } = createRoute(t);
  const days = seed(sqlite);
  const request = { market: "US", filters: { minPrice: 11, minChangePct: 9 }, limit: 0 };
  assert.equal((await (await post(route, request)).json()).matchedCount, 0);
  const response = await (await post(route, { ...request, lookbackDays: 2 })).json();
  assert.equal(response.lookbackDays, 2);
  assert.equal(response.matchedCount, 1);
  assert.equal(response.results[0].instrumentId, "AAPL");
  assert.equal(response.results[0].matchedTimestamp, days[1]);
  assert.equal(response.results[0].lagTradingDays, 1);
  assert.equal(response.results[0].timestamp, days[2]);
  assert.equal(response.results[0].close, 10);
  assert.ok(response.results[0].changePct < 0);
});

test("CN route forwards normalized lookback to the installed local service", async (t) => {
  let request;
  const { route } = createRoute(t, async (url, init) => {
    assert.equal(url, "/scan/latest");
    request = JSON.parse(init.body);
    return Response.json({ market: "CN", latestTimestamp: 1, lookbackDays: request.lookbackDays, results: [] });
  });
  const response = await post(route, { market: "CN", lookbackDays: 100 });
  assert.equal(response.status, 200);
  assert.equal(request.lookbackDays, 60);
  await post(route, { market: "CN" });
  assert.equal(request.lookbackDays, 1);
});

test("US route evaluates selected patterns on the historical signal day", async (t) => {
  const { route, sqlite } = createRoute(t);
  const days = seed(sqlite);
  sqlite.prepare("UPDATE candles SET open = 10, high = 11, low = 7 WHERE instrument_id = 'AAPL' AND timestamp = ?").run(days[1]);
  const preset = patterns.defaultPatternPresets.find((candidate) => candidate.kind === "long_lower_wick");
  const response = await (await post(route, {
    market: "US", presets: [preset], presetIds: [preset.id], lookbackDays: 2,
  })).json();
  assert.equal(response.matchedCount, 1);
  assert.equal(response.results[0].matchedTimestamp, days[1]);
  assert.deepEqual(response.results[0].presetIds, [preset.id]);
  assert.equal(response.results[0].close, 10);
});

test("a running local service without lookback support asks for restart instead of silently scanning one day", async (t) => {
  const { route } = createRoute(t, async () => Response.json({ market: "CN", results: [] }));
  const response = await post(route, { market: "CN", lookbackDays: 5 });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /重启程序/);
  assert.equal((await post(route, { market: "CN" })).status, 200);
});
