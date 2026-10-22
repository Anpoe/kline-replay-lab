import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronizeMt4Clock } from '../app/lib/mt4Clock.mjs';
import { mt4CandleCountdown } from '../app/lib/mt4CandleCountdown.mjs';
import { mt4ChartWindow } from '../app/lib/mt4ChartWindow.mjs';

const opening = Date.UTC(2026, 9, 20, 12);
const sample = { scope: 'account:session', serverTime: opening / 1000 + 100, receivedAt: 10000, now: 10000, monotonicNow: 0, connected: true };
const countdown = (state, input, overrides = {}) => mt4CandleCountdown({ ...input, anchor: state?.anchor, openTime: opening, timeframe: 15, ...overrides });

test('whole-second snapshots with variable arrival times never reset the running second', () => {
  let clock = null;
  const transitions = [];
  let previous;
  for (let elapsed = 0; elapsed <= 6000; elapsed += 50) {
    // Whole seconds, up to 750 ms arrival jitter and a one-second offset wobble.
    const arrival = Math.floor(elapsed / 200) * 200;
    const jitter = [0, 750, 100, 600, 250][Math.floor(arrival / 200) % 5];
    const input = { ...sample, serverTime: sample.serverTime + Math.floor(Math.max(0, arrival - jitter) / 1000) + [0, 0, -1, 0, -1][Math.floor(arrival / 200) % 5], receivedAt: sample.receivedAt + arrival, now: sample.now + elapsed, monotonicNow: elapsed };
    clock = synchronizeMt4Clock(clock, input);
    const value = countdown(clock, input);
    if (value !== previous) { transitions.push({ elapsed, value }); previous = value; }
  }
  assert.deepEqual(transitions, Array.from({ length: 7 }, (_, n) => ({ elapsed: n * 1000, value: '13:' + String(20 - n).padStart(2, '0') })));
});

test('stale replies do not rewind; a delayed browser tick catches up from monotonic time', () => {
  const clock = synchronizeMt4Clock(null, sample);
  assert.equal(synchronizeMt4Clock(clock, { ...sample, receivedAt: 9000, serverTime: sample.serverTime - 20, now: 12000, monotonicNow: 2000 }), clock);
  assert.equal(countdown(clock, { ...sample, now: 13500, monotonicNow: 3500 }), '13:17');
  // System clock adjustments do not advance the presentation clock.
  assert.equal(countdown(clock, { ...sample, now: 14000, monotonicNow: 3500 }), '13:17');
});

test('reconnect, terminal session changes and substantial clock corrections re-anchor', () => {
  const clock = synchronizeMt4Clock(null, sample);
  assert.equal(synchronizeMt4Clock(clock, { ...sample, connected: false }), null);
  assert.equal(synchronizeMt4Clock(clock, { ...sample, now: 26000, monotonicNow: 16000 }), null);
  assert.equal(synchronizeMt4Clock(clock, { ...sample, serverTime: undefined }), null);
  const changed = { ...sample, scope: 'other-account:session', serverTime: sample.serverTime + 30, receivedAt: 11000, now: 11000, monotonicNow: 1000 };
  assert.equal(countdown(synchronizeMt4Clock(clock, changed), changed), '12:50');
  const corrected = { ...changed, scope: sample.scope };
  assert.equal(countdown(synchronizeMt4Clock(clock, corrected), corrected), '12:50');
  const resumed = { ...sample, serverTime: sample.serverTime + 16, receivedAt: 26000, now: 26000, monotonicNow: 16000 };
  assert.equal(countdown(synchronizeMt4Clock(null, resumed), resumed), '13:04');
});

test('countdown and chart motion windows share the same continuous clock at boundaries', () => {
  const input = { ...sample, serverTime: opening / 1000 + 49 };
  let clock = synchronizeMt4Clock(null, input);
  const settings = { enabled: true, startSeconds: 10, endSeconds: 10 };
  const at = (elapsed) => {
    const next = { ...input, serverTime: input.serverTime, receivedAt: input.receivedAt + elapsed, now: input.now + elapsed, monotonicNow: elapsed };
    clock = synchronizeMt4Clock(clock, next);
    return { ...next, anchor: clock.anchor, openTime: opening, timeframe: 1 };
  };
  const before = at(999), after = at(1000);
  assert.equal(countdown(clock, before, { timeframe: 1 }), '00:11');
  assert.equal(mt4ChartWindow({ ...before, settings }), 'frozen');
  assert.equal(countdown(clock, after, { timeframe: 1 }), '00:10');
  assert.equal(mt4ChartWindow({ ...after, settings }), 'live');
  assert.equal(countdown(clock, { ...after, connected: false }), '已暂停');
  assert.equal(countdown(clock, { ...after, now: after.receivedAt + 15001 }), '已暂停');
});
