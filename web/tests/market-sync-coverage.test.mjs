import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as sync from "../app/lib/marketSync.ts";
import * as coordinator from "../app/lib/marketSyncWorkerCoordinator.ts";

const source = ts.transpileModule(readFileSync(new URL("../app/lib/marketSyncService.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const mode of ["reconcile", "download"]) test(`美股 ${mode} 按任务和品种索引结算，不扫描全部历史任务和覆盖记录`, async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  sqlite.exec(`CREATE TABLE candle_coverage (
    instrument_id TEXT NOT NULL, timeframe TEXT NOT NULL, adjustment_type TEXT NOT NULL,
    source TEXT NOT NULL, bar_count INTEGER NOT NULL, first_timestamp INTEGER NOT NULL,
    last_timestamp INTEGER NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (instrument_id, timeframe, adjustment_type, source))`);
  const queries = [];
  const executions = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { executions.push({ sql, values }); return { meta: sqlite.prepare(sql).run(...values) }; },
      };
    },
    async batch(statements) { return await Promise.all(statements.map(statement => statement.run())); },
  };
  const timestamp = "2026-10-15T00:00:00.000Z";
  sqlite.prepare(`INSERT INTO market_sync_runs
    (id,market,mode,status,feed,start_date,end_date,latest_session,created_at,updated_at)
    VALUES ('run','US','update','running','sip','2026-10-14','2026-10-15','2026-10-15',?,?)`).run(timestamp,timestamp);
  sqlite.prepare(`INSERT INTO market_sync_batches
    (id,run_id,batch_no,symbols_json,start_date,end_date,session_count,estimated_points,url_length,feed,status,created_at,updated_at)
    VALUES ('batch','run',1,'[]','2026-10-14','2026-10-15',2,10,100,'sip','completed',?,?)`).run(timestamp,timestamp);
  const variants = [
    ["sip", "1d", "all", "alpaca-sip", 2, "completed"],
    ["iex", "1d", "all", "alpaca-iex", 2, "completed"],
    ["raw", "1d", "none", "alpaca-sip", 2, "no_data"],
    ["intraday", "5m", "all", "alpaca-sip", 2, "no_data"],
    ["other", "1d", "all", "import", 2, "no_data"],
    ["empty", "1d", "all", "alpaca-sip", 0, "no_data"],
  ];
  for (const [id,timeframe,adjustment,provider,count] of variants) {
    sqlite.prepare("INSERT INTO instruments (id,symbol,name,market,timezone,price_precision) VALUES (?,?,?,'US','America/New_York',2)").run(id,id,id);
    sqlite.prepare(`INSERT INTO candle_coverage VALUES (?,?,?,?,?,0,1,?)`).run(id,timeframe,adjustment,provider,count,timestamp);
    sqlite.prepare(`INSERT INTO data_download_jobs
      (id,provider,instrument_id,vendor_symbol,instrument_name,market,timeframe,start_date,end_date,status,sync_run_id,sync_batch_id,created_at,updated_at)
      VALUES (?,'alpaca',?, ?,?,'US','1d','2026-10-14','2026-10-15','running','run','batch',?,?)`).run(id,id,id,id,timestamp,timestamp);
  }
  if (mode === "download") {
    sqlite.prepare("UPDATE market_sync_batches SET status='queued', symbols_json=?").run(JSON.stringify(variants.map(row => row[0])));
    sqlite.prepare("INSERT INTO market_sync_locks (market,run_id,lease_token,expires_at,updated_at) VALUES ('US','run','token','2099-01-01',?)").run(timestamp);
  }
  const dependencies = {
    "../../db/runtime": { ensureSchema: async () => {}, getRawDb: () => db },
    "./marketDataWriteGuard": { withMarketDataWrite: async (_market,work) => work() },
    "./marketDataProviders": { fetchAlpacaMultiSymbolChunk: async () => ({ candlesBySymbol: new Map(), source: "alpaca-sip", cursor: {} }) },
    "./marketSync": sync,
    "./providerCredentials": { loadProviderSecrets: async () => ({ secrets: { alpacaKeyId: "test", alpacaSecretKey: "test" } }) },
    "./marketSyncWorkerCoordinator.ts": coordinator,
    "./usMarketSessions": {},
    "./legacyUsData.ts": {},
  };
  const service = {};
  new Function("require","exports",source)(id => {
    assert.ok(dependencies[id], `Unexpected dependency ${id}`);
    return dependencies[id];
  },service);
  const result = await service.processNextMarketSyncBatch("run");
  assert.equal(result.run.status,"completed");
  assert.equal(result.run.completedSymbols,variants.length);
  for (const [id,,,,,status] of variants) {
    const row = sqlite.prepare("SELECT status,terminal_reason FROM data_download_jobs WHERE id=?").get(id);
    assert.equal(row.status,status);
    assert.equal(row.terminal_reason,status === "completed" ? null : "no_bars_returned");
  }
  const reconciliation = queries.find(sql => sql.startsWith("UPDATE data_download_jobs SET status = CASE"));
  assert.ok(reconciliation);
  const plan = sqlite.prepare("EXPLAIN QUERY PLAN " + reconciliation).all(timestamp,"run","run");
  assert.ok(plan.some(row => /SEARCH c USING INDEX/.test(row.detail)), JSON.stringify(plan));
  assert.ok(!plan.some(row => /SCAN c\b/.test(row.detail)), JSON.stringify(plan));
  for (const { sql, values } of executions.filter(row => row.sql.startsWith("UPDATE data_download_jobs"))) {
    const plan = sqlite.prepare("EXPLAIN QUERY PLAN " + sql).all(...values);
    assert.ok(!plan.some(row => /SCAN (?:data_download_jobs|c)\b/.test(row.detail)), JSON.stringify(plan));
  }
});
