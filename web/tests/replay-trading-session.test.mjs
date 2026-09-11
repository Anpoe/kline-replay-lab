import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceReplayCursor,
  firstReplaySkippedBarIndex,
  normalizeReplayTradingSession,
} from "../app/lib/replayTradingSession.ts";
import { executeBarStep, DEFAULT_EXECUTION_COST_PROFILE } from "../app/lib/executionEngine.ts";

const session = { enabled: true, startTime: "07:00", endTime: "18:00" };
const bar = (time, overrides = {}) => ({ timestamp: Date.parse(time), open: 100, high: 101, low: 99, close: 100, ...overrides });
const bars = [
  bar("2026-09-07T17:55:00+08:00"),
  bar("2026-09-07T18:00:00+08:00", { low: 89 }),
  bar("2026-09-08T06:55:00+08:00"),
  bar("2026-09-08T07:00:00+08:00"),
  bar("2026-09-08T07:05:00+08:00"),
  bar("2026-09-08T07:10:00+08:00"),
];
const advance = (options = {}) => advanceReplayCursor({
  bars, cursor: 0, requestedCount: 1, endCursor: bars.length - 1,
  session, timeframe: "5m", timezone: "Asia/Shanghai", ...options,
});

test("skips from the exclusive session end to its inclusive start without removing history", () => {
  const original = structuredClone(bars);
  const cursor = advance();
  assert.equal(cursor, 3);
  assert.deepEqual(bars.slice(0, cursor + 1), original.slice(0, 4));
  assert.deepEqual(bars, original);
  assert.equal(advance({ cursor }), 4);
});

test("fast forward counts only candles within the chosen session", () => {
  assert.equal(advance({ requestedCount: 3 }), 5);
});

test("identifies the first candle at which a replay session skip begins", () => {
  assert.equal(firstReplaySkippedBarIndex({
    bars,
    cursor: 0,
    destination: advance(),
    session,
    timeframe: "5m",
    timezone: "Asia/Shanghai",
  }), 1);
  assert.equal(firstReplaySkippedBarIndex({
    bars,
    cursor: 0,
    destination: 1,
    session,
    timeframe: "5m",
    timezone: "Asia/Shanghai",
  }), 1);
  assert.equal(firstReplaySkippedBarIndex({
    bars,
    cursor: 0,
    destination: 0,
    session,
    timeframe: "5m",
    timezone: "Asia/Shanghai",
  }), null);
});

test("uses the chart timezone and supports minute precision", () => {
  assert.equal(advance({ timezone: "UTC" }), 1);
  assert.equal(advance({ session: { ...session, startTime: "07:05" } }), 4);
});

test("supports an overnight session and excludes its end", () => {
  const overnightBars = ["21:55", "22:00", "23:55", "00:00", "06:55", "07:00", "22:00"]
    .map((time, index) => bar(`2026-09-${index < 3 ? "07" : "08"}T${time}:00+08:00`));
  const options = { bars: overnightBars, endCursor: 6, session: { ...session, startTime: "22:00", endTime: "07:00" } };
  assert.equal(advance(options), 1);
  assert.equal(advance({ ...options, cursor: 2 }), 3);
  assert.equal(advance({ ...options, cursor: 4 }), 6);
});

test("uses timezone daylight saving rules for each historical candle", () => {
  const dstBars = [
    bar("2026-03-06T22:55:00Z"), // New York 17:55, before DST
    bar("2026-03-06T23:00:00Z"),
    bar("2026-03-09T10:55:00Z"), // New York 06:55, after DST
    bar("2026-03-09T11:00:00Z"),
  ];
  assert.equal(advance({ bars: dstBars, endCursor: 3, timezone: "America/New_York" }), 3);
});

test("leaves disabled, random, live, daily and larger replay advances unchanged", () => {
  for (const options of [
    { session: { ...session, enabled: false } }, { randomRun: true }, { liveMode: true },
    ...["1d", "1w", "1mo"].map((timeframe) => ({ timeframe })),
  ]) assert.equal(advance(options), 1);
});

test("reaches the original task boundary even when no in-session candle remains", () => {
  assert.equal(advance({ endCursor: 2 }), 2);
  assert.equal(advance({ cursor: 2, endCursor: 2 }), 2);
  assert.equal(advance({ cursor: 5 }), 5);
  assert.equal(advance({ bars: [], cursor: 0, endCursor: 0 }), 0);
});

test("preserves scheduled-order pauses unless the pause would land outside the chosen session", () => {
  const scheduledOrderTimestamps = [bars[3].timestamp];
  assert.equal(advance({ requestedCount: 5, session: { ...session, enabled: false }, scheduledOrderTimestamps }), 2);
  assert.equal(advance({ scheduledOrderTimestamps }), 3);
  assert.equal(advance({ requestedCount: 5, scheduledOrderTimestamps: [bars[5].timestamp] }), 4);
});

test("execution engine keeps protective exits available without session settlement", () => {
  let state = { orders: [], positions: [{
    id: "position", side: "long", qty: 1, entryPrice: 100, entryTimestamp: bars[0].timestamp,
    entryOrderId: "open", status: "open", stopLoss: 90,
  }], cashBalance: 900 };
  const fills = [];
  for (let index = 1; index <= advance(); index += 1) {
    const result = executeBarStep({ ...state, bar: bars[index], profile: DEFAULT_EXECUTION_COST_PROFILE, capitalMode: true });
    state = { orders: result.remainingOrders, positions: result.positions, cashBalance: result.cashBalance };
    fills.push(...result.fills);
  }
  assert.equal(fills.length, 1);
  assert.equal(fills[0].reason, "stop_loss");
  assert.equal(fills[0].timestamp, bars[1].timestamp);
  assert.equal(fills[0].price, 90);
  assert.equal(state.positions[0].status, "closed");
  assert.equal(state.cashBalance, 990);
});

test("session-end close exits at the first skipped candle open before protective levels", () => {
  const result = executeBarStep({
    orders: [{
      id: "session-close:position",
      action: "close",
      side: "sell",
      qty: 1,
      createdAt: bars[1].timestamp,
      positionId: "position",
      orderType: "market",
      reason: "session_end",
    }],
    positions: [{
      id: "position", side: "long", qty: 1, entryPrice: 100, entryTimestamp: bars[0].timestamp,
      entryOrderId: "open", status: "open", stopLoss: 90,
    }],
    bar: bars[1],
    profile: DEFAULT_EXECUTION_COST_PROFILE,
    cashBalance: 900,
    capitalMode: true,
    skipProtectiveExits: true,
  });
  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].reason, "session_end");
  assert.equal(result.fills[0].timestamp, bars[1].timestamp);
  assert.equal(result.fills[0].price, bars[1].open);
  assert.equal(result.positions[0].status, "closed");
  assert.equal(result.cashBalance, 1000);
});

test("legacy or corrupt stored sessions default to unrestricted replay", () => {
  assert.deepEqual(normalizeReplayTradingSession(undefined), { ...session, enabled: false });
  for (const value of [null, [], { ...session, startTime: "25:00" }, { ...session, endTime: "07:00" }]) {
    assert.equal(normalizeReplayTradingSession(value).enabled, false);
  }
  assert.deepEqual(normalizeReplayTradingSession(session), session);
});
