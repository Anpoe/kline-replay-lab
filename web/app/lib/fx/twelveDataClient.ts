import type { NormalizedCandle, QualityReport } from "../marketDataProviders.ts";
import {
  calculateTwelveDataSyncWindow,
  formatTwelveDataDateTime,
  getLastCompletedOneMinuteTimestamp,
  normalizeTwelveDataPayload,
  parseTwelveDataTimestamp,
  summarizeTwelveDataQuality,
  type TwelveDataMeta,
  type TwelveDataPayload,
  type TwelveDataSyncWindow,
} from "./twelveDataNormalize.ts";

export const TWELVE_DATA_TIME_SERIES_URL = "https://api.twelvedata.com/time_series";
export const TWELVE_DATA_SOURCE = "twelvedata-fx-1m";

export type TwelveDataCursor = {
  /** Twelve Data has no opaque page token for /time_series; date is the cursor. */
  nextStartDate?: string;
};

export type TwelveDataOneMinuteRequest = {
  apiKey: string;
  symbol: string;
  startDate?: string | number;
  endDate?: string | number;
  cursor?: TwelveDataCursor;
  outputsize?: number;
  lastCompletedTimestamp?: number | null;
  historyBoundary?: number | null;
  overlapBars?: number;
  now?: number;
  /** Injectable endpoint for tests or a provider-compatible proxy. */
  baseUrl?: string;
};

export type TwelveDataUrlRequest = Pick<
  TwelveDataOneMinuteRequest,
  "apiKey" | "symbol" | "startDate" | "endDate" | "cursor" | "outputsize" | "baseUrl"
>;

export type TwelveDataFetcher = typeof fetch;

export type TwelveDataOneMinuteChunk = {
  /** Bars safe for the caller to write to the canonical FX dataset. */
  candles: NormalizedCandle[];
  /** Completed overlap bars before writeFromTimestamp, for read-only comparison. */
  overlapCandles: NormalizedCandle[];
  /** Quality of all completed bars returned by the provider, including overlap. */
  quality: QualityReport;
  /** Quality of only the safe-to-write bars. */
  writeQuality: QualityReport;
  meta?: TwelveDataMeta;
  cursor: TwelveDataCursor;
  complete: boolean;
  source: typeof TWELVE_DATA_SOURCE;
  writeFromTimestamp?: number;
  requestedStartTimestamp?: number;
  requestedEndTimestamp?: number;
  filteredUncompleted: number;
  latestReceivedTimestamp?: number;
  latestCompletedTimestamp?: number;
};

export class TwelveDataApiError extends Error {
  readonly status: number;
  readonly code?: number | string;
  readonly rateLimited: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    options: {
      code?: number | string;
      rateLimited?: boolean;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message);
    this.name = "TwelveDataApiError";
    this.status = status;
    this.code = options.code;
    this.rateLimited = options.rateLimited ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class TwelveDataRateLimitError extends TwelveDataApiError {
  constructor(
    message: string,
    status: number,
    options: { code?: number | string; retryAfterMs?: number } = {},
  ) {
    super(message, status, { ...options, rateLimited: true });
    this.name = "TwelveDataRateLimitError";
  }
}

export function isTwelveDataRateLimitError(error: unknown): error is TwelveDataRateLimitError {
  return error instanceof TwelveDataApiError && error.rateLimited;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampOutputsize(value: number | undefined) {
  if (value === undefined) return 5_000;
  if (!Number.isFinite(value)) throw new RangeError("outputsize must be finite");
  return Math.min(5_000, Math.max(1, Math.floor(value)));
}

function normalizeFxSymbol(symbol: string) {
  const value = symbol.trim().toUpperCase();
  if (!value) throw new Error("Twelve Data symbol is required");
  if (/^[A-Z]{6}\.FX$/.test(value)) return `${value.slice(0, 3)}/${value.slice(3, 6)}`;
  if (/^[A-Z]{6}$/.test(value)) return `${value.slice(0, 3)}/${value.slice(3, 6)}`;
  return value.replace(/[-_]/g, "/");
}

export function normalizeTwelveDataFxSymbol(symbol: string) {
  return normalizeFxSymbol(symbol);
}

function dateValueToTimestamp(value: string | number | undefined, name: string) {
  if (value === undefined) return undefined;
  const timestamp = typeof value === "number" ? value : parseTwelveDataTimestamp(value);
  if (!Number.isFinite(timestamp)) throw new RangeError(`${name} must be a valid UTC date or timestamp`);
  return timestamp;
}

function retryAfterMs(response: Response, payload: TwelveDataPayload) {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const retryAt = Date.parse(header);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  const retryAfter = isRecord(payload) ? payload.retry_after : undefined;
  const numeric = Number(retryAfter);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric * 1000 : undefined;
}

function providerCode(payload: TwelveDataPayload) {
  return typeof payload.code === "number" || typeof payload.code === "string"
    ? payload.code
    : undefined;
}

function isRateLimitResponse(status: number, code: number | string | undefined, message: string) {
  return status === 429
    || String(code ?? "") === "429"
    || /(rate[ -]?limit|too many requests?|quota|credit(?:s)? exhausted|frequency)/i.test(message);
}

function errorMessage(payload: TwelveDataPayload, status: number) {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  return message || `Twelve Data request failed: HTTP ${status}`;
}

function isErrorPayload(payload: TwelveDataPayload) {
  const status = String(payload.status ?? "").toLowerCase();
  return status === "error" || (payload.code !== undefined && payload.message !== undefined);
}

async function readJson(response: Response) {
  try {
    const value = await response.json();
    return isRecord(value) ? value as TwelveDataPayload : {} as TwelveDataPayload;
  } catch {
    return {} as TwelveDataPayload;
  }
}

function throwApiError(response: Response, payload: TwelveDataPayload): never {
  const code = providerCode(payload);
  const message = errorMessage(payload, response.status);
  const options = { code, retryAfterMs: retryAfterMs(response, payload) };
  if (isRateLimitResponse(response.status, code, message)) {
    throw new TwelveDataRateLimitError(message, response.status, options);
  }
  throw new TwelveDataApiError(message, response.status, options);
}

function toUrlDate(value: string | number | undefined) {
  if (value === undefined) return undefined;
  const timestamp = dateValueToTimestamp(value, "date");
  if (timestamp === undefined) return undefined;
  return formatTwelveDataDateTime(timestamp);
}

export function buildTwelveDataTimeSeriesUrl(request: TwelveDataUrlRequest) {
  if (!request.apiKey?.trim()) throw new Error("Twelve Data API key is required");
  const baseUrl = request.baseUrl ?? TWELVE_DATA_TIME_SERIES_URL;
  const url = new URL(baseUrl);
  const params = url.searchParams;
  params.set("symbol", normalizeFxSymbol(request.symbol));
  params.set("interval", "1min");
  params.set("outputsize", String(clampOutputsize(request.outputsize)));
  params.set("order", "asc");
  params.set("timezone", "UTC");
  params.set("format", "JSON");
  const startDate = request.cursor?.nextStartDate ?? toUrlDate(request.startDate);
  const endDate = toUrlDate(request.endDate);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  params.set("apikey", request.apiKey.trim());
  return url.toString();
}

function emptyChunk(options: {
  window?: TwelveDataSyncWindow;
  completedThroughTimestamp: number;
}): TwelveDataOneMinuteChunk {
  const window = options.window;
  return {
    candles: [],
    overlapCandles: [],
    quality: {
      received: 0,
      accepted: 0,
      invalid: 0,
      duplicates: 0,
    },
    writeQuality: {
      received: 0,
      accepted: 0,
      invalid: 0,
      duplicates: 0,
    },
    cursor: {},
    complete: true,
    source: TWELVE_DATA_SOURCE,
    ...(window?.writeFromTimestamp === undefined ? {} : { writeFromTimestamp: window.writeFromTimestamp }),
    ...(window?.requestStartTimestamp === undefined ? {} : { requestedStartTimestamp: window.requestStartTimestamp }),
    ...(window?.endTimestamp === undefined ? {} : { requestedEndTimestamp: window.endTimestamp }),
    filteredUncompleted: 0,
    latestCompletedTimestamp: options.completedThroughTimestamp,
  };
}

function nextCursor(
  valuesReceived: number,
  outputsize: number,
  latestCompletedTimestamp: number | undefined,
  requestedStartTimestamp: number | undefined,
  requestedEndTimestamp: number | undefined,
) {
  if (valuesReceived < outputsize || latestCompletedTimestamp === undefined) return undefined;
  const candidate = latestCompletedTimestamp + 60 * 1000;
  if (requestedStartTimestamp !== undefined && candidate <= requestedStartTimestamp) return undefined;
  if (requestedEndTimestamp !== undefined && candidate > requestedEndTimestamp) return undefined;
  return { nextStartDate: formatTwelveDataDateTime(candidate) } satisfies TwelveDataCursor;
}

export async function fetchTwelveDataOneMinuteChunk(
  request: TwelveDataOneMinuteRequest,
  fetcher: TwelveDataFetcher = fetch,
): Promise<TwelveDataOneMinuteChunk> {
  if (!request.apiKey?.trim()) throw new Error("Twelve Data API key is required");
  const now = request.now ?? Date.now();
  const completedThroughTimestamp = getLastCompletedOneMinuteTimestamp(now);
  const hasSyncAnchor = request.lastCompletedTimestamp != null || request.historyBoundary != null;
  const calculatedWindow = hasSyncAnchor
    ? calculateTwelveDataSyncWindow({
        now,
        lastCompletedTimestamp: request.lastCompletedTimestamp,
        historyBoundary: request.historyBoundary,
        overlapBars: request.overlapBars,
      })
    : undefined;

  const cursorStart = request.cursor?.nextStartDate;
  const requestedStartTimestamp = cursorStart !== undefined
    ? dateValueToTimestamp(cursorStart, "cursor.nextStartDate")
    : dateValueToTimestamp(request.startDate, "startDate")
      ?? calculatedWindow?.requestStartTimestamp;
  const explicitEndTimestamp = dateValueToTimestamp(request.endDate, "endDate");
  const requestedEndTimestamp = explicitEndTimestamp === undefined
    ? (calculatedWindow?.endTimestamp
      ?? (requestedStartTimestamp === undefined ? undefined : completedThroughTimestamp))
    : Math.min(explicitEndTimestamp, completedThroughTimestamp);
  const writeFromTimestamp = calculatedWindow?.writeFromTimestamp ?? requestedStartTimestamp;

  if (
    requestedStartTimestamp !== undefined
    && requestedEndTimestamp !== undefined
    && requestedStartTimestamp > requestedEndTimestamp
  ) {
    return emptyChunk({
      window: calculatedWindow ?? {
        requestStartTimestamp: requestedStartTimestamp,
        endTimestamp: requestedEndTimestamp,
        writeFromTimestamp: writeFromTimestamp ?? requestedStartTimestamp,
        overlapBars: request.overlapBars ?? 0,
      },
      completedThroughTimestamp,
    });
  }

  const url = buildTwelveDataTimeSeriesUrl({
    ...request,
    startDate: requestedStartTimestamp,
    endDate: requestedEndTimestamp,
    cursor: undefined,
  });
  const response = await fetcher(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const payload = await readJson(response);
  if (!response.ok || isErrorPayload(payload)) throwApiError(response, payload);

  const normalized = normalizeTwelveDataPayload(payload, {
    completedThroughTimestamp,
  });
  const outputsize = clampOutputsize(request.outputsize);
  const cursor = nextCursor(
    Array.isArray(payload.values) ? payload.values.length : 0,
    outputsize,
    normalized.latestCompletedTimestamp,
    requestedStartTimestamp,
    requestedEndTimestamp,
  );
  const overlapCandles = writeFromTimestamp === undefined
    ? []
    : normalized.candles.filter((candle) => candle.timestamp < writeFromTimestamp);
  const candles = writeFromTimestamp === undefined
    ? normalized.candles
    : normalized.candles.filter((candle) => candle.timestamp >= writeFromTimestamp);

  return {
    candles,
    overlapCandles,
    quality: normalized.report,
    writeQuality: summarizeTwelveDataQuality(candles),
    ...(normalized.meta === undefined ? {} : { meta: normalized.meta }),
    cursor: cursor ?? {},
    complete: cursor === undefined,
    source: TWELVE_DATA_SOURCE,
    ...(writeFromTimestamp === undefined ? {} : { writeFromTimestamp }),
    ...(requestedStartTimestamp === undefined ? {} : { requestedStartTimestamp }),
    ...(requestedEndTimestamp === undefined ? {} : { requestedEndTimestamp }),
    filteredUncompleted: normalized.filteredUncompleted,
    ...(normalized.latestReceivedTimestamp === undefined
      ? {}
      : { latestReceivedTimestamp: normalized.latestReceivedTimestamp }),
    ...(normalized.latestCompletedTimestamp === undefined
      ? {}
      : { latestCompletedTimestamp: normalized.latestCompletedTimestamp }),
  };
}
