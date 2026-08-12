import assert from "node:assert/strict";
import test from "node:test";

import {
  accountEquity,
  availableCash,
  executionCashFlow,
  portfolioReturnPct,
  positionReturnPct,
  settleOpenPositionsAtPrice,
} from "../app/lib/tradingAccount.ts";

test("capital account reserves pending buys and tracks equity", () => {
  assert.equal(availableCash(100_000, [
    { action: "open", side: "buy", reservedCash: 20_000 },
    { action: "open", side: "sell", reservedCash: 50_000 },
  ]), 80_000);
  assert.equal(executionCashFlow("buy", 20, 100), -2_000);
  assert.equal(executionCashFlow("sell", 21, 100), 2_100);
  assert.equal(accountEquity(98_000, [{
    side: "long", qty: 100, entryPrice: 20, status: "open",
  }], 21), 100_100);
});

test("return-only account reports direction-aware percentage returns", () => {
  const long = { side: "long", qty: 100, entryPrice: 20, status: "open" };
  const short = { side: "short", qty: 100, entryPrice: 20, status: "open" };
  assert.equal(positionReturnPct(long, 22), 10);
  assert.equal(positionReturnPct(short, 18), 10);
  assert.equal(portfolioReturnPct([long, short], 22), 0);
});

test("FX returns use contract notional instead of treating one lot as one currency unit", () => {
  const instrumentEconomics = {
    settlementMode: "margin",
    quoteBasis: "bid",
    quantityUnit: "lot",
    contractSize: 100_000,
    pipSize: 0.0001,
    pointSize: 0.00001,
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    accountCurrency: "USD",
    leverage: 100,
    stopOutLevelPct: 50,
    manualQuoteToAccountRate: 0,
  };
  const positions = [
    {
      side: "long", qty: 1, entryPrice: 1.25926, status: "closed", realizedPnl: 98,
      instrumentEconomics,
    },
    {
      side: "long", qty: 1, entryPrice: 1.26013, status: "closed", realizedPnl: 11,
      instrumentEconomics,
    },
  ];

  assert.ok(Math.abs(
    positionReturnPct(positions[0], 0) - 98 / (1.25926 * 100_000) * 100,
  ) < 1e-12);
  assert.ok(Math.abs(
    portfolioReturnPct(positions, 0) - 109 / ((1.25926 + 1.26013) * 100_000) * 100,
  ) < 1e-12);
});

test("training-end settlement closes every open position at the final close", () => {
  const positions = [
    { id: "long", side: "long", qty: 100, entryPrice: 10, entryTimestamp: 1, entryOrderId: "open-1", status: "open" },
    { id: "short", side: "short", qty: 50, entryPrice: 12, entryTimestamp: 2, entryOrderId: "open-2", status: "open" },
    { id: "done", side: "long", qty: 10, entryPrice: 8, entryTimestamp: 3, entryOrderId: "open-3", status: "closed", exitPrice: 9, exitTimestamp: 4, exitOrderId: "old-close", realizedPnl: 10 },
  ];

  const settled = settleOpenPositionsAtPrice(positions, 11, 99, (position) => `close-${position.id}`);

  assert.deepEqual(settled.map((position) => position.status), ["closed", "closed", "closed"]);
  assert.deepEqual(settled.map((position) => position.realizedPnl), [100, 50, 10]);
  assert.deepEqual(settled.map((position) => position.exitPrice), [11, 11, 9]);
  assert.deepEqual(settled.map((position) => position.exitOrderId), ["close-long", "close-short", "old-close"]);
  assert.equal(settled[0].exitTimestamp, 99);
  assert.equal(settled[2], positions[2]);
});
