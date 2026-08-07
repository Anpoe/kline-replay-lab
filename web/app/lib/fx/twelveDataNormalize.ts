import type { NormalizedCandle, QualityReport } from "../marketDataProviders.ts";

export const TWELVE_DATA_ONE_MINUTE_MS = 60 * 1000;
export const TWELVE_DATA_ONE_MINUTE_INTERVAL = "1min" as const;

export type TwelveDataMeta = {
  symbol?: string;
  interval?: string;
  currency_base?: string;
  currency_quote?: string;
  type?: string;
  [key: string]: unknown;
};

export type TwelveDataValue = {
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
  [key: string]: unknown;
};

export type TwelveDataPayload = {
  meta?: TwelveDataMeta;
  values?: TwelveDataValue[] | null;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  [key: string]: unknown;
};

export class TwelveDataPayloadError extends Error {
  readonly code?: number | string;

  constructor(message: string, code?: number | string) {
    super(message);
    this.name = "TwelveDataPayloadError";
    this.code = code;
  }
}

export type TwelveDataNormalizeOptions = {
  /** The wall-clock time used to decide whether a 1m bar has closed. */
  now?: number;
  /** A deterministic cutoff, useful when the caller already computed it. */
  completedThroughTimestamp?: number;
  /** Keep the one-minute alignment check enabled by default. */
  enforceOneMinuteAlignment?: boolean;
};

export type TwelveDataNormalizeResult = {
  candles: NormalizedCandle[];
  report: QualityReport;
  meta?: TwelveDataMeta;
  filteredUncompleted: number;
  latestReceivedTimestamp?: number;
  latestCompletedTimestamp?: number;
};

export type TwelveDataSyncWindowOptions = {
  now?: number;
  lastCompletedTimestamp?: number | null;
  historyBoundary?: number | null;
  overlapBars?: number;
};

export type TwelveDataSyncWindow = {
  requestStartTimestamp: number;
  endTimestamp: number;
  writeFromTimestamp: number;
  historyBoundary?: number;
  overlapBars: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function finiteTimestamp(value: number | null | undefined, name: string) {
  if (value === null || value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite timestamp`);
  return Math.floor(value / TWELVE_DATA_ONE_MINUTE_MS) * TWELVE_DATA_ONE_MINUTE_MS;
}

function positiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new RangeError("overlapBars must be finite");
  return Math.min(20, Math.max(0, Math.floor(value)));
}

function emptyReport(): QualityReport {
  return {
    received: 0,
    accepted: 0,
    invalid: 0,
    duplicates: 0,
  };
}

/**
 * Twelve Data returns Forex intraday datetimes in UTC when timezone=UTC is
 * requested.  Be explicit for values without an offset: Date.parse otherwise
 * interprets them in the host machine's local timezone.
 */
export function parseTwelveDataTimestamp(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Number.NaN;
    return Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
  }

  const text = String(value ?? "").trim();
  if (!text) return Number.NaN;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return Number.NaN;
    return Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  const isoLike = text.includes("T") ? text : text.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoLike);
  const timestamp = Date.parse(hasTimezone ? isoLike : `${isoLike}Z`);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

export function formatTwelveDataDateTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) throw new RangeError("timestamp must be finite");
  return new Date(timestamp).toISOString().replace(/\.000Z$/, "Z");
}

/**
 * A bar stamped at floor(now / 1m) is still forming. The previous bucket is
 * therefore the most recent bar that can safely enter the training database.
 */
export function getLastCompletedOneMinuteTimestamp(now = Date.now()) {
  if (!Number.isFinite(now)) throw new RangeError("now must be a finite timestamp");
  return Math.floor(now / TWELVE_DATA_ONE_MINUTE_MS) * TWELVE_DATA_ONE_MINUTE_MS
    - TWELVE_DATA_ONE_MINUTE_MS;
}

export function filterCompletedOneMinuteCandles(
  candles: NormalizedCandle[],
  now = Date.now(),
) {
  const cutoff = getLastCompletedOneMinuteTimestamp(now);
  return candles
    .filter((candle) => Number.isFinite(candle.timestamp) && candle.timestamp <= cutoff)
    .sort((left, right) => left.timestamp - right.timestamp);
}

/**
 * Calculate the request and write boundaries for the two-source FX dataset.
 *
 * The request deliberately starts a few bars before the local anchor.  The
 * returned writeFromTimestamp prevents a Twelve Data response from replacing
 * Dukascopy history before historyBoundary, while still allowing same-source
 * overlap to repair recently completed bars.
 */
export function calculateTwelveDataSyncWindow(
  options: TwelveDataSyncWindowOptions = {},
): TwelveDataSyncWindow {
  const now = options.now ?? Date.now();
  const endTimestamp = getLastCompletedOneMinuteTimestamp(now);
  const lastCompletedTimestamp = finiteTimestamp(options.lastCompletedTimestamp, "lastCompletedTimestamp");
  const historyBoundary = finiteTimestamp(options.historyBoundary, "historyBoundary");
  const overlapBars = positiveInteger(options.overlapBars, 2);

  const anchors = [
    ...(lastCompletedTimestamp === undefined ? [] : [lastCompletedTimestamp]),
    ...(historyBoundary === undefined ? [] : [historyBoundary]),
  ];
  const anchor = anchors.length ? Math.max(...anchors) : endTimestamp;
  const requestStartTimestamp = anchor - overlapBars * TWELVE_DATA_ONE_MINUTE_MS;
  const sameSourceWriteStart = lastCompletedTimestamp === undefined
    ? requestStartTimestamp
    : lastCompletedTimestamp - overlapBars * TWELVE_DATA_ONE_MINUTE_MS;
  const writeFromTimestamp = historyBoundary === undefined
    ? sameSourceWriteStart
    : Math.max(historyBoundary + TWELVE_DATA_ONE_MINUTE_MS, sameSourceWriteStart);

  return {
    requestStartTimestamp,
    endTimestamp,
    writeFromTimestamp,
    ...(historyBoundary === undefined ? {} : { historyBoundary }),
    overlapBars,
  };
}

function isValidCandle(candle: NormalizedCandle, enforceOneMinuteAlignment: boolean) {
  return (
    Number.isFinite(candle.timestamp)
    && (!enforceOneMinuteAlignment
      || candle.timestamp % TWELVE_DATA_ONE_MINUTE_MS === 0)
    && Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.high >= candle.low
  );
}

function payloadError(payload: TwelveDataPayload) {
  const status = String(payload.status ?? "").toLowerCase();
  if (status !== "error" && payload.code === undefined) return null;
  const code = typeof payload.code === "number" || typeof payload.code === "string"
    ? payload.code
    : undefined;
  const message = String(payload.message ?? "Twelve Data returned an error");
  return new TwelveDataPayloadError(message, code);
}

export function normalizeTwelveDataPayload(
  payload: TwelveDataPayload,
  options: TwelveDataNormalizeOptions = {},
): TwelveDataNormalizeResult {
  const error = payloadError(payload);
  if (error) throw error;

  const values = payload.values === undefined || payload.values === null
    ? []
    : Array.isArray(payload.values) ? payload.values : [];
  const cutoff = options.completedThroughTimestamp
    ?? getLastCompletedOneMinuteTimestamp(options.now ?? Date.now());
  if (!Number.isFinite(cutoff)) throw new RangeError("completedThroughTimestamp must be finite");
  const enforceOneMinuteAlignment = options.enforceOneMinuteAlignment ?? true;

  const unique = new Map<number, NormalizedCandle>();
  let invalid = 0;
  let duplicates = 0;
  let filteredUncompleted = 0;
  let latestReceivedTimestamp: number | undefined;
  let latestCompletedTimestamp: number | undefined;

  for (const value of values) {
    const row = isRecord(value) ? value : {};
    const timestamp = parseTwelveDataTimestamp(row.datetime);
    if (Number.isFinite(timestamp)) {
      latestReceivedTimestamp = latestReceivedTimestamp === undefined
        ? timestamp
        : Math.max(latestReceivedTimestamp, timestamp);
      if (timestamp <= cutoff) {
        latestCompletedTimestamp = latestCompletedTimestamp === undefined
          ? timestamp
          : Math.max(latestCompletedTimestamp, timestamp);
      }
    }

    const candle: NormalizedCandle = {
      timestamp,
      open: finiteNumber(row.open),
      high: finiteNumber(row.high),
      low: finiteNumber(row.low),
      close: finiteNumber(row.close),
      volume: null,
      turnover: null,
    };

    if (!isValidCandle(candle, enforceOneMinuteAlignment)) {
      invalid += 1;
      continue;
    }
    if (timestamp > cutoff) {
      filteredUncompleted += 1;
      continue;
    }
    if (unique.has(timestamp)) duplicates += 1;
    unique.set(timestamp, candle);
  }

  const candles = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp);
  const report: QualityReport = {
    received: values.length,
    accepted: candles.length,
    invalid,
    duplicates,
    firstTimestamp: candles[0]?.timestamp,
    lastTimestamp: candles.at(-1)?.timestamp,
  };

  return {
    candles,
    report,
    ...(payload.meta === undefined ? {} : { meta: payload.meta }),
    filteredUncompleted,
    ...(latestReceivedTimestamp === undefined ? {} : { latestReceivedTimestamp }),
    ...(latestCompletedTimestamp === undefined ? {} : { latestCompletedTimestamp }),
  };
}

export function summarizeTwelveDataQuality(candles: NormalizedCandle[]): QualityReport {
  if (!candles.length) return emptyReport();
  return {
    received: candles.length,
    accepted: candles.length,
    invalid: 0,
    duplicates: 0,
    firstTimestamp: candles[0].timestamp,
    lastTimestamp: candles.at(-1)?.timestamp,
  };
}
