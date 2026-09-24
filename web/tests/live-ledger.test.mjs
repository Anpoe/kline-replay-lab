import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("live performance data uses isolated tables and a patch API", async () => {
  const [schema, runtime, ledger, route, preferences, workbench] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("db/runtime.ts", root), "utf8"),
    readFile(new URL("db/live-ledger.ts", root), "utf8"),
    readFile(new URL("app/api/live-state/route.ts", root), "utf8"),
    readFile(new URL("app/api/preferences/route.ts", root), "utf8"),
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
  ]);

  for (const table of [
    "livePortfolios",
    "livePositions",
    "livePendingOrders",
    "liveExecutions",
    "liveOrderRejections",
    "liveWatchlist",
  ]) assert.match(schema, new RegExp(`export const ${table} =`));
  for (const table of [
    "live_portfolios",
    "live_positions",
    "live_pending_orders",
    "live_executions",
    "live_order_rejections",
    "live_watchlist",
  ]) assert.match(runtime, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(schema, /export const liveCommandReceipts =/);
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS live_command_receipts/);
  for (const column of ["rawPrice", "quotePrice", "priceImpactCost", "engineVersion", "payloadVersion"]) {
    assert.match(ledger, new RegExp(column));
  }
  assert.match(ledger, /WHERE excluded\.updated_at >= live_accounts\.updated_at/);
  assert.match(ledger, /excluded\.account_version > live_accounts\.account_version/);
  assert.match(runtime, /migrateLegacyLiveData\(db\)/);
  assert.match(ledger, /live_data_migrated_v1/);
  assert.match(ledger, /portfolioUpserts/);
  assert.match(ledger, /excluded\.updated_at >= live_portfolios\.updated_at/);
  assert.match(ledger, /excluded\.updated_at >= live_watchlist\.updated_at/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /applyLiveStatePatch/);
  assert.match(workbench, /postCommand/);
  assert.match(preferences, /delete preferences\.livePortfolios/);
  assert.match(preferences, /delete preferences\.liveWatchlist/);
  assert.match(workbench, /fetch\("\/api\/live-state"/);
  assert.match(workbench, /liveStateHydratedRef/);
  assert.doesNotMatch(workbench, /livePortfolios:\s*sanitizeLivePortfolios\(livePortfolios\)/);
});
