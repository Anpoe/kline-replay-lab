import test from 'node:test';
import assert from 'node:assert/strict';
import { captureOpenBatchPlan, runOpenBatch } from '../app/features/mt4/mt4OpenBatch.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Mt4Bridge } from '../local-data/mt4-bridge.mjs';

function fixture(orderType = 'limit', side = 'buy') {
  const state = { accountKey: 'a'.repeat(64), enabled: true, connection: 'connected', unresolved: 0, commands: [], selection: { symbol: 'XAUUSD', timeframe: 5 }, snapshot: {
    sessionId: 'batch-session', orderCount: 0, orders: [], history: [], symbols: [],
    account: { login: '123', server: 'Broker', mode: 'demo', connected: true, tradeAllowed: true, allowReal: false },
  } };
  const input = { id: 'initial-0', accountKey: state.accountKey, type: 'open', symbol: 'XAUUSD', side, orderType, lots: .05, price: side === 'buy' ? orderType === 'limit' ? 1990 : 2010 : orderType === 'limit' ? 2010 : 1990, stopLoss: side === 'buy' ? 1980 : 2020, takeProfit: side === 'buy' ? 2020 : 1980, slippage: 20 };
  let id = 0, polls = 0;
  const posts = [], progress = [];
  const request = async payload => {
    if (payload) {
      assert.equal(state.unresolved, 0, 'Commands never overlap');
      if (posts.length) assert.equal(state.snapshot.orders.length, posts.length, 'Wait for receipt AND order visibility');
      posts.push(payload.command); polls = 0; state.unresolved = 1;
      state.commands.unshift({ ...payload.command, ...state.snapshot.account, ticket: 100 + posts.length, status: 'queued' });
    } else if (posts.length && polls < 2) {
      polls++; state.commands[0].status = 'succeeded'; state.unresolved = 0;
      if (polls === 2) {
        const c = state.commands[0];
        state.snapshot.orders.push({ ticket: c.ticket, symbol: c.symbol, lots: c.lots, type: (c.orderType === 'limit' ? 2 : c.orderType === 'stop' ? 4 : 0) + (c.side === 'sell' ? 1 : 0), openTime: 100 });
        state.snapshot.orderCount = state.snapshot.orders.length;
      }
    }
    return structuredClone(state);
  };
  return { state, input, posts, progress, request, options: { request, commandId: () => 'command-' + ++id, wait: async () => {}, onProgress: p => progress.push(p) } };
}
test('all four pending types submit the requested count and unchanged per-order prices with unique IDs', async () => {
  for (const type of ['limit', 'stop']) for (const side of ['buy', 'sell']) {
    const f = fixture(type, side), plan = captureOpenBatchPlan(f.state, f.input, 3);
    const result = await runOpenBatch(plan, f.options);
    assert.equal(result.outcome, 'complete'); assert.equal(result.completed, 3); assert.equal(result.remaining, 0);
    assert.deepEqual(result.tickets, [101, 102, 103]); assert.equal(new Set(f.posts.map(c => c.id)).size, 3);
    assert.ok(f.posts.every(c => c.orderType === type && c.side === side && c.price === f.input.price && c.stopLoss === f.input.stopLoss && c.takeProfit === f.input.takeProfit && c.lots === .05));
  }
});
test('batch capture rejects invalid counts, a disabled account and another selected instrument', () => {
  const f = fixture();
  for (const count of [0, 1.5, 11, NaN]) assert.throws(() => captureOpenBatchPlan(f.state, f.input, count), /订单数/);
  f.state.enabled = false; assert.throws(() => captureOpenBatchPlan(f.state, f.input, 3), /交易/);
  f.state.enabled = true; f.state.selection.symbol = 'EURUSD'; assert.throws(() => captureOpenBatchPlan(f.state, f.input, 3), /品种/);
});
test('batch snapshots each row independently and never replaces later prices with the first row', async () => {
  const f = fixture();
  const commands = [0, 1, 2].map(i => ({ ...f.input, id: 'row-' + i, price: 1990 - i, lots: .01 * (i + 1), stopLoss: 1980 - i, takeProfit: 2010 + i }));
  const expected = structuredClone(commands), plan = captureOpenBatchPlan(f.state, commands[0], 3, commands);
  commands[1].price = 100; commands[2].lots = 10;
  const result = await runOpenBatch(plan, f.options);
  assert.equal(result.outcome, 'complete'); assert.deepEqual(f.posts, expected);
  assert.throws(() => captureOpenBatchPlan(f.state, f.input, 3, [f.input]), /每笔|订单数/);
});
test('rejection stops after partial success and does not resend any leg', async () => {
  const f = fixture(), plan = captureOpenBatchPlan(f.state, f.input, 3);
  const result = await runOpenBatch(plan, { ...f.options, request: async payload => {
    const state = await f.request(payload);
    if (f.posts.length === 2) { state.commands[0].status = 'failed'; state.commands[0].error = 'broker rejection'; }
    return state;
  } });
  assert.equal(result.completed, 1); assert.equal(result.remaining, 2); assert.equal(f.posts.length, 2); assert.equal(result.pendingCommand, undefined); assert.match(result.message, /broker rejection/);
});
test('unknown or lost submission retains the same pending ID and never sends another leg', async () => {
  for (const lost of [true, false]) {
    const f = fixture(), plan = captureOpenBatchPlan(f.state, f.input, 3);
    const result = await runOpenBatch(plan, { ...f.options, request: async payload => {
      const state = await f.request(payload);
      if (payload && lost) throw Error('connection lost');
      if (f.posts.length) state.commands[0].status = 'unknown';
      return state;
    } });
    assert.equal(result.outcome, 'stopped'); assert.equal(result.completed, 0); assert.equal(f.posts.length, 1); assert.equal(result.pendingCommand.id, f.posts[0].id);
  }
});
test('stop, abort, session/account/selection changes and permissions prevent the next order', async () => {
  for (const change of [s => s.accountKey = 'other', s => s.snapshot.sessionId = 'other', s => s.selection.symbol = 'EURUSD', s => s.selection.timeframe = 15, s => s.enabled = false, s => s.snapshot.account.tradeAllowed = false, s => { s.snapshot.account.mode = 'real'; s.snapshot.account.allowReal = false; }, null, 'abort']) {
    const f = fixture(), plan = captureOpenBatchPlan(f.state, f.input, 3), abort = new AbortController(); let stop = false;
    const result = await runOpenBatch(plan, { ...f.options, signal: abort.signal, shouldStop: () => stop, onProgress: p => {
      if (p.completed === 1) { if (change === 'abort') abort.abort(); else if (change) change(f.state); else stop = true; }
    } });
    assert.equal(result.completed, 1); assert.equal(f.posts.length, 1); assert.equal(result.outcome, 'stopped');
  }
});
test('a mismatched or reused receipt and a success without an order cannot advance the batch', async () => {
  for (const error of ['account', 'side', 'type', 'missing']) {
    const f = fixture(), plan = captureOpenBatchPlan(f.state, f.input, 2); let now = 0;
    const result = await runOpenBatch(plan, { ...f.options, timeoutMs: 100, now: () => now, wait: async () => { now += 100; }, request: async payload => {
      const s = await f.request(payload);
      if (f.posts.length) {
        if (error === 'account') s.commands[0].accountKey = 'other';
        if (error === 'side') s.commands[0].side = 'sell';
        if (error === 'type') s.commands[0].orderType = 'stop';
        if (error === 'missing') s.snapshot.orders = [];
      }
      return s;
    } });
    assert.equal(result.completed, 0); assert.equal(result.outcome, 'stopped'); assert.equal(f.posts.length, 1);
  }
});
test('preparing each order can recheck discipline, while definite unsent rejection clears pending', async () => {
  const f = fixture(), plan = captureOpenBatchPlan(f.state, f.input, 3); let checks = 0;
  const result = await runOpenBatch(plan, { ...f.options, beforeEach: () => { if (++checks === 2) throw Error('决策已变化'); } });
  assert.equal(result.completed, 1); assert.equal(f.posts.length, 1); assert.match(result.message, /决策/);
  const g = fixture(), other = captureOpenBatchPlan(g.state, g.input, 3);
  const rejected = await runOpenBatch(other, { ...g.options, isDefiniteRejection: e => e.definite, request: async payload => { if (payload) throw Object.assign(Error('unsent'), { definite: true }); return g.request(); } });
  assert.equal(rejected.pendingCommand, undefined); assert.equal(g.posts.length, 0);
});

test('four batch pending types traverse the real queue with per-leg risk and idempotent submission', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mt4-open-batch-')); t.after(() => rm(root, { recursive: true, force: true }));
  let time = Date.now(); const bridge = await new Mt4Bridge({ root, now: () => time }).init(); const pairing = await bridge.ui({ action: 'pair' });
  const q = { symbol: 'XAUUSD', digits: 2, point: .01, bid: 2000, ask: 2000.1, quoteTime: Math.floor(time / 1000), minLot: .01, maxLot: 100, lotStep: .01, contractSize: 100, tickValue: 1, tickSize: .01, stopLevel: 0, freezeLevel: 0, tradeAllowed: true };
  const data = { executionVersion: 2, protocolVersion: 1, sessionId: 'test', capturedAt: Math.floor(time / 1000), account: { login: '123', server: 'demo', mode: 'demo', currency: 'USD', balance: 1000, equity: 1000, margin: 0, freeMargin: 1000, profit: 0, connected: true, tradeAllowed: true, allowReal: false }, symbols: [q], orders: [], history: [], receipts: [], chart: { symbol: 'XAUUSD', timeframe: 5, bars: [] } };
  const heartbeat = () => bridge.terminal(pairing.token, { ...data, capturedAt: Math.floor(time / 1000) });
  await heartbeat(); await bridge.ui({ action: 'enable', accountKey: bridge.status().accountKey, confirmation: '123' });
  let ticket = 100;
  for (const type of ['limit', 'stop']) for (const side of ['buy', 'sell']) {
    const price = side === 'buy' ? type === 'limit' ? 1990 : 2010 : type === 'limit' ? 2010 : 1990;
    const command = { id: randomUUID(), accountKey: bridge.status().accountKey, type: 'open', symbol: q.symbol, side, orderType: type, lots: .01, price, stopLoss: price + (side === 'buy' ? -1 : 1), takeProfit: price + (side === 'buy' ? 2 : -2), slippage: 20, sizingMode: 'risk-percent', riskPercent: 1 };
    const wires = [], plan = captureOpenBatchPlan(bridge.status(), command, 3);
    const result = await runOpenBatch(plan, { commandId: randomUUID, now: () => time, wait: async ms => { time += ms; }, request: async payload => {
      if (payload) {
        await bridge.ui(payload); const duplicate = await bridge.ui(payload);
        assert.equal(duplicate.commands.filter(c => c.id === payload.command.id).length, 1);
        return duplicate;
      }
      if (bridge.status().commands.some(c => c.status === 'queued')) {
        const wire = (await heartbeat()).wire.split('|'); wires.push(wire);
        assert.equal(wire[6], 'open'); assert.equal(wire[8], side); assert.equal(wire[9], type); assert.equal(Number(wire[11]), price);
        const order = { ticket: ++ticket, symbol: q.symbol, type: (type === 'limit' ? 2 : 4) + (side === 'sell' ? 1 : 0), lots: .1, openPrice: price, stopLoss: command.stopLoss, takeProfit: command.takeProfit, profit: 0, swap: 0, commission: 0, openTime: Math.floor(time / 1000), closeTime: 0, closePrice: 0, magic: 0 };
        data.orders.push(order); data.receipts.push({ id: wire[0], status: 'succeeded', ticket, error: '' }); await heartbeat();
      }
      return bridge.status();
    } });
    assert.equal(result.outcome, 'complete', result.message); assert.equal(result.completed, 3); assert.equal(wires.length, 3);
    const accepted = bridge.status().commands.filter(c => result.tickets.includes(c.ticket));
    assert.ok(accepted.every(c => c.sizingMode === 'risk-percent' && c.riskPercent === 1 && Math.abs(c.lots - .1) < .000001));
    assert.equal(bridge.status().unresolved, 0);
  }
});
