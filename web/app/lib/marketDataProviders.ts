export type MarketDataProviderId = "tushare" | "alpaca";
export type SupportedTimeframe = "5m" | "1h" | "1d" | "1w";

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

export type ProviderCursor = {
  nextStartDate?: string;
  pageToken?: string;
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

type AlpacaBar = {
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

export type AlpacaAsset = {
  symbol?: string;
  name?: string;
  status?: string;
  tradable?: boolean;
  class?: string;
  asset_class?: string;
};

const timeframeToAlpaca: Record<SupportedTimeframe, string> = {
  "5m": "5Min",
  "1h": "1Hour",
  "1d": "1Day",
  "1w": "1Week",
};

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function minDate(left: string, right: string) {
  return left <= right ? left : right;
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

export function filterTradableUsAssets(assets: AlpacaAsset[]) {
  return assets.filter((asset) =>
    (asset.class === "us_equity" || asset.asset_class === "us_equity")
    && asset.status === "active"
    && asset.tradable === true
    && Boolean(asset.symbol?.trim()));
}

function tushareChunkRequest(request: ProviderChunkRequest) {
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
  const params = new URLSearchParams({
    timeframe: timeframeToAlpaca[request.timeframe],
    start: request.startDate,
    end: request.endDate,
    limit: "10000",
    adjustment: "raw",
    feed: "iex",
    sort: "asc",
  });
  if (request.cursor.pageToken) params.set("page_token", request.cursor.pageToken);
  const response = await fetcher(
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(request.vendorSymbol)}/bars?${params}`,
    {
      headers: {
        "APCA-API-KEY-ID": secrets.alpacaKeyId,
        "APCA-API-SECRET-KEY": secrets.alpacaSecretKey,
      },
    },
  );
  const payload = await response.json() as AlpacaPayload;
  if (!response.ok) throw new Error(payload.message || `Alpaca 请求失败：HTTP ${response.status}`);
  const normalized = normalizeAlpacaBars(payload);
  const pageToken = payload.next_page_token ?? undefined;
  return {
    candles: normalized.candles,
    quality: normalized.report,
    cursor: pageToken ? { pageToken } : {},
    complete: !pageToken,
    source: "alpaca-iex",
  };
}
