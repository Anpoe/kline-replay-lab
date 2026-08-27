import { canAggregateTimeframe, timeframeRank, type TimeframeId } from "./timeframeCatalog.ts";

export type MarketDataProviderId = "tushare" | "alpaca";
export type SupportedTimeframe = TimeframeId;

export const DIRECT_PROVIDER_TIMEFRAMES: Record<MarketDataProviderId, readonly SupportedTimeframe[]> = {
  tushare: ["5m", "1h", "1d", "1w"],
  alpaca: ["5m", "1h", "1d", "1w"],
};

/**
 * Resolves the smallest direct source needed to build a requested target.
 * Direct provider capabilities stay truthful; derived targets are fetched
 * from the largest valid lower source to keep the provider request bounded.
 */
export function resolveProviderSourceTimeframe(
  provider: MarketDataProviderId,
  targetTimeframe: SupportedTimeframe,
): SupportedTimeframe {
  const direct = DIRECT_PROVIDER_TIMEFRAMES[provider];
  if (direct.includes(targetTimeframe)) return targetTimeframe;
  const source = [...direct]
    .filter((candidate) => canAggregateTimeframe(candidate, targetTimeframe))
    .sort((left, right) => (timeframeRank(right) ?? -1) - (timeframeRank(left) ?? -1))[0];
  if (!source) {
    throw new Error(`${provider} 没有可用于生成 ${targetTimeframe} 的更小直接周期`);
  }
  return source;
}

export type NormalizedCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: number | null;
};

export type QualityReport = {
  received: number;
  accepted: number;
  invalid: number;
  duplicates: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
};

export type AlpacaFeed = "sip" | "iex";

export type ProviderCursor = {
  nextStartDate?: string;
  pageToken?: string;
  feed?: AlpacaFeed;
};

export type ProviderChunkRequest = {
  provider: MarketDataProviderId;
  vendorSymbol: string;
  timeframe: SupportedTimeframe;
  startDate: string;
  endDate: string;
  cursor: ProviderCursor;
};

export type ProviderSecrets = {
  tushareToken?: string;
  alpacaKeyId?: string;
  alpacaSecretKey?: string;
  twelveDataApiKey?: string;
  dukascopyEndpoint?: string;
};

export type ProviderChunk = {
  candles: NormalizedCandle[];
  cursor: ProviderCursor;
  complete: boolean;
  source: string;
  quality: QualityReport;
};

type TusharePayload = {
  code?: number;
  msg?: string;
  data?: {
    fields?: string[];
    items?: unknown[][];
  };
};

export type AlpacaBar = {
  t?: string;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
};

type AlpacaPayload = {
  bars?: AlpacaBar[];
  next_page_token?: string | null;
  message?: string;
};

type AlpacaMultiSymbolPayload = {
  bars?: Record<string, AlpacaBar[]>;
  next_page_token?: string | null;
  message?: string;
};

export type AlpacaMultiSymbolChunkRequest = {
  symbols: string[];
  timeframe: SupportedTimeframe;
  startDate: string;
  endDate: string;
  feed: AlpacaFeed;
  pageToken?: string;
  limit?: number;
};

export type AlpacaMultiSymbolChunk = {
  candlesBySymbol: Map<string, NormalizedCandle[]>;
  cursor: ProviderCursor;
  complete: boolean;
  source: string;
};

export type AlpacaRequestOptions = {
  timeoutMs?: number;
};

export class AlpacaApiError extends Error {
  readonly status: number;
  feed?: AlpacaFeed;

  constructor(message: string, status: number, feed?: AlpacaFeed) {
    super(message);
    this.name = "AlpacaApiError";
    this.status = status;
    this.feed = feed;
  }
}

export type AlpacaAsset = {
  symbol?: string;
  name?: string;
  status?: string;
  tradable?: boolean;
  class?: string;
  asset_class?: string;
};

const timeframeToAlpaca: Partial<Record<SupportedTimeframe, string>> = {
  "5m": "5Min",
  "1h": "1Hour",
  "1d": "1Day",
  "1w": "1Week",
};

function requireAlpacaTimeframe(timeframe: SupportedTimeframe) {
  const value = timeframeToAlpaca[timeframe];
  if (!value) throw new Error(`Alpaca 不支持直接请求 ${timeframe} 周期`);
  return value;
}

function requireTushareTimeframe(timeframe: SupportedTimeframe) {
  if (!DIRECT_PROVIDER_TIMEFRAMES.tushare.includes(timeframe)) {
    throw new Error(`Tushare 不支持直接请求 ${timeframe} 周期`);
  }
  return timeframe;
}

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function minDate(left: string, right: string) {
  return left <= right ? left : right;
}

function retryDelayMs(response: Response | null, attempt: number) {
  const header = response?.headers.get("retry-after");
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(30_000, Math.max(250, seconds * 1000));
  if (header) {
    const retryAt = Date.parse(header);
    if (Number.isFinite(retryAt)) return Math.min(30_000, Math.max(250, retryAt - Date.now()));
  }
  return Math.min(30_000, 500 * (2 ** attempt) + Math.floor(Math.random() * 250));
}

function errorMessage(payload: { message?: string }, status: number) {
  return payload.message || `Alpaca 请求失败：HTTP ${status}`;
}

function isRetryableAlpacaStatus(status: number) {
  return status === 429 || status >= 500;
}

async function fetchAlpacaJson<T extends { message?: string }>(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  timeoutMs = 30_000,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response: Response | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetcher(url, { ...init, signal: controller.signal });
        let payload: T;
        try {
          payload = await response.json() as T;
        } catch (error) {
          if (response.ok) throw error;
          payload = {} as T;
        }
        if (response.ok) return { response, payload };
        const error = new AlpacaApiError(errorMessage(payload, response.status), response.status);
        if (!isRetryableAlpacaStatus(response.status) || attempt === 4) throw error;
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error instanceof AlpacaApiError && !isRetryableAlpacaStatus(error.status)) throw error;
      lastError = error;
      if (attempt === 4) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
  }
  throw lastError instanceof Error ? lastError : new Error("Alpaca 请求失败");
}

function tushareTimestamp(value: unknown, timeframe: SupportedTimeframe) {
  const text = String(value ?? "");
  if (timeframe === "5m" || timeframe === "1h") {
    return Date.parse(`${text.replace(" ", "T")}+08:00`);
  }
  if (!/^\d{8}$/.test(text)) return Number.NaN;
  return Date.parse(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00+08:00`);
}

function finiteOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function validateCandles(candles: NormalizedCandle[]) {
  const unique = new Map<number, NormalizedCandle>();
  let invalid = 0;
  let duplicates = 0;

  for (const candle of candles) {
    const valid = (
      Number.isFinite(candle.timestamp)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
      && candle.low <= Math.min(candle.open, candle.close)
      && candle.high >= Math.max(candle.open, candle.close)
      && candle.high >= candle.low
    );
    if (!valid) {
      invalid += 1;
      continue;
    }
    if (unique.has(candle.timestamp)) duplicates += 1;
    unique.set(candle.timestamp, candle);
  }

  const accepted = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp);
  return {
    candles: accepted,
    report: {
      received: candles.length,
      accepted: accepted.length,
      invalid,
      duplicates,
      firstTimestamp: accepted[0]?.timestamp,
      lastTimestamp: accepted.at(-1)?.timestamp,
    } satisfies QualityReport,
  };
}

export function normalizeTusharePayload(
  payload: TusharePayload,
  timeframe: SupportedTimeframe,
) {
  requireTushareTimeframe(timeframe);
  if (payload.code !== 0) throw new Error(payload.msg || `Tushare 返回错误 ${payload.code ?? "unknown"}`);
  const fields = payload.data?.fields ?? [];
  const rows = payload.data?.items ?? [];
  const objects = rows.map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])));
  const dailyLike = timeframe === "1d" || timeframe === "1w";
  const candles = objects.map((row) => ({
    timestamp: tushareTimestamp(row.trade_time ?? row.trade_date, timeframe),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: finiteOrNull(row.vol) == null ? null : Number(row.vol) * (dailyLike ? 100 : 1),
    turnover: finiteOrNull(row.amount) == null ? null : Number(row.amount) * (dailyLike ? 1000 : 1),
  }));
  return validateCandles(candles);
}

export function normalizeAlpacaBars(payload: AlpacaPayload) {
  const candles = (payload.bars ?? []).map((bar) => ({
    timestamp: Date.parse(String(bar.t ?? "")),
    open: Number(bar.o),
    high: Number(bar.h),
    low: Number(bar.l),
    close: Number(bar.c),
    volume: finiteOrNull(bar.v),
    turnover: null,
  }));
  return validateCandles(candles);
}

export function buildAlpacaMultiSymbolUrl(request: AlpacaMultiSymbolChunkRequest) {
  const symbols = [...new Set(request.symbols.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  const params = new URLSearchParams({
    symbols: symbols.join(","),
    timeframe: requireAlpacaTimeframe(request.timeframe),
    start: request.startDate,
    end: request.endDate,
    limit: String(Math.min(10_000, Math.max(1, request.limit ?? 10_000))),
    adjustment: "raw",
    feed: request.feed,
    sort: "asc",
  });
  if (request.pageToken) params.set("page_token", request.pageToken);
  return `https://data.alpaca.markets/v2/stocks/bars?${params}`;
}

export async function fetchAlpacaMultiSymbolChunk(
  request: AlpacaMultiSymbolChunkRequest,
  secrets: ProviderSecrets,
  fetcher: typeof fetch = fetch,
  options: AlpacaRequestOptions = {},
): Promise<AlpacaMultiSymbolChunk> {
  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    throw new Error("尚未配置 APCA_API_KEY_ID 和 APCA_API_SECRET_KEY");
  }
  const symbols = [...new Set(request.symbols.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) {
    return { candlesBySymbol: new Map(), cursor: {}, complete: true, source: `alpaca-${request.feed}` };
  }
  const url = buildAlpacaMultiSymbolUrl({ ...request, symbols });
  let result: { response: Response; payload: AlpacaMultiSymbolPayload };
  try {
    result = await fetchAlpacaJson<AlpacaMultiSymbolPayload>(url, {
      headers: {
        "APCA-API-KEY-ID": secrets.alpacaKeyId,
        "APCA-API-SECRET-KEY": secrets.alpacaSecretKey,
      },
    }, fetcher, options.timeoutMs);
  } catch (error) {
    if (error instanceof AlpacaApiError) error.feed = request.feed;
    throw error;
  }
  const candlesBySymbol = new Map<string, NormalizedCandle[]>();
  for (const [symbol, bars] of Object.entries(result.payload.bars ?? {})) {
    candlesBySymbol.set(symbol, normalizeAlpacaBars({ bars }).candles);
  }
  const pageToken = result.payload.next_page_token ?? undefined;
  return {
    candlesBySymbol,
    cursor: pageToken ? { pageToken, feed: request.feed } : {},
    complete: !pageToken,
    source: `alpaca-${request.feed}`,
  };
}

export function filterTradableUsAssets(assets: AlpacaAsset[]) {
  return assets.filter((asset) =>
    (asset.class === "us_equity" || asset.asset_class === "us_equity")
    && asset.status === "active"
    && asset.tradable === true
    && Boolean(asset.symbol?.trim()));
}

function tushareChunkRequest(request: ProviderChunkRequest) {
  requireTushareTimeframe(request.timeframe);
  const cursorStart = request.cursor.nextStartDate ?? request.startDate;
  const chunkDays = request.timeframe === "5m" ? 120 : request.timeframe === "1h" ? 900 : request.timeframe === "1d" ? 3000 : 6000;
  const chunkEnd = minDate(addUtcDays(cursorStart, chunkDays - 1), request.endDate);
  const apiName = request.timeframe === "5m" || request.timeframe === "1h"
    ? "stk_mins"
    : request.timeframe === "1d" ? "daily" : "weekly";
  const minute = apiName === "stk_mins";
  return {
    apiName,
    chunkEnd,
    params: {
      ts_code: request.vendorSymbol,
      ...(minute
        ? {
            freq: request.timeframe === "5m" ? "5min" : "60min",
            start_date: `${cursorStart} 00:00:00`,
            end_date: `${chunkEnd} 23:59:59`,
          }
        : {
            start_date: cursorStart.replaceAll("-", ""),
            end_date: chunkEnd.replaceAll("-", ""),
          }),
    },
  };
}

export async function fetchProviderChunk(
  request: ProviderChunkRequest,
  secrets: ProviderSecrets,
  fetcher: typeof fetch = fetch,
): Promise<ProviderChunk> {
  if (request.provider === "tushare") {
    if (!secrets.tushareToken) throw new Error("尚未配置 TUSHARE_TOKEN");
    const chunk = tushareChunkRequest(request);
    const response = await fetcher("https://api.tushare.pro", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_name: chunk.apiName,
        token: secrets.tushareToken,
        params: chunk.params,
        fields: "",
      }),
    });
    if (!response.ok) throw new Error(`Tushare 请求失败：HTTP ${response.status}`);
    const normalized = normalizeTusharePayload(await response.json() as TusharePayload, request.timeframe);
    const nextStartDate = addUtcDays(chunk.chunkEnd, 1);
    const complete = nextStartDate > request.endDate;
    return {
      candles: normalized.candles,
      quality: normalized.report,
      cursor: complete ? {} : { nextStartDate },
      complete,
      source: "tushare",
    };
  }

  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    throw new Error("尚未配置 APCA_API_KEY_ID 和 APCA_API_SECRET_KEY");
  }
  // US history is intentionally SIP-only.  IEX is a partial venue feed and
  // silently falling back to it makes the same instrument change definition
  // halfway through its history.  A SIP failure must be visible to the user.
  const feed: AlpacaFeed = "sip";
  const params = new URLSearchParams({
    timeframe: requireAlpacaTimeframe(request.timeframe),
    start: request.startDate,
    end: request.endDate,
    limit: "10000",
    adjustment: "raw",
    feed,
    sort: "asc",
  });
  if (request.cursor.feed !== "iex" && request.cursor.pageToken) {
    params.set("page_token", request.cursor.pageToken);
  }
  const result = await fetchAlpacaJson<AlpacaPayload>(
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(request.vendorSymbol)}/bars?${params}`,
    {
      headers: {
        "APCA-API-KEY-ID": secrets.alpacaKeyId,
        "APCA-API-SECRET-KEY": secrets.alpacaSecretKey,
      },
    },
    fetcher,
  );
  const normalized = normalizeAlpacaBars(result.payload);
  const pageToken = result.payload.next_page_token ?? undefined;
  return {
    candles: normalized.candles,
    quality: normalized.report,
    cursor: pageToken ? { pageToken, feed } : {},
    complete: !pageToken,
    source: "alpaca-sip",
  };
}
