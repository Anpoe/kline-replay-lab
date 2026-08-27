import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const eaPath = path.resolve(here, "..", "AlwaysInStructureAlert.mq4");
const modelPath = path.resolve(here, "..", "always-in-alert-model.mjs");
const patternFilterPath = path.resolve(here, "..", "..", "web", "app", "lib", "patternFilters.ts");

test("Always In EA exposes the screenshot parameters and lifecycle", () => {
  assert.equal(fs.existsSync(eaPath), true, "EA source should exist");
  const source = fs.readFileSync(eaPath, "utf8");
  for (const name of [
    "InpEmaPeriod",
    "InpPivotStrength",
    "InpFollowThroughBars",
    "InpEmaSlopeBars",
    "InpStateLookback",
    "InpRecentBreakoutBars",
    "InpControlWindow",
    "InpMinimumTrendCloses",
    "InpMaximumEmaCrosses",
  ]) {
    assert.match(source, new RegExp(`Inp${name.slice(3)}`));
  }
  assert.match(source, /InpCooldownBars\s*=\s*10/);
  assert.match(source, /InpCooldownBars\s*!=\s*10/);
  assert.match(source, /OnInit\s*\(/);
  assert.match(source, /OnTick\s*\(/);
});

test("Always In EA is alert-only and contains no trade API", () => {
  assert.equal(fs.existsSync(eaPath), true, "EA source should exist");
  const source = fs.readFileSync(eaPath, "utf8");
  assert.match(source, /Alert\s*\(/);
  assert.match(source, /Print\s*\(/);
  assert.doesNotMatch(source, /\b(OrderSend|OrderModify|OrderClose|OrderDelete|OrderSelect|OrderType)\s*\(/);
});

test("Long and Short share the ten-bar cooldown", async () => {
  const { cooldownAlertIndices } = await import(pathToFileURL(modelPath).href);
  assert.deepEqual(
    cooldownAlertIndices([1, 1, 1, -1, -1, -1, -1], 2),
    [0, 3, 6],
  );
});

test("closed-bar guard rejects the forming candle", async () => {
  const { assertClosedBarIndex } = await import(pathToFileURL(modelPath).href);
  assert.throws(() => assertClosedBarIndex(0, 100), /closed candle/i);
  assert.throws(() => assertClosedBarIndex(100, 100), /closed candle/i);
  assert.doesNotThrow(() => assertClosedBarIndex(1, 100));
  const source = fs.readFileSync(eaPath, "utf8");
  assert.match(source, /int shift = requested - position/);
  assert.doesNotMatch(source, /i(?:Open|High|Low|Close)\(Symbol\(\),\s*Period\(\),\s*0\)/);
});

test("strict structure fixture produces both long and mirrored short states", async () => {
  const { defaultPatternPresets, matchesPattern } = await import(pathToFileURL(patternFilterPath).href);
  const candle = (timestamp, open, high, low, close) => ({ timestamp, open, high, low, close, volume: 100 });
  const rows = [
    [9.3, 9.8, 9.1, 9.5], [9.5, 10.2, 9.3, 10], [10, 10.7, 9.8, 10.5],
    [10.5, 12, 10.3, 11.5], [11.5, 11.6, 10.7, 11], [11, 11.2, 10.2, 10.5],
    [10.4, 10.6, 9, 10.2], [10.2, 10.4, 9.4, 10.25], [10.2, 11.4, 9.8, 11],
    [11, 13, 10.8, 12.5], [12.5, 12.6, 11.7, 12], [12, 12.2, 11, 11.5],
    [11.5, 11.8, 10, 11], [11, 11.3, 10.3, 11.1], [11.1, 12.5, 10.8, 12],
    [12, 14, 11.8, 13.5], [13.4, 14.8, 13.2, 14.5],
  ];
  const bars = rows.map((values, index) => candle(index, ...values));
  const mirrored = bars.map((bar) => candle(
    bar.timestamp,
    30 - bar.open,
    30 - bar.low,
    30 - bar.high,
    30 - bar.close,
  ));
  const parameters = {
    emaPeriod: 5,
    pivotStrength: 1,
    followThroughBars: 1,
    emaSlopeBars: 1,
    stateLookback: 20,
    recentBreakoutBars: 10,
    controlWindow: 6,
    minimumTrendCloses: 3,
    maximumEmaCrosses: 3,
  };
  const long = defaultPatternPresets.find((preset) => preset.id === "always-in-long");
  const short = defaultPatternPresets.find((preset) => preset.id === "always-in-short");
  assert.equal(matchesPattern(bars, 16, { ...long, parameters }), true);
  assert.equal(matchesPattern(mirrored, 16, { ...short, parameters }), true);
});
