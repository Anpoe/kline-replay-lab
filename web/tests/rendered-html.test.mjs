import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the K-line training workbench instead of the starter", async () => {
  const [page, layout, workbench, dataSourceManager, providerSettings, settingsPanel, reviewHistory, providerSettingsRoute, packageJson, replayChart, sessionsRoute, snapshotsRoute, marketRules, marketJobsRoute, dataJobsRoute, downloadRunner] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/features/market-data/components/DataSourceManager.tsx", root), "utf8"),
    readFile(new URL("app/features/market-data/components/ProviderSettingsPanel.tsx", root), "utf8"),
    readFile(new URL("app/features/settings/components/SettingsPanel.tsx", root), "utf8"),
    readFile(new URL("app/features/review/components/SessionHistoryPanel.tsx", root), "utf8"),
    readFile(new URL("app/api/provider-settings/route.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
    readFile(new URL("app/api/sessions/route.ts", root), "utf8"),
    readFile(new URL("app/api/snapshots/route.ts", root), "utf8"),
    readFile(new URL("app/lib/marketRules.ts", root), "utf8"),
    readFile(new URL("app/api/data-jobs/market/route.ts", root), "utf8"),
    readFile(new URL("app/api/data-jobs/route.ts", root), "utf8"),
    readFile(new URL("app/api/data-jobs/run/route.ts", root), "utf8"),
  ]);

  assert.match(page, /<TrainingWorkbenchShell\s*\/>/);
  assert.match(layout, /K线训练营 2\.0/);
  assert.match(layout, /ResizeObserver loop completed with undelivered notifications/);
  assert.match(layout, /stopImmediatePropagation/);
  assert.match(workbench, /未来已隐藏/);
  assert.match(workbench, /下一根开盘/);
  assert.match(workbench, /K 线数据库/);
  assert.match(workbench, /queueClosePosition/);
  assert.match(workbench, /kline-replay-lab:last-training/);
  assert.match(workbench, /继续训练/);
  assert.match(workbench, /trainingNavigatorSessions/);
  assert.match(workbench, /moveTrainingSession/);
  assert.match(workbench, /训练切换/);
  assert.match(workbench, /RECYCLE BIN/);
  assert.match(workbench, /loadTrashSessions/);
  assert.match(workbench, /inspectTrashedSession/);
  assert.match(workbench, /查看训练/);
  assert.match(workbench, /resumeSession\(session, true\)/);
  assert.match(workbench, /trashPreview/);
  assert.match(workbench, /恢复训练/);
  assert.match(workbench, /彻底删除/);
  assert.doesNotMatch(workbench, />默认品种/);
  assert.doesNotMatch(workbench, />默认周期/);
  assert.doesNotMatch(workbench, />默认下单数量/);
  assert.doesNotMatch(workbench, />默认播放速度/);
  assert.match(workbench, /drawingsRestoreNonce/);
  assert.match(workbench, /session_created/);
  assert.match(workbench, /decision_submitted/);
  assert.match(workbench, /decision_updated/);
  assert.match(workbench, /decision_deleted/);
  assert.match(workbench, /编辑事前决策/);
  assert.match(workbench, /DecisionLinkedTradeSummary/);
  assert.match(workbench, /关联交易/);
  assert.match(workbench, /跳到交易/);
  assert.match(workbench, /点击入场 \/ 出场时间可跳回对应 K 线/);
  assert.match(workbench, /删除这份决策吗/);
  assert.match(workbench, /编辑交易理由标签/);
  assert.match(workbench, /删除交易理由标签/);
  assert.match(workbench, /已同步 .* 份历史决策/);
  assert.match(workbench, /decisionSubmissions/);
  assert.match(workbench, /reasonTags/);
  assert.match(workbench, /normalizeReasonTagText/);
  assert.match(workbench, /REASON_TAGS_KEY/);
  assert.match(workbench, /事前决策记录/);
  assert.match(workbench, /查看复盘/);
  assert.match(reviewHistory, /全部可恢复训练，可滚动浏览/);
  assert.match(reviewHistory, /filters\.planStatus/);
  assert.match(reviewHistory, /已写计划/);
  assert.match(reviewHistory, /未写计划/);
  assert.match(sessionsRoute, /migrate-next-bar-decision-links/);
  assert.match(sessionsRoute, /migrate-same-bar-decision-links/);
  assert.match(sessionsRoute, /plan_bar_same_candle_entry/);
  assert.match(sessionsRoute, /plan_bar_then_next_candle_entry/);
  assert.match(workbench, /loadSessions\(true\)/);
  assert.match(workbench, /训练内容发生实际修改后会自动保存/);
  assert.match(workbench, /单纯浏览 K 线不会触发保存/);
  assert.match(settingsPanel, /随机训练规则/);
  assert.match(workbench, /RANDOM_TRAINING_PATTERN_PRESETS_KEY/);
  assert.match(workbench, /patternPresetIds: randomTrainingPatternPresetIds/);
  assert.doesNotMatch(workbench, /className="restore-notice"/);
  assert.match(workbench, /继续随机/);
  assert.match(workbench, /退出随机训练/);
  assert.match(workbench, /训练表现/);
  assert.match(workbench, /当前训练集/);
  assert.match(workbench, /按交易胜率/);
  assert.match(workbench, /按训练胜率/);
  assert.match(workbench, /训练收益率合计/);
  assert.match(workbench, /默认展示全部已保存训练/);
  assert.match(workbench, /最优持仓时长/);
  assert.match(workbench, /最优交易形态/);
  assert.match(workbench, /最优价格区间/);
  assert.match(workbench, /最优平均成交量区间/);
  assert.match(workbench, /最优平均成交额区间/);
  assert.match(workbench, /最优市值区间/);
  assert.match(workbench, /最优习惯组合/);
  assert.match(workbench, /筛选训练集/);
  assert.match(workbench, /选择具体训练/);
  assert.match(workbench, /什么是盲测/);
  assert.match(workbench, /总盈亏/);
  assert.match(workbench, /observationClose/);
  assert.match(workbench, /scanTimestamp/);
  assert.match(workbench, /entryTimestamp/);
  assert.match(workbench, /observationPrice/);
  assert.match(workbench, /function liveWatchHasLaterPrice/);
  assert.match(workbench, /watch\.latestTimestamp > observationTimestamp/);
  assert.match(workbench, /const pending = !liveWatchHasLaterPrice\(watch\)/);
  assert.match(workbench, /!row\.pending && row\.returnPct !== null/);
  assert.match(workbench, /观望当日开盘价/);
  assert.match(workbench, /liveWatchPerformanceRows/);
  assert.match(workbench, /liveWatchPerformanceSummary/);
  assert.match(workbench, /type LivePerformanceFilters/);
  assert.match(workbench, /buyDateFrom/);
  assert.match(workbench, /holdingStatus/);
  assert.match(workbench, /filteredLivePerformanceRows/);
  assert.match(workbench, /row\.buyTimestamps/);
  assert.match(workbench, /performanceFilters\.market/);
  assert.match(workbench, /performanceFilters\.outcome/);
  assert.match(workbench, /performanceMarketOptions/);
  assert.match(workbench, /value="profit"/);
  assert.match(workbench, /totalReturn/);
  assert.match(workbench, /previousIndex/);
  assert.match(workbench, /orders_filled/);
  assert.match(workbench, /deleteSession/);
  assert.match(workbench, /dataSnapshotId/);
  assert.match(workbench, /DataSourceManager/);
  assert.match(dataSourceManager, /Tushare/);
  assert.match(dataSourceManager, /Alpaca/);
  assert.match(dataSourceManager, /快速初始化/);
  assert.match(dataSourceManager, /高级自定义/);
  assert.match(dataSourceManager, /TdxQuant/);
  assert.match(dataSourceManager, /锁定训练数据版本/);
  assert.match(dataSourceManager, /刷新完整基础包/);
  assert.match(dataSourceManager, /每日增量更新/);
  assert.match(dataSourceManager, /扫描并修复缺口/);
  assert.match(dataSourceManager, /初始化美股市场库/);
  assert.doesNotMatch(dataSourceManager, /供应商代码/);
  assert.match(workbench, /选择要管理的数据市场/);
  assert.match(dataSourceManager, /result\.recovered/);
  assert.match(dataSourceManager, /4000/);
  assert.doesNotMatch(dataSourceManager, /\.env\.local/);
  assert.match(providerSettings, /数据源设置|历史行情数据源/);
  assert.match(providerSettings, /保存 Alpaca/);
  assert.match(providerSettings, /清除本机凭证/);
  assert.match(providerSettings, /正在读取本机凭证状态/);
  assert.match(providerSettings, /1200/);
  assert.match(dataSourceManager, /MarketSyncStatus/);
  assert.match(dataSourceManager, /market\/sync\/worker/);
  assert.match(dataSourceManager, /URL 长度自动计算批量/);
  assert.doesNotMatch(dataSourceManager, /usDownloadConcurrency/);
  assert.match(downloadRunner, /rowsPerStatement = 8/);
  assert.match(downloadRunner, /candle_coverage/);
  assert.match(workbench, /Keeping intraday snapshots bounded prevents multi-million-bar/);
  assert.match(workbench, /const rewindLocked = Boolean\(trainingTask\?\.randomRun\)/);
  assert.match(workbench, /随机训练为单向揭示，不允许查看上一根/);
  assert.match(settingsPanel, /收益率模式/);
  assert.match(settingsPanel, /资金账户模式/);
  assert.match(workbench, /insufficient_cash_at_fill/);
  assert.match(workbench, /次日开盘平仓/);
  assert.match(workbench, /order_queued_for_next_session/);
  assert.match(workbench, /earliestScheduledIndex - 1/);
  assert.match(workbench, /syncedPreferencesHydratedRef/);
  assert.match(workbench, /!syncedPreferencesReady \|\| !syncedPreferencesHydratedRef\.current/);
  assert.doesNotMatch(workbench, /\.finally\(\(\) => \{\s*if \(!cancelled\) setSyncedPreferencesReady\(true\)/);
  assert.doesNotMatch(providerSettingsRoute, /credentialsJson.*Response\.json/s);
  assert.match(replayChart, /tradeLifecycle/);
  assert.match(replayChart, /decisionSubmission/);
  assert.match(replayChart, /syncDecisionMarkers/);
  assert.match(replayChart, /PersistedDrawing/);
  assert.match(replayChart, /getPersistedDrawings/);
  assert.doesNotMatch(replayChart, /FrameResizeObserver/);
  assert.match(replayChart, /style: "dashed"/);
  assert.match(replayChart, /subscribeBar/);
  assert.match(replayChart, /chartBars\.length !== bars\.length/);
  assert.match(replayChart, /chart\.resetData\(\)/);
  assert.match(replayChart, /AUTHORITATIVE_REPLAY_RESET_BAR_LIMIT/);
  assert.match(replayChart, /chart\.resize\(\)/);
  assert.match(replayChart, /wheelZoomScale/);
  assert.match(replayChart, /tradeMarkerSignature/);
  assert.match(replayChart, /signature !== syncedTradeMarkersRef\.current/);
  assert.match(sessionsRoute, /export async function DELETE/);
  assert.match(sessionsRoute, /export async function PATCH/);
  assert.match(sessionsRoute, /deleted_at/);
  assert.match(sessionsRoute, /movedToTrash/);
  assert.match(sessionsRoute, /permanentlyDeleted/);
  assert.match(sessionsRoute, /ORDER BY sequence ASC/);
  assert.match(sessionsRoute, /searchParams\.get\("all"\) === "1"/);
  assert.match(snapshotsRoute, /SHA-256/);
  assert.match(snapshotsRoute, /contentHash/);
  assert.match(snapshotsRoute, /storageMode/);
  assert.match(snapshotsRoute, /randomWindow/);
  assert.match(snapshotsRoute, /replayWindow/);
  assert.match(snapshotsRoute, /DEFAULT_REPLAY_FUTURE_BARS = 5_000/);
  assert.match(snapshotsRoute, /MAX_REPLAY_FUTURE_BARS = 10_000/);
  assert.match(snapshotsRoute, /selectDatabaseReplayWindow/);
  assert.match(snapshotsRoute, /ORDER BY timestamp ASC LIMIT \? OFFSET \?/);
  assert.match(snapshotsRoute, /patternPresets/);
  assert.match(snapshotsRoute, /requiredPatternHistory/);
  assert.match(snapshotsRoute, /matchesPattern/);
  assert.match(snapshotsRoute, /PATTERN_SCAN_BLOCK_BARS = 2_048/);
  assert.match(snapshotsRoute, /PATTERN_SCAN_MAX_BLOCKS = 8/);
  assert.match(snapshotsRoute, /patternAttempts/);
  assert.match(workbench, /createRandomWindowSnapshot/);
  assert.match(workbench, /replayWindow: newTaskRequest/);
  assert.match(workbench, /data\.selection\.startCursor \+ 1/);
  assert.match(workbench, /selectedPresets/);
  assert.match(workbench, /windowSnapshot\?\.patternMatch/);
  assert.match(workbench, /"snapshotId" in request/);
  assert.match(workbench, /selectedPatternIds\.length && taskSetupKind === "random"[\s\S]*?requestSnapshotId = request\.snapshotId/);
  assert.doesNotMatch(workbench, /\bformatNumber\(/);
  assert.match(workbench, /setOrderType\("market"\)[\s\S]*?setOrderTriggerPrice\(""\)[\s\S]*?setOrderStopLoss\(""\)[\s\S]*?setOrderTakeProfit\(""\)/);
  assert.match(snapshotsRoute, /baseSnapshotId/);
  assert.match(marketRules, /CN_A_MAINBOARD_RULES_V1/);
  assert.match(marketJobsRoute, /createMarketSyncRun/);
  assert.match(marketJobsRoute, /marketSyncService/);
  assert.match(downloadRunner, /chunk\.source === "alpaca-sip"/);
  assert.doesNotMatch(downloadRunner, /DELETE FROM data_snapshots/);
  assert.match(dataJobsRoute, /WITH ranked_jobs AS/);
  assert.match(dataJobsRoute, /instrument_status AS/);
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
    access(new URL("drizzle/0005_normal_supernaut.sql", root)),
    access(new URL("drizzle/0006_numerous_jack_power.sql", root)),
    access(new URL("drizzle/0007_left_phalanx.sql", root)),
    access(new URL("drizzle/0008_adorable_smiling_tiger.sql", root)),
  ]);
});
