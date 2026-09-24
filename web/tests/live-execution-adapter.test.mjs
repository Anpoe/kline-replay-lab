import assert from "node:assert/strict";
import test from "node:test";

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
