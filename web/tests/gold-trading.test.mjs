import assert from "node:assert/strict";
import test from "node:test";

import {
  accountNotional,
  accountPnl,
  pipValueInAccount,
  requiredMargin,
} from "../app/lib/fxTrading.ts";
import {
  describeBuyQuantity,
  resolveMarketRules,
} from "../app/lib/marketRules.ts";
import { executeBarStep } from "../app/lib/executionEngine.ts";

test("resolves XAU/USD as a dedicated spot-margin instrument", () => {
  const rules = resolveMarketRules("GOLD", "XAUUSD.GOLD", {
    accountCurrency: "USD",
    leverage: 100,
    stopOutLevelPct: 50,
  });
  const economics = rules.instrumentEconomics;

  assert.equal(rules.id, "gold-spot-margin");
  assert.equal(rules.name, "黄金现货保证金（Bid/Ask）");
  assert.equal(rules.market, "GOLD");
  assert.equal(rules.allowShort, true);
  assert.equal(rules.quantityUnit, "lot");
  assert.equal(rules.minimumBuyQuantity, 0.01);
  assert.equal(rules.buyQuantityStep, 0.01);
  assert.equal(rules.priceTick, 0.01);
  assert.equal(describeBuyQuantity(rules), "买入 0.01 手整数倍");
  assert.equal(economics?.settlementMode, "margin");
  assert.equal(economics?.quoteBasis, "bid");
  assert.equal(economics?.contractSize, 100);
  assert.equal(economics?.pipSize, 0.01);
  assert.equal(economics?.pointSize, 0.01);
  assert.equal(economics?.baseCurrency, "XAU");
  assert.equal(economics?.quoteCurrency, "USD");
});

test("calculates gold notional, margin and PnL in a USD account", () => {
  const economics = resolveMarketRules("GOLD", "XAUUSD.GOLD", {
    accountCurrency: "USD",
    leverage: 100,
  }).instrumentEconomics;
  assert.ok(economics);

  assert.equal(accountNotional(4071, 1, economics), 407100);
  assert.equal(requiredMargin(4071, 1, economics), 4071);
  assert.equal(accountPnl(4071, 4072, 1, "long", economics), 100);
  assert.equal(pipValueInAccount(4071, 1, economics), 1);
});

test("gold execution uses Ask for buys while reserving margin instead of full notional", () => {
  const economics = resolveMarketRules("GOLD", "XAUUSD.GOLD", {
    accountCurrency: "USD",
    leverage: 100,
  }).instrumentEconomics;
  assert.ok(economics);
  const opened = executeBarStep({
    orders: [{
      id: "gold-open",
      action: "open",
      side: "buy",
      qty: 0.01,
      createdAt: 1,
      positionId: "gold-position",
    }],
    positions: [],
    bar: { timestamp: 2, open: 4071, high: 4075, low: 4068, close: 4072 },
    profile: { spreadBps: 10, slippageBps: 0 },
    instrumentEconomics: economics,
    cashBalance: 1_000,
    capitalMode: true,
  });

  assert.equal(opened.fills.length, 1);
  assert.equal(opened.fills[0].quoteSide, "ask");
  assert.ok(Math.abs(opened.fills[0].price - 4075.071) < 1e-9);
  assert.ok(Math.abs(opened.positions[0].marginUsed - 40.75071) < 1e-9);
  assert.equal(opened.cashBalance, 1_000);
});

test("gold always normalizes a requested return account to capital mode", async () => {
  const settings = await import("../app/features/settings/settingsContracts.ts");
  assert.equal(typeof settings.tradingModeForInstrument, "function");
  assert.equal(settings.tradingModeForInstrument("return", "GOLD", "XAUUSD.GOLD"), "capital");
  assert.equal(settings.tradingModeForInstrument("capital", "GOLD", "XAUUSD.GOLD"), "capital");
  assert.equal(settings.tradingModeForInstrument("return", "CN", "600519.SH"), "return");
});
