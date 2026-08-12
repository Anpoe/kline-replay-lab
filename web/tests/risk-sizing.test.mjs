import assert from "node:assert/strict";
import test from "node:test";

import { calculateRiskSizedQuantity, inferRiskSizingSide } from "../app/lib/riskSizing.ts";
import { createFxInstrumentEconomics } from "../app/lib/fxTrading.ts";

test("risk preview infers direction from the expected entry instead of the current quote", () => {
  assert.equal(inferRiskSizingSide(1.145, 1.14), "buy");
  assert.equal(inferRiskSizingSide(1.135, 1.14), "sell");
  assert.equal(inferRiskSizingSide(1.14, 1.14), null);
});

test("risk percentage sizing includes adverse execution and both commissions", () => {
  const result = calculateRiskSizedQuantity({
    side: "buy",
    equity: 100_000,
    riskPercent: 1,
    entryRawPrice: 100,
    stopLoss: 98,
    minimumQuantity: 100,
    quantityStep: 100,
    profile: { commissionRateBps: 1, minimumCommission: 5, spreadBps: 10, slippageBps: 5 },
  });
  assert.ok(result);
  assert.equal(result.quantity, 400);
  assert.ok(result.estimatedRisk <= result.riskBudget);
  assert.ok(result.estimatedRisk > 800);
});

test("risk sizing obeys lot size and available cash", () => {
  const result = calculateRiskSizedQuantity({
    side: "buy",
    equity: 100_000,
    riskPercent: 5,
    entryRawPrice: 100,
    stopLoss: 99,
    minimumQuantity: 100,
    quantityStep: 100,
    availableCash: 25_000,
    profile: {},
  });
  assert.ok(result);
  assert.equal(result.quantity, 200);
  assert.equal(result.limitedByCash, true);
});

test("risk sizing rejects a stop on the wrong side", () => {
  assert.equal(calculateRiskSizedQuantity({
    side: "buy",
    equity: 100_000,
    riskPercent: 1,
    entryRawPrice: 100,
    stopLoss: 101,
    minimumQuantity: 1,
    quantityStep: 1,
  }), null);
});

test("FX risk sizing returns decimal lots and obeys available margin", () => {
  const economics = createFxInstrumentEconomics("EURUSD.FX", { leverage: 100 });
  const result = calculateRiskSizedQuantity({
    side: "buy",
    equity: 10_000,
    riskPercent: 1,
    entryRawPrice: 1.1,
    stopLoss: 1.098,
    minimumQuantity: 0.01,
    quantityStep: 0.01,
    availableMargin: 200,
    profile: { spreadBps: 10 },
    instrumentEconomics: economics,
  });
  assert.ok(result);
  assert.equal(result.quantity, 0.18);
  assert.equal(result.limitedByMargin, true);
  assert.ok(result.estimatedRisk <= 100);
});
