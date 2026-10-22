import assert from 'node:assert/strict';
import test from 'node:test';
import { mt4ChartWindow, selectMt4ChartFrame, normalizeMt4ChartMotion, selectMt4FloatingFrame, mt4FloatingOrderKey } from '../app/lib/mt4ChartWindow.mjs';

const open = Date.UTC(2026, 9, 20, 10);
const settings = { enabled: true, startSeconds: 10, endSeconds: 20 };
const clock = (seconds, patch = {}) => ({ settings, openTime: open, timeframe: 5, serverTime: open / 1000 + seconds, receivedAt: 1000, now: 1000, connected: true, ...patch });
const bar = (close, timestamp = open) => ({ timestamp, open: 100, high: Math.max(101, close), low: 99, close, volume: close * 2 });

test('opens and closes the visible windows at their exact server-time boundaries', () => {
  for (const seconds of [0, 9.999, 280, 299.999]) assert.equal(mt4ChartWindow(clock(seconds)), 'live');
  for (const seconds of [10, 100, 279.999]) assert.equal(mt4ChartWindow(clock(seconds)), 'frozen');
  assert.equal(mt4ChartWindow(clock(300)), 'waiting');
  assert.equal(mt4ChartWindow(clock(-1)), 'waiting');
});

test('uses elapsed receipt time and the actual monthly close, including leap February', () => {
  assert.equal(mt4ChartWindow(clock(9, { now: 2000 })), 'frozen');
  const feb = Date.UTC(2024, 1, 1), march = Date.UTC(2024, 2, 1);
  assert.equal(mt4ChartWindow(clock(0, { openTime: feb, timeframe: 43200, serverTime: march / 1000 - 20 })), 'live');
  assert.equal(mt4ChartWindow(clock(0, { openTime: feb, timeframe: 43200, serverTime: march / 1000 - 21 })), 'frozen');
  assert.equal(mt4ChartWindow(clock(0, { openTime: feb, timeframe: 43200, serverTime: march / 1000 })), 'waiting');
});

test('does not invent a new period from a stale bar or an unavailable terminal clock', () => {
  assert.equal(mt4ChartWindow(clock(601)), 'waiting');
  assert.equal(mt4ChartWindow(clock(2, { connected: false })), 'paused');
  assert.equal(mt4ChartWindow(clock(2, { now: 16001 })), 'paused');
  assert.equal(mt4ChartWindow(clock(2, { serverTime: undefined })), 'clock');
  assert.equal(mt4ChartWindow(clock(2, { openTime: 0 })), 'waiting');
});

test('overlapping windows show the whole bar, and disabled mode does not depend on a clock', () => {
  for (const seconds of [0, 30, 59.999]) assert.equal(mt4ChartWindow(clock(seconds, { timeframe: 1, settings: { ...settings, startSeconds: 30, endSeconds: 30 } })), 'live');
  assert.equal(mt4ChartWindow(clock(100, { connected: false, serverTime: undefined, settings: { ...settings, enabled: false } })), 'live');
});

test('freezes OHLCV without modifying the live input, then catches up when the closing window opens', () => {
  const initial = [bar(101)];
  const first = selectMt4ChartFrame(null, { scope: 'account:A:XAUUSD:5', bars: initial, window: 'live' });
  const tick = [bar(103)];
  const frozen = selectMt4ChartFrame(first, { scope: first.scope, bars: tick, window: 'frozen' });
  assert.equal(frozen, first);
  assert.equal(frozen.bars[0].close, 101);
  assert.equal(tick[0].close, 103);
  assert.equal(tick[0].volume, 206);
  const caughtUp = selectMt4ChartFrame(frozen, { scope: first.scope, bars: tick, window: 'live' });
  assert.equal(caughtUp.bars, tick);
  assert.equal(caughtUp.bars[0].volume, 206);
});

test('takes an honest initial snapshot and updates the baseline on rollover or identity changes', () => {
  let frame = selectMt4ChartFrame(null, { scope: 'account:A:XAUUSD:5', bars: [bar(101)], window: 'frozen' });
  const rollover = [bar(105), bar(106, open + 300000)];
  frame = selectMt4ChartFrame(frame, { scope: frame.scope, bars: rollover, window: 'frozen' });
  assert.equal(frame.bars, rollover);
  for (const scope of ['account:B:XAUUSD:5', 'account:B:EURUSD:5', 'account:B:EURUSD:15', 'new-session:B:EURUSD:15']) {
    const replacement = [bar(200)];
    frame = selectMt4ChartFrame(frame, { scope, bars: replacement, window: 'frozen' });
    assert.equal(frame.bars, replacement);
    assert.equal(frame.scope, scope);
  }
  frame = selectMt4ChartFrame(frame, { scope: frame.scope, bars: [], window: 'frozen' });
  assert.deepEqual(frame.bars, []);
});

test('normalizes saved windows safely, independently and without enabling old settings', () => {
  for (const input of [undefined, null, [], 'bad', { enabled: 'true' }]) assert.equal(normalizeMt4ChartMotion(input).enabled, false);
  assert.deepEqual(normalizeMt4ChartMotion({ enabled: true, startSeconds: 0, endSeconds: Infinity }), { enabled: true, startSeconds: 1, endSeconds: 10 });
  assert.deepEqual(normalizeMt4ChartMotion({ enabled: true, startSeconds: 100000, endSeconds: 20.8 }), { enabled: true, startSeconds: 86400, endSeconds: 21 });
});

test('keeps an empty waiting frame stable across renders', () => {
  const previous = { scope: 'empty', bars: [] };
  assert.equal(selectMt4ChartFrame(previous, { scope: 'empty', bars: [], window: 'live' }), previous);
});

test('floating money freezes with the chart while live order identities still appear and disappear', () => {
  const order = { ticket: 1, symbol: 'XAUUSD', type: 0, openTime: 10, profit: 10, swap: -1, commission: -2 };
  const input = { scope: 'a:XAUUSD:5', barTimestamp: open, window: 'live', profit: 10, orders: [order] };
  const first = selectMt4FloatingFrame(null, input);
  const tick = { ...input, window: 'frozen', profit: 20, orders: [{ ...order, profit: 20 }] };
  assert.equal(selectMt4FloatingFrame(first, tick), first);
  assert.equal(first.profit, 10);
  assert.equal(first.orderProfits[mt4FloatingOrderKey(order)], 7);
  const fresh = { ...order, ticket: 2, symbol: 'EURUSD', profit: 5 };
  const withNew = selectMt4FloatingFrame(first, { ...tick, orders: [...tick.orders, fresh] });
  assert.equal(withNew.orderProfits[mt4FloatingOrderKey(order)], 7);
  assert.equal(withNew.orderProfits[mt4FloatingOrderKey(fresh)], 2);
  const closed = selectMt4FloatingFrame(withNew, { ...tick, orders: [fresh] });
  assert.equal(closed.orderProfits[mt4FloatingOrderKey(order)], undefined);
  assert.equal(withNew.profit, 12);
  assert.equal(closed.profit, 5);
  assert.equal(selectMt4FloatingFrame(closed, { ...tick, profit: 0, orders: [] }).profit, 0);
  const resumed = selectMt4FloatingFrame(closed, { ...tick, window: 'live' });
  assert.equal(resumed.profit, 20);
  assert.equal(resumed.orderProfits[mt4FloatingOrderKey(order)], 17);
  assert.equal(tick.orders[0].profit, 20);
});
test('floating baselines reset on account, symbol, timeframe, session or candle changes', () => {
  const input = { scope: 'a:XAUUSD:5:session', barTimestamp: open, window: 'frozen', profit: 1, orders: [] };
  const first = selectMt4FloatingFrame(null, input);
  for (const scope of ['b:XAUUSD:5:session', 'a:EURUSD:5:session', 'a:XAUUSD:15:session', 'a:XAUUSD:5:new']) {
    assert.equal(selectMt4FloatingFrame(first, { ...input, scope, profit: 9 }).profit, 9);
  }
  assert.equal(selectMt4FloatingFrame(first, { ...input, barTimestamp: open + 300000, profit: 9 }).profit, 9);
  assert.equal(selectMt4FloatingFrame(first, { ...input, window: 'live', profit: 9 }).profit, 9);
});
