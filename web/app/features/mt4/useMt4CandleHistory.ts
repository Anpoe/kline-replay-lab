import { useCallback, useEffect, useState } from 'react';
import type { KLineData } from 'klinecharts';
import { createMt4CandleHistory, type Mt4CandleContext, type Mt4CandlePage, type Mt4CandleHistoryState } from '../../lib/mt4CandleHistory.mjs';
import { requestMt4Archive } from './mt4Gateway';

export function useMt4CandleHistory(context: Mt4CandleContext, seed: KLineData[], focus = 0, evidence = false) {
  const [state, setState] = useState<Mt4CandleHistoryState>({ bars: [], loading: false, error: '', hasBefore: false, hasAfter: false });
  const [history] = useState(() => createMt4CandleHistory({
    load: (query, signal) => requestMt4Archive<Mt4CandlePage>({ action: 'bars', accountKey: query.accountKey, symbol: query.symbol, timeframe: query.timeframe, before: query.before ?? 0, after: query.after ?? 0, focus: query.focus ?? 0 }, undefined, AbortSignal.any([signal, AbortSignal.timeout(15000)])),
    onChange: setState,
  }));
  const { accountKey, symbol, timeframe, live } = context;
  const identity = JSON.stringify([accountKey, symbol, timeframe, live, focus]);
  useEffect(() => {
    history.setContext(!evidence && /^[a-f0-9]{64}$/.test(accountKey) && symbol ? { accountKey, symbol, timeframe, live } : null, seed, focus);
  }, [history, identity, accountKey, symbol, timeframe, live, evidence, seed, focus]);
  useEffect(() => () => history.dispose(), [history]);
  useEffect(() => { history.update(seed); }, [history, seed]);
  const onRange = useCallback((range: { before: boolean; after: boolean }) => {
    if (range.before && history.getState().hasBefore) void history.extend('before');
    else if (range.after) void history.extend('after');
  }, [history]);
  const active = !evidence && state.identity === identity;
  return { ...state, bars: active ? state.bars : seed, error: active ? state.error : '', digits: active ? state.digits : undefined, onRange: active ? onRange : undefined, retry: () => { void history.retry(); } };
}
