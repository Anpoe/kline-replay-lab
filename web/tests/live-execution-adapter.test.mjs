import assert from "node:assert/strict";
import test from "node:test";
import { createFxInstrumentEconomics } from "../app/lib/fxTrading.ts";
import { liveAccountMarginTotals } from "../app/lib/tradingAccount.ts";

import { executeLiveBars } from "../app/lib/liveExecutionAdapter.ts";
import { EXECUTION_ENGINE_VERSION } from "../app/lib/executionEngine.ts";

test("live bars use the shared engine for OHLC-aware entry and close execution", () => {
  const opened = executeLiveBars({
    bars: [{ timestamp: 2, open: 100, high: 110, low: 90, close: 105, volume: 100, closed: true }],
    orders: [{
      id: "open-1",
      action: "open",
      side: "buy",
      qty: 10,
      createdAt: 1,
      positionId: "position-1",
      orderType: "limit",
      triggerPrice: 95,
    }],
    positions: [],
    cashBalance: 2_000,
    capitalMode: true,
    profile: { commissionRateBps: 1, minimumCommission: 0 },
  });

  assert.equal(opened.fills[0].price, 95);
  assert.equal(opened.fills[0].rawPrice, 95);
  assert.equal(opened.fills[0].engineVersion, EXECUTION_ENGINE_VERSION);
  assert.equal(opened.positions[0].status, "open");
  assert.equal(opened.cashBalance, 1_049.905);

  const closed = executeLiveBars({
    bars: [{ timestamp: 3, open: 110, high: 112, low: 109, close: 111, volume: 100, closed: true }],
    orders: [{
      id: "close-1",
      action: "close",
      side: "sell",
      qty: 10,
      createdAt: 2,
      positionId: "position-1",
      orderType: "market",
    }],
    positions: opened.positions,
    cashBalance: opened.cashBalance,
    capitalMode: true,
    profile: { commissionRateBps: 1, minimumCommission: 0 },
  });

  assert.equal(closed.remainingOrders.length, 0);
  assert.equal(closed.positions[0].status, "closed");
  assert.equal(closed.positions[0].exitPrice, 110);
  assert.equal(closed.positions[0].realizedPnl, 149.795);
  assert.equal(closed.cashBalance, 2_149.795);
});

test("live adapter ignores unclosed bars and never fills on an order's creation bar", () => {
  const result = executeLiveBars({
    bars: [
      { timestamp: 2, open: 100, high: 110, low: 90, close: 105, closed: false },
      { timestamp: 3, open: 101, high: 103, low: 99, close: 102, closed: true },
    ],
    orders: [{
      id: "open-1",
      action: "open",
      side: "buy",
      qty: 1,
      createdAt: 3,
      positionId: "position-1",
      orderType: "market",
    }],
    positions: [],
    cashBalance: 1_000,
    capitalMode: true,
  });

  assert.equal(result.fills.length, 0);
  assert.equal(result.processedBars.length, 1);
  assert.equal(result.processedBars[0].timestamp, 3);
  assert.equal(result.remainingOrders.length, 1);
});

test("live adapter evaluates protective exits from complete intrabar highs and lows", () => {
  const result = executeLiveBars({
    bars: [{ timestamp: 3, open: 100, high: 112, low: 90, close: 105, closed: true }],
    orders: [],
    positions: [{
      id: "position-1",
      side: "long",
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 2,
      entryOrderId: "open-1",
      status: "open",
      takeProfit: 110,
    }],
    cashBalance: 0,
    capitalMode: false,
  });

  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].reason, "take_profit");
  assert.equal(result.fills[0].price, 110);
  assert.equal(result.positions[0].status, "closed");
});

test('live margin execution accounts for positions and reservations on other symbols', () => {
  const economics = createFxInstrumentEconomics('EURUSD.FX');
  const result = executeLiveBars({
    orders: [{ id: 'entry', action: 'open', side: 'buy', qty: 0.1, createdAt: 1, positionId: 'p', orderType: 'market', instrumentEconomics: economics }],
    positions: [], cashBalance: 1000, capitalMode: true, instrumentEconomics: economics,
    externalMargin: { floatingPnl: 0, usedMargin: 800, reservedMargin: 150 },
    profile: { spreadBps: 0, slippageBps: 0, commissionRateBps: 0 },
    bars: [{ timestamp: 2, open: 1.1, high: 1.1, low: 1.1, close: 1.1, closed: true }],
  });
  assert.equal(result.fills.length, 0);
  assert.equal(result.rejections[0].code, 'insufficient_margin_at_fill');
});

test('shared margin totals use each symbol price, both directions, and only the selected account', () => {
  const eur = createFxInstrumentEconomics('EURUSD.FX');
  const gbp = createFxInstrumentEconomics('GBPUSD.FX');
  const totals = liveAccountMarginTotals('fx', [
    { accountId: 'fx', latestClose: 1.11, positions: [{ side: 'long', qty: 0.1, entryPrice: 1.1, status: 'open', marginUsed: 110, instrumentEconomics: eur }], pendingOrders: [{ reservedMargin: 20 }] },
    { accountId: 'fx', latestClose: 1.29, positions: [{ side: 'short', qty: 0.2, entryPrice: 1.3, status: 'open', marginUsed: 260, instrumentEconomics: gbp }], pendingOrders: [{ reservedMargin: 35 }] },
    { accountId: 'gold', latestClose: 9, positions: [], pendingOrders: [{ reservedMargin: 999 }] },
  ]);
  assert.ok(Math.abs(totals.floatingPnl - 300) < 0.00001);
  assert.equal(totals.usedMargin, 370);
  assert.equal(totals.reservedMargin, 55);
});
