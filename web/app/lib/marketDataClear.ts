import { type DataMarket } from "./dataMarkets.ts";
import { isDataMarket, MarketDataBusyError, withMarketDataClear } from "./marketDataWriteGuard.ts";

const marketAliases: Record<DataMarket, string[]> = {
  CN: ["CN", "A股"], US: ["US", "美股"], FX: ["FX", "FOREX", "外汇"], GOLD: ["GOLD", "METAL", "黄金"],
};

export async function clearMarketData(
  db: D1Database,
  market: unknown,
  options: { clearLocalData?: () => Promise<void> } = {},
) {
  if (!isDataMarket(market)) throw new Error("请选择要清空的市场。");
  return withMarketDataClear(market, async () => {
    // Only fixed aliases enter SQL; request text never becomes an identifier.
    const aliases = marketAliases[market].map((value) => `'${value}'`).join(", ");
    const marketWhere = `UPPER(TRIM(market)) IN (${aliases})`;
    const instrumentIds = `SELECT id FROM instruments WHERE ${marketWhere}
      UNION SELECT instrument_id FROM data_download_jobs WHERE ${marketWhere}
        AND instrument_id NOT IN (SELECT id FROM instruments)`;
    const fxWhere = `instrument_id IN (${instrumentIds}) OR
      (instrument_id LIKE '%.${market}' AND instrument_id NOT IN (SELECT id FROM instruments))`;
    const runs = `SELECT id FROM market_sync_runs WHERE ${marketWhere}`;
    const busy = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM data_download_jobs WHERE ${marketWhere} AND status IN ('queued', 'running')
        AND (sync_run_id IS NULL OR sync_run_id NOT IN (SELECT id FROM market_sync_runs WHERE status NOT IN ('queued', 'running')))) +
      (SELECT COUNT(*) FROM market_sync_runs WHERE ${marketWhere} AND status IN ('queued', 'running')) +
      (SELECT COUNT(*) FROM market_sync_batches WHERE run_id IN (${runs}) AND status = 'running') +
      (SELECT COUNT(*) FROM fx_data_tasks WHERE (${fxWhere}) AND status IN ('queued', 'running')) AS count`).first<{ count: number }>();
    if (Number(busy?.count ?? 0) > 0) {
      throw new MarketDataBusyError("该市场还有行情任务正在排队或处理中，请先暂停任务，等待当前处理完成后重试清空。");
    }
    let localCleared = false;
    if (market === "CN") {
      if (!options.clearLocalData) throw new Error("请从控制面板启动数据服务后重试清空 A 股行情。");
      await options.clearLocalData();
      localCleared = true;
    }
    try {
      const results = await db.batch([
        db.prepare(`DELETE FROM candles WHERE instrument_id IN (${instrumentIds})`),
        db.prepare(`DELETE FROM candle_coverage WHERE instrument_id IN (${instrumentIds})`),
        db.prepare(`DELETE FROM fx_data_tasks WHERE ${fxWhere}`),
        db.prepare(`DELETE FROM market_sync_batches WHERE run_id IN (${runs})`),
        db.prepare(`DELETE FROM market_sync_runs WHERE ${marketWhere}`),
        db.prepare(`DELETE FROM market_sync_locks WHERE ${marketWhere}`),
        db.prepare(`DELETE FROM data_download_jobs WHERE ${marketWhere}`),
        // Clearing an empty/new install must not trigger sample seeding later.
        db.prepare("INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sample_data_seeded', '1')"),
        db.prepare("INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, '1')").bind(`market_data_cleared:${market}`),
      ]);
      return { market, cleared: true, deletedRows: Number(results[0]?.meta?.changes ?? 0), localCleared };
    } catch (error) {
      if (localCleared) throw new Error("A 股本机行情已清空，其余行情记录未能清空，请重试以完成清理。", { cause: error });
      throw error;
    }
  });
}
