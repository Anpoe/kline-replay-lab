import test from "node:test";
import assert from "node:assert/strict";
import { riskSizedMt4Lots, checkMt4OpeningGap } from "../app/lib/mt4OrderRules.mjs";
test("risk lots use account-currency tick value and round down to broker step", () => {
  const result = riskSizedMt4Lots({ balance: 10000, riskPercent: 1, entryPrice: 1.1002, stopLoss: 1.09, symbol: { tickValue: 1, tickSize: 0.00001, minLot: 0.01, maxLot: 100, lotStep: 0.01 } });
  assert.equal(result.lots, 0.09); assert.ok(result.estimatedRisk <= result.riskBudget);
  assert.throws(() => riskSizedMt4Lots({ balance: 10, riskPercent: 1, entryPrice: 1.1, stopLoss: 1.09, symbol: { tickValue: 1, tickSize: 0.00001, minLot: 0.01, maxLot: 100, lotStep: 0.01 } }), /最小手数/);
});
test("opening-gap bounds retain training filter's directional and inclusive semantics", () => {
  checkMt4OpeningGap({ previousClose: 100, openingPrice: 101, mode: "high", unit: "percent", threshold: 2 });
  for (const openingPrice of [99, 102]) assert.throws(() => checkMt4OpeningGap({ previousClose: 100, openingPrice, mode: "high", unit: "price", threshold: 2 }), /不符合/);
  checkMt4OpeningGap({ previousClose: 100, openingPrice: 99, mode: "low", unit: "price", threshold: 2 });
  assert.throws(() => checkMt4OpeningGap({ previousClose: 100, openingPrice: 98, mode: "low", unit: "percent", threshold: 2 }), /不符合/);
});
