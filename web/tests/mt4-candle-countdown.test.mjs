import test from "node:test";
import assert from "node:assert/strict";
import { mt4CandleCountdown } from "../app/lib/mt4CandleCountdown.mjs";

const opening = Date.UTC(2026, 9, 14, 12);
const clock = { serverTime: opening / 1000 + 104, receivedAt: 1000, now: 1000, connected: true };
test("MT4 countdown uses terminal clock and advances between snapshots", () => {
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 15, ...clock }), "13:16");
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 15, ...clock, now: 2000 }), "13:15");
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 240, ...clock }), "3:58:16");
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 15, ...clock, serverTime: opening / 1000 + 901 }), "00:00");
  assert.equal(mt4CandleCountdown({ openTime: opening + 900000, timeframe: 15, ...clock, serverTime: opening / 1000 + 901 }), "14:59");
});
test("calendar month countdown handles leap years and weekly periods", () => {
  const february = Date.UTC(2024, 1, 1);
  assert.equal(mt4CandleCountdown({ openTime: february, timeframe: 43200, ...clock, serverTime: Date.UTC(2024, 1, 28, 23, 59, 59) / 1000 }), "24:00:01");
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 10080, ...clock, serverTime: opening / 1000 + 6 * 86400 }), "24:00:00");
});
test("missing clock and lost connection never invent a running countdown", () => {
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 15, ...clock, serverTime: undefined }), "—:—");
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 15, ...clock, connected: false }), "已暂停");
  assert.equal(mt4CandleCountdown({ openTime: opening, timeframe: 15, ...clock, now: 17000 }), "已暂停");
  assert.equal(mt4CandleCountdown({ openTime: 0, timeframe: 15, ...clock }), null);
});
