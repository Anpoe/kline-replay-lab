import assert from "node:assert/strict";
import test from "node:test";

import { resolveLivePendingOrderPrice } from "../app/lib/liveOrderExecution.ts";

const price = { timestamp: 2, open: 100, close: 101 };

function order(overrides = {}) {
  return {
    id: "order-1",
    action: "open",
    side: "buy",
    qty: 1,
    createdAt: 1,
    positionId: "position-1",
    ...overrides,
  };
}

test("live orders use the shared order type trigger rules at the next open", () => {
  assert.equal(resolveLivePendingOrderPrice(order({ orderType: "market" }), price), 100);
  assert.equal(resolveLivePendingOrderPrice(order({ orderType: "limit", triggerPrice: 105 }), price), 100);
  assert.equal(resolveLivePendingOrderPrice(order({ orderType: "limit", triggerPrice: 95 }), price), null);
  assert.equal(resolveLivePendingOrderPrice(order({ orderType: "stop", triggerPrice: 95 }), price), 100);
  assert.equal(resolveLivePendingOrderPrice(order({ orderType: "stop", triggerPrice: 105 }), price), null);
});

test("live pending orders remain queued until a later bar", () => {
  assert.equal(resolveLivePendingOrderPrice(order({ orderType: "market", createdAt: 2 }), price), null);
  assert.equal(resolveLivePendingOrderPrice(order({ orderType: "market", executeAtTimestamp: 3 }), price), null);
});
