import assert from "node:assert/strict";
import test from "node:test";

import { findLiveOrderFill, resolveLivePendingOrderPrice } from "../app/lib/liveOrderExecution.ts";

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

test("live fills choose the first complete bar after a missed refresh window", () => {
  const fill = findLiveOrderFill(order({ orderType: "market", createdAt: 2 }), [
    { timestamp: 5, open: 105, close: 106 },
    { timestamp: 3, open: 103, close: 104 },
  ]);
  assert.deepEqual(fill, {
    bar: { timestamp: 3, open: 103, close: 104 },
    fillPrice: 103,
  });
});

test("live conditional orders can skip earlier bars and trigger later", () => {
  const fill = findLiveOrderFill(order({ orderType: "limit", triggerPrice: 95, createdAt: 2 }), [
    { timestamp: 3, open: 103, close: 104 },
    { timestamp: 4, open: 94, close: 96 },
  ]);
  assert.deepEqual(fill, {
    bar: { timestamp: 4, open: 94, close: 96 },
    fillPrice: 94,
  });
});

test("live orders stay pending when no later complete bar is available", () => {
  assert.equal(findLiveOrderFill(order({ orderType: "market", createdAt: 5 }), [
    { timestamp: 5, open: 105, close: 106 },
  ]), null);
});
