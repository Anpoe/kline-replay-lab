import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indicators = await import("../app/lib/chartIndicators.ts");

test("normalizes MA and EMA settings without accepting unusable periods", () => {
  const value = indicators.normalizeMovingAverageSettings({
    ma: { enabled: false, periods: [0, 5.4, 5, 999, "20"] },
    ema: { enabled: true, periods: [] },
  });

  assert.deepEqual(value.ma, { enabled: false, periods: [1, 5, 500, 20] });
  assert.deepEqual(value.ema, { enabled: true, periods: [12, 26] });
});

test("limits each moving-average group to six unique lines", () => {
  assert.deepEqual(
    indicators.normalizeMovingAveragePeriods([2, 3, 5, 8, 13, 21, 34, 34], [5]),
    [2, 3, 5, 8, 13, 21],
  );
});

test("wires configurable MA and EMA into the price pane and both toolbar layouts", async () => {
  const [chart, workbench, styles] = await Promise.all([
    readFile(new URL("../app/components/KLineReplayChart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TrainingWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(chart, /PRICE_INDICATOR_PANE = "candle_pane"/);
  assert.match(chart, /chart\.createIndicator\(override, true\)/);
  assert.match(chart, /chart\.overrideIndicator\(override\)/);
  assert.match(workbench, /aria-label="主图指标设置"/);
  assert.match(workbench, /aria-label="MA 和 EMA 指标设置"/);
  assert.match(workbench, /MOVING_AVERAGE_SETTINGS_KEY/);
  assert.match(workbench, /className="mobile-indicator-settings"/);
  assert.match(styles, /\.indicator-popover/);
});
