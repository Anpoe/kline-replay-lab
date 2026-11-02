import { createCandleHistory } from './candleHistory.mjs';
export { mergeCandles as mergeMt4Candles } from './candleHistory.mjs';

export function createMt4CandleHistory({ load, onChange }) {
  return createCandleHistory({
    load, onChange,
    keyOf: (context, focus) => JSON.stringify([context.accountKey, context.symbol, context.timeframe, context.live, focus]),
    validate: (page, context) => {
      if (page.accountKey !== context.accountKey || page.symbol !== context.symbol || page.timeframe !== context.timeframe) throw new Error('行情账户、品种或周期不匹配，请重试读取。');
    },
  });
}
