import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveProtectionLines,
  resetConsumedStopDraftAfterOpenFills,
  resetConsumedStopDraftAfterFlatten,
} from "../app/lib/tradeProtection.ts";

const openPosition = {
  id: "open-1",
  status: "open",
  side: "long",
  entryTimestamp: 1_000,
  stopLoss: 92,
  takeProfit: 115,
};

const closedPosition = {
  id: "closed-1",
  status: "closed",
  side: "long",
  entryTimestamp: 2_000,
  stopLoss: 88,
  takeProfit: 118,
};

test("keeps a closed trade's stop hidden until its history row is hovered", () => {
  const baseInput = {
    currentTimestamp: 3_000,
    draftStopLoss: 91,
    draftTakeProfit: undefined,
    positions: [openPosition, closedPosition],
    movable: true,
  };

  const hidden = deriveProtectionLines({
    ...baseInput,
    hoveredClosedPositionId: null,
  });
  assert.deepEqual(hidden.map((line) => line.id), [
    "draft-stop-loss",
    "open-1:stop-loss",
    "open-1:take-profit",
  ]);

  const hovered = deriveProtectionLines({
    ...baseInput,
    hoveredClosedPositionId: "closed-1",
  });
  assert.deepEqual(hovered.at(-1), {
    id: "closed-1:historical-stop-loss",
    kind: "stop-loss",
    price: 88,
    timestamp: 2_000,
    label: "历史 SL",
    movable: false,
    source: "position",
    positionId: "closed-1",
    side: "long",
  });
});

test("clears a consumed stop draft when the account becomes flat", () => {
  assert.deepEqual(resetConsumedStopDraftAfterFlatten({
    previousPositions: [openPosition],
    nextPositions: [{ ...openPosition, status: "closed" }],
    orderStopLoss: "92.00000",
    decisionStop: "92.00000",
  }), {
    orderStopLoss: "",
    decisionStop: "",
  });
});

test("consumes an opening order's stop draft once the position owns the stop", () => {
  assert.deepEqual(resetConsumedStopDraftAfterOpenFills({
    orders: [{ id: "order-1", action: "open", stopLoss: 92 }],
    fills: [{ orderId: "order-1", action: "open" }],
    orderStopLoss: "92.00000",
    decisionStop: "92.00000",
  }), {
    orderStopLoss: "",
    decisionStop: "",
  });

  assert.deepEqual(resetConsumedStopDraftAfterOpenFills({
    orders: [{ id: "order-1", action: "open", stopLoss: 92 }],
    fills: [{ orderId: "order-1", action: "open" }],
    orderStopLoss: "89",
    decisionStop: "89",
  }), {
    orderStopLoss: "89",
    decisionStop: "89",
  });
});

test("does not clear a newer stop draft or a draft while another position remains open", () => {
  assert.deepEqual(resetConsumedStopDraftAfterFlatten({
    previousPositions: [openPosition],
    nextPositions: [{ ...openPosition, status: "closed" }],
    orderStopLoss: "89",
    decisionStop: "89",
  }), {
    orderStopLoss: "89",
    decisionStop: "89",
  });

  assert.deepEqual(resetConsumedStopDraftAfterFlatten({
    previousPositions: [openPosition, { ...openPosition, id: "open-2", stopLoss: 90 }],
    nextPositions: [
      { ...openPosition, status: "closed" },
      { ...openPosition, id: "open-2", stopLoss: 90 },
    ],
    orderStopLoss: "92",
    decisionStop: "92",
  }), {
    orderStopLoss: "92",
    decisionStop: "92",
  });
});
