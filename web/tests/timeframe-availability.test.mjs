import assert from "node:assert/strict";
import test from "node:test";

import {
  availableTimeframesForInstrument,
  isTimeframeAvailable,
  timeframeDisplayOptions,
} from "../app/lib/timeframeAvailability.ts";

const supported = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"];

test("keeps every timeframe visible while deriving larger periods from daily data", () => {
  const catalog = [{ id: "AAPL.US", timeframes: ["1d"] }];

  assert.deepEqual(timeframeDisplayOptions(supported), supported);
  assert.deepEqual(availableTimeframesForInstrument(catalog, "AAPL.US", supported), ["1d", "1w", "1mo"]);
  assert.equal(isTimeframeAvailable(catalog, "AAPL.US", "1d"), true);
  assert.equal(isTimeframeAvailable(catalog, "AAPL.US", "15m"), false);
  assert.equal(isTimeframeAvailable(catalog, "AAPL.US", "1mo"), true);
});

test("derives all larger intraday and calendar periods from a smaller base", () => {
  const catalog = [{ id: "EURUSD.FX", timeframes: ["5m"] }];

  assert.deepEqual(availableTimeframesForInstrument(catalog, "EURUSD.FX", supported), [
    "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo",
  ]);
});

test("does not derive MN from weekly candles because weekly OHLCV crosses month boundaries", () => {
  const catalog = [{ id: "WEEKLY", timeframes: ["1w"] }];

  assert.deepEqual(availableTimeframesForInstrument(catalog, "WEEKLY", supported), ["1w"]);
});

test("does not treat missing instrument coverage as all timeframes available", () => {
  assert.deepEqual(availableTimeframesForInstrument([{ id: "UNKNOWN" }], "UNKNOWN", supported), []);
  assert.equal(isTimeframeAvailable([{ id: "UNKNOWN" }], "UNKNOWN", "1d"), false);
});
