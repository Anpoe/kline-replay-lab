import { useCallback, useEffect, useState } from 'react';
import type { KLineData } from 'klinecharts';
import { createCandleHistory, type CandleHistoryState } from '../../lib/candleHistory.mjs';

export const OBSERVATION_PAGE_SIZE = 500;
export async function loadObservationPage<T>(instrumentId: string, timeframe: string, signal: AbortSignal, before?: number): Promise<T> {
  const params = new URLSearchParams({ instrument: instrumentId, timeframe, limit: String(OBSERVATION_PAGE_SIZE) });
  if (before !== undefined) params.set('before', String(before));
  const response = await fetch(`/api/candles?${params}`, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  if (!response.ok) throw new Error('行情未能读取，请重试或检查行情数据。');
  return response.json() as Promise<T>;
}

// Observation owns only the displayed history. Trading/training indexes stay in
// the canonical series and are never shifted by prepending a chart page.
export function useObservationHistory(enabled: boolean, instrumentId: string, timeframe: string, seed: KLineData[]) {
  const [state, setState] = useState<CandleHistoryState>();
  const [history] = useState(() => createCandleHistory({
    loadInitial: false,
    keyOf: (context: { instrumentId: string; timeframe: string; live: boolean }) => JSON.stringify([context.instrumentId, context.timeframe]),
    load: async (query, signal) => {
      const page = await loadObservationPage<{ candles: KLineData[]; hasBefore: boolean }>(query.instrumentId, query.timeframe, signal, query.before);
      return { bars: page.candles, hasBefore: page.hasBefore };
    },
    onChange: setState,
  }));
  const key = JSON.stringify([instrumentId, timeframe]);
  const active = enabled && state?.identity === key ? state : undefined;
  useEffect(() => {
    history.setContext(enabled ? { instrumentId, timeframe, live: true } : null, seed);
    return () => history.dispose();
  }, [enabled, history, instrumentId, timeframe, seed]);
  const onRange = useCallback((range: { before: boolean; after: boolean }) => {
    if (range.before) void history.extend('before');
  }, [history]);
  return { bars: active?.bars ?? seed, loading: active?.loading ?? false, error: active?.error ?? '', onRange: enabled ? onRange : undefined, retry: () => history.retry() };
}
