import assert from "node:assert/strict";
import test from "node:test";

import {
  accountEquity,
  availableCash,
  executionCashFlow,
  portfolioReturnPct,
  positionReturnPct,
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
