import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [service, runner] = await Promise.all([
  readFile(new URL("app/lib/dataAutoUpdateService.ts", root), "utf8"),
  readFile(new URL("local-data/background-auto-update.mjs", root), "utf8"),
]);

test("自动更新检查 GOLD 的已有覆盖并交给 Dukascopy 日期边界", () => {
  assert.match(service, /goldRows/);
  assert.match(service, /inspectFxUpdates\([\s\S]*goldRows/);
  assert.match(service, /marketLabel = "外汇"/);
  assert.match(service, /Dukascopy 检查最近完整交易日/);
  assert.match(service, /GOLD:[\s\S]*gold/);
});

test("后台自动更新调度 GOLD 的待更新品种", () => {
  assert.match(runner, /const gold = asObject\(markets\.GOLD\)/);
  assert.match(runner, /gold\.duePairIds/);
  assert.match(runner, /setMarket\("GOLD"/);
});
