import { readLocalDataJson } from "./localDataService";
import { inspectMarketSyncUpdate } from "./marketSyncService";
import { loadProviderSecrets } from "./providerCredentials";
import { FX_INSTRUMENT_CATALOG, getFxInstrumentDefinition } from "./fxDataContracts";
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

type TusharePayload = {
  code?: number;
  msg?: string;
  data?: {
    fields?: string[];
    items?: unknown[][];
  };
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

function dateOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedDateTime(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

async function latestClosedTushareDate(token: string) {
  const now = zonedDateTime("Asia/Shanghai");
  // A daily bar is not considered complete until the regular A-share session
  // has ended. This prevents a morning startup from requesting today's bar.
  const cutoffDate = now.minutes >= 15 * 60 + 30 ? now.date : dateOffset(now.date, -1);
  const response = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_name: "trade_cal",
      token,
      params: {
        exchange: "SSE",
        start_date: dateOffset(cutoffDate, -60).replaceAll("-", ""),
        end_date: now.date.replaceAll("-", ""),
        is_open: "1",
      },
      fields: "cal_date,is_open",
    }),
  });
  if (!response.ok) return { date: null, error: `Tushare 交易日检查失败（HTTP ${response.status}）` };
  const payload = await response.json() as TusharePayload;
  if (payload.code !== 0) return { date: null, error: payload.msg || "Tushare 交易日检查失败" };
  const fields = payload.data?.fields ?? [];
  const rows = payload.data?.items ?? [];
  const dateIndex = fields.indexOf("cal_date");
  const openIndex = fields.indexOf("is_open");
  const dates = rows
    .map((row) => ({
      date: String(row[dateIndex] ?? "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
      isOpen: openIndex < 0 || String(row[openIndex] ?? "") === "1",
    }))
    .filter((row) => row.isOpen && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date <= cutoffDate)
    .map((row) => row.date)
    .sort();
  return { date: dates.at(-1) ?? null };
}

async function readDatabaseMarketRows(db: D1Database) {
  const result = await db.prepare(`SELECT i.market AS market,
      COUNT(DISTINCT i.id) AS instrumentCount,
      COALESCE(SUM(c.bar_count), 0) AS barCount,
      MAX(c.last_timestamp) AS lastTimestamp
    FROM instruments i
    JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE c.bar_count > 0 AND c.source <> 'sample'
    GROUP BY i.market`).all<DatabaseMarketRow>();
  return result.results.map((row) => ({
    market: marketCode(row.market),
    instrumentCount: Number(row.instrumentCount ?? 0),
    barCount: Number(row.barCount ?? 0),
    lastTimestamp: finiteTimestamp(row.lastTimestamp),
  }));
}

async function readLocalCnSummary() {
  const response = await readLocalDataJson<{ instruments?: LocalInstrumentRow[] }>("/instruments", 12_000);
  const instruments = (response?.instruments ?? []).filter((item) => (
    marketCode(item.market) === "CN" && Number(item.barCount ?? 0) > 0
  ));
  return {
    instrumentCount: instruments.length,
    barCount: instruments.reduce((sum, item) => sum + Math.max(0, Number(item.barCount ?? 0)), 0),
    lastTimestamp: maxTimestamp(...instruments.map((item) => finiteTimestamp(item.lastTimestamp))),
  };
}

async function inspectCnUpdate(
  row: DatabaseMarketRow | undefined,
  local: Awaited<ReturnType<typeof readLocalCnSummary>>,
  tushareToken: string | undefined,
) {
  const instrumentCount = Math.max(Number(row?.instrumentCount ?? 0), local.instrumentCount);
  const barCount = Number(row?.barCount ?? 0) + local.barCount;
  const latestTimestamp = maxTimestamp(row?.lastTimestamp, local.lastTimestamp);
  const existing = instrumentCount > 0 && barCount > 0;
  if (!existing) {
    return {
      existing: false,
      configured: Boolean(tushareToken),
      needsUpdate: false,
      latestDate: null,
      expectedLatestDate: null,
      reason: "A 股尚无可更新的历史数据",
    };
  }
  if (!tushareToken) {
    return {
      existing: true,
      configured: false,
      needsUpdate: false,
      latestDate: dateFromTimestamp(latestTimestamp),
      expectedLatestDate: null,
      reason: "A 股已有数据，但尚未配置 Tushare Token",
    };
  }
  try {
    const provider = await latestClosedTushareDate(tushareToken);
    if (!provider.date) {
      return {
        existing: true,
        configured: true,
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
      configured: true,
      needsUpdate: false,
      latestDate: dateFromTimestamp(latestTimestamp),
      expectedLatestDate: null,
      reason: "无法连接 Tushare 检查交易日，已跳过自动更新",
    };
  }
}

async function inspectFxUpdates(
  rows: Array<{ instrumentId: string; lastTimestamp: number | null }>,
  twelveDataApiKey: string | undefined,
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
      reason: "外汇尚无可更新的历史数据",
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
      reason: "外汇已有数据，但尚未配置 Twelve Data API Key",
    };
  }
  for (const row of rows) {
    const instrument = getFxInstrumentDefinition(row.instrumentId);
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
      ? `外汇有 ${duePairIds.length} 个货币对存在新收盘分钟数据`
      : errors
        ? `${errors} 个货币对无法完成最新状态检查，已跳过自动更新`
        : "外汇已有数据已经是最新",
  };
}

export async function inspectExistingMarkets(db: D1Database) {
  const [{ secrets }, databaseRows, localCn] = await Promise.all([
    loadProviderSecrets(),
    readDatabaseMarketRows(db),
    readLocalCnSummary(),
  ]);
  const byMarket = new Map(databaseRows.map((row) => [row.market, row]));
  const fxRows = await db.prepare(`SELECT i.id AS instrumentId, MAX(c.last_timestamp) AS lastTimestamp
    FROM instruments i
    JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE (UPPER(i.market) = 'FX' OR UPPER(i.market) = 'FOREX')
      AND c.bar_count > 0 AND c.source <> 'sample'
    GROUP BY i.id`).all<{ instrumentId: string; lastTimestamp: number | null }>();

  const [cn, us, fx] = await Promise.all([
    inspectCnUpdate(byMarket.get("CN"), localCn, secrets.tushareToken),
    inspectMarketSyncUpdate(db),
    inspectFxUpdates(
      fxRows.results.map((row) => ({
        instrumentId: String(row.instrumentId),
        lastTimestamp: finiteTimestamp(row.lastTimestamp),
      })),
      secrets.twelveDataApiKey,
    ),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    markets: {
      CN: cn,
      US: us,
      FX: fx,
      GOLD: {
        existing: Boolean(byMarket.get("GOLD")?.barCount),
        configured: false,
        needsUpdate: false,
        reason: "黄金数据源尚未接入自动更新",
      },
    },
    fxCatalogCount: FX_INSTRUMENT_CATALOG.length,
  };
}
