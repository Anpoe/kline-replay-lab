import { timeframeMinutes } from "./timeframeCatalog.ts";

export type ReplayTradingSession = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  skipWeekends: boolean;
};

export const DEFAULT_REPLAY_TRADING_SESSION: Readonly<ReplayTradingSession> = Object.freeze({
  enabled: false,
  startTime: "07:00",
  endTime: "18:00",
  skipWeekends: false,
});

export function isTradingSessionTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeReplayTradingSession(value: unknown): ReplayTradingSession {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ReplayTradingSession>
    : {};
  const valid = isTradingSessionTime(stored.startTime)
    && isTradingSessionTime(stored.endTime)
    && stored.startTime !== stored.endTime;
  return {
    enabled: stored.enabled === true && valid,
    startTime: valid ? stored.startTime! : DEFAULT_REPLAY_TRADING_SESSION.startTime,
    endTime: valid ? stored.endTime! : DEFAULT_REPLAY_TRADING_SESSION.endTime,
    skipWeekends: stored.skipWeekends === true,
  };
}

function minuteOfDay(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export type ReplaySessionPredicateOptions = {
  session?: ReplayTradingSession;
  timeframe: string;
  timezone: string;
  randomRun?: boolean;
  liveMode?: boolean;
};

export function createReplayTradingSessionPredicate({ session, timeframe, timezone, randomRun = false, liveMode = false }: ReplaySessionPredicateOptions) {
  const normalized = normalizeReplayTradingSession(session);
  const minutes = timeframeMinutes(timeframe);
  const restricted = (normalized.enabled || normalized.skipWeekends)
    && !randomRun
    && !liveMode
    && minutes != null
    && minutes < 1440;
  if (!restricted) return undefined;
  const formatter = normalized.enabled
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      })
    : undefined;
  const weekdayFormatter = normalized.skipWeekends
    ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
    : undefined;
  const start = minuteOfDay(normalized.startTime);
  const finish = minuteOfDay(normalized.endTime);
  return (timestamp: number) => {
    if (weekdayFormatter) {
      const weekday = weekdayFormatter.format(timestamp);
      if (weekday === "Sat" || weekday === "Sun") return false;
    }
    if (!formatter) return true;
    const minute = minuteOfDay(formatter.format(timestamp));
    return start < finish ? minute >= start && minute < finish : minute >= start || minute < finish;
  };
}

export function isReplayTradingSessionBar(timestamp: number, options: ReplaySessionPredicateOptions) {
  return createReplayTradingSessionPredicate(options)?.(timestamp) ?? true;
}

export function firstReplaySkippedBarIndex({
  bars,
  cursor,
  destination,
  ...options
}: ReplaySessionPredicateOptions & {
  bars: readonly { timestamp: number }[];
  cursor: number;
  destination: number;
}) {
  const predicate = createReplayTradingSessionPredicate(options);
  if (!predicate) return null;
  for (let index = cursor + 1; index <= destination && index < bars.length; index += 1) {
    if (!predicate(bars[index].timestamp)) return index;
  }
  return null;
}

/**
 * A replay order becomes eligible only on a candle after it was created.
 * This keeps rewinding and re-entering the creation candle from filling an
 * order that was queued after that candle had already been revealed.
 */
export function isReplayOrderDueAtBar(
  order: { createdAt: number; executeAtTimestamp?: number },
  timestamp: number,
) {
  return order.createdAt < timestamp
    && (order.executeAtTimestamp == null || order.executeAtTimestamp <= timestamp);
}

/** Select a destination only. Every intervening bar is still displayed and processed by the caller. */
export function advanceReplayCursor({
  bars,
  cursor,
  requestedCount,
  endCursor = bars.length - 1,
  session,
  timeframe,
  timezone,
  randomRun = false,
  liveMode = false,
  scheduledOrderTimestamps = [],
}: {
  bars: readonly { timestamp: number }[];
  cursor: number;
  requestedCount: number;
  endCursor?: number;
  session?: ReplayTradingSession;
  timeframe: string;
  timezone: string;
  randomRun?: boolean;
  liveMode?: boolean;
  scheduledOrderTimestamps?: readonly number[];
}) {
  const end = Math.min(endCursor, bars.length - 1);
  if (cursor >= end) return cursor;
  const count = Number.isFinite(requestedCount) ? Math.max(1, Math.floor(requestedCount)) : 1;
  const inSession = createReplayTradingSessionPredicate({ session, timeframe, timezone, randomRun, liveMode });
  let destination = Math.min(end, cursor + count);
  if (inSession) {
    let remaining = count;
    destination = end;
    for (let index = cursor + 1; index <= end; index += 1) {
      if (inSession(bars[index].timestamp) && --remaining === 0) {
        destination = index;
        break;
      }
    }
  }
  // Keep the existing pause before a scheduled order, provided it does not
  // reintroduce a stop outside the user's chosen trading hours.
  const earliestScheduledIndex = scheduledOrderTimestamps
    .map((timestamp) => bars.findIndex((bar, index) => index > cursor && bar.timestamp >= timestamp))
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), Number.POSITIVE_INFINITY);
  if (earliestScheduledIndex > cursor + 1 && destination >= earliestScheduledIndex) {
    const pauseCursor = earliestScheduledIndex - 1;
    if (!inSession || inSession(bars[pauseCursor].timestamp)) return pauseCursor;
  }
  return destination;
}
