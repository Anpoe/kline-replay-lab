export type SnapshotCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: number | null;
};

export function computeSnapshotDelta(previousCandles: SnapshotCandle[], currentCandles: SnapshotCandle[]) {
  const previous = new Map(previousCandles.map((candle) => [candle.timestamp, candle]));
  const currentTimestamps = new Set(currentCandles.map((candle) => candle.timestamp));
  return {
    changedCandles: currentCandles.filter(
      (candle) => JSON.stringify(previous.get(candle.timestamp)) !== JSON.stringify(candle),
    ),
    removedTimestamps: previousCandles
      .filter((candle) => !currentTimestamps.has(candle.timestamp))
      .map((candle) => candle.timestamp),
  };
}
