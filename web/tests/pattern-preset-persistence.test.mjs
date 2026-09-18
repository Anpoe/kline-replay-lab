import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHiddenBuiltInPatternPresetIds,
  hiddenBuiltInPatternPresetIds,
  mergeHiddenBuiltInPatternPresets,
  PATTERN_PRESET_RESTORE_ACTION,
} from "../app/lib/patternPresetPersistence.ts";

const hiddenBuiltIn = {
  id: "breakout",
  kind: "breakout",
  name: "区间突破",
  description: "隐藏的内置形态",
  builtIn: true,
  parameters: { lookback: 20 },
  enabled: false,
};

const visibleBuiltIn = {
  ...hiddenBuiltIn,
  enabled: undefined,
};

test("applies a local hidden shadow without changing other presets", () => {
  const presets = [visibleBuiltIn, { ...hiddenBuiltIn, id: "uptrend", enabled: undefined }];

  const applied = applyHiddenBuiltInPatternPresetIds(presets, ["breakout"]);

  assert.equal(applied[0].enabled, false);
  assert.equal(applied[1].enabled, undefined);
  assert.deepEqual(hiddenBuiltInPatternPresetIds(applied), ["breakout"]);
});

test("stale visible preference writes cannot re-enable an existing hidden built-in", () => {
  const merged = mergeHiddenBuiltInPatternPresets(
    { version: 1, patternPresets: [visibleBuiltIn] },
    { version: 1, patternPresets: [hiddenBuiltIn] },
  );

  assert.equal(merged.patternPresets[0].enabled, false);
});

test("stale writes cannot drop a hidden built-in from the preset list", () => {
  const merged = mergeHiddenBuiltInPatternPresets(
    { version: 1, patternPresets: [] },
    { version: 1, patternPresets: [hiddenBuiltIn] },
  );

  assert.deepEqual(merged.patternPresets, [hiddenBuiltIn]);
});

test("only the explicit restore action may clear hidden built-ins", () => {
  const restored = mergeHiddenBuiltInPatternPresets(
    {
      version: 1,
      patternPresetAction: PATTERN_PRESET_RESTORE_ACTION,
      patternPresets: [visibleBuiltIn],
    },
    { version: 1, patternPresets: [hiddenBuiltIn] },
    true,
  );

  assert.equal(restored.patternPresets[0].enabled, undefined);
});
