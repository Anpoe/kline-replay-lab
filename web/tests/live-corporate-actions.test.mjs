import assert from "node:assert/strict";
import test from "node:test";

import { applyLiveCorporateActionsBeforeBar, terminalLiveCorporateActionIds } from "../app/lib/liveCorporateActions.ts";

const event = {
  id: "600000.SH:2026-03-11:1",
  instrumentId: "600000.SH",
  date: "2026-03-11",
  timestamp: Date.parse("2026-03-11T00:00:00Z"),
  category: 1,
  label: "D",
  description: "每10股派2元（税前）",
  cashPer10: 2,
  bonusSharesPer10: 0,
  rightsSharesPer10: 0,
  rightsPrice: 0,
  source: "tdx",
};

const heldPosition = {
  id: "position-1",
  side: "long",
  qty: 100,
  status: "open",
  entryTimestamp: Date.parse("2026-03-10T00:00:00Z"),
};

test("live cash dividend reuses training eligibility and is terminally idempotent", () => {
  const result = applyLiveCorporateActionsBeforeBar({
    events: [event],
    positions: [heldPosition],
    pendingOrders: [],
    barTimestamp: event.timestamp,
    priceBasis: "raw",
    currency: "CNY",
    capitalMode: true,
    now: "2026-03-12T00:00:00.000Z",
    revision: "rev-1",
  });
  assert.equal(result.cashDelta, 20);
  assert.deepEqual(result.ledgerEntries[0], {
    eventId: event.id,
    instrumentId: event.instrumentId,
    eventType: "cash-dividend",
    date: event.date,
    timestamp: event.timestamp,
    status: "applied",
    source: "tdx",
    priceBasis: "raw",
    currency: "CNY",
    amount: 20,
    quantityBefore: 100,
    quantityAfter: 100,
    reason: "现金分红已计入市场账户现金",
    revision: "rev-1",
    eventFingerprint: "600000.SH:2026-03-11:1|600000.SH|1773187200000|1|2|0|0|0||tdx",
    appliedAt: "2026-03-12T00:00:00.000Z",
  });
  assert.deepEqual([...terminalLiveCorporateActionIds(result.ledgerEntries)], [event.id]);
  const repeated = applyLiveCorporateActionsBeforeBar({
    events: [event],
    positions: [heldPosition],
    pendingOrders: [],
    barTimestamp: event.timestamp + 86_400_000,
    priceBasis: "raw",
    currency: "CNY",
    capitalMode: true,
    processedEventIds: terminalLiveCorporateActionIds(result.ledgerEntries),
  });
  assert.equal(repeated.cashDelta, 0);
  assert.deepEqual(repeated.ledgerEntries, []);
});

test("adjusted and unknown price basis never double-counts an action", () => {
  for (const priceBasis of ["adjusted", "unknown"]) {
    const result = applyLiveCorporateActionsBeforeBar({
      events: [event],
      positions: [heldPosition],
      pendingOrders: [],
      barTimestamp: event.timestamp,
      priceBasis,
      currency: "CNY",
      capitalMode: true,
    });
    assert.equal(result.cashDelta, 0);
    assert.equal(result.ledgerEntries[0].status, "pending");
    assert.match(result.ledgerEntries[0].reason, /口径|调整/);
  }
});

test("return mode records the dividend without changing buying power", () => {
  const result = applyLiveCorporateActionsBeforeBar({
    events: [event],
    positions: [heldPosition],
    pendingOrders: [],
    barTimestamp: event.timestamp,
    priceBasis: "raw",
    currency: "CNY",
    capitalMode: false,
  });
  assert.equal(result.cashDelta, 0);
  assert.equal(result.ledgerEntries[0].status, "applied");
  assert.equal(result.ledgerEntries[0].amount, 20);
});

test("ineligible holdings are recorded once without a fake cash credit", () => {
  const result = applyLiveCorporateActionsBeforeBar({
    events: [event],
    positions: [{ ...heldPosition, entryTimestamp: event.timestamp }],
    pendingOrders: [],
    barTimestamp: event.timestamp,
    priceBasis: "raw",
    currency: "CNY",
    capitalMode: true,
  });
  assert.equal(result.cashDelta, 0);
  assert.equal(result.ledgerEntries[0].status, "not-eligible");
  assert.match(result.ledgerEntries[0].reason, /除权除息日前/);
});

test("a changed event with the same identity pauses automatic processing", () => {
  const first = applyLiveCorporateActionsBeforeBar({
    events: [event],
    positions: [heldPosition],
    pendingOrders: [],
    barTimestamp: event.timestamp,
    priceBasis: "raw",
    currency: "CNY",
    capitalMode: true,
  });
  const corrected = applyLiveCorporateActionsBeforeBar({
    events: [{ ...event, cashPer10: 3 }],
    positions: [heldPosition],
    pendingOrders: [],
    barTimestamp: event.timestamp + 86_400_000,
    priceBasis: "raw",
    currency: "CNY",
    capitalMode: true,
    processedEventIds: terminalLiveCorporateActionIds(first.ledgerEntries),
    existingEntries: new Map(first.ledgerEntries.map((entry) => [entry.eventId, entry])),
  });
  assert.equal(corrected.cashDelta, 0);
  assert.equal(corrected.requiresUserAction, true);
  assert.equal(corrected.ledgerEntries[0].status, "corrected");
});
