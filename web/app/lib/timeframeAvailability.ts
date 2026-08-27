import { canAggregateTimeframe, TIMEFRAME_IDS, isSupportedTimeframe } from "./timeframeCatalog.ts";

export type TimeframeCatalogItem = {
  id: string;
  timeframes?: readonly string[];
};

export function normalizeTimeframeCoverage(values: unknown): string[] {
  const candidates = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(",")
      : [];
  const available = new Set(
    candidates
      .map((value) => String(value))
      .filter((value) => isSupportedTimeframe(value)),
  );
  return TIMEFRAME_IDS.filter((timeframe) => available.has(timeframe));
}

export function availableTimeframesForInstrument(
  instruments: readonly TimeframeCatalogItem[],
  instrumentId: string,
  supportedTimeframes: readonly string[],
): string[] {
  const instrument = instruments.find((item) => item.id === instrumentId);
  if (!instrument?.timeframes?.length) return [];

  const available = new Set(normalizeTimeframeCoverage(instrument.timeframes));
  return supportedTimeframes.filter((timeframe) => (
    available.has(timeframe)
    || [...available].some((sourceTimeframe) => canAggregateTimeframe(sourceTimeframe, timeframe))
  ));
}

export function timeframeDisplayOptions(supportedTimeframes: readonly string[]) {
  return [...supportedTimeframes];
}

export function isTimeframeAvailable(
  instruments: readonly TimeframeCatalogItem[],
  instrumentId: string,
  timeframe: string,
) {
  return availableTimeframesForInstrument(instruments, instrumentId, [timeframe]).includes(timeframe);
}

export function resolveAvailableTimeframe(
  availableTimeframes: readonly string[],
  requestedTimeframe: string,
): string {
  return availableTimeframes.includes(requestedTimeframe)
    ? requestedTimeframe
    : availableTimeframes[0] ?? requestedTimeframe;
}
