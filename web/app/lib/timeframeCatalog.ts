export const TIMEFRAME_IDS = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1mo",
] as const;

export type TimeframeId = typeof TIMEFRAME_IDS[number];

export const TIMEFRAME_LABELS: Readonly<Record<TimeframeId, string>> = Object.freeze({
  "1m": "M1",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "4h": "H4",
  "1d": "D1",
  "1w": "W1",
  "1mo": "MN",
});

const timeframeSet = new Set<string>(TIMEFRAME_IDS);
const timeframeRanks = new Map<string, number>(TIMEFRAME_IDS.map((value, index) => [value, index]));
const fixedTimeframeMinutes: Readonly<Partial<Record<TimeframeId, number>>> = Object.freeze({
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 4 * 60,
  "1d": 24 * 60,
  "1w": 7 * 24 * 60,
});

export function isSupportedTimeframe(value: unknown): value is TimeframeId {
  return typeof value === "string" && timeframeSet.has(value);
}

export function timeframeRank(value: string) {
  return timeframeRanks.get(value) ?? null;
}

export function timeframeMinutes(value: string) {
  if (!isSupportedTimeframe(value)) return null;
  return fixedTimeframeMinutes[value] ?? null;
}

export function timeframeLookbackMs(value: string) {
  const minutes = timeframeMinutes(value);
  if (minutes != null) return minutes * 60_000;
  if (value === "1mo") return 31 * 24 * 60 * 60_000;
  return null;
}

export function isCalendarTimeframe(value: string) {
  return value === "1mo";
}

export function timeframeLabel(value: string) {
  return isSupportedTimeframe(value) ? TIMEFRAME_LABELS[value] : value;
}

export function canAggregateTimeframe(sourceTimeframe: string, targetTimeframe: string) {
  const sourceRank = timeframeRank(sourceTimeframe);
  const targetRank = timeframeRank(targetTimeframe);
  if (sourceRank == null || targetRank == null || targetRank <= sourceRank) return false;
  // A weekly OHLCV bar can cross two calendar months, so it cannot be
  // losslessly regrouped into monthly OHLCV. Monthly views must use daily or
  // finer source candles (or a direct MN series).
  if (sourceTimeframe === "1w" && targetTimeframe === "1mo") return false;
  return true;
}
