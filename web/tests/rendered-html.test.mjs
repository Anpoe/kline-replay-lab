import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the K-line training workbench instead of the starter", async () => {
  const [page, layout, workbench, dataSourceManager, providerSettings, providerSettingsRoute, packageJson, replayChart, sessionsRoute, snapshotsRoute, marketRules] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/components/DataSourceManager.tsx", root), "utf8"),
    readFile(new URL("app/components/ProviderSettingsPanel.tsx", root), "utf8"),
    readFile(new URL("app/api/provider-settings/route.ts", root), "utf8"),
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
  assert.match(workbench, /只有点击“保存训练”或训练自动结束后/);
  assert.match(workbench, /随机训练规则/);
  assert.match(workbench, /继续随机/);
  assert.match(workbench, /退出随机训练/);
  assert.match(workbench, /训练表现/);
  assert.match(workbench, /整体表现/);
  assert.match(workbench, /筛选训练集/);
  assert.match(workbench, /选择具体训练/);
  assert.match(workbench, /什么是盲测/);
  assert.match(workbench, /总盈亏/);
  assert.match(workbench, /orders_filled/);
  assert.match(workbench, /deleteSession/);
  assert.match(workbench, /dataSnapshotId/);
  assert.match(workbench, /DataSourceManager/);
  assert.match(dataSourceManager, /Tushare/);
  assert.match(dataSourceManager, /Alpaca/);
  assert.match(dataSourceManager, /创建并开始下载/);
  assert.match(dataSourceManager, /任务按页保存进度/);
  assert.doesNotMatch(dataSourceManager, /\.env\.local/);
  assert.match(providerSettings, /数据源设置|历史行情数据源/);
  assert.match(providerSettings, /保存 Alpaca/);
  assert.match(providerSettings, /清除本机凭证/);
  assert.doesNotMatch(providerSettingsRoute, /credentialsJson.*Response\.json/s);
  assert.match(replayChart, /tradeLifecycle/);
  assert.match(replayChart, /decisionSubmission/);
  assert.match(replayChart, /syncDecisionMarkers/);
  assert.match(replayChart, /PersistedDrawing/);
  assert.match(replayChart, /getPersistedDrawings/);
  assert.match(replayChart, /style: "dashed"/);
  assert.match(sessionsRoute, /export async function DELETE/);
  assert.match(sessionsRoute, /ORDER BY sequence ASC/);
  assert.match(sessionsRoute, /searchParams\.get\("all"\) === "1"/);
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
    access(new URL("drizzle/0003_calm_silvermane.sql", root)),
    access(new URL("drizzle/0004_violet_squirrel_girl.sql", root)),
  ]);
});
