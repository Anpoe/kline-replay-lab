import assert from "node:assert/strict";
import test from "node:test";
import { latestClosedUsSession } from "../app/lib/usMarketSessions.ts";

const calendar = [
  { date: "2026-07-31", close: "16:00" },
  { date: "2026-08-03", close: "16:00" },
  { date: "2026-08-04", close: "16:00" },
];

test("纽约收盘后可使用当天美股日线", () => {
  assert.equal(
    latestClosedUsSession(calendar, new Date("2026-08-04T03:42:00Z")),
    "2026-08-03",
  );
});

test("纽约收盘前不会把未完成的当天交易日当成最新日线", () => {
  assert.equal(
    latestClosedUsSession(calendar, new Date("2026-08-03T19:00:00Z")),
    "2026-07-31",
  );
});
