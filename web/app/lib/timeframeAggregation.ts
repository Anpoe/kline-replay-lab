export type SupportedTimeframe = "1m" | "5m" | "1h" | "1d" | "1w";

export type AggregatableCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: number | null;
};

const timeframeMinutesMap: Record<SupportedTimeframe, number> = {
  "1m": 1,
  "5m": 5,
  "1h": 60,
  "1d": 24 * 60,
  "1w": 7 * 24 * 60,
};

export function timeframeMinutes(value: string) {
  return timeframeMinutesMap[value as SupportedTimeframe] ?? null;
}

export function canAggregateTimeframe(sourceTimeframe: string, targetTimeframe: string) {
  const sourceMinutes = timeframeMinutes(sourceTimeframe);
  const targetMinutes = timeframeMinutes(targetTimeframe);
  return sourceMinutes != null && targetMinutes != null && targetMinutes > sourceMinutes;
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
  if (timeframe === "1m") return `epoch:${Math.floor(timestamp / 60_000)}`;
  if (timeframe === "5m") return `epoch:${Math.floor(timestamp / (5 * 60_000))}`;
  if (timeframe === "1h") return `epoch:${Math.floor(timestamp / 3_600_000)}`;
  const parts = localParts(timestamp, timeZone);
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (timeframe === "1w") return weekStartKey(parts.year, parts.month, parts.day);
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
