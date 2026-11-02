import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLists, updateLists, quoteFromCandles } from '../app/features/watchlist/watchlistController.ts';
import { loadWatchlistQuotes } from '../app/features/watchlist/watchlistGateway.ts';

const gold = { instrumentId: 'XAUUSD.GOLD', symbol: 'XAUUSD.GOLD', name: '黄金', market: 'GOLD' };
test('lists support independent membership, rename, reorder and deletion without changing input', () => {
  const initial = [];
  let lists = updateLists(initial, { type: 'create', id: 'a', name: ' 黄金 ' });
  lists = updateLists(lists, { type: 'create', id: 'b', name: '观察' });
  lists = updateLists(lists, { type: 'add', id: 'a', item: gold });
  lists = updateLists(lists, { type: 'add', id: 'a', item: gold });
  lists = updateLists(lists, { type: 'add', id: 'b', item: gold });
  lists = updateLists(lists, { type: 'add', id: 'a', item: { ...gold, instrumentId: 'EURUSD.FX' } });
  lists = updateLists(lists, { type: 'move', id: 'a', instrumentId: 'EURUSD.FX', direction: -1 });
  assert.equal(lists[0].items[0].instrumentId, 'EURUSD.FX');
  lists = updateLists(lists, { type: 'rename', id: 'a', name: '精选' });
  assert.throws(() => updateLists(lists, { type: 'rename', id: 'a', name: '观察' }), /同名/);
  assert.throws(() => updateLists(lists, { type: 'create', id: 'c', name: ' ' }), /名称/);
  lists = updateLists(lists, { type: 'remove', id: 'a', instrumentId: gold.instrumentId });
  assert.equal(lists[1].items.length, 1);
  lists = updateLists(lists, { type: 'delete', id: 'a' });
  assert.deepEqual(lists.map(x => x.id), ['b']);
  assert.deepEqual(initial, []);
  assert.deepEqual(normalizeLists(JSON.parse(JSON.stringify(lists))), lists);
});
test('malformed storage is rejected without silently overwriting saved lists', () => {
  assert.throws(() => normalizeLists({}), /读取/);
  assert.throws(() => normalizeLists([{ id: 'a', name: 'x', items: [null] }]), /读取/);
});
test('daily changes use two distinct chronological daily closes, including flat and negative days', () => {
  assert.equal(quoteFromCandles([{ timestamp: 2, close: 90 }, { timestamp: 1, close: 100 }]).changePct, -10);
  assert.equal(quoteFromCandles([{ timestamp: 1, close: 100 }, { timestamp: 2, close: 100 }]).changePct, 0);
  assert.equal(quoteFromCandles([{ timestamp: 1, close: 100 }]).changePct, null);
  assert.equal(quoteFromCandles([{ timestamp: 1, close: 0 }, { timestamp: 2, close: 100 }]).changePct, null);
});
test('quote reading covers equities, gold and FX, keeps partial failures recoverable and never starts sync', async () => {
  const calls = [];
  const items = [gold, { ...gold, instrumentId: 'GIC.US', market: 'US' }, { ...gold, instrumentId: 'EURUSD.FX', market: 'FX' }];
  const quotes = await loadWatchlistQuotes(items, async (url, init) => {
    calls.push([url, init]);
    if (url.includes('EURUSD')) throw new Error('offline');
    return { ok: true, json: async () => url === '/api/live-scan'
      ? { prices: [{ instrumentId: 'GIC.US', close: 110, previousClose: 100, timestamp: 2 }] }
      : { candles: [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 105 }] } };
  });
  assert.equal(quotes['GIC.US'].changePct, 10);
  assert.equal(quotes[gold.instrumentId].changePct, 5);
  assert.equal(quotes['EURUSD.FX'].error, true);
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls.find(x => x[0] === '/api/live-scan')[1].body).action, 'refresh');
  assert.equal(JSON.parse(calls.find(x => x[0] === '/api/live-scan')[1].body).storedOnly, true);
  assert.ok(calls.filter(x => x[0].startsWith('/api/candles?')).every(x => new URL(x[0], 'http://local').searchParams.get('limit') === '2'));
  assert.ok(calls.every(x => x[0] === '/api/live-scan' || x[0].startsWith('/api/candles?')));
});

test('large watchlists publish bounded batches without waiting for the entire list and stop on cancellation', async () => {
  const controller = new AbortController();
  const calls = [], progress = [];
  const items = Array.from({ length: 100 }, (_, i) => ({ ...gold, instrumentId: `${i}.SH`, market: 'CN' }));
  const quotes = await loadWatchlistQuotes(items, async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    assert.equal(body.storedOnly, true);
    return { ok: true, json: async () => ({ prices: body.instrumentIds.map(instrumentId => ({ instrumentId, close: 110, previousClose: 100, timestamp: 2 })) }) };
  }, controller.signal, partial => { progress.push(partial); controller.abort(); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].instrumentIds.length, 40);
  assert.equal(Object.keys(progress[0]).length, 40);
  assert.equal(Object.keys(quotes).length, 40);
});
