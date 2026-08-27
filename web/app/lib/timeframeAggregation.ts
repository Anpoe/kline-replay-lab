import {
  canAggregateTimeframe as canAggregateCatalogTimeframe,
  timeframeMinutes as catalogTimeframeMinutes,
  type TimeframeId,
} from "./timeframeCatalog.ts";

export type SupportedTimeframe = TimeframeId;

export type AggregatableCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: number | null;
};

export function timeframeMinutes(value: string) {
  return catalogTimeframeMinutes(value);
}

export function canAggregateTimeframe(sourceTimeframe: string, targetTimeframe: string) {
  return canAggregateCatalogTimeframe(sourceTimeframe, targetTimeframe);
}

function localParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function weekStartKey(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 1);
  return date.toISOString().slice(0, 10);
}

function bucketKey(timestamp: number, timeframe: SupportedTimeframe, timeZone: string) {
  const minutes = timeframeMinutes(timeframe);
  if (minutes != null && minutes < 24 * 60) {
    return `epoch:${Math.floor(timestamp / (minutes * 60_000))}`;
  }
  const parts = localParts(timestamp, timeZone);
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (timeframe === "1w") return weekStartKey(parts.year, parts.month, parts.day);
  if (timeframe === "1mo") return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  if (timeframe === "1d") return dateKey;
  return dateKey;
}

export function timeframeBucketKey(timestamp: number, timeframe: SupportedTimeframe, timeZone = "UTC") {
  return bucketKey(timestamp, timeframe, timeZone);
}

function sumIfComplete(candles: AggregatableCandle[], field: "volume" | "turnover") {
  if (candles.some((candle) => candle[field] == null || !Number.isFinite(candle[field] as number))) return null;
  return candles.reduce((sum, candle) => sum + Number(candle[field]), 0);
}

/** Aggregates sorted OHLCV candles without mutating the input collection. */
export function aggregateCandlesToTimeframe(
  candles: Iterable<AggregatableCandle>,
  targetTimeframe: SupportedTimeframe,
  timeZone = "UTC",
) {
  const sorted = [...candles]
    .filter((candle) => (
      Number.isFinite(candle.timestamp)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
    ))
    .sort((left, right) => left.timestamp - right.timestamp);
  const groups = new Map<string, AggregatableCandle[]>();
  sorted.forEach((candle) => {
    const key = bucketKey(candle.timestamp, targetTimeframe, timeZone);
    const group = groups.get(key);
    if (group) group.push(candle);
    else groups.set(key, [candle]);
  });
  return [...groups.values()].map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    return {
      timestamp: first.timestamp,
      open: first.open,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      close: last.close,
      volume: sumIfComplete(group, "volume"),
      turnover: sumIfComplete(group, "turnover"),
    } satisfies AggregatableCandle;
  });
}
