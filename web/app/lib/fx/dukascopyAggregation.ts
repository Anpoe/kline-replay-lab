import type { FxCandle } from "./dukascopyCsv";

export type { FxCandle } from "./dukascopyCsv";

export type FxTimeframe = "1m" | "5m" | "1h" | "1d" | "1w";

export type FxSessionOptions = {
  /** The local time at which an FX trading day starts. */
  timeZone?: string;
  sessionStartHour?: number;
  sessionStartMinute?: number;
  /** 0 = Sunday, 1 = Monday, ...; FX defaults to Sunday. */
  weekStartsOn?: number;
};

export const DEFAULT_FX_SESSION: Required<FxSessionOptions> = {
  timeZone: "America/New_York",
  sessionStartHour: 17,
  sessionStartMinute: 0,
  weekStartsOn: 0,
};

export type FxCandleGap = {
  fromTimestamp: number;
  toTimestamp: number;
  expectedFirstTimestamp: number;
  missingBuckets: number;
  kind: "weekend" | "missing";
  ignored: boolean;
};

type LocalDateParts = { year: number; month: number; day: number };
type LocalDateTimeParts = LocalDateParts & { hour: number; minute: number; second: number };

function resolveSession(input: FxSessionOptions = {}): Required<FxSessionOptions> {
  const session = { ...DEFAULT_FX_SESSION, ...input };
  if (!Number.isInteger(session.sessionStartHour) || session.sessionStartHour < 0 || session.sessionStartHour > 23) {
    throw new Error("sessionStartHour 必须在 0 到 23 之间");
  }
  if (!Number.isInteger(session.sessionStartMinute) || session.sessionStartMinute < 0 || session.sessionStartMinute > 59) {
    throw new Error("sessionStartMinute 必须在 0 到 59 之间");
  }
  if (!Number.isInteger(session.weekStartsOn) || session.weekStartsOn < 0 || session.weekStartsOn > 6) {
    throw new Error("weekStartsOn 必须在 0 到 6 之间");
  }
  return session;
}

function datePartsToUtcMs(parts: LocalDateTimeParts) {
  const timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day ||
    check.getUTCHours() !== parts.hour ||
    check.getUTCMinutes() !== parts.minute ||
    check.getUTCSeconds() !== parts.second
  ) return null;
  return timestamp;
}

function localDateTimeParts(timestamp: number, timeZone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function addCalendarDays(date: LocalDateParts, amount: number): LocalDateParts {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
  value.setUTCDate(value.getUTCDate() + amount);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function zonedDateTimeToUtcMs(date: LocalDateParts, hour: number, minute: number, timeZone: string) {
  const wallClockAsUtc = datePartsToUtcMs({ ...date, hour, minute, second: 0 });
  if (wallClockAsUtc == null) return null;
  if (timeZone === "UTC" || timeZone === "Etc/UTC" || timeZone === "GMT") return wallClockAsUtc;
  let guess = wallClockAsUtc;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = localDateTimeParts(guess, timeZone);
    const actualAsUtc = datePartsToUtcMs(actual);
    if (actualAsUtc == null) return null;
    guess = wallClockAsUtc - (actualAsUtc - guess);
  }
  return Number.isFinite(guess) ? guess : null;
}

function tradingDate(timestamp: number, session: Required<FxSessionOptions>): LocalDateParts {
  const local = localDateTimeParts(timestamp, session.timeZone);
  const beforeStart = local.hour < session.sessionStartHour ||
    (local.hour === session.sessionStartHour && local.minute < session.sessionStartMinute);
  const date = { year: local.year, month: local.month, day: local.day };
  return beforeStart ? addCalendarDays(date, -1) : date;
}

function dayOfWeek(date: LocalDateParts) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function timeframeDurationMs(timeframe: FxTimeframe) {
  switch (timeframe) {
    case "1m": return 60_000;
    case "5m": return 5 * 60_000;
    case "1h": return 60 * 60_000;
    case "1d": return 24 * 60 * 60_000;
    case "1w": return 7 * 24 * 60 * 60_000;
  }
}

/** Returns the UTC start bucket without creating empty buckets. */
export function bucketStartTimestamp(timestamp: number, timeframe: FxTimeframe, inputSession: FxSessionOptions = {}) {
  if (!Number.isFinite(timestamp)) throw new Error("timestamp 必须是有限数值");
  const session = resolveSession(inputSession);
  const duration = timeframeDurationMs(timeframe);
  if (timeframe === "1m" || timeframe === "5m" || timeframe === "1h") return Math.floor(timestamp / duration) * duration;

  const date = tradingDate(timestamp, session);
  if (timeframe === "1d") return zonedDateTimeToUtcMs(date, session.sessionStartHour, session.sessionStartMinute, session.timeZone) as number;
  const offset = (dayOfWeek(date) - session.weekStartsOn + 7) % 7;
  const weekStart = addCalendarDays(date, -offset);
  return zonedDateTimeToUtcMs(weekStart, session.sessionStartHour, session.sessionStartMinute, session.timeZone) as number;
}

function mergeCandle(current: FxCandle, next: FxCandle): FxCandle {
  return {
    timestamp: current.timestamp,
    open: current.open,
    high: Math.max(current.high, next.high),
    low: Math.min(current.low, next.low),
    close: next.close,
    volume: current.volume == null || next.volume == null ? null : current.volume + next.volume,
    turnover: null,
  };
}

function firstCandle(candle: FxCandle, bucket: number): FxCandle {
  return { ...candle, timestamp: bucket, turnover: null };
}

/** Pure aggregation. The input is copied and sorted; no source array is mutated. */
export function aggregateCandles(candles: Iterable<FxCandle>, timeframe: FxTimeframe, inputSession: FxSessionOptions = {}) {
  const session = resolveSession(inputSession);
  const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
  const result: FxCandle[] = [];
  let currentBucket: number | undefined;
  let current: FxCandle | undefined;
  for (const candle of sorted) {
    const bucket = bucketStartTimestamp(candle.timestamp, timeframe, session);
    if (currentBucket == null || bucket !== currentBucket) {
      if (current) result.push(current);
      currentBucket = bucket;
      current = firstCandle(candle, bucket);
    } else if (current) {
      current = mergeCandle(current, candle);
    }
  }
  if (current) result.push(current);
  return result;
}

export function aggregateM1To5m(candles: Iterable<FxCandle>, inputSession: FxSessionOptions = {}) {
  return aggregateCandles(candles, "5m", inputSession);
}

export function aggregate5mToTimeframe(candles: Iterable<FxCandle>, timeframe: "1h" | "1d" | "1w", inputSession: FxSessionOptions = {}) {
  return aggregateCandles(candles, timeframe, inputSession);
}

export type StreamingCandleAggregator = {
  add(candle: FxCandle): FxCandle | null;
  finish(): FxCandle | null;
};

/**
 * Streaming aggregation for sorted input. It emits a completed bucket as soon
 * as the next bucket is seen, so a caller can process chunks without retaining
 * the complete CSV or complete candle series.
 */
export function createStreamingCandleAggregator(timeframe: FxTimeframe, inputSession: FxSessionOptions = {}): StreamingCandleAggregator {
  const session = resolveSession(inputSession);
  let currentBucket: number | undefined;
  let current: FxCandle | undefined;

  return {
    add(candle) {
      const bucket = bucketStartTimestamp(candle.timestamp, timeframe, session);
      if (currentBucket != null && bucket < currentBucket) throw new Error("流式聚合要求输入按 timestamp 升序");
      if (currentBucket == null) {
        currentBucket = bucket;
        current = firstCandle(candle, bucket);
        return null;
      }
      if (bucket === currentBucket) {
        current = mergeCandle(current as FxCandle, candle);
        return null;
      }
      const completed = current;
      currentBucket = bucket;
      current = firstCandle(candle, bucket);
      return completed ?? null;
    },
    finish() {
      const completed = current;
      current = undefined;
      currentBucket = undefined;
      return completed ?? null;
    },
  };
}

export function* aggregateCandleChunks(chunks: Iterable<Iterable<FxCandle>>, timeframe: FxTimeframe, inputSession: FxSessionOptions = {}): Generator<FxCandle> {
  const aggregator = createStreamingCandleAggregator(timeframe, inputSession);
  for (const chunk of chunks) {
    for (const candle of chunk) {
      const completed = aggregator.add(candle);
      if (completed) yield completed;
    }
  }
  const final = aggregator.finish();
  if (final) yield final;
}

function nextExpectedBucket(timestamp: number, timeframe: FxTimeframe, session: Required<FxSessionOptions>) {
  if (timeframe === "1m" || timeframe === "5m" || timeframe === "1h") return timestamp + timeframeDurationMs(timeframe);
  const local = localDateTimeParts(timestamp, session.timeZone);
  const date = addCalendarDays({ year: local.year, month: local.month, day: local.day }, timeframe === "1w" ? 7 : 1);
  return zonedDateTimeToUtcMs(date, session.sessionStartHour, session.sessionStartMinute, session.timeZone) as number;
}

function isFxSessionClosed(timestamp: number, session: Required<FxSessionOptions>) {
  const local = localDateTimeParts(timestamp, session.timeZone);
  const weekday = dayOfWeek(local);
  const afterStart = local.hour > session.sessionStartHour ||
    (local.hour === session.sessionStartHour && local.minute >= session.sessionStartMinute);
  if (weekday === 6) return true;
  if (weekday === 0) return !afterStart;
  if (weekday === 5) return afterStart;
  return false;
}

function weekendOnlyGap(firstMissing: number, missingBuckets: number, timeframe: FxTimeframe, session: Required<FxSessionOptions>) {
  if (missingBuckets <= 0 || missingBuckets > 20_000) return false;
  let cursor = firstMissing;
  for (let index = 0; index < missingBuckets; index += 1) {
    if (!isFxSessionClosed(cursor, session)) return false;
    cursor = nextExpectedBucket(cursor, timeframe, session);
  }
  return true;
}

/**
 * Reports gaps while classifying a normal Friday-close/Sunday-open interval as
 * weekend. It never creates synthetic candles and does not treat a weekend as
 * an ordinary missing-data error.
 */
export function findFxCandleGaps(candles: Iterable<FxCandle>, timeframe: FxTimeframe, inputSession: FxSessionOptions = {}) {
  const session = resolveSession(inputSession);
  const buckets = [...new Set([...candles].map((candle) => bucketStartTimestamp(candle.timestamp, timeframe, session)))].sort((left, right) => left - right);
  const gaps: FxCandleGap[] = [];
  for (let index = 1; index < buckets.length; index += 1) {
    const fromTimestamp = buckets[index - 1];
    const toTimestamp = buckets[index];
    const expectedFirstTimestamp = nextExpectedBucket(fromTimestamp, timeframe, session);
    if (toTimestamp <= expectedFirstTimestamp) continue;
    let cursor = expectedFirstTimestamp;
    let missingBuckets = 0;
    while (cursor < toTimestamp && missingBuckets <= 20_000) {
      missingBuckets += 1;
      cursor = nextExpectedBucket(cursor, timeframe, session);
    }
    if (cursor < toTimestamp) missingBuckets = Math.max(missingBuckets, Math.floor((toTimestamp - expectedFirstTimestamp) / timeframeDurationMs(timeframe)));
    const weekend = weekendOnlyGap(expectedFirstTimestamp, missingBuckets, timeframe, session);
    gaps.push({
      fromTimestamp,
      toTimestamp,
      expectedFirstTimestamp,
      missingBuckets,
      kind: weekend ? "weekend" : "missing",
      ignored: weekend,
    });
  }
  return gaps;
}

