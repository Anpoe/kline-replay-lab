export type LegacyUsDataSummary = {
  needsRebuild: boolean;
  instrumentCount: number;
  barCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
};

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableTimestamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export type LegacyUsDataCoverageRow = {
  legacyBarCount?: unknown;
  adjustedBarCount?: unknown;
  firstTimestamp?: unknown;
  lastTimestamp?: unknown;
};

export function shouldRebuildLegacyUsData(input: {
  legacyBarCount?: unknown;
  adjustedBarCount?: unknown;
}) {
  return toNumber(input.legacyBarCount) > 0 && toNumber(input.adjustedBarCount) <= 0;
}

export function summarizeLegacyUsData(rows: readonly LegacyUsDataCoverageRow[]) {
  const pending = rows.filter(shouldRebuildLegacyUsData);
  const firstTimestamps = pending
    .map((row) => nullableTimestamp(row.firstTimestamp))
    .filter((value): value is number => value !== null);
  const lastTimestamps = pending
    .map((row) => nullableTimestamp(row.lastTimestamp))
    .filter((value): value is number => value !== null);
  return normalizeLegacyUsDataSummary({
    instrumentCount: pending.length,
    barCount: pending.reduce((sum, row) => sum + toNumber(row.legacyBarCount), 0),
    firstTimestamp: firstTimestamps.length ? Math.min(...firstTimestamps) : null,
    lastTimestamp: lastTimestamps.length ? Math.max(...lastTimestamps) : null,
  });
}

export function normalizeLegacyUsDataSummary(row: {
  instrumentCount?: unknown;
  barCount?: unknown;
  firstTimestamp?: unknown;
  lastTimestamp?: unknown;
} | null | undefined): LegacyUsDataSummary {
  const instrumentCount = toNumber(row?.instrumentCount);
  const barCount = toNumber(row?.barCount);
  return {
    needsRebuild: instrumentCount > 0 && barCount > 0,
    instrumentCount,
    barCount,
    firstTimestamp: nullableTimestamp(row?.firstTimestamp),
    lastTimestamp: nullableTimestamp(row?.lastTimestamp),
  };
}
