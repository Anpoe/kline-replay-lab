import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("falls back when randomUUID is unavailable on an insecure LAN origin", async () => {
  const workbench = await readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8");

  assert.match(workbench, /typeof webCrypto\?\.randomUUID === "function"/);
  assert.match(workbench, /typeof webCrypto\?\.getRandomValues === "function"/);
  assert.match(workbench, /bytes\[6\].*0x40/);
  assert.doesNotMatch(workbench, /\bcrypto\.randomUUID\(/);
});

test("exposes the web UI on IPv4 and IPv6 while keeping remote access explicit", async () => {
  const [viteConfig, packageJson, launcher] = await Promise.all([
    readFile(new URL("vite.config.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("../启动本地网页版.bat", root), "utf8"),
  ]);

  assert.match(viteConfig, /host:\s*"::"/);
  assert.match(viteConfig, /allowedHosts:\s*\["kline42\.dynv6\.net"\]/);
  assert.match(packageJson, /vinext dev --hostname ::/);
  assert.match(launcher, /KLINE_MOBILE_URL/);
  assert.match(launcher, /KLINE_REMOTE_HOST=kline42\.dynv6\.net/);
  assert.match(launcher, /Remote \(IPv6\):/);
  assert.match(launcher, /same trusted Wi-Fi/);
  assert.match(launcher, /does not open a public firewall port automatically/);
});

test("supports touch long-press decision backfill without disabling chart dragging", async () => {
  const chart = await readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8");

  assert.match(chart, /MOBILE_REPLAY_RIGHT_OFFSET = 16/);
  assert.match(chart, /chart\.scrollToRealTime\(\);[\s\S]*chart\.setOffsetRightDistance\(MOBILE_REPLAY_RIGHT_OFFSET\)/);
  assert.match(chart, /matchMedia\(MOBILE_CHART_QUERY\)/);
  assert.match(chart, /event\.pointerType !== "touch"/);
  assert.match(chart, /Math\.hypot/);
  assert.match(chart, /window\.setTimeout/);
  assert.match(chart, /onPointerCancel=\{cancelLongPress\}/);
  assert.match(chart, /右键或长按已揭示的 K 线/);
});

test("locks mobile gestures while drawing and preserves refresh-scoped chart zoom", async () => {
  const [chart, styles] = await Promise.all([
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(chart, /MOBILE_REPLAY_BAR_SPACE = 8/);
  assert.match(chart, /DESKTOP_REPLAY_BAR_SPACE = 16/);
  assert.match(chart, /mobile \? MOBILE_REPLAY_BAR_SPACE : DESKTOP_REPLAY_BAR_SPACE/);
  assert.match(chart, /refreshZoomAppliedRef/);
  assert.match(chart, /subscribeAction\("onZoom", preserveCurrentZoom\)/);
  assert.match(chart, /const barSpaceBeforeReset = chart\.getBarSpace\(\)\.bar/);
  assert.match(chart, /chart\.resetData\(\);[\s\S]*chart\.setBarSpace\(barSpaceBeforeReset\)/);
  assert.doesNotMatch(chart, /viewportResetKey/);
  assert.match(chart, /chart\?\.setScrollEnabled\(!active\)/);
  assert.match(chart, /chart\?\.setZoomEnabled\(!active\)/);
  assert.match(chart, /touchmove[\s\S]*passive: false, capture: true/);
  assert.match(styles, /\.chart-canvas\.drawing-active[\s\S]*touch-action: none !important/);
});

test("supports TradingView-style drawing groups, object management and drawing history", async () => {
  const [workbench, chart] = await Promise.all([
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
  ]);

  assert.match(workbench, /CUSTOM_REASON_TAGS_KEY/);
  assert.match(workbench, /aria-label="自定义交易理由标签"/);
  assert.match(workbench, /name: "segment", label: "趋势线"/);
  assert.match(workbench, /name: "trainingRectangle", label: "矩形区域"/);
  assert.match(workbench, /name: "trainingPosition", label: "多空仓位"/);
  assert.match(workbench, /id: "channels"/);
  assert.match(workbench, /name: "parallelStraightLine", label: "二线平行通道"/);
  assert.match(workbench, /name: "priceChannelLine", label: "三线价格通道"/);
  assert.match(workbench, /group\.tools\.length === 1/);
  assert.doesNotMatch(workbench, /group\.id === "position"/);
  assert.match(workbench, /name: "trainingTextBox", label: "文字标记"/);
  assert.match(workbench, /aria-label="图表文字"/);
  assert.match(workbench, /aria-label="文字内容"/);
  assert.match(workbench, /aria-label="文字大小"/);
  assert.match(workbench, /aria-label="切换磁吸 OHLC"/);
  assert.match(workbench, /aria-label="绘图对象列表"/);
  assert.match(workbench, /aria-label="线条粗细"/);
  assert.match(workbench, /lock: !selectedDrawing\.lock/);
  assert.match(workbench, /aria-label="撤销绘图"/);
  assert.match(workbench, /aria-label="重做绘图"/);
  assert.match(workbench, /setDrawingsRestoreNonce\(\(nonce\) => nonce \+ 1\)/);
  assert.match(chart, /name: "trainingRectangle"/);
  assert.match(chart, /registerPositionOverlay\("trainingPosition", "auto"\)/);
  assert.match(chart, /registerPositionOverlay\("trainingLongPosition", "long"\)/);
  assert.match(chart, /name: "trainingTextNote"/);
  assert.match(chart, /name: "trainingTextBox"/);
  assert.match(chart, /resolvedDirection === "long"[\s\S]*entryValue \+ targetDistance/);
  assert.match(chart, /mode: drawingRequest\.mode \?\? "normal"/);
});

test("discards stale market loads when a newer random round starts", async () => {
  const workbench = await readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8");

  assert.match(workbench, /marketLoadRef\.current\.controller\?\.abort\(\)/);
  assert.match(workbench, /marketLoadRef\.current\.id !== requestId/);
  assert.match(workbench, /requestInstrumentId = restoreRequest\?\.instrumentId \?\? newTaskRequest\?\.instrumentId/);
  assert.match(workbench, /instrumentId: requestInstrumentId, timeframe: requestTimeframe/);
});

test("starts a fresh random round and only samples available instrument-timeframe pairs", async () => {
  const [workbench, candlesRoute] = await Promise.all([
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/api/candles/route.ts", root), "utf8"),
  ]);

  assert.doesNotMatch(workbench, /const findLastTraining/);
  assert.match(workbench, /startupRandomStartedRef/);
  assert.match(workbench, /createPairs\(instrumentCandidates, requestedTimeframes\)/);
  assert.match(workbench, /isRandomInstrumentAllowed\(item, config\.includeIndices\)/);
  assert.match(workbench, /randomIncludeIndices: false/);
  assert.match(workbench, /randomUsLiquidityFilter: true/);
  assert.match(workbench, /randomUsMinAverageDailyDollarVolume: 1000000/);
  assert.match(workbench, /过滤低流动性美股/);
  assert.match(workbench, /completedTask\.randomConfig \?\? currentRandomConfig\(\)/);
  assert.match(workbench, /patternPresetId: "all"/);
  assert.match(workbench, /形态筛选/);
  assert.match(workbench, /纳入指数（只看盘）/);
  assert.match(workbench, /指数仅供看盘训练，不能直接模拟买卖/);
  assert.match(workbench, /currentAssetType === "index" \? "指数不可交易"/);
  assert.match(workbench, /item\.timeframes[\s\S]*candidateTimeframe/);
  assert.match(workbench, /chartLoadError[\s\S]*这组行情无法开始训练/);
  assert.match(candlesRoute, /GROUP_CONCAT\(DISTINCT c\.timeframe\)/);
  assert.match(candlesRoute, /timeframes: \["1d", "1w"\]/);
});

test("uses mobile cards for wide training and data tables", async () => {
  const [styles, workbench] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /\.orders-table td::before/);
  assert.match(styles, /\.performance-session-header \{ display: none; \}/);
  assert.match(styles, /\.coverage-table tbody tr \{ display: grid/);
  assert.match(styles, /\.download-job-header \{ display: none; \}/);
  assert.match(styles, /\.trade-dock \{[\s\S]*position: fixed;[\s\S]*bottom: 64px;/);
  assert.match(styles, /\.topbar \{[\s\S]*height: 46px;[\s\S]*flex-wrap: nowrap;/);
  assert.match(styles, /\.chart-area \{[\s\S]*height: clamp\(380px, 52svh, 500px\)/);
  assert.match(styles, /\.orders-board\.mobile-expanded \.orders-table-wrap \{ display: block; \}/);
  assert.match(workbench, /className="mobile-order-label"/);
  assert.match(workbench, /aria-label=\{startingTraining \? "正在筛选随机训练" : "立即开始随机训练"\}/);
  assert.match(workbench, /onClick=\{\(\) => void startQuickRandomTraining\(\)\}/);
  assert.match(workbench, /className="mobile-toolbar-toggle"/);
  assert.match(workbench, /id="mobile-training-toolbar"/);
  assert.match(workbench, /QUICK_RANDOM_PATTERN_KEY/);
  assert.match(workbench, /aria-label="一键随机训练形态"/);
  assert.match(workbench, /没有找到“\$\{patternPresets\.find/);
  assert.match(workbench, /aria-label="下单数量"/);
  assert.match(workbench, /data-label="覆盖范围"/);
  assert.match(workbench, /长按 K 线补写决策/);
});
