import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../app/lib/fxDataContracts.ts";
import * as timeframes from "../app/lib/timeframeCatalog.ts";
import * as writeGuard from "../app/lib/marketDataWriteGuard.ts";
import * as aggregation from "../app/lib/fx/dukascopyAggregation.ts";
import * as historical from "../app/lib/fx/dukascopyClient.ts";
import * as official from "../app/lib/fx/dukascopyOfficialClient.ts";

const serviceCode = ts.transpileModule(
  readFileSync(new URL("../app/lib/fxDataService.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const migrationDir = new URL("../drizzle/", import.meta.url);
const migrations = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => readFileSync(new URL(name, migrationDir), "utf8"));
const minute = 60_000;
const epoch = (date) => Date.parse(`${date}T00:00:00Z`);

function dayCandles(date) {
  const start = epoch(date);
  const weekday = new Date(start).getUTCDay();
  const first = weekday === 0 ? 22 * 60 : 0;
  const last = weekday === 5 ? 22 * 60 : weekday === 6 ? 0 : 24 * 60;
  return Array.from({ length: last - first }, (_, index) => ({
    timestamp: start + (first + index) * minute,
    open: 1.1, high: 1.2, low: 1.0, close: 1.15, volume: 10, turnover: null,
  }));
}

function fixture(t, { pairId = "EURUSD.FX", beforeFetch, beforeRun } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const migration of migrations) sqlite.exec(migration);
  sqlite.exec(`CREATE TABLE candle_coverage (
    instrument_id TEXT NOT NULL, timeframe TEXT NOT NULL, adjustment_type TEXT NOT NULL,
    source TEXT NOT NULL, bar_count INTEGER NOT NULL, first_timestamp INTEGER NOT NULL,
    last_timestamp INTEGER NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (instrument_id, timeframe, adjustment_type, source))`);
  const requests = [];
  let gapScans = 0;
  const db = {
    prepare(sql) {
      if (sql.includes("LAG(timestamp)")) gapScans++;
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() {
          await beforeRun?.(sql, values);
          return { meta: sqlite.prepare(sql).run(...values) };
        },
      };
    },
  };
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    if (path.includes("/instruments/")) return Response.json({ code: "EUR-USD", histories: [] });
    const parts = path.split("/");
    const date = parts.slice(-3).map((value, i) => i ? value.padStart(2, "0") : value).join("-");
    assert.match(date, /^2026-08-\d{2}$/);
    requests.push(date);
    const override = await beforeFetch?.(date);
    return override ?? Response.json({ candles: dayCandles(date) });
  };
  class FixtureClient extends official.DukascopyOfficialClient {
    constructor(options) {
      super({ ...options, fetcher, serverUrl: official.DUKASCOPY_PRODUCTION_SERVER_URL,
        maxAttempts: 1, dailyRequestIntervalMs: 0 });
    }
  }
  const dependencies = {
    "./fxDataContracts.ts": contracts,
    "./timeframeCatalog.ts": timeframes,
    "./marketDataWriteGuard.ts": writeGuard,
    "./fx/dukascopyAggregation.ts": aggregation,
    "./fx/dukascopyClient.ts": historical,
    "./fx/dukascopyOfficialClient.ts": { ...official, DukascopyOfficialClient: FixtureClient },
    "./providerCredentials.ts": { loadProviderSecrets: async () => ({ secrets: {} }) },
  };
  const service = {};
  new Function("require", "exports", serviceCode)((id) => {
    if (!dependencies[id]) throw new Error(`Unexpected service dependency: ${id}`);
    return dependencies[id];
  }, service);
  const seed = (date) => {
    const candles = dayCandles(date);
    const insert = sqlite.prepare(`INSERT OR REPLACE INTO candles
      (instrument_id, timeframe, timestamp, open, high, low, close, volume, source)
      VALUES (?, '1m', ?, ?, ?, ?, ?, ?, 'dukascopy')`);
    for (const candle of candles) insert.run(pairId, candle.timestamp, candle.open,
      candle.high, candle.low, candle.close, candle.volume);
    sqlite.prepare(`INSERT OR REPLACE INTO candle_coverage
      (instrument_id, timeframe, adjustment_type, source, bar_count, first_timestamp, last_timestamp, updated_at)
      SELECT ?, '1m', 'none', 'dukascopy', COUNT(*), MIN(timestamp), MAX(timestamp), 'fixture'
      FROM candles WHERE instrument_id = ? AND timeframe = '1m'`).run(pairId, pairId);
  };
  seed("2026-08-13");
  const create = (mode = "update", endDate = "2026-08-18") => service.createFxTask(db, mode, {
    pairId, startDate: "2026-08-01", endDate, targetTimeframes: timeframes.TIMEFRAME_IDS,
  });
  const run = (id) => service.runFxTask(db, id);
  const finish = async (task) => {
    for (let count = 0; count < 10 && task.status === "queued"; count++) task = await run(task.id);
    assert.equal(task.status, "completed", `task did not finish; requested ${requests.join(", ")}`);
    return task;
  };
  return { db, sqlite, service, requests, seed, create, run, finish, gapScans: () => gapScans };
}

for (const pairId of ["EURUSD.FX", "XAUUSD.GOLD"]) {
  test(`${pairId}: a daily update advances past 23:59 and the weekend, with persisted derived candles`, async (t) => {
    const f = fixture(t, { pairId });
    let task = await f.create();
    task = await f.run(task.id);
    task = await f.run(task.id);
    assert.deepEqual(f.requests, ["2026-08-13", "2026-08-14"]);
    task = await f.finish(task);
    assert.deepEqual(f.requests, ["2026-08-13", "2026-08-14", "2026-08-16", "2026-08-17", "2026-08-18"]);
    assert.equal(f.gapScans(), 0, "daily updates must not scan historical gaps");
    const last = f.sqlite.prepare("SELECT MAX(timestamp) AS ts FROM candles WHERE instrument_id = ? AND timeframe = '1m'").get(pairId).ts;
    assert.equal(last, epoch("2026-08-19") - minute);
    const m15 = f.sqlite.prepare("SELECT volume FROM candles WHERE instrument_id = ? AND timeframe = '15m' AND timestamp = ?")
      .get(pairId, epoch("2026-08-18") + 23 * 60 * minute + 45 * minute);
    assert.equal(m15.volume, 150);
    assert.equal(JSON.parse(task.progressJson).percent, 100);
  });
}

test("429 retries resume at the failed day and retain the completed Friday and empty Saturday", async (t) => {
  let fail = true;
  const f = fixture(t, { beforeFetch: (date) => date === "2026-08-16" && fail
    ? Response.json({ error: "Too Many Requests" }, { status: 429 }) : undefined });
  let task = await f.create();
  for (let i = 0; i < 3; i++) task = await f.run(task.id);
  assert.equal(task.status, "queued", "an empty Saturday must not finish the entire update");
  const checkpoint = task.cursorJson;
  await assert.rejects(() => f.run(task.id), /429/);
  await f.service.failFxTask(f.db, task.id, new Error("HTTP 429"));
  assert.equal((await f.service.getFxTask(f.db, task.id)).cursorJson, checkpoint);
  fail = false;
  task = await f.service.patchFxTask(f.db, task.id, "retry");
  task = await f.finish(task);
  assert.deepEqual(f.requests, ["2026-08-13", "2026-08-14", "2026-08-16", "2026-08-16", "2026-08-17", "2026-08-18"]);
});

test("gap repair scans once and advances even if the provider retains a small gap", async (t) => {
  const f = fixture(t, { beforeFetch: (date) => date === "2026-08-14"
    ? Response.json({ candles: dayCandles(date).filter((candle) => candle.timestamp !== epoch(date) + 12 * 60 * minute) }) : undefined });
  f.seed("2026-08-18");
  const task = await f.finish(await f.create("repair"));
  assert.equal(task.status, "completed");
  assert.equal(f.gapScans(), 2, "scan M1 and M5 once, then continue the persisted plan");
  assert.deepEqual(f.requests, ["2026-08-13", "2026-08-14", "2026-08-16", "2026-08-17", "2026-08-18"]);
  assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM candles WHERE timeframe = '15m' AND timestamp >= ? AND timestamp < ?")
    .get(epoch("2026-08-14"), epoch("2026-08-15")).n > 0);
});

test("a failure after M1 persistence retries that day to finish the higher timeframes", async (t) => {
  let fail = true;
  const f = fixture(t, { beforeRun: (sql, values) => {
    if (fail && sql.includes("INSERT OR REPLACE INTO candles") && values[1] === "5m") {
      fail = false;
      throw new Error("fixture interrupted M5 write");
    }
  } });
  // Finish the seeded day first, then interrupt the first new day.
  let task = await f.run((await f.create()).id);
  await assert.rejects(() => f.run(task.id), /interrupted M5/);
  await f.service.failFxTask(f.db, task.id, new Error("interrupted write"));
  task = await f.service.patchFxTask(f.db, task.id, "retry");
  await f.finish(task);
  assert.deepEqual(f.requests, ["2026-08-13", "2026-08-14", "2026-08-14", "2026-08-16", "2026-08-17", "2026-08-18"]);
  assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM candles WHERE timeframe = '15m' AND timestamp >= ? AND timestamp < ?")
    .get(epoch("2026-08-14"), epoch("2026-08-15")).n > 0);
});
