import { readLocalDataJson } from "./localDataService";
import { inspectMarketSyncUpdate } from "./marketSyncService";
import { loadProviderSecrets } from "./providerCredentials";
import { FX_INSTRUMENT_CATALOG, getMarketInstrumentDefinition, GOLD_INSTRUMENT_CATALOG } from "./fxDataContracts";
import { fetchTwelveDataOneMinuteChunk } from "./fx/twelveDataClient";

type DatabaseMarketRow = {
  market: string;
  instrumentCount: number;
  barCount: number;
  lastTimestamp: number | null;
};

type LocalInstrumentRow = {
  market?: unknown;
  barCount?: unknown;
  lastTimestamp?: unknown;
};

function marketCode(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "A股") return "CN";
  if (normalized === "美股") return "US";
  if (normalized === "FOREX" || normalized === "外汇") return "FX";
  if (normalized === "METAL" || normalized === "黄金") return "GOLD";
  return normalized;
}

function finiteTimestamp(value: unknown) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function maxTimestamp(...values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

function dateFromTimestamp(timestamp: number | null) {
  if (timestamp == null) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

async function readDatabaseMarketRows(db: D1Database) {
  // CN is owned by the BaoStock local service.  Legacy TDX/Tushare rows in
  // the application database must not make automatic update decisions.
  const result = await db.prepare(`SELECT i.market AS market,
      COUNT(DISTINCT i.id) AS instrumentCount,
      COALESCE(SUM(c.bar_count), 0) AS barCount,
      MAX(c.last_timestamp) AS lastTimestamp
    FROM instruments i
    JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE c.bar_count > 0 AND c.source <> 'sample'
      AND UPPER(i.market) NOT IN ('CN', 'A股')
    GROUP BY i.market`).all<DatabaseMarketRow>();
  return result.results.map((row) => ({
    market: marketCode(row.market),
    instrumentCount: Number(row.instrumentCount ?? 0),
    barCount: Number(row.barCount ?? 0),
    lastTimestamp: finiteTimestamp(row.lastTimestamp),
  }));
}

async function readLocalCnSummary() {
  const response = await readLocalDataJson<{
    activeSource?: string;
    instruments?: LocalInstrumentRow[];
  }>("/instruments", 12_000);
  const status = await readLocalDataJson<{
    dataset?: { corporateActions?: { enabled?: boolean } | null } | null;
  }>("/tasks/current", 12_000);
  const instruments = (response?.instruments ?? []).filter((item) => (
    marketCode(item.market) === "CN" && Number(item.barCount ?? 0) > 0
  ));
  return {
    source: response?.activeSource,
    corporateActionsEnabled: Boolean(status?.dataset?.corporateActions?.enabled),
    instrumentCount: instruments.length,
    barCount: instruments.reduce((sum, item) => sum + Math.max(0, Number(item.barCount ?? 0)), 0),
    lastTimestamp: maxTimestamp(...instruments.map((item) => finiteTimestamp(item.lastTimestamp))),
  };
}

async function latestClosedBaoStockDate() {
  const result = await readLocalDataJson<{ latestClosedDate?: string; error?: string }>("/market/cn/status", 12_000);
  if (!result?.latestClosedDate) {
    return { date: null, error: result?.error ?? "无法连接本机 BaoStock 交易日服务" };
  }
  return { date: result.latestClosedDate, error: null };
}

async function inspectCnUpdate(
  _row: DatabaseMarketRow | undefined,
  local: Awaited<ReturnType<typeof readLocalCnSummary>>,
  tushareToken?: string,
) {
  const instrumentCount = local.instrumentCount;
  const barCount = local.barCount;
  const latestTimestamp = local.lastTimestamp;
  const existing = instrumentCount > 0 && barCount > 0;
  if (!existing) {
    return {
      existing: false,
      configured: true,
      needsUpdate: false,
      latestDate: null,
      expectedLatestDate: null,
      reason: "A 股尚无可更新的本地历史数据",
    };
  }
  if (String(local.source).toLowerCase() === "tdx") {
    return {
      existing: true,
      configured: Boolean(tushareToken),
      needsUpdate: Boolean(tushareToken),
      latestDate: dateFromTimestamp(latestTimestamp),
      expectedLatestDate: null,
      reason: tushareToken
        ? `通达信不复权日线将继续检查增量${local.corporateActionsEnabled ? "，并维护权息信息" : ""}`
        : "通达信不复权日线已有数据，但尚未配置日线增量所需的数据源凭证",
    };
  }
  try {
    const provider = await latestClosedBaoStockDate();
    if (!provider.date) {
      return {
        existing: true,
        configured: false,
        needsUpdate: false,
        latestDate: dateFromTimestamp(latestTimestamp),
        expectedLatestDate: null,
        reason: provider.error ?? "无法确认最近 A 股交易日，已跳过自动更新",
      };
    }
    const latestDate = dateFromTimestamp(latestTimestamp);
    const needsUpdate = !latestDate || latestDate < provider.date;
    return {
      existing: true,
      configured: true,
      needsUpdate,
      latestDate,
      expectedLatestDate: provider.date,
      reason: needsUpdate
        ? `A 股数据截至 ${latestDate ?? "未知日期"}，最近完整交易日为 ${provider.date}`
        : `A 股已覆盖最近完整交易日 ${provider.date}`,
    };
  } catch {
    return {
      existing: true,
      configured: false,
      needsUpdate: false,
      latestDate: dateFromTimestamp(latestTimestamp),
      expectedLatestDate: null,
      reason: "无法连接本机数据服务检查交易日，已跳过自动更新",
    };
  }
}

async function inspectFxUpdates(
  rows: Array<{ instrumentId: string; lastTimestamp: number | null }>,
  twelveDataApiKey: string | undefined,
  marketLabel = "外汇",
) {
  const pairs = [] as Array<{
    pairId: string;
    latestTimestamp: number | null;
    providerLatestTimestamp: number | null;
    needsUpdate: boolean;
    error?: string;
  }>;
  if (!rows.length) {
    return {
      existing: false,
      configured: Boolean(twelveDataApiKey),
      needsUpdate: false,
      duePairIds: [] as string[],
      pairs,
      reason: `${marketLabel}尚无可更新的历史数据`,
    };
  }
  if (!twelveDataApiKey) {
    return {
      existing: true,
      configured: false,
      needsUpdate: false,
      duePairIds: [] as string[],
      pairs: rows.map((row) => ({
        pairId: row.instrumentId,
        latestTimestamp: row.lastTimestamp,
        providerLatestTimestamp: null,
        needsUpdate: false,
      })),
      reason: `${marketLabel}已有数据，但尚未配置 Twelve Data 访问密钥`,
    };
  }
  for (const row of rows) {
    const instrument = getMarketInstrumentDefinition(row.instrumentId);
    if (!instrument) continue;
    try {
      const latest = await fetchTwelveDataOneMinuteChunk({
        apiKey: twelveDataApiKey,
        symbol: instrument.twelveDataSymbol,
        outputsize: 1,
      });
      const providerLatestTimestamp = finiteTimestamp(
        latest.latestCompletedTimestamp ?? latest.candles.at(-1)?.timestamp,
      );
      const needsUpdate = providerLatestTimestamp != null
        && (row.lastTimestamp == null || providerLatestTimestamp > row.lastTimestamp);
      pairs.push({
        pairId: row.instrumentId,
        latestTimestamp: row.lastTimestamp,
        providerLatestTimestamp,
        needsUpdate,
      });
    } catch (error) {
      pairs.push({
        pairId: row.instrumentId,
        latestTimestamp: row.lastTimestamp,
        providerLatestTimestamp: null,
        needsUpdate: false,
        error: error instanceof Error ? error.message : "Twelve Data 最新状态检查失败",
      });
    }
  }
  const duePairIds = pairs.filter((pair) => pair.needsUpdate).map((pair) => pair.pairId);
  const errors = pairs.filter((pair) => pair.error).length;
  return {
    existing: true,
    configured: true,
    needsUpdate: duePairIds.length > 0,
    duePairIds,
    pairs,
    reason: duePairIds.length
      ? `${marketLabel}有 ${duePairIds.length} 个品种存在新收盘分钟数据`
      : errors
        ? `${errors} 个${marketLabel}品种无法完成最新状态检查，已跳过自动更新`
        : `${marketLabel}已有数据已经是最新`,
  };
}

export async function inspectExistingMarkets(db: D1Database) {
  const [{ secrets }, databaseRows, localCn] = await Promise.all([
    loadProviderSecrets(),
    readDatabaseMarketRows(db),
    readLocalCnSummary(),
  ]);
  const byMarket = new Map(databaseRows.map((row) => [row.market, row]));
  const marketRows = await db.prepare(`SELECT i.id AS instrumentId, i.market AS market, MAX(c.last_timestamp) AS lastTimestamp
    FROM instruments i
    JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE UPPER(i.market) IN ('FX', 'FOREX', 'GOLD', 'METAL')
      AND c.bar_count > 0 AND c.source <> 'sample'
    GROUP BY i.id, i.market`).all<{ instrumentId: string; market: string; lastTimestamp: number | null }>();
  const fxRows = marketRows.results.filter((row) => marketCode(row.market) === "FX");
  const goldRows = marketRows.results.filter((row) => marketCode(row.market) === "GOLD");

  const [cn, us, fx, gold] = await Promise.all([
    inspectCnUpdate(byMarket.get("CN"), localCn, secrets.tushareToken),
    inspectMarketSyncUpdate(db),
    inspectFxUpdates(
      fxRows.map((row) => ({
        instrumentId: String(row.instrumentId),
        lastTimestamp: finiteTimestamp(row.lastTimestamp),
      })),
      secrets.twelveDataApiKey,
    ),
    inspectFxUpdates(
      goldRows.map((row) => ({
        instrumentId: String(row.instrumentId),
        lastTimestamp: finiteTimestamp(row.lastTimestamp),
      })),
      secrets.twelveDataApiKey,
      "黄金",
    ),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    markets: { CN: cn, US: us, FX: fx, GOLD: gold },
    fxCatalogCount: FX_INSTRUMENT_CATALOG.length,
    goldCatalogCount: GOLD_INSTRUMENT_CATALOG.length,
  };
}
