import assert from "node:assert/strict";
import test from "node:test";

import {
  CN_A_MAINBOARD_RULES_V1,
  CN_BEIJING_RULES_V1,
  CN_CHINEXT_RULES_V1,
  CN_STAR_MARKET_RULES_V1,
  describeBuyQuantity,
  findNextTradingSessionIndex,
  createPriceBand,
  resolveMarketRules,
  validateCloseOrder,
  validateMarketFill,
  validateOpenOrder,
} from "../app/lib/marketRules.ts";

test("resolves the versioned A-share mainboard rule profile", () => {
  const rules = resolveMarketRules("CN", "600519.SH");
  assert.equal(rules.id, "cn-a-mainboard-cash");
  assert.equal(rules.version, "2026.07-v1");
  assert.equal(rules.boardLot, 100);
  assert.equal(rules.tPlusOne, true);
  assert.equal(rules.allowShort, false);
});

test("uses instrument precision for FX price ticks and quantity wording", () => {
  const eurusd = resolveMarketRules("FX", "EURUSD.FX");
  const usdjpy = resolveMarketRules("FX", "USDJPY.FX");
  assert.equal(eurusd.id, "fx-spot-margin");
  assert.equal(eurusd.priceTick, 0.00001);
  assert.equal(usdjpy.priceTick, 0.001);
  assert.equal(eurusd.allowShort, true);
  assert.equal(eurusd.minimumBuyQuantity, 0.01);
  assert.equal(eurusd.buyQuantityStep, 0.01);
  assert.equal(eurusd.defaultOrderQuantity, 1);
  assert.equal(eurusd.instrumentEconomics.contractSize, 100_000);
  assert.equal(eurusd.instrumentEconomics.quoteBasis, "bid");
  assert.equal(describeBuyQuantity(eurusd), "买入 0.01 手整数倍");
});

test("enforces board lots and prevents unbacked short selling", () => {
  assert.equal(validateOpenOrder(CN_A_MAINBOARD_RULES_V1, "buy", 100).ok, true);
  assert.equal(validateOpenOrder(CN_A_MAINBOARD_RULES_V1, "buy", 150).code, "board_lot_required");
  assert.equal(validateOpenOrder(CN_A_MAINBOARD_RULES_V1, "sell", 100).code, "short_not_allowed");
});

test("resolves and trades the STAR Market, ChiNext and Beijing exchange", () => {
  assert.equal(resolveMarketRules("CN", "688322.SH").id, "cn-a-star-market-cash");
  assert.equal(resolveMarketRules("CN", "300750.SZ").id, "cn-a-chinext-cash");
  assert.equal(resolveMarketRules("CN", "920001.BJ").id, "cn-a-beijing-cash");

  assert.equal(validateOpenOrder(CN_STAR_MARKET_RULES_V1, "buy", 100).code, "minimum_quantity_required");
  assert.equal(validateOpenOrder(CN_STAR_MARKET_RULES_V1, "buy", 200).ok, true);
  assert.equal(validateOpenOrder(CN_STAR_MARKET_RULES_V1, "buy", 201).ok, true);
  assert.equal(describeBuyQuantity(CN_STAR_MARKET_RULES_V1), "买入至少 200 股，之后按 1 股递增");

  assert.equal(validateOpenOrder(CN_CHINEXT_RULES_V1, "buy", 100).ok, true);
  assert.equal(validateOpenOrder(CN_CHINEXT_RULES_V1, "buy", 150).code, "board_lot_required");
  assert.equal(validateOpenOrder(CN_BEIJING_RULES_V1, "buy", 100).ok, true);
  assert.equal(validateOpenOrder(CN_BEIJING_RULES_V1, "buy", 101).ok, true);
});

test("keeps A-share indices in read-only training mode", () => {
  const rules = resolveMarketRules("CN", "399965.SZ");
  assert.equal(rules.tradingEnabled, false);
  assert.equal(validateOpenOrder(rules, "buy", 100).code, "market_rule_not_implemented");
});

test("uses board-specific price limits and skips IPO no-limit sessions", () => {
  assert.equal(createPriceBand(CN_STAR_MARKET_RULES_V1, 10, 5), null);
  assert.deepEqual(createPriceBand(CN_STAR_MARKET_RULES_V1, 10, 6), {
    referenceClose: 10,
    lower: 8,
    upper: 12,
    ratio: 0.2,
  });
  assert.equal(createPriceBand(CN_BEIJING_RULES_V1, 10, 1), null);
  assert.deepEqual(createPriceBand(CN_BEIJING_RULES_V1, 10, 2), {
    referenceClose: 10,
    lower: 7,
    upper: 13,
    ratio: 0.3,
  });
});

test("locks a newly bought A-share position until the next trading date", () => {
  const position = {
    side: "long",
    qty: 100,
    entryTimestamp: Date.parse("2026-07-23T01:35:00Z"),
  };
  const sameDay = validateCloseOrder(
    CN_A_MAINBOARD_RULES_V1,
    position,
    Date.parse("2026-07-23T06:55:00Z"),
    "Asia/Shanghai",
  );
  const nextDay = validateCloseOrder(
    CN_A_MAINBOARD_RULES_V1,
    position,
    Date.parse("2026-07-24T01:30:00Z"),
    "Asia/Shanghai",
  );
  assert.equal(sameDay.code, "t_plus_one_locked");
  assert.equal(nextDay.ok, true);
});

test("finds the first bar of the next trading session for a deferred close", () => {
  const bars = [
    { timestamp: Date.parse("2026-07-23T01:35:00Z") },
    { timestamp: Date.parse("2026-07-23T06:55:00Z") },
    { timestamp: Date.parse("2026-07-24T01:30:00Z") },
    { timestamp: Date.parse("2026-07-24T01:35:00Z") },
  ];
  assert.equal(findNextTradingSessionIndex(bars, 0, "Asia/Shanghai"), 2);
  assert.equal(findNextTradingSessionIndex(bars, 1, "Asia/Shanghai"), 2);
  assert.equal(findNextTradingSessionIndex(bars, 3, "Asia/Shanghai"), -1);
});

test("uses a 10% price band and conservative limit fill policy", () => {
  const band = createPriceBand(CN_A_MAINBOARD_RULES_V1, 10);
  assert.deepEqual(band, { referenceClose: 10, lower: 9, upper: 11, ratio: 0.1 });
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "buy", 10.5, band).ok, true);
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "buy", 11, band).code, "limit_up_buy_blocked");
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "sell", 9, band).code, "limit_down_sell_blocked");
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "buy", 11.01, band).code, "bar_outside_price_limit");
});
