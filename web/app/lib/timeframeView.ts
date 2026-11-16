import { bucketStartTimestamp, nextBucketStartTimestamp, type FxTimeframe } from './fx/dukascopyAggregation.ts';
import type { TrainingTask } from './trainingTasks.ts';

export type TimestampedBar = { timestamp: number };
type DrawingPoint = { timestamp?: number; dataIndex?: number; value?: number };

/** Sub-bar coordinates for annotations; timestamps remain stable across paging and timeframes. */
export function interpolatedDrawingIndex(bars: readonly TimestampedBar[], timestamp: number): number | undefined {
  if (!bars.length || !Number.isFinite(timestamp)) return undefined;
  if (bars.length === 1) return 0;
  let left = 0, right = bars.length - 1;
  while (left < right) {
    const middle = Math.ceil((left + right) / 2);
    if (bars[middle].timestamp <= timestamp) left = middle;
    else right = middle - 1;
  }
  const index = Math.min(left, bars.length - 2);
  const span = bars[index + 1].timestamp - bars[index].timestamp;
  return span > 0 ? index + (timestamp - bars[index].timestamp) / span : index;
}

/** Adapt chart coordinates while keeping the existing drawing format and editor. */
export function remapReplayDrawingPoints<T extends { name?: string; points: DrawingPoint[] }>(
  drawing: T, source: readonly TimestampedBar[], target: readonly TimestampedBar[], sourceOffset = 0, targetOffset = 0,
): T {
  return { ...drawing, points: drawing.points.map(point => {
    const timestamp = point.timestamp ?? (point.dataIndex == null ? undefined : source[point.dataIndex - sourceOffset]?.timestamp);
    if (timestamp == null) return point;
    if (drawing.name === "trainingTextBox") {
      const index = interpolatedDrawingIndex(target, timestamp);
      return index == null ? point : { ...point, timestamp, dataIndex: index + targetOffset };
    }
    const index = findTimeframeViewCursor(target, timestamp);
    return index < 0 ? point : { ...point, timestamp: target[index].timestamp, dataIndex: index + targetOffset };
  }) };
}

export type TimeframeViewSourceMode = "aggregated" | "direct";

export type TimeframeViewSourceMetadataInput = {
  sourceSnapshotId: string;
  sourceTimeframe: string;
  targetTimeframe: string;
  mode: TimeframeViewSourceMode;
  firstTimestamp: number;
  lastTimestamp: number;
};

export function buildTimeframeViewSourceMetadata({
  sourceSnapshotId,
  sourceTimeframe,
  targetTimeframe,
  mode,
  firstTimestamp,
  lastTimestamp,
}: TimeframeViewSourceMetadataInput) {
  return {
    kind: "timeframe-view" as const,
    version: 1 as const,
    sourceSnapshotId,
    sourceTimeframe,
    targetTimeframe,
    mode,
    firstTimestamp,
    lastTimestamp,
  };
}

export function findTimeframeViewCursor<T extends TimestampedBar>(bars: readonly T[], timestamp: number) {
  if (!Number.isFinite(timestamp)) return -1;
  let cursor = -1;
  bars.forEach((bar, index) => {
    if (Number.isFinite(bar.timestamp) && bar.timestamp <= timestamp) cursor = index;
  });
  return cursor;
}

export function visibleTimeframeViewBars<T extends TimestampedBar>(
  bars: readonly T[],
  timestamp: number,
  inclusive = true,
) {
  if (!Number.isFinite(timestamp)) return [];
  return bars.filter((bar) => (
    Number.isFinite(bar.timestamp)
    && (inclusive ? bar.timestamp <= timestamp : bar.timestamp < timestamp)
  ));
}

/** Reuse the same calendar/session buckets as the chart; the result is exclusive. */
export function replayTimeframeEnd(timestamp: number, timeframe: string, timezone: string, fx: boolean) {
  const session = { timeZone: timezone, sessionStartHour: fx ? 17 : 0, sessionStartMinute: 0, weekStartsOn: fx ? 0 : 1 };
  const start = bucketStartTimestamp(timestamp, timeframe as FxTimeframe, session);
  return nextBucketStartTimestamp(start, timeframe as FxTimeframe, session);
}

/** Preserve the selected random period's fully revealed start and original end. */
export function rebaseReplayTaskToFinerBars(
  task: TrainingTask,
  bars: readonly TimestampedBar[],
  timeframe: string,
  timezone: string,
  fx: boolean,
): TrainingTask {
  const startCursor = findTimeframeViewCursor(bars, replayTimeframeEnd(task.startTimestamp, timeframe, timezone, fx) - 1);
  const endCursor = findTimeframeViewCursor(bars, replayTimeframeEnd(task.endTimestamp, timeframe, timezone, fx) - 1);
  if (startCursor < 0 || endCursor < startCursor
    || bars[startCursor].timestamp < task.startTimestamp || bars[endCursor].timestamp < task.endTimestamp) {
    throw new Error('该训练区间缺少小周期行情，请补齐训练数据后重试。');
  }
  return { ...task, startCursor, endCursor, startTimestamp: bars[startCursor].timestamp,
    endTimestamp: bars[endCursor].timestamp, requestedLength: task.requestedLength == null ? null : endCursor - startCursor };
}
