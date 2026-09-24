import assert from "node:assert/strict";
import test from "node:test";

import { findLiveOrderFill, resolveLivePendingOrderPrice } from "../app/lib/liveOrderExecution.ts";

const price = { timestamp: 2, open: 100, high: 101, low: 99, close: 101, volume: 1000 };

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
    { timestamp: 5, open: 105, high: 108, low: 104, close: 106, volume: 500 },
    { timestamp: 3, open: 103, high: 106, low: 101, close: 104, volume: 400 },
  ]);
  assert.deepEqual(fill, {
    bar: { timestamp: 3, open: 103, high: 106, low: 101, close: 104, volume: 400 },
    fillPrice: 103,
  });
});

test("live conditional orders can skip earlier bars and trigger later", () => {
  const fill = findLiveOrderFill(order({ orderType: "limit", triggerPrice: 95, createdAt: 2 }), [
    { timestamp: 3, open: 103, high: 104, low: 102, close: 104, volume: 400 },
    { timestamp: 4, open: 94, high: 98, low: 92, close: 96, volume: 500 },
  ]);
  assert.deepEqual(fill, {
    bar: { timestamp: 4, open: 94, high: 98, low: 92, close: 96, volume: 500 },
    fillPrice: 94,
  });
});

test("live orders stay pending when no later complete bar is available", () => {
  assert.equal(findLiveOrderFill(order({ orderType: "market", createdAt: 5 }), [
    { timestamp: 5, open: 105, high: 108, low: 104, close: 106, volume: 500 },
  ]), null);
});

test("live fills ignore unclosed bars and use intrabar high and low", () => {
  assert.equal(findLiveOrderFill(order({ orderType: "stop", triggerPrice: 108, createdAt: 1 }), [
    { timestamp: 2, open: 100, high: 107, low: 99, close: 105, closed: true },
    { timestamp: 3, open: 100, high: 110, low: 98, close: 105, closed: false },
  ]), null);
  const fill = findLiveOrderFill(order({ orderType: "stop", triggerPrice: 108, createdAt: 1 }), [
    { timestamp: 2, open: 100, high: 107, low: 99, close: 105, closed: true },
    { timestamp: 3, open: 100, high: 110, low: 98, close: 105, closed: true },
  ]);
  assert.equal(fill?.fillPrice, 108);
  assert.equal(fill?.bar.high, 110);
  assert.equal(fill?.bar.low, 98);
});
