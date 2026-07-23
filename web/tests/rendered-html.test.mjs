import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the K-line training workbench instead of the starter", async () => {
  const [page, layout, workbench, packageJson, replayChart, sessionsRoute, snapshotsRoute, marketRules] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
    readFile(new URL("app/api/sessions/route.ts", root), "utf8"),
    readFile(new URL("app/api/snapshots/route.ts", root), "utf8"),
    readFile(new URL("app/lib/marketRules.ts", root), "utf8"),
  ]);

  assert.match(page, /<TrainingWorkbench\s*\/>/);
  assert.match(layout, /K线训练营 2\.0/);
  assert.match(workbench, /未来已隐藏/);
  assert.match(workbench, /下一根开盘/);
  assert.match(workbench, /K 线数据库/);
  assert.match(workbench, /queueClosePosition/);
  assert.match(workbench, /kline-replay-lab:last-training/);
  assert.match(workbench, /继续训练/);
  assert.match(workbench, /drawingsRestoreNonce/);
  assert.match(workbench, /session_created/);
  assert.match(workbench, /decision_submitted/);
  assert.match(workbench, /decisionSubmissions/);
  assert.match(workbench, /事前决策记录/);
  assert.match(workbench, /查看复盘/);
  assert.match(workbench, /orders_filled/);
  assert.match(workbench, /deleteSession/);
  assert.match(workbench, /dataSnapshotId/);
  assert.match(replayChart, /tradeLifecycle/);
  assert.match(replayChart, /decisionSubmission/);
  assert.match(replayChart, /syncDecisionMarkers/);
  assert.match(replayChart, /PersistedDrawing/);
  assert.match(replayChart, /getPersistedDrawings/);
  assert.match(replayChart, /style: "dashed"/);
  assert.match(sessionsRoute, /export async function DELETE/);
  assert.match(sessionsRoute, /ORDER BY sequence ASC/);
  assert.match(snapshotsRoute, /SHA-256/);
  assert.match(snapshotsRoute, /contentHash/);
  assert.match(marketRules, /CN_A_MAINBOARD_RULES_V1/);
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
    access(new URL("drizzle/0001_pale_jazinda.sql", root)),
    access(new URL("drizzle/0002_watery_thunderbolt_ross.sql", root)),
  ]);
});
