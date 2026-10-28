import { TIMEFRAME_IDS } from './timeframeCatalog.ts';
import { availableTimeframesForInstrument, type TimeframeCatalogItem } from './timeframeAvailability.ts';

/** Zero length means the complete remaining range, never a fixed-size substitute. */
export function replayRangeEndIndex(start: number, last: number, length: unknown, dateEnd?: number) {
  const count = Number(length);
  const requested = dateEnd ?? (Number.isFinite(count) && count > 0 ? start + Math.round(count) : last);
  return Math.max(start, Math.min(last, requested));
}

export function randomReplayPairs<T extends TimeframeCatalogItem>(
  instruments: readonly T[],
  mode: 'current' | 'all' | 'fixed',
  current: string,
  fixed: string,
) {
  const requested = mode === 'current' ? [current] : mode === 'fixed' ? [fixed] : TIMEFRAME_IDS;
  return instruments.flatMap(instrument => availableTimeframesForInstrument([instrument], instrument.id, requested)
    .map(timeframe => ({ instrument, timeframe })));
}
