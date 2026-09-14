import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldRebuildLegacyUsData,
  summarizeLegacyUsData,
  normalizeLegacyUsDataSummary,
} from "../app/lib/legacyUsData.ts";

test("已有复权覆盖时，不因旧版原始历史更长而重复要求重建", () => {
  assert.equal(shouldRebuildLegacyUsData({ legacyBarCount: 2_327, adjustedBarCount: 1_388 }), false);
  assert.equal(shouldRebuildLegacyUsData({ legacyBarCount: 2_327, adjustedBarCount: 0 }), true);
  assert.deepEqual(summarizeLegacyUsData([
    {
      legacyBarCount: 2_327,
      adjustedBarCount: 1_388,
      firstTimestamp: 1493352000000,
      lastTimestamp: 1785470400000,
    },
    {
      legacyBarCount: 100,
      adjustedBarCount: 0,
      firstTimestamp: 1451883600000,
      lastTimestamp: 1785470400000,
    },
  ]), {
    needsRebuild: true,
    instrumentCount: 1,
    barCount: 100,
    firstTimestamp: 1451883600000,
    lastTimestamp: 1785470400000,
  });
});

test("旧版美股摘要只把有效原始覆盖标记为待重建", () => {
  assert.deepEqual(normalizeLegacyUsDataSummary({
    instrumentCount: "2",
    barCount: "500",
    firstTimestamp: "1451883600000",
    lastTimestamp: "1789099200000",
  }), {
    needsRebuild: true,
    instrumentCount: 2,
    barCount: 500,
    firstTimestamp: 1451883600000,
    lastTimestamp: 1789099200000,
  });
  assert.equal(normalizeLegacyUsDataSummary(null).needsRebuild, false);
});

test("空摘要不会要求美股重建", () => {
  assert.deepEqual(normalizeLegacyUsDataSummary({
    instrumentCount: 0,
    barCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  }), {
    needsRebuild: false,
    instrumentCount: 0,
    barCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  });
});
