import assert from "node:assert/strict";
import test from "node:test";

import {
  EXECUTION_ENGINE_VERSION,
  executeBarStep,
  executionFee,
  executionPrice,
  resolveOrderRawPrice,
  resolveProtectiveExit,
} from "../app/lib/executionEngine.ts";
import { createFxInstrumentEconomics } from "../app/lib/fxTrading.ts";

const bar = { timestamp: 2, open: 100, high: 110, low: 90, close: 105 };

function order(overrides = {}) {
  return {
    id: "order-1",
    action: "open",
    side: "buy",
    qty: 10,
    createdAt: 1,
    positionId: "position-1",
    ...overrides,
  };
}

test("market, limit and stop triggers use deterministic gap-aware prices", () => {
  assert.equal(resolveOrderRawPrice(order(), bar), 100);
  assert.equal(resolveOrderRawPrice(order({ orderType: "limit", triggerPrice: 95 }), bar), 95);
  assert.equal(resolveOrderRawPrice(order({ orderType: "limit", triggerPrice: 105 }), bar), 100);
  assert.equal(resolveOrderRawPrice(order({ orderType: "stop", triggerPrice: 105 }), bar), 105);
  assert.equal(resolveOrderRawPrice(order({ orderType: "stop", triggerPrice: 95 }), bar), 100);
  assert.equal(resolveOrderRawPrice(order({ side: "sell", orderType: "limit", triggerPrice: 108 }), bar), 108);
  assert.equal(resolveOrderRawPrice(order({ side: "sell", orderType: "stop", triggerPrice: 95 }), bar), 95);
  assert.equal(resolveOrderRawPrice(order({ orderType: "limit", triggerPrice: 80 }), bar), null);
});

test("cost profile applies half spread, slippage and minimum commission", () => {
  const profile = { spreadBps: 10, slippageBps: 5, commissionRateBps: 2, minimumCommission: 5 };
  assert.equal(executionPrice("buy", 100, profile), 100.1);
  assert.equal(executionPrice("sell", 100, profile), 99.9);
  assert.equal(executionFee(100, 10, profile), 5);
  assert.equal(executionFee(100, 1000, profile), 20);
});

test("same-bar stop and target conflicts obey the frozen policy", () => {
  const position = {
    id: "p1", side: "long", qty: 10, entryPrice: 100, entryTimestamp: 1,
    entryOrderId: "o1", status: "open", stopLoss: 95, takeProfit: 108,
  };
  assert.deepEqual(resolveProtectiveExit(position, bar, "conservative"), {
    reason: "stop_loss", rawPrice: 95, ambiguous: true,
  });
  assert.deepEqual(resolveProtectiveExit(position, bar, "optimistic"), {
    reason: "take_profit", rawPrice: 108, ambiguous: true,
  });
  assert.deepEqual(
    resolveProtectiveExit(position, bar, "seeded"),
    resolveProtectiveExit(position, bar, "seeded"),
  );
});

test("new positions cannot hit attached exits on their entry bar", () => {
  const opened = executeBarStep({
    orders: [order({ stopLoss: 95, takeProfit: 108 })],
    positions: [],
    bar,
    profile: {},
    cashBalance: 10_000,
    capitalMode: true,
  });
  assert.equal(opened.positions[0].status, "open");
  assert.equal(opened.positions[0].entryOrderType, "market");
  assert.equal(opened.positions[0].entryIntrabar, false);
  assert.equal(opened.fills.length, 1);

  const closed = executeBarStep({
    orders: [],
    positions: opened.positions,
    bar: { ...bar, timestamp: 3 },
    profile: { intrabarConflictPolicy: "conservative" },
    cashBalance: opened.cashBalance,
    capitalMode: true,
  });
  assert.equal(closed.positions[0].status, "closed");
  assert.equal(closed.positions[0].exitReason, "stop_loss");
  assert.equal(closed.positions[0].intrabarAmbiguous, true);
});

test("positions record whether a conditional order filled inside the entry bar", () => {
  const intrabar = executeBarStep({
    orders: [order({ orderType: "limit", triggerPrice: 95 })],
    positions: [],
    bar,
    profile: {},
    cashBalance: 10_000,
    capitalMode: false,
  });
  assert.equal(intrabar.positions[0].entryOrderType, "limit");
  assert.equal(intrabar.positions[0].entryIntrabar, true);

  const gapAtOpen = executeBarStep({
    orders: [order({ orderType: "limit", triggerPrice: 105 })],
    positions: [],
    bar,
    profile: {},
    cashBalance: 10_000,
    capitalMode: false,
  });
  assert.equal(gapAtOpen.positions[0].entryIntrabar, false);
});

test("engine books costs into cash and net realized PnL", () => {
  const profile = { commissionRateBps: 0, minimumCommission: 2, slippageBps: 0, spreadBps: 0 };
  // A zero commission rate intentionally disables the minimum fee.
  assert.equal(executionFee(100, 10, profile), 0);
  const chargedProfile = { ...profile, commissionRateBps: 1 };
  const opened = executeBarStep({
    orders: [order()], positions: [], bar, profile: chargedProfile,
    cashBalance: 2_000, capitalMode: true,
  });
  assert.equal(opened.cashBalance, 998);
  const closed = executeBarStep({
    orders: [order({ id: "close-1", action: "close", side: "sell" })],
    positions: opened.positions,
    bar: { timestamp: 3, open: 110, high: 112, low: 109, close: 111 },
    profile: chargedProfile,
    cashBalance: opened.cashBalance,
    capitalMode: true,
  });
  assert.equal(closed.positions[0].grossRealizedPnl, 100);
  assert.equal(closed.positions[0].realizedPnl, 96);
  assert.equal(closed.positions[0].totalFees, 4);
  assert.equal(closed.cashBalance, 2096);
  assert.equal(closed.fills[0].engineVersion, EXECUTION_ENGINE_VERSION);
});

test("untriggered orders stay pending while rejected triggered orders are consumed", () => {
  const pending = executeBarStep({
    orders: [order({ orderType: "limit", triggerPrice: 80 })], positions: [], bar,
    cashBalance: 1_000, capitalMode: false,
  });
  assert.equal(pending.remainingOrders.length, 1);

  const rejected = executeBarStep({
    orders: [order()], positions: [], bar, cashBalance: 1_000, capitalMode: false,
    validateFill: () => ({ ok: false, code: "price_limit", message: "涨跌停限制" }),
  });
  assert.equal(rejected.remainingOrders.length, 0);
  assert.deepEqual(rejected.consumedOrderIds, ["order-1"]);
  assert.equal(rejected.rejections[0].code, "price_limit");
});

test("protective exits cannot bypass a market-rule rejection", () => {
  const position = {
    id: "protected", side: "long", qty: 10, entryPrice: 100, entryTimestamp: 1,
    entryOrderId: "open", status: "open", stopLoss: 95,
  };
  const result = executeBarStep({
    orders: [], positions: [position],
    bar: { timestamp: 2, open: 94, high: 96, low: 90, close: 92 },
    cashBalance: 0, capitalMode: false,
    validateProtectiveFill: () => ({ ok: false, code: "t_plus_one_locked", message: "当日买入不可卖出" }),
  });
  assert.equal(result.positions[0].status, "open");
  assert.equal(result.fills.length, 0);
  assert.equal(result.rejections[0].code, "t_plus_one_locked");
  assert.match(result.rejections[0].orderId, /^protect:/);
});

test("volume participation partially fills an open order and keeps the remainder pending", () => {
  const first = executeBarStep({
    orders: [order({ qty: 30, reservedCash: 3_000 })],
    positions: [],
    bar: { ...bar, volume: 100 },
    profile: { maxVolumeParticipationPct: 10 },
    cashBalance: 10_000,
    capitalMode: true,
  });
  assert.equal(first.fills[0].qty, 10);
  assert.equal(first.fills[0].partial, true);
  assert.equal(first.fills[0].remainingQty, 20);
  assert.equal(first.positions[0].qty, 10);
  assert.equal(first.remainingOrders[0].qty, 20);
  assert.equal(first.remainingOrders[0].filledQty, 10);
  assert.equal(first.remainingOrders[0].reservedCash, 2_000);
  assert.deepEqual(first.consumedOrderIds, []);

  const second = executeBarStep({
    orders: first.remainingOrders,
    positions: first.positions,
    bar: { ...bar, timestamp: 3, volume: 500 },
    profile: { maxVolumeParticipationPct: 10 },
    cashBalance: first.cashBalance,
    capitalMode: true,
  });
  assert.equal(second.fills[0].qty, 20);
  assert.equal(second.positions.filter((position) => position.status === "open").length, 2);
  assert.equal(second.remainingOrders.length, 0);
  assert.deepEqual(second.consumedOrderIds, ["order-1"]);
});

test("a partial close creates a closed slice and leaves the remainder protected", () => {
  const position = {
    id: "p1", side: "long", qty: 30, entryPrice: 100, entryTimestamp: 1,
    entryOrderId: "o1", status: "open", entryFee: 3, totalFees: 3, stopLoss: 90,
    initialRisk: 303,
  };
  const result = executeBarStep({
    orders: [order({ id: "close-1", action: "close", side: "sell", qty: 30, positionId: "p1" })],
    positions: [position],
    bar: { timestamp: 3, open: 110, high: 111, low: 109, close: 110, volume: 100 },
    profile: { maxVolumeParticipationPct: 10 },
    cashBalance: 0,
    capitalMode: false,
  });
  const open = result.positions.find((item) => item.status === "open");
  const closed = result.positions.find((item) => item.status === "closed");
  assert.equal(open.qty, 20);
  assert.equal(open.stopLoss, 90);
  assert.equal(closed.qty, 10);
  assert.equal(closed.realizedPnl, 99);
  assert.equal(result.remainingOrders[0].qty, 20);
});

test("FX BID candles trigger and fill each side with the correct Bid or Ask quote", () => {
  const economics = createFxInstrumentEconomics("EURUSD.FX", { leverage: 100 });
  const profile = { spreadBps: 10, slippageBps: 0 };
  const notTriggered = executeBarStep({
    orders: [order({ qty: 0.1, orderType: "limit", triggerPrice: 1.1 })],
    positions: [],
    bar: { timestamp: 2, open: 1.101, high: 1.102, low: 1.099, close: 1.101 },
    profile,
    instrumentEconomics: economics,
    cashBalance: 10_000,
    capitalMode: true,
  });
  assert.equal(notTriggered.fills.length, 0, "Ask stayed above the buy limit even though BID traded below it");

  const opened = executeBarStep({
    orders: [order({ qty: 0.1 })],
    positions: [],
    bar: { timestamp: 2, open: 1.1, high: 1.101, low: 1.099, close: 1.1 },
    profile,
    instrumentEconomics: economics,
    cashBalance: 10_000,
    capitalMode: true,
  });
  assert.ok(Math.abs(opened.fills[0].price - 1.1011) < 1e-12);
  assert.equal(opened.fills[0].quoteSide, "ask");
  assert.equal(opened.positions[0].qty, 0.1);
  assert.ok(Math.abs(opened.positions[0].marginUsed - 110.11) < 1e-8);
  assert.equal(opened.cashBalance, 10_000, "opening margin does not deduct the full notional");

  const closed = executeBarStep({
    orders: [order({ id: "fx-close", action: "close", side: "sell", qty: 0.1 })],
    positions: opened.positions,
    bar: { timestamp: 3, open: 1.105, high: 1.106, low: 1.104, close: 1.105 },
    profile,
    instrumentEconomics: economics,
    cashBalance: opened.cashBalance,
    capitalMode: true,
  });
  assert.equal(closed.fills[0].quoteSide, "bid");
  assert.ok(Math.abs(closed.positions[0].grossRealizedPnl - 39) < 1e-8);
  assert.ok(Math.abs(closed.cashBalance - 10_039) < 1e-8);
});

test("a short protective stop is triggered by Ask rather than the displayed BID high", () => {
  const economics = createFxInstrumentEconomics("EURUSD.FX", { leverage: 100 });
  const result = executeBarStep({
    orders: [],
    positions: [{
      id: "short-fx",
      side: "short",
      qty: 0.1,
      entryPrice: 1.1,
      entryTimestamp: 1,
      entryOrderId: "open-fx",
      status: "open",
      stopLoss: 1.105,
      marginUsed: 100,
      instrumentEconomics: economics,
    }],
    bar: { timestamp: 2, open: 1.103, high: 1.104, low: 1.102, close: 1.103 },
    profile: { spreadBps: 10 },
    instrumentEconomics: economics,
    cashBalance: 10_000,
    capitalMode: true,
  });
  assert.equal(result.positions[0].status, "closed");
  assert.equal(result.positions[0].exitReason, "stop_loss");
  assert.equal(result.fills[0].quoteSide, "ask");
  assert.ok(Math.abs(result.fills[0].price - 1.105) < 1e-12);
});

test("FX margin rejection and deterministic stop-out are enforced", () => {
  const economics = createFxInstrumentEconomics("EURUSD.FX", {
    leverage: 100,
    stopOutLevelPct: 60,
  });
  const rejected = executeBarStep({
    orders: [order({ qty: 2 })],
    positions: [],
    bar: { timestamp: 2, open: 1.1, high: 1.1, low: 1.1, close: 1.1 },
    profile: {},
    instrumentEconomics: economics,
    cashBalance: 1_000,
    capitalMode: true,
  });
  assert.equal(rejected.rejections[0].code, "insufficient_margin_at_fill");

  const opened = executeBarStep({
    orders: [order({ qty: 1 })],
    positions: [],
    bar: { timestamp: 2, open: 1.1, high: 1.1, low: 1.1, close: 1.1 },
    profile: {},
    instrumentEconomics: economics,
    cashBalance: 1_200,
    capitalMode: true,
  });
  assert.equal(opened.positions[0].status, "open");
  const stoppedOut = executeBarStep({
    orders: [order({ id: "waiting", qty: 0.01, orderType: "limit", triggerPrice: 1 })],
    positions: opened.positions,
    bar: { timestamp: 3, open: 1.096, high: 1.097, low: 1.094, close: 1.095 },
    profile: {},
    instrumentEconomics: economics,
    cashBalance: opened.cashBalance,
    capitalMode: true,
  });
  assert.equal(stoppedOut.liquidation?.triggered, true);
  assert.equal(stoppedOut.positions[0].status, "closed");
  assert.equal(stoppedOut.positions[0].exitReason, "liquidation");
  assert.equal(stoppedOut.remainingOrders.length, 0);
  assert.deepEqual(stoppedOut.liquidation.cancelledOrderIds, ["waiting"]);
});
