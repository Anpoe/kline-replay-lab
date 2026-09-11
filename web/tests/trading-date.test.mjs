import assert from "node:assert/strict";
import test from "node:test";
import { tradingDate } from "../app/lib/marketRules.ts";

test("trading dates preserve local midnight and historical daylight saving boundaries", () => {
  for (const [timestamp, timezone, expected] of [
    ["2026-01-01T04:59:00Z", "America/New_York", "2025-12-31"],
    ["2026-01-01T05:00:00Z", "America/New_York", "2026-01-01"],
    ["2026-07-01T03:59:00Z", "America/New_York", "2026-06-30"],
    ["2026-07-01T04:00:00Z", "America/New_York", "2026-07-01"],
    ["2026-01-01T16:00:00Z", "Asia/Shanghai", "2026-01-02"],
  ]) {
    assert.equal(tradingDate(Date.parse(timestamp), timezone), expected);
  }
  assert.throws(() => tradingDate(0, "Invalid/Timezone"), RangeError);
});

test("bulk snapshot date analysis does not allocate an Intl formatter per candle", async (t) => {
  let allocations = 0;
  const OriginalFormatter = Intl.DateTimeFormat;
  t.mock.method(Intl, "DateTimeFormat", function (...args) {
    allocations += 1;
    return new OriginalFormatter(...args);
  });
  // Load a fresh module so the check is independent of the other test's cache.
  const { tradingDate: formatDate } = await import("../app/lib/marketRules.ts?bulk-analysis");
  const start = Date.parse("2026-07-01T00:00:00Z");
  for (let index = 0; index < 20_000; index += 1) {
    const timezone = index % 2 ? "America/New_York" : "Asia/Shanghai";
    assert.match(formatDate(start + index * 60_000, timezone), /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.ok(allocations <= 2, `Allocated ${allocations} formatters for only two timezones`);
});
