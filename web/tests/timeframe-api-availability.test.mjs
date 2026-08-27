import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TIMEFRAME_IDS, timeframeLookbackMs } from "../app/lib/timeframeCatalog.ts";
import { normalizeTimeframeCoverage } from "../app/lib/timeframeAvailability.ts";

test("daily-only instruments keep the full display catalog and can derive larger calendar periods", () => {
  assert.deepEqual([...TIMEFRAME_IDS], ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"]);
  assert.deepEqual(normalizeTimeframeCoverage(["1d"]), ["1d"]);
});

test("invalid or missing coverage never becomes an available timeframe", () => {
  assert.deepEqual(normalizeTimeframeCoverage(["1d", "not-a-timeframe", "1mo", "1d"]), ["1d", "1mo"]);
  assert.deepEqual(normalizeTimeframeCoverage(undefined), []);
});

test("monthly direct reads have a calendar-safe lookback instead of a null duration", () => {
  assert.equal(timeframeLookbackMs("1mo"), 31 * 24 * 60 * 60 * 1000);
  assert.equal(timeframeLookbackMs("not-a-timeframe"), null);
});

test("snapshot creation materializes a derived target from an available lower source", async () => {
  const source = await readFile(new URL("../app/api/snapshots/route.ts", import.meta.url), "utf8");

  assert.match(source, /ensureDerivedTimeframeCandleSource/);
  assert.match(source, /aggregateTimeframeViewCandles\(/);
  assert.match(source, /derived:\$\{sourceTimeframe\}/);
});
