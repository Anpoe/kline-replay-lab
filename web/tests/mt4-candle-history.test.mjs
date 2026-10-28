import test from 'node:test';
import assert from 'node:assert/strict';
import { createMt4CandleHistory, mergeMt4Candles } from '../app/lib/mt4CandleHistory.mjs';
const context = { accountKey: 'a'.repeat(64), symbol: 'XAUUSD', timeframe: 5, live: true };
const candle = n => ({ timestamp: n * 300000, open: 10, high: 12, low: 8, close: 10, volume: n });
const page = (query, bars, extra = {}) => ({ ...query, bars, digits: 2, hasBefore: false, hasAfter: false, ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('live history accumulates beyond snapshot windows; archive quotes cannot unfreeze the current candle', async () => {
  const calls = [];
  const history = createMt4CandleHistory({ onChange() {}, load: async query => {
    calls.push(query);
    return page(query, Array.from({ length: 1000 }, (_, i) => candle(query.before / 300000 - 1000 + i)), { hasBefore: calls.length < 6 });
  } });
  history.setContext(context, [candle(7000)]); await settle();
  for (let i = 0; i < 5; i++) await history.extend('before');
  assert.equal(history.getState().bars.length, 6001);
  history.update([candle(7001)]);
  assert.equal(history.getState().bars.length, 6002);
  assert.equal(history.getState().bars[0].timestamp, candle(1000).timestamp);
  assert.equal(history.getState().hasBefore, false);
  assert.equal(calls[0].before, candle(7000).timestamp);
  const unchanged = history.getState().bars; history.update([candle(7001)]);
  assert.equal(history.getState().bars, unchanged);
  history.dispose();
});
test('focus is a position in the same archive; pages extend both ways without duplicates', async () => {
  const calls = [];
  const history = createMt4CandleHistory({ onChange() {}, load: async query => {
    calls.push(query);
    return page(query, query.before ? [candle(8), candle(9)] : query.after ? [candle(13), candle(14)] : [candle(10), candle(11), candle(12)], { hasBefore: !query.before, hasAfter: !query.after });
  } });
  history.setContext({ ...context, live: false }, [candle(11)], candle(11).timestamp); await settle();
  await history.extend('before'); await history.extend('after');
  assert.deepEqual(history.getState().bars.map(bar => bar.timestamp), Array.from({ length: 7 }, (_, i) => candle(i + 8).timestamp));
  assert.equal(calls[0].focus, candle(11).timestamp);
  assert.equal(calls[1].before, candle(10).timestamp);
  assert.equal(calls[2].after, candle(12).timestamp);
});
test('late responses and failures preserve the correct account; explicit retry recovers', async () => {
  let resolveOld, fail = true;
  const history = createMt4CandleHistory({ onChange() {}, load: async query => {
    if (query.accountKey === context.accountKey) return new Promise(resolve => { resolveOld = resolve; });
    if (fail) throw Error('存储暂时不可读');
    return page(query, [candle(20)]);
  } });
  history.setContext(context, [candle(10)]);
  const other = { ...context, accountKey: 'b'.repeat(64), symbol: 'EURUSD' };
  history.setContext(other, [candle(21)]); await settle();
  resolveOld(page(context, [candle(1)])); await settle();
  assert.match(history.getState().error, /暂时/);
  assert.deepEqual(history.getState().bars, [candle(21)]);
  fail = false; await history.retry();
  assert.equal(history.getState().error, '');
  assert.deepEqual(history.getState().bars, [candle(20), candle(21)]);
});
test('responses with mismatched context are rejected; overlap revisions preserve frozen tail', async () => {
  const history = createMt4CandleHistory({ onChange() {}, load: async query => page(query, [{ ...candle(10), close: 11 }]) });
  history.setContext(context, [candle(10)]); await settle();
  assert.equal(history.getState().bars.at(-1).close, 10);
  assert.equal(mergeMt4Candles([candle(1)], [{ ...candle(1), close: 11 }])[0].close, 11);
  history.dispose();
  const wrong = createMt4CandleHistory({ onChange() {}, load: async query => page({ ...query, timeframe: 15 }, [candle(1)]) });
  wrong.setContext(context, [candle(10)]); await settle();
  assert.match(wrong.getState().error, /周期不匹配/);
  assert.deepEqual(wrong.getState().bars, [candle(10)]);
});
test('candles arriving after an empty backfill reopen browsing on both sides', async () => {
  const calls = [];
  const history = createMt4CandleHistory({ onChange() {}, load: async query => {
    calls.push(query);
    return page(query, query.before ? [candle(9)] : query.after ? [candle(11)] : []);
  } });
  history.setContext({ ...context, live: false }, [], candle(10).timestamp); await settle();
  assert.equal(history.getState().hasBefore, false); assert.equal(history.getState().hasAfter, false);
  history.update([candle(10)]);
  await history.extend('before'); await history.extend('after');
  assert.deepEqual(history.getState().bars, [candle(9), candle(10), candle(11)]);
  assert.equal(calls.length, 3);
});
