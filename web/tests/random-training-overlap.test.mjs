import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTrainingWindowOverlap,
  findStrongestTrainingWindowOverlap,
} from "../app/lib/randomTrainingOverlap.ts";

const timestamps = Array.from({ length: 10 }, (_, index) => (index + 1) * 1_000);

test("random training overlap uses the current window as the denominator", () => {
  assert.deepEqual(calculateTrainingWindowOverlap(timestamps, 3_000, 10_000), {
    overlapBars: 8,
    currentBarCount: 10,
    overlapRatio: 0.8,
  });
});

test("duplicate warning requires more than 80 percent overlap", () => {
  assert.equal(findStrongestTrainingWindowOverlap(timestamps, [{
    value: "exactly-80",
    startTimestamp: 3_000,
    endTimestamp: 10_000,
  }]), null);

  assert.deepEqual(findStrongestTrainingWindowOverlap(timestamps, [{
    value: "over-80",
    startTimestamp: 2_000,
    endTimestamp: 10_000,
  }]), {
    value: "over-80",
    overlapBars: 9,
    currentBarCount: 10,
    overlapRatio: 0.9,
  });
});

test("duplicate warning links to the strongest overlapping training", () => {
  const match = findStrongestTrainingWindowOverlap(timestamps, [
    { value: "nine-bars", startTimestamp: 2_000, endTimestamp: 10_000 },
    { value: "all-bars", startTimestamp: 1_000, endTimestamp: 10_000 },
  ]);
  assert.equal(match?.value, "all-bars");
  assert.equal(match?.overlapRatio, 1);
});
