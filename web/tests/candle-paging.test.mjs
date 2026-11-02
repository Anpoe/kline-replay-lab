import test from 'node:test';
import assert from 'node:assert/strict';
import { candlePageQuery, sliceCandlePage } from '../app/lib/candlePaging.mjs';
import { createCandleHistory } from '../app/lib/candleHistory.mjs';

test('bounded candle pages retain ascending order, use exclusive cursors, and terminate without gaps', () => {
  const candles = Array.from({ length: 1201 }, (_, timestamp) => ({ timestamp, close: timestamp + 1 }));
  let before, result = [], pages = 0;
  while (true) {
    const page = sliceCandlePage(candles, { limit: 500, before });
    assert.ok(page.candles.length <= 500);
    result = [...page.candles, ...result]; pages++;
    if (!page.hasBefore) break;
    before = page.candles[0].timestamp;
  }
  assert.equal(pages, 3);
  assert.deepEqual(result, candles);
  assert.equal(sliceCandlePage(candles, null).candles, candles);
  assert.deepEqual(sliceCandlePage(candles, { limit: 2, before: 0 }), { candles: [], hasBefore: false });
});

test('pagination is opt-in and rejects invalid or unbounded requests', () => {
  assert.equal(candlePageQuery(new URLSearchParams()), null);
  assert.deepEqual(candlePageQuery(new URLSearchParams('limit=500&before=123')), { limit: 500, before: 123 });
  for (const query of ['limit=0', 'limit=NaN', 'limit=2001', 'limit=1.5', 'limit=1&before=NaN']) assert.throws(() => candlePageQuery(new URLSearchParams(query)));
});

test('observation reuses history paging without fetching until the user reaches an edge', async () => {
  const calls = [];
  const seed = [{ timestamp: 10, close: 100 }];
  const history = createCandleHistory({
    loadInitial: false, keyOf: context => context.instrumentId, onChange() {},
    load: async query => { calls.push(query); return { bars: [{ timestamp: 9, close: 99 }, { timestamp: 10, close: 1 }], hasBefore: false }; },
  });
  history.setContext({ instrumentId: 'A', live: true }, seed);
  assert.equal(calls.length, 0);
  await history.extend('before');
  assert.equal(calls[0].before, 10);
  assert.deepEqual(history.getState().bars, [{ timestamp: 9, close: 99 }, ...seed]);
  await history.extend('before');
  assert.equal(calls.length, 1);
  history.dispose();
});
