import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimeframeViewSourceMetadata,
  findTimeframeViewCursor,
  visibleTimeframeViewBars,
} from "../app/lib/timeframeView.ts";

const bars = [
  { timestamp: 1_000, close: 10 },
  { timestamp: 2_000, close: 11 },
  { timestamp: 3_000, close: 12 },
  { timestamp: 4_000, close: 13 },
];

test("maps the current training timestamp to the latest target bar not in the future", () => {
  assert.equal(findTimeframeViewCursor(bars, 3_500), 2);
  assert.equal(findTimeframeViewCursor(bars, 500), -1);
});

test("keeps target-period view bars at or before the current training timestamp", () => {
  assert.deepEqual(visibleTimeframeViewBars(bars, 3_500), bars.slice(0, 3));
  assert.deepEqual(visibleTimeframeViewBars(bars, 500), []);
  assert.deepEqual(visibleTimeframeViewBars(bars, 3_000, false), bars.slice(0, 2));
});

test("builds a stable source metadata object for cached timeframe views", () => {
  assert.deepEqual(
    buildTimeframeViewSourceMetadata({
      sourceSnapshotId: "snapshot-1",
      sourceTimeframe: "5m",
      targetTimeframe: "1h",
      mode: "aggregated",
      firstTimestamp: 1_000,
      lastTimestamp: 4_000,
    }),
    {
      kind: "timeframe-view",
      version: 1,
      sourceSnapshotId: "snapshot-1",
      sourceTimeframe: "5m",
      targetTimeframe: "1h",
      mode: "aggregated",
      firstTimestamp: 1_000,
      lastTimestamp: 4_000,
    },
  );
});
