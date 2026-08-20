export type TimestampedBar = { timestamp: number };

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
