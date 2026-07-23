import assert from "node:assert/strict";
import test from "node:test";

import {
  CN_A_MAINBOARD_RULES_V1,
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

test("enforces board lots and prevents unbacked short selling", () => {
  assert.equal(validateOpenOrder(CN_A_MAINBOARD_RULES_V1, "buy", 100).ok, true);
  assert.equal(validateOpenOrder(CN_A_MAINBOARD_RULES_V1, "buy", 150).code, "board_lot_required");
  assert.equal(validateOpenOrder(CN_A_MAINBOARD_RULES_V1, "sell", 100).code, "short_not_allowed");
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

test("uses a 10% price band and conservative limit fill policy", () => {
  const band = createPriceBand(CN_A_MAINBOARD_RULES_V1, 10);
  assert.deepEqual(band, { referenceClose: 10, lower: 9, upper: 11, ratio: 0.1 });
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "buy", 10.5, band).ok, true);
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "buy", 11, band).code, "limit_up_buy_blocked");
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "sell", 9, band).code, "limit_down_sell_blocked");
  assert.equal(validateMarketFill(CN_A_MAINBOARD_RULES_V1, "buy", 11.01, band).code, "bar_outside_price_limit");
});
