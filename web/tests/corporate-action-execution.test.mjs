import assert from "node:assert/strict";
import test from "node:test";
import { applyCorporateActionsBeforeBar } from "../app/lib/corporateActionExecution.ts";
import { executeBarStep, DEFAULT_EXECUTION_COST_PROFILE } from "../app/lib/executionEngine.ts";
import { corporateActionMarkersForBars, unhandledQuantityActionIds } from "../app/lib/corporateActions.ts";

const exDate = Date.parse("2018-06-07T00:00:00Z");
const event = { id: "300730.SZ:2018-06-07:1", instrumentId: "300730.SZ", date: "2018-06-07", timestamp: exDate, category: 1, label: "D", description: "每10股派1元；送转7股", cashPer10: 1, bonusSharesPer10: 7, rightsSharesPer10: 0, rightsPrice: 0, source: "tdx" };
const position = { id: "p1", side: "long", status: "open", qty: 100, entryPrice: 50.5, entryTimestamp: exDate - 86400000, entryOrderId: "buy", stopLoss: 45, takeProfit: 60, entryFee: 5, initialRisk: 560 };
const input = (overrides = {}) => ({ events: [event], positions: [position], pendingOrders: [], barTimestamp: exDate, previousTimestamp: exDate - 86400000, previousClose: 50.5, priceBasis: "raw", ...overrides });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("300730 10转7 preserves invested cost, credits old quantity, and protects before execution", () => {
  const result = applyCorporateActionsBeforeBar(input());
  assert.equal(result.blockedReason, "");
  const adjusted = result.positions[0];
  assert.equal(adjusted.qty, 170);
  near(adjusted.entryPrice * adjusted.qty, 5050);
  near(adjusted.stopLoss, (45 - 0.1) / 1.7);
  near(adjusted.takeProfit, (60 - 0.1) / 1.7);
  assert.equal(adjusted.entryFee, 5);
  assert.equal(adjusted.initialRisk, 560);
  assert.equal(result.dividendCredits[0].amount, 10);
  near(result.referenceClose, (50.5 - 0.1) / 1.7);
  const execution = executeBarStep({ positions: result.positions, orders: [], bar: { timestamp: exDate, open: 30.57, high: 32.62, low: 28.8, close: 31.78 }, profile: DEFAULT_EXECUTION_COST_PROFILE, cashBalance: 4950 + 10, capitalMode: true });
  assert.equal(execution.fills.length, 0, "old stop must not liquidate at the ex-date open");
  near(execution.cashBalance + 170 * 31.78 - 10000, 362.6);
  assert.deepEqual(position.qty, 100, "input must not mutate");
});

test("unchanged economic value produces zero loss; sale and allocated fees use new units", () => {
  const result = applyCorporateActionsBeforeBar(input({ positions: [{ ...position, entryFee: 0, stopLoss: undefined, takeProfit: undefined }] }));
  const close = executeBarStep({ positions: result.positions, orders: [{ id: "sell", action: "close", side: "sell", qty: 170, positionId: "p1", createdAt: exDate }], bar: { timestamp: exDate, open: result.referenceClose, high: result.referenceClose, low: result.referenceClose, close: result.referenceClose }, profile: DEFAULT_EXECUTION_COST_PROFILE, cashBalance: 4950 + 10, capitalMode: true });
  near(close.cashBalance, 10000);
  near(close.positions[0].realizedPnl + result.dividendCredits[0].amount, 0);
});

test("pre-ex-date close orders change units and stale opening orders cancel without fabricated fills", () => {
  const result = applyCorporateActionsBeforeBar(input({ pendingOrders: [
    { id: "close", action: "close", side: "sell", qty: 50, positionId: "p1", createdAt: exDate - 1, triggerPrice: 52, originalQty: 100, filledQty: 50 },
    { id: "open", action: "open", side: "buy", qty: 100, positionId: "new", createdAt: exDate - 1, reservedCash: 4800 },
  ] }));
  assert.deepEqual(result.cancelledOrderIds, ["open"]);
  assert.equal(result.pendingOrders.length, 1);
  assert.equal(result.pendingOrders[0].qty, 85);
  assert.equal(result.pendingOrders[0].originalQty, 170);
  assert.equal(result.pendingOrders[0].filledQty, 85);
  near(result.pendingOrders[0].triggerPrice, (52 - 0.1) / 1.7);
});

test("event identity persists across replay/restore, same-day and closed lots are excluded", () => {
  const first = applyCorporateActionsBeforeBar(input({ positions: [position, { ...position, id: "today", entryTimestamp: exDate }, { ...position, id: "closed", status: "closed" }] }));
  assert.equal(first.positions[1].qty, 100);
  assert.equal(first.positions[2].qty, 100);
  const repeated = applyCorporateActionsBeforeBar(input({ positions: first.positions, processedEventIds: new Set(first.appliedEvents.map((item) => item.event.id)) }));
  assert.deepEqual(repeated.positions, first.positions);
  assert.equal(repeated.dividendCredits.length, 0);
});

test("sequential pure bonuses compound on remaining shares, future events stay pending", () => {
  const second = { ...event, id: "second", timestamp: exDate + 86400000, cashPer10: 0, bonusSharesPer10: 5 };
  const result = applyCorporateActionsBeforeBar(input({ events: [second, event, { ...second, id: "future", timestamp: exDate + 3 * 86400000 }], barTimestamp: second.timestamp }));
  assert.equal(result.positions[0].qty, 255);
  near(result.positions[0].entryPrice * 255, 5050);
  assert.equal(result.appliedEvents.length, 2);
  assert.equal(result.dividendCredits.length, 1);
});

test("adjusted series are never paid or split again, unsafe or late actions block atomically", () => {
  const adjusted = applyCorporateActionsBeforeBar(input({ priceBasis: "adjusted" }));
  assert.deepEqual(adjusted.positions, [position]);
  assert.equal(adjusted.dividendCredits.length, 0);
  for (const overrides of [
    { priceBasis: "unknown" },
    { events: [{ ...event, rightsSharesPer10: 1 }] },
    { events: [{ ...event, category: 11, shareRatio: 2 }] },
    { events: [{ ...event, bonusSharesPer10: NaN }] },
    { previousTimestamp: exDate + 1 },
  ]) {
    const result = applyCorporateActionsBeforeBar(input(overrides));
    assert.ok(result.blockedReason);
    assert.deepEqual(result.positions, [position]);
    assert.deepEqual(result.appliedEvents, []);
    assert.deepEqual(result.dividendCredits, []);
  }
});

test("cash dividend uses original quantity before same-bar exit and shifts protection only once", () => {
  const result = applyCorporateActionsBeforeBar(input({ events: [{ ...event, bonusSharesPer10: 0 }] }));
  assert.equal(result.positions[0].qty, 100);
  assert.equal(result.positions[0].entryPrice, 50.5);
  near(result.positions[0].stopLoss, 44.9);
  assert.equal(result.dividendCredits[0].amount, 10);
});

test("historical events outside the visible daily window never map to the first candle", () => {
  const bar = { timestamp: exDate + 86400000, open: 30, high: 32, low: 29, close: 31 };
  assert.deepEqual(corporateActionMarkersForBars([event], [bar], "1d", "Asia/Shanghai", bar.timestamp), []);
});

test("review flags only unhandled quantity events for lots crossing the ex-date", () => {
  const closed = { ...position, status: "closed", exitTimestamp: exDate };
  assert.deepEqual(unhandledQuantityActionIds([event], [closed], [], exDate), [event.id]);
  assert.deepEqual(unhandledQuantityActionIds([event], [closed], [{ type: "corporate_action_applied", payload: { eventId: event.id } }], exDate), []);
  assert.deepEqual(unhandledQuantityActionIds([event], [{ ...closed, exitTimestamp: exDate - 1 }], [], exDate), []);
  assert.deepEqual(unhandledQuantityActionIds([event], [closed], [], exDate - 1), []);
});

test("raw weekly candles cannot execute across a midweek action using mixed share units", () => {
  const result = applyCorporateActionsBeforeBar(input({ barTimestamp: exDate - 86400000, previousTimestamp: exDate - 8 * 86400000, aggregatedBarEndTimestamp: exDate + 4 * 86400000 }));
  assert.match(result.blockedReason, /周线或月线/);
  assert.deepEqual(result.positions, [position]);
});

test("intraday charts put the ex-date event on that day's first available candle", () => {
  const first = exDate + 90 * 60000;
  const bar = { timestamp: first, open: 30, high: 32, low: 29, close: 31 };
  const markers = corporateActionMarkersForBars([event], [bar, { ...bar, timestamp: first + 300000 }], "5m", "Asia/Shanghai", first);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].barTimestamp, first);
});

test("blind replay keeps revealed ex-date markers while hiding dates and action details", () => {
  const bar = { timestamp: exDate, open: 30, high: 32, low: 29, close: 31 };
  const future = { ...event, id: "future", timestamp: exDate + 86400000 };
  const markers = corporateActionMarkersForBars([event, future], [bar, { ...bar, timestamp: future.timestamp }], "1d", "Asia/Shanghai", exDate, true);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].barTimestamp, exDate);
  assert.equal(markers[0].label, "除权除息");
  assert.equal(markers[0].date, "");
  assert.equal(markers[0].description, "训练结束后可查看权息明细。");
  assert.equal(event.date, "2018-06-07", "display privacy must not change accounting evidence");
  assert.equal(event.bonusSharesPer10, 7);
  const revealed = corporateActionMarkersForBars([event], [bar], "1d", "Asia/Shanghai", exDate);
  assert.equal(revealed[0].date, event.date);
  assert.equal(revealed[0].description, event.description);
});

test("blind action labels distinguish cash, quantity, and unsupported events without revealing amounts", () => {
  const bar = { timestamp: exDate, open: 30, high: 32, low: 29, close: 31 };
  for (const [action, label] of [
    [{ ...event, bonusSharesPer10: 0 }, "除息"],
    [{ ...event, cashPer10: 0 }, "除权"],
    [{ ...event, category: 11 }, "权息"],
  ]) {
    const [marker] = corporateActionMarkersForBars([action], [bar], "1d", "Asia/Shanghai", exDate, true);
    assert.equal(marker.label, label);
    assert.equal(marker.date, "");
    assert.doesNotMatch(marker.description, /2018|每10|派1|转7/);
  }
  assert.deepEqual(corporateActionMarkersForBars([event], [bar], "1d", "Asia/Shanghai", exDate - 1, true), []);
  assert.deepEqual(corporateActionMarkersForBars([event], [], "1d", "Asia/Shanghai", exDate, true), []);
  const weekStart = exDate - 3 * 86400000;
  assert.deepEqual(corporateActionMarkersForBars([event], [{ ...bar, timestamp: weekStart }], "1w", "Asia/Shanghai", exDate - 1, true), []);
});
