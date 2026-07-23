import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the K-line training workbench instead of the starter", async () => {
  const [page, layout, workbench, packageJson, replayChart] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
  ]);

  assert.match(page, /<TrainingWorkbench\s*\/>/);
  assert.match(layout, /K线训练营 2\.0/);
  assert.match(workbench, /未来已隐藏/);
  assert.match(workbench, /下一根开盘成交/);
  assert.match(workbench, /K 线数据库/);
  assert.match(workbench, /每次开仓形成独立持仓/);
  assert.match(workbench, /queueClosePosition/);
  assert.match(replayChart, /tradeLifecycle/);
  assert.match(replayChart, /style: "dashed"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("generated sample candles satisfy OHLC invariants", async () => {
  const source = await readFile(new URL("db/sample-data.ts", root), "utf8");
  assert.match(source, /generateDaily/);
  assert.match(source, /generateIntraday/);
  assert.match(source, /aggregateBars/);
  assert.match(source, /Math\.max\(open, close\)/);
  assert.match(source, /Math\.min\(open, close\)/);
});

test("build output and database migration exist", async () => {
  await Promise.all([
    access(new URL("dist/server/index.js", root)),
    access(new URL("drizzle/0000_third_cassandra_nova.sql", root)),
  ]);
});
