"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleStop, Pencil, Settings2, TriangleAlert } from "lucide-react";
import { OrderEntryControls, OrderEntryActions, OrderPricePicker, OrderPriceInput } from "../../../components/OrderEntryControls";
import { Mt4BatchOrders } from './Mt4BatchOrders';
import { readMt4OrderSettings, saveMt4OrderSettings, serializeMt4OrderSettings, resizeMt4BatchRows, type Mt4BatchRow, type Mt4OrderSettings } from '../mt4OrderSettings';
import { useKeyboardShortcuts } from "../../../components/useKeyboardShortcuts";
import type { ShortcutAction, ShortcutSettings } from "../../../lib/keyboardShortcuts";
import { Mt4PersistentAnalysis } from "./Mt4PersistentAnalysis";
import { Mt4Toast } from "./Mt4Toast";
import { Mt4ArchiveHistory } from "./Mt4ArchiveHistory";
import type { ArchiveAccount, ArchiveTrade, HistoryFilterSelection, HistoryRecords, HistoryChartSelection, DecisionPlanSource } from '../mt4ArchiveContracts';
import { Mt4SymbolPicker } from "./Mt4SymbolPicker";
import { ChartTimeframePicker } from "../../../components/ChartTimeframePicker";
import { ChartIndicatorMenu } from "../../../components/ChartIndicatorMenu";
import { defaultMovingAverageSettings, defaultMacdSettings, normalizeMovingAverageSettings, normalizeMacdSettings, type MovingAverageSettings, type MacdSettings } from "../../../lib/chartIndicators";
import { latestEntryDecisionRecord, decisionProtectionMatches, decisionForEntry } from "../../../lib/decisionWorkflow";
import { decisionPlanScore } from "../../../lib/decisionPlan";
import { deriveSopInstrumentContext } from "../../../lib/performanceSop";
import { evaluateDisciplineGate, type DisciplineGateInput } from "../../sop/sopController";
import { decisionValue, decisionRecord, mt4Draft, type Mt4Analysis, type Mt4EntryReceipt } from "../mt4Analysis";
import { analysisKey } from "../mt4Analysis";
import { downloadMt4Config, Mt4RequestError, requestMt4, requestMt4Archive } from "../mt4Gateway";
import { synchronizeMt4Clock, type Mt4ClockState } from "../../../lib/mt4Clock.mjs";
import { deriveMt4OrderProtectionLines, prepareMt4Protection, prepareMt4ProtectionDrag, type Mt4OrderProtectionLine, type Mt4ProtectionEdit, type Mt4ProtectionField } from "../mt4Protection.mjs";
import { useMt4ChartWindow } from "../useMt4ChartWindow";
import { useMt4CandleHistory } from "../useMt4CandleHistory";
import { useMt4WindowSound } from "../useMt4WindowSound";
import { mt4FloatingOrderKey, type Mt4ChartMotionSettings } from "../../../lib/mt4ChartWindow.mjs";
import type { Mt4CommandInput, Mt4Order, Mt4Status } from "../mt4Contracts";
import type { PriceSelectionMode } from "../../../components/KLineReplayChart";
import { buildMt4HistoryMarkers } from "../../../lib/mt4History.mjs";
import { riskSizedMt4Lots, checkMt4OpeningGap } from "../../../lib/mt4OrderRules.mjs";
import { captureCloseAllPlan, runCloseAll, type CloseAllPlan, type CloseAllProgress, type CloseAllResult } from "../mt4CloseAll";
import { captureOpenBatchPlan, runOpenBatch, type OpenBatchPlan, type OpenBatchProgress, type OpenBatchResult } from "../mt4OpenBatch";
import { mt4LotPreferenceKey, readMt4Lots, saveMt4Lots, validMt4Lots } from "../mt4LotPreferences";

const timeframeMinutes: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080, "1mo": 43200 };
const chartPeriods: Record<number, string> = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d", 10080: "1w", 43200: "1mo" };
const orderTypes = ["买入", "卖出", "买入限价", "卖出限价", "买入突破", "卖出突破"];
const commandTypes = { open: "开仓", close: "平仓", cancel: "撤单", protect: "修改保护价" };
const connectionLabels = { unpaired: "未配置", waiting: "等待 MT4", connected: "已连接", offline: "已断开" };
function formatTime(value: number) { return value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "—"; }
const lotStorage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) };
function loadIndicators() {
  try {
    const stored = typeof window === "undefined" ? {} : JSON.parse(localStorage.getItem("kline.mt4.indicators.v1") ?? "{}");
    return { ma: normalizeMovingAverageSettings(stored.movingAverageSettings), macd: normalizeMacdSettings(stored.macdSettings), error: "" };
  } catch { return { ma: defaultMovingAverageSettings, macd: defaultMacdSettings, error: "指标设置未能读取，修改指标后可重新保存。" }; }
}

export function Mt4Panel({ chartMotion, disciplineSettings, sharedReasonTags, onReasonTagsChange, keyboardShortcuts, shortcutsEnabled = true }: { chartMotion: Mt4ChartMotionSettings; disciplineSettings: Pick<DisciplineGateInput, "strictModeEnabled" | "requirePretradePlan" | "requiredPretradeFields" | "sopCheckEnabled" | "personalSopCheckEnabled" | "activePersonalSopRule">; sharedReasonTags: string[]; onReasonTagsChange: (tags: string[]) => void; keyboardShortcuts?: ShortcutSettings; shortcutsEnabled?: boolean }) {
  const [state, setState] = useState<Mt4Status | null>(null);
  const [candleClockState, setCandleClockState] = useState<Mt4ClockState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  const noticeSequence = useRef(0);
  const notify = useCallback((message: string) => setNotice(message ? { id: ++noticeSequence.current, message } : null), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(true);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [initialIndicators] = useState(loadIndicators);
  const [movingAverageSettings, setMovingAverageSettings] = useState(initialIndicators.ma);
  const [macdSettings, setMacdSettings] = useState(initialIndicators.macd);
  const [indicatorError, setIndicatorError] = useState(initialIndicators.error);
  const saveIndicators = (ma: MovingAverageSettings, macd: MacdSettings) => {
    setMovingAverageSettings(ma); setMacdSettings(macd);
    try { localStorage.setItem("kline.mt4.indicators.v1", JSON.stringify({ movingAverageSettings: ma, macdSettings: macd })); setIndicatorError(""); }
    catch { setIndicatorError("指标设置未保存，请释放浏览器存储空间后重试；当前显示仍可使用。"); }
  };
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [acceptReal, setAcceptReal] = useState(false);
  const [orderCount, setOrderCount] = useState("1");
  const [batchRows, setBatchRows] = useState<Mt4BatchRow[]>([]);
  const [batchPriceSelection, setBatchPriceSelection] = useState<{ index: number; kind: PriceSelectionMode; scope: string } | null>(null);
  const [orderSettingsError, setOrderSettingsError] = useState('');
  const [orderSaveRetry, setOrderSaveRetry] = useState(0);
  const lastOrderSettings = useRef('');
  const [lots, setLots] = useState("0.01");
  const [lotsError, setLotsError] = useState("");
  const lotsScope = useRef("");
  const [sizingMode, setSizingMode] = useState<"fixed" | "risk-percent">("fixed");
  const [riskPercent, setRiskPercent] = useState("1");
  const [gapMode, setGapMode] = useState<"off" | "high" | "low">("off");
  const [gapUnit, setGapUnit] = useState<"percent" | "price">("percent");
  const [gapThreshold, setGapThreshold] = useState("3");
  const [orderPriceSelection, setOrderPriceSelection] = useState<PriceSelectionMode | null>(null);
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
  const [price, setPrice] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [slippage, setSlippage] = useState("20");
  const [protection, setProtection] = useState<Mt4ProtectionEdit | null>(null);
  const [protectionError, setProtectionError] = useState("");
  const protectionEditor = useRef<HTMLElement>(null);
  const protectionOpener = useRef<HTMLButtonElement | null>(null);
  const protectionIdentity = protection ? JSON.stringify([protection.accountKey, protection.order.ticket, protection.order.symbol, protection.field]) : "";
  useEffect(() => {
    if (protectionIdentity) {
      if (orderPriceSelection) return;
      const frame = requestAnimationFrame(() => protectionEditor.current?.querySelector<HTMLButtonElement>(".protection-picker-control > button")?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
    if (protectionOpener.current?.isConnected) protectionOpener.current.focus({ preventScroll: true });
  }, [protectionIdentity, orderPriceSelection]);
  const [protectSl, setProtectSl] = useState("");
  const [protectTp, setProtectTp] = useState("");
  const [pending, setPending] = useState<Mt4CommandInput | null>(null);
  const [review, setReview] = useState<{ trade: ArchiveTrade; account: ArchiveAccount; focus: number; returnFocus?: number; evidence?: ArchiveTrade['events'][number] } | null>(null);
  const [decisionSource, setDecisionSource] = useState<(DecisionPlanSource & { accountKey: string; symbol: string }) | null>(null);
  const [archiveRefresh, setArchiveRefresh] = useState(0);
  const [historyChart, setHistoryChart] = useState<(HistoryFilterSelection & { symbol: string; timeframe: number }) | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyRecords, setHistoryRecords] = useState<HistoryRecords | null>(null);
  const [chartSelection, setChartSelection] = useState<HistoryChartSelection | null>(null);
  const historical = !!review || !!historyChart;
  const [chartFetch, setChartFetch] = useState(false);
  const reviewLoadSequence = useRef(0);
  const [closeAllProgress, setCloseAllProgress] = useState<CloseAllProgress | null>(null);
  const [closeAllResult, setCloseAllResult] = useState<CloseAllResult | null>(null);
  const [closeAllLogin, setCloseAllLogin] = useState("");
  const [closeAllRunning, setCloseAllRunning] = useState(false);
  const [closeAllStopping, setCloseAllStopping] = useState(false);
  const closeAllController = useRef<AbortController | null>(null);
  const closeAllStop = useRef(false);
  const [openBatchProgress, setOpenBatchProgress] = useState<OpenBatchProgress | null>(null);
  const [openBatchResult, setOpenBatchResult] = useState<OpenBatchResult | null>(null);
  const [openBatchRunning, setOpenBatchRunning] = useState(false);
  const [openBatchStopping, setOpenBatchStopping] = useState(false);
  const openBatchController = useRef<AbortController | null>(null);
  const openBatchStop = useRef(false);
  const disciplineRef = useRef(disciplineSettings);
  useEffect(() => { disciplineRef.current = disciplineSettings; }, [disciplineSettings]);
  const latestState = useRef<Mt4Status | null>(null);
  const lock = useRef(false);
  const activeAnalysis = useRef<{ key: string; value: Mt4Analysis } | null>(null);
  const [analysisReadyKey, setAnalysisReadyKey] = useState('');
  const onAnalysisChange = useCallback((key: string, value: Mt4Analysis | null) => {
    activeAnalysis.current = value ? { key, value } : null;
    setAnalysisReadyKey(value ? key : '');
  }, []);
  type EntryIntent = Omit<Mt4EntryReceipt, 'ticket' | 'openTime'>;
  const entryIntents = useRef(new Map<string, EntryIntent>());
  const [executedEntries, setExecutedEntries] = useState<Array<EntryIntent & { ticket: number }>>([]);
  const trackedCommands = useRef(new Set<string>());
  const accountKeyRef = useRef("");
  const pendingRef = useRef<Mt4CommandInput | null>(null);
  const pollRef = useRef<AbortController | null>(null);

  const onHistoryFilters = useCallback((selection: HistoryFilterSelection) => {
    if (!selection.navigate) return;
    setDecisionSource(null);
    const symbol = selection.filter.symbol || (selection.account.symbols.includes(latestState.current?.selection.symbol ?? '') ? latestState.current!.selection.symbol : selection.account.symbols[0]);
    reviewLoadSequence.current++; setReview(null); setHistoryError(''); setOrderPriceSelection(null); setProtection(null);
    setHistoryChart({ ...selection, symbol, timeframe: latestState.current?.selection.timeframe ?? 15 });
  }, []);
  const onHistoryRecords = useCallback((records: HistoryRecords) => setHistoryRecords(records), []);
  const onHistorySelect = useCallback((trade: ArchiveTrade, archivedAccount: ArchiveAccount, focus?: number, evidence?: ArchiveTrade['events'][number]) => {
    setDecisionSource(null);
    reviewLoadSequence.current++; setReview(previous => ({ trade, account: archivedAccount, focus: focus ?? trade.order.openTime * 1000, evidence, returnFocus: evidence ? previous?.focus : undefined }));
    setOrderPriceSelection(null); setProtection(null);
  }, []);

  useEffect(() => () => { closeAllController.current?.abort(); openBatchController.current?.abort(); }, []);

  const apply = useCallback((next: Mt4Status) => {
    const lotSymbol = next.snapshot?.symbols.find(item => item.symbol === next.selection.symbol);
    const nextLotsScope = mt4LotPreferenceKey(next.accountKey, lotSymbol);
    if (nextLotsScope !== lotsScope.current) {
      const remembered = readMt4Lots(lotStorage, next.accountKey, lotSymbol);
      lotsScope.current = nextLotsScope;
      setLots(remembered.value); setLotsError(remembered.error);
      const restored = readMt4OrderSettings(lotStorage, next.accountKey, lotSymbol?.symbol ?? '');
      const settings = restored.value;
      lastOrderSettings.current = serializeMt4OrderSettings(settings);
      setOrderCount(settings.count); setBatchRows(settings.rows); setSizingMode(settings.sizingMode); setRiskPercent(settings.riskPercent);
      setOrderType(settings.orderType); setPrice(settings.price); setSl(settings.sl); setTp(settings.tp); setSlippage(settings.slippage);
      setGapMode(settings.gapMode); setGapUnit(settings.gapUnit); setGapThreshold(settings.gapThreshold); setOrderSettingsError(restored.error);
      setBatchPriceSelection(null); setOrderPriceSelection(null);
    }
    const now = Date.now(), monotonicNow = performance.now();
    setCandleClockState(previous => synchronizeMt4Clock(previous, {
      scope: JSON.stringify([next.accountKey, next.snapshot?.sessionId]),
      serverTime: next.snapshot?.serverUtcOffset == null ? undefined : next.snapshot.capturedAt + next.snapshot.serverUtcOffset,
      receivedAt: next.lastSeen ?? 0, connected: next.connection === "connected" && Boolean(next.snapshot?.account.connected), now, monotonicNow,
    }));
    if (next.accountKey !== accountKeyRef.current) {
      accountKeyRef.current = next.accountKey; setAccountConfirmation(""); setAcceptReal(false); setProtection(null); setOrderPriceSelection(null);
    }
    if (pendingRef.current && next.commands.some(c => c.id === pendingRef.current?.id)) { pendingRef.current = null; setPending(null); }
    for (const command of next.commands) {
      if (!trackedCommands.current.has(command.id)) continue;
      if (command.status === "succeeded") {
        const intent = entryIntents.current.get(command.id);
        if (intent && command.type === "open" && command.ticket > 0) { setExecutedEntries(items => [...items.filter(item => item.commandId !== intent.commandId), { ...intent, ticket: command.ticket }]); entryIntents.current.delete(command.id); }
        notify(`${commandTypes[command.type]}已执行 · ${command.symbol}${command.ticket ? ` · #${command.ticket}` : ""}`);
        if (command.type === "protect") setProtection(current => current?.commandId === command.id ? null : current);
      }
      else if (command.status === "failed") { entryIntents.current.delete(command.id); setError(command.error || `${commandTypes[command.type]}未执行，请核对 MT4 后重试`); }
      if (["succeeded", "failed", "cancelled", "resolved"].includes(command.status)) trackedCommands.current.delete(command.id);
    }
    latestState.current = next; setState(next);
  }, [notify]);
  const refresh = useCallback(async () => {
    if (lock.current) return;
    pollRef.current?.abort();
    const controller = new AbortController(); pollRef.current = controller;
    try {
      const next = await requestMt4(undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]));
      if (!controller.signal.aborted) { apply(next); setReadError(""); }
    } catch (e) { if (!controller.signal.aborted) setReadError(e instanceof Error ? e.message : "连接读取失败，请重试"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [apply]);
  useEffect(() => {
    if (!state?.accountKey || !state.selection.symbol || lotsScope.current !== mt4LotPreferenceKey(state.accountKey, { symbol: state.selection.symbol, minLot: 0, maxLot: 0, lotStep: 0 })) return;
    const value: Mt4OrderSettings = { version: 1, count: orderCount, rows: batchRows, sizingMode, riskPercent, orderType, price, sl, tp, slippage, gapMode, gapUnit, gapThreshold };
    const serialized = serializeMt4OrderSettings(value);
    if (serialized === lastOrderSettings.current) return;
    const result = saveMt4OrderSettings(lotStorage, state.accountKey, state.selection.symbol, value);
    if (result.saved) lastOrderSettings.current = serialized;
    setOrderSettingsError(result.error);
  }, [state?.accountKey, state?.selection.symbol, orderCount, batchRows, sizingMode, riskPercent, orderType, price, sl, tp, slippage, gapMode, gapUnit, gapThreshold, orderSaveRetry]);
  const awaitingCommand = Boolean(pending || state?.unresolved);
  useEffect(() => {
    let disposed = false; let generation = 0; let timer: ReturnType<typeof setTimeout>;
    const poll = async (current = generation) => { await refresh(); if (!disposed && current === generation) timer = setTimeout(() => void poll(current), document.visibilityState === "hidden" ? 3000 : awaitingCommand || latestState.current?.connection === "connected" ? 200 : 1500); };
    const visibility = () => { generation++; clearTimeout(timer); pollRef.current?.abort(); void poll(); };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { disposed = true; document.removeEventListener("visibilitychange", visibility); clearTimeout(timer); pollRef.current?.abort(); };
  }, [refresh, awaitingCommand]);

  const act = async (payload: Record<string, unknown>, success = "") => {
    if (lock.current) return;
    lock.current = true; setBusy(true); pollRef.current?.abort(); setError(""); notify("");
    try { const next = await requestMt4(payload, AbortSignal.timeout(7000)); apply(next); notify(success); setLoading(false); }
    catch (e) { setError(e instanceof Error ? e.message : "操作未完成，请重试读取 MT4"); }
    finally { lock.current = false; setBusy(false); }
  };
  const submit = async (command: Mt4CommandInput) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); pollRef.current?.abort(); setError(""); notify("");
    trackedCommands.current.add(command.id);
    pendingRef.current = command; setPending(command);
    try {
      const next = await requestMt4({ action: "command", command }, AbortSignal.timeout(7000)); apply(next);
      const receipt = next.commands.find(c => c.id === command.id);
      if (!receipt || receipt.status === "queued" || receipt.status === "sent") notify("指令已提交，等待 MT4 确认");
    } catch (e) {
      if (e instanceof Mt4RequestError && e.definite) { trackedCommands.current.delete(command.id); pendingRef.current = null; setPending(null); }
      setError(e instanceof Error ? e.message : "提交结果尚未确认，请核对提交结果");
    } finally { lock.current = false; setBusy(false); }
  };
  const snapshot = state?.snapshot;
  const account = snapshot?.account;
  const symbol = snapshot?.symbols.find(s => s.symbol === state?.selection.symbol);
  const connected = state?.connection === "connected" && !loading && !readError;
  const quoteFresh = symbol && symbol.bid > 0 && symbol.ask > 0 && symbol.quoteTime > 0 && snapshot && snapshot.capturedAt - symbol.quoteTime <= 30;
  const protectionBlocked = !connected || !account?.connected || !account?.tradeAllowed || !state?.enabled || !!state?.unresolved || busy || !!pending;
  const canTrade = Boolean(!historical && connected && state?.enabled && account?.tradeAllowed && quoteFresh && !state?.unresolved && !busy && !pending && analysisReadyKey === analysisKey(state.accountKey, state.selection.symbol, state.selection.timeframe));
  const entryDisabled = !canTrade || !symbol?.tradeAllowed || (Number(orderCount) <= 1 && (Number(lots) <= 0 || (orderType !== "market" && Number(price) <= 0)));
  const chartReady = snapshot && snapshot.chart.symbol === state?.selection.symbol && snapshot.chart.timeframe === state?.selection.timeframe;
  const chartBars = chartReady ? snapshot.chart.bars : [];
  const latestBar = chartBars.at(-1);
  const displaySymbol = review?.trade.symbol ?? historyChart?.symbol ?? state?.selection.symbol ?? '';
  const displayTimeframe = review?.trade.timeframe ?? historyChart?.timeframe ?? state?.selection.timeframe ?? 5;
  const sourceBars = review?.evidence?.evidence.chart?.bars ?? review?.trade.bars ?? (historyChart ? [] : chartBars);
  const displayAccount = review?.trade.accountKey ?? historyChart?.account.accountKey ?? state?.accountKey ?? '';
  // Candle time follows terminal heartbeats; stale quotes and read errors still block trading.
  const chartClock = { anchor: candleClockState?.anchor, serverTime: snapshot?.serverUtcOffset == null ? undefined : snapshot.capturedAt + snapshot.serverUtcOffset, receivedAt: state?.lastSeen ?? 0, connected: Boolean(!historical && state?.connection === "connected" && !loading && account?.connected), timeframe: displayTimeframe };
  const chartView = useMt4ChartWindow(sourceBars, JSON.stringify([displayAccount, displaySymbol, displayTimeframe, historical ? 'history' : snapshot?.sessionId ?? '']), historical ? { ...chartMotion, enabled: false } : chartMotion, chartClock, { profit: account?.profit ?? 0, orders: snapshot?.orders ?? [] });
  const markerOrders = historyRecords?.accountKey === displayAccount && historyRecords.chartSymbol === displaySymbol && historyRecords.showOnChart ? historyRecords.orders : [];
  const chartFocus = review?.focus ?? (historyChart ? markerOrders.length ? (markerOrders[0].closeTime || markerOrders[0].openTime) * 1000 : historyChart.filter.from ? Date.parse(historyChart.filter.from + 'T00:00:00Z') : historyChart.filter.to ? Date.parse(historyChart.filter.to + 'T23:59:59Z') : 0 : 0);
  const candleHistory = useMt4CandleHistory({ accountKey: displayAccount, symbol: displaySymbol, timeframe: displayTimeframe, live: !historical }, chartView.bars, chartFocus, !!review?.evidence);
  const displayBars = candleHistory.bars;
  const displayDigits = review?.trade.digits ?? candleHistory.digits ?? symbol?.digits ?? 5;
  useMt4WindowSound({ scope: JSON.stringify([displayAccount, displaySymbol, displayTimeframe, historical ? 'history' : snapshot?.sessionId ?? '']), window: chartView.window, settings: historical ? { ...chartMotion, enabled: false } : chartMotion }, notify);
  const displayedAccount = account ? { ...account, profit: chartView.floating.profit, equity: account.equity - account.profit + chartView.floating.profit, freeMargin: account.freeMargin - account.profit + chartView.floating.profit } : undefined;
  const displayedBar = displayBars.at(-1);
  const selectedBatchRow = batchPriceSelection && batchPriceSelection.scope === mt4LotPreferenceKey(state?.accountKey ?? '', symbol) ? batchRows[batchPriceSelection.index] : undefined;
  const selectedOrderPrices = selectedBatchRow ? { stopLoss: Number(selectedBatchRow.sl), takeProfit: Number(selectedBatchRow.tp), entry: orderType === 'market' ? 0 : Number(selectedBatchRow.price) } : { stopLoss: Number(sl), takeProfit: Number(tp), entry: orderType === 'market' ? 0 : Number(price) };
  const unresolvedCommands = state?.commands.filter(c => c.status === "unknown") ?? [];
  const tradeMarkers = buildMt4HistoryMarkers(markerOrders, displayBars, displayTimeframe, displayAccount);
  const onTradeSelect = (id: string, event: 'entry' | 'exit') => {
    const marker = tradeMarkers.find(marker => marker.id === id);
    const order = marker && markerOrders.find(order => order.ticket === marker.ticket && order.symbol === marker.symbol);
    if (order) setChartSelection({ accountKey: displayAccount, order: { ...order, timeframe: displayTimeframe }, focus: (event === 'exit' ? order.closeTime : order.openTime) * 1000, nonce: Date.now() });
  };
  const relatedOrders = [...new Map([...(displayAccount === state?.accountKey ? snapshot?.orders ?? [] : []), ...(displayAccount === state?.accountKey ? snapshot?.history ?? [] : []), ...markerOrders, ...(review ? [review.trade.order] : [])].filter(order => order.symbol === displaySymbol).map(order => [order.ticket, order])).values()];
  const receiptIntent = executedEntries.findLast(intent => intent.accountKey === displayAccount && intent.symbol === displaySymbol && intent.timeframe === displayTimeframe && relatedOrders.some(order => order.ticket === intent.ticket));
  const receiptOrder = receiptIntent && relatedOrders.find(order => order.ticket === receiptIntent.ticket);
  const entryReceipt = receiptIntent && receiptOrder ? { ...receiptIntent, openTime: receiptOrder.openTime } : undefined;
  const source = decisionSource?.accountKey === displayAccount && decisionSource.symbol === displaySymbol && !review?.evidence ? decisionSource : null;
  const displayScope = source?.scope ?? (review ? `trade:${review.trade.order.ticket}` : 'chart');
  const analysisTimeframe = source?.timeframe ?? displayTimeframe;
  const showChartMarkers = historyRecords?.accountKey === displayAccount ? historyRecords.showOnChart : true;
  const displayKey = `${analysisKey(displayAccount, displaySymbol, analysisTimeframe)}:${displayScope}:${review?.evidence?.id ?? 0}`;
  const protectionCommand = pending?.type === 'protect' ? pending : state?.commands.find(command => command.id === protection?.commandId);
  const liveOrderLines = historical || source ? [] : deriveMt4OrderProtectionLines({ state, symbol: displaySymbol, timestamp: displayedBar?.timestamp ?? 0, digits: displayDigits, movable: !protectionBlocked, pending: protectionCommand });
  const reviewSeed = review?.evidence?.evidence.analysis?.data ?? review?.trade.events.find(event => event.source === 'observed' && event.evidence.chart?.timeframe === displayTimeframe && event.evidence.analysis?.data)?.evidence.analysis?.data ?? undefined;
  const readReview = async (timeframe = displayTimeframe) => {
    if (!review) return;
    const sequence = ++reviewLoadSequence.current;
    const next = await requestMt4Archive<ArchiveTrade>({ action: 'trade', accountKey: review.trade.accountKey, symbol: review.trade.symbol, ticket: review.trade.order.ticket, timeframe, focus: review.focus }, undefined, AbortSignal.timeout(15000));
    if (sequence !== reviewLoadSequence.current) return;
    setReview(previous => previous && previous.focus === review.focus && previous.trade.accountKey === next.accountKey && previous.trade.symbol === next.symbol && previous.trade.order.ticket === next.order.ticket ? { ...previous, trade: next } : previous);
  };
  const fetchReviewChart = async () => {
    if (!review || chartFetch) return;
    setChartFetch(true); setError('');
    try {
      await requestMt4Archive({}, { action: 'chart', accountKey: review.trade.accountKey, symbol: review.trade.symbol, ticket: review.trade.order.ticket, timeframe: displayTimeframe, anchor: review.focus / 1000 });
      notify('正在补取交易附近行情');
    } catch(e) { setError(e instanceof Error ? e.message : '历史行情未能补取，请重试'); }
    finally { setChartFetch(false); }
  };
  useEffect(() => {
    if (!review) return;
    let disposed = false;
    const timer = setInterval(() => {
      void requestMt4Archive<ArchiveTrade>({ action: 'trade', accountKey: review.trade.accountKey, symbol: review.trade.symbol, ticket: review.trade.order.ticket, timeframe: review.trade.timeframe, focus: review.focus }, undefined, AbortSignal.timeout(10000)).then(next => {
        if (!disposed) setReview(previous => previous && previous.focus === review.focus && previous.trade.accountKey === next.accountKey && previous.trade.symbol === next.symbol && previous.trade.order.ticket === next.order.ticket && previous.trade.timeframe === next.timeframe ? { ...previous, trade: next } : previous);
      }).catch(e => { if (!disposed) setHistoryError(e instanceof Error ? e.message : '交易更新失败，请刷新重试'); });
    }, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [review]);
  const advancedReady = (snapshot?.executionVersion ?? 1) >= 2;
  let previewLots = "";
  if (sizingMode === "risk-percent" && symbol) {
    try { previewLots = String(riskSizedMt4Lots({ balance: account?.balance ?? 0, riskPercent: Number(riskPercent) / (Number(orderCount) || 1), entryPrice: orderType === "market" ? symbol.ask : Number(price), stopLoss: Number(sl), symbol }).lots); } catch { /* The submit action shows the specific incomplete sizing input. */ }
  }
  const onPlanProtectionChange = useCallback((changes: { stopLoss?: string; takeProfit?: string }) => {
    if (historical || source) return;
    if (changes.stopLoss != null) setSl(changes.stopLoss);
    if (changes.takeProfit != null) setTp(changes.takeProfit);
  }, [historical, source]);
  const onOrderPriceSelect = (kind: PriceSelectionMode, value: number) => {
    const formatted = value.toFixed(symbol?.digits ?? 5);
    if (!protection && batchPriceSelection && orderPriceSelection === kind && batchPriceSelection.kind === kind) {
      if (batchPriceSelection.scope !== lotsScope.current || busy) { setOrderPriceSelection(null); setBatchPriceSelection(null); return; }
      const field = kind === 'entry-trigger' ? 'price' : kind === 'stop-loss' ? 'sl' : 'tp';
      setBatchRows(rows => rows.map((row, index) => index === batchPriceSelection.index ? { ...row, [field]: formatted } : row));
    } else if (protection && orderPriceSelection === kind && kind !== "entry-trigger") {
      const current = latestState.current;
      if (protectionBlocked || current?.accountKey !== protection.accountKey || current.selection.symbol !== protection.order.symbol || current.snapshot?.chart.symbol !== protection.order.symbol) {
        setProtectionError("订单或图表已变化，请重新打开订单选价。"); return;
      }
      if (kind === "stop-loss") setProtectSl(formatted); else setProtectTp(formatted);
      setProtectionError("");
      requestAnimationFrame(() => protectionEditor.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    } else if (kind === "entry-trigger") setPrice(formatted); else if (kind === "stop-loss") setSl(formatted); else setTp(formatted);
    setOrderPriceSelection(null);
    setBatchPriceSelection(null);
  };
  const select = (nextSymbol: string, timeframe: number) => {
    setDecisionSource(null);
    setOrderPriceSelection(null); setBatchPriceSelection(null); setProtection(null);
    void act({ action: "select", symbol: nextSymbol, timeframe });
  };
  const toggleOrderPriceSelection = (kind: PriceSelectionMode) => {
    setProtection(null);
    setBatchPriceSelection(null);
    setOrderPriceSelection(current => !protection && current === kind ? null : kind);
  };
  const changeOrderCount = (value: string) => {
    setOrderCount(value);
    setBatchRows(rows => resizeMt4BatchRows(rows, Number(value), { lots, price, sl, tp }));
    setBatchPriceSelection(null); setOrderPriceSelection(null);
  };
  const pickBatchPrice = (index: number, kind: PriceSelectionMode) => {
    setProtection(null);
    const cancel = batchPriceSelection?.index === index && batchPriceSelection.kind === kind && orderPriceSelection === kind;
    setBatchPriceSelection(cancel ? null : { index, kind, scope: lotsScope.current }); setOrderPriceSelection(cancel ? null : kind);
  };
  const rememberLots = (value: string, retry = false) => {
    setLots(value);
    const result = saveMt4Lots(lotStorage, state?.accountKey ?? "", symbol, value);
    setLotsError(result.error || (retry && !result.saved ? "请填写符合当前合约的手数后重试。" : ""));
  };
  const captureEntryIntent = (current: Mt4Status, command: Mt4CommandInput): EntryIntent => {
    const live = current.snapshot, targetSymbol = live?.symbols.find(item => item.symbol === command.symbol);
    if (!live || !targetSymbol || live.chart.symbol !== command.symbol || live.chart.timeframe !== current.selection.timeframe || !live.chart.bars.length) throw Error("当前图表与下单品种尚未同步，请等待读取完成。");
    const chartBars = live.chart.bars, latestBar = chartBars.at(-1)!;
    const entryPrice = command.orderType === "market" ? command.side === "buy" ? targetSymbol.ask : targetSymbol.bid : command.price ?? 0;
    if (command.gapMode && command.gapMode !== "off") {
      if (latestBar.timestamp !== command.gapBarTime) throw Error("K 线已变化，后续下单已停止，请重新检查跳空条件。");
      checkMt4OpeningGap({ previousClose: chartBars.at(-2)?.close ?? 0, openingPrice: latestBar.open, mode: command.gapMode, unit: command.gapUnit ?? "percent", threshold: command.gapThreshold ?? 0 });
    }
    const decisionContextKey = analysisKey(current.accountKey, command.symbol, current.selection.timeframe);
    if (activeAnalysis.current?.key !== decisionContextKey) throw Error("决策记录正在读取，请稍后再下单。");
    const capturedAnalysis = activeAnalysis.current.value;
    const stop = command.stopLoss ? String(command.stopLoss) : "", target = command.takeProfit ? String(command.takeProfit) : "";
    const plannedDecision = { ...decisionForEntry(decisionValue(capturedAnalysis.draft), capturedAnalysis.decisions.map(decisionRecord), latestBar.timestamp), stop, target };
    const market = /^(XAU|XAG|GOLD|SILVER)/i.test(command.symbol) ? "GOLD" : "FX";
    const risk = Number(stop) > 0 ? Math.abs(entryPrice - Number(stop)) : 0, reward = Number(target) > 0 ? Math.abs(Number(target) - entryPrice) : 0;
    const gate = evaluateDisciplineGate({ ...disciplineRef.current, scope: { market, timeframe: chartPeriods[current.selection.timeframe], instrumentId: command.symbol }, decision: { ...plannedDecision, score: decisionPlanScore(plannedDecision) }, patterns: [], instrument: deriveSopInstrumentContext(chartBars, chartBars.length - 1, "UTC", chartPeriods[current.selection.timeframe], { market, entryPrice }), riskReward: risk > 0 && reward > 0 ? reward / risk : undefined });
    if (!gate.allowed) throw Error(gate.checks.filter(check => check.status === "blocked").map(check => check.message).join("；"));
    const currentManual = capturedAnalysis.decisions.find(record => !record.backfilled && !record.autoGenerated && record.candleTimestamp === latestBar.timestamp && decisionProtectionMatches(decisionValue(record.draft), stop, target));
    const latestManual = latestEntryDecisionRecord(capturedAnalysis.decisions.map(decisionRecord), latestBar.timestamp);
    return { commandId: command.id, accountKey: current.accountKey, symbol: command.symbol, timeframe: current.selection.timeframe, candleTimestamp: latestBar.timestamp, referencePrice: latestBar.close ?? entryPrice, draft: mt4Draft(plannedDecision), decisionId: currentManual?.id ?? (!stop && !target ? latestManual?.id : undefined) };
  };
  const executeOpenBatch = async (plan: OpenBatchPlan) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); pollRef.current?.abort();
    const controller = new AbortController(); openBatchController.current = controller; openBatchStop.current = false;
    setOpenBatchRunning(true); setOpenBatchStopping(false); setOpenBatchResult(null); setError(""); notify("");
    try {
      const result = await runOpenBatch(plan, {
        request: requestMt4, signal: controller.signal, shouldStop: () => openBatchStop.current,
        onStatus: apply, onProgress: setOpenBatchProgress,
        beforeEach: (current, command) => { entryIntents.current.set(command.id, captureEntryIntent(current, command)); },
        onPending: command => { pendingRef.current = command; setPending(command); if (command) trackedCommands.current.add(command.id); },
        isDefiniteRejection: e => e instanceof Mt4RequestError && e.definite,
      });
      if (controller.signal.aborted) return;
      pendingRef.current = result.pendingCommand ?? null; setPending(result.pendingCommand ?? null);
      setOpenBatchResult(result); setOpenBatchProgress(result); setError("");
      if (result.outcome === "complete") notify(`批量下单完成 · ${result.completed} 笔`);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "批量下单已停止，请核对 MT4 执行回报。"); }
    finally { lock.current = false; openBatchController.current = null; if (!controller.signal.aborted) { setBusy(false); setOpenBatchRunning(false); setOpenBatchStopping(false); } }
  };
  const openOrder = (side: "buy" | "sell") => {
    if (!state || !symbol || !canTrade || lock.current) return;
    try {
      const count = Number(orderCount);
      if (!Number.isInteger(count) || count < 1 || count > 10) throw Error("订单数应为 1–10 的整数。");
      const perOrderRisk = Number(riskPercent) / count;
      if (sizingMode === "risk-percent" && perOrderRisk < 0.0001) throw Error("整批风险比例过小，请增加风险比例或减少订单数。");
      const gapActive = side === "buy" && gapMode !== "off";
      const rows = count === 1 ? [{ lots, price, sl, tp }] : resizeMt4BatchRows(batchRows, count, { lots, price, sl, tp }).slice(0, count);
      const commands = rows.map((row, index) => {
        try {
          const entryPrice = orderType === 'market' ? side === 'buy' ? symbol.ask : symbol.bid : Number(row.price);
          const plannedLots = sizingMode === 'risk-percent' ? riskSizedMt4Lots({ balance: account?.balance ?? 0, riskPercent: perOrderRisk, entryPrice, stopLoss: Number(row.sl), symbol }).lots : Number(row.lots);
          if (!validMt4Lots(String(plannedLots), symbol)) throw Error('手数不符合当前品种的最小值、最大值或步长，请重新填写。');
          if (!(plannedLots > 0) || ![plannedLots, Number(row.price), Number(row.sl), Number(row.tp)].every(Number.isFinite) || (orderType !== 'market' && !(entryPrice > 0))) throw Error('请填写有效的手数与挂单价格。');
          const command: Mt4CommandInput = { id: crypto.randomUUID(), accountKey: state.accountKey, type: 'open', symbol: symbol.symbol, side, orderType,
        lots: plannedLots, price: orderType === 'market' ? 0 : Number(row.price), stopLoss: Number(row.sl), takeProfit: Number(row.tp), slippage: Number(slippage),
        ...(sizingMode === "risk-percent" ? { sizingMode, riskPercent: perOrderRisk } : {}),
        ...(gapActive ? { gapMode, gapUnit, gapThreshold: Number(gapThreshold), gapTimeframe: state.selection.timeframe, gapBarTime: latestBar?.timestamp ?? 0 } : {}) };
          captureEntryIntent(state, command);
          return command;
        } catch (error) { throw Error(`第 ${index + 1} 笔：${error instanceof Error ? error.message : '下单参数无效'}`); }
      });
      if (count === 1) { const command = commands[0]; setOpenBatchResult(null); setOpenBatchProgress(null); entryIntents.current.set(command.id, captureEntryIntent(state, command)); void submit(command); }
      else void executeOpenBatch(captureOpenBatchPlan(state, commands[0], count, commands));
    } catch (e) { setError(e instanceof Error ? e.message : "下单参数无效，请调整后重试。"); }
  };
  const orderAction = (order: Mt4Order, type: "close" | "cancel") => {
    if (!state) return;
    void submit({ id: crypto.randomUUID(), accountKey: state.accountKey, type, symbol: order.symbol, ticket: order.ticket,
      stopLoss: 0, takeProfit: 0, slippage: Number(slippage) });
  };
  const openProtection = (order: Mt4Order, field: Mt4ProtectionEdit["field"], opener: HTMLButtonElement) => {
    if (!state || protectionBlocked) return;
    protectionOpener.current = opener; setProtectionError(""); setError("");
    const editing = { accountKey: state.accountKey, order: { ...order }, field };
    setOrderPriceSelection(null); setProtection(editing);
    setProtectSl(order.stopLoss ? String(order.stopLoss) : ""); setProtectTp(order.takeProfit ? String(order.takeProfit) : "");
    if (field !== "both") beginProtectionPricePick(editing, field);
  };
  const beginProtectionPricePick = (editing: Mt4ProtectionEdit, field: Mt4ProtectionField) => {
    if (!state || protectionBlocked) return;
    if (state.selection.symbol !== editing.order.symbol) select(editing.order.symbol, state.selection.timeframe);
    setProtection(editing); setProtectionError("");
    const kind = field === "stopLoss" ? "stop-loss" : "take-profit";
    setOrderPriceSelection(current => current === kind && protection?.order.ticket === editing.order.ticket && protection.order.symbol === editing.order.symbol ? null : kind);
    requestAnimationFrame(() => document.getElementById("mt4-chart-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const saveProtection = (remove?: Mt4ProtectionField) => {
    if (!protection || protectionBlocked || lock.current || pendingRef.current) return;
    setOrderPriceSelection(null);
    try {
      const command = prepareMt4Protection({ state: latestState.current, edit: protection, values: { stopLoss: protectSl, takeProfit: protectTp }, remove, id: crypto.randomUUID() });
      setProtectionError("");
      if (!command) { notify("保护价未改变"); setProtection(null); return; }
      setProtection(current => current ? { ...current, commandId: command.id } : current);
      void submit(command);
    } catch(e) { setProtectionError(e instanceof Error ? e.message : "保护价未能提交，请重新读取订单后修改。"); }
  };
  const moveOrderProtectionLine = (line: Mt4OrderProtectionLine, price: number) => {
    if (historical || source || protectionBlocked || lock.current || pendingRef.current) return false;
    try {
      const current = latestState.current;
      const command = prepareMt4ProtectionDrag({ state: current, line, price, id: crypto.randomUUID() });
      if (!command) return false;
      const order = current!.snapshot!.orders.find(order => order.ticket === line.order.ticket && order.symbol === line.order.symbol)!;
      const field = line.field === 'entry' ? command.stopLoss !== order.stopLoss ? 'stopLoss' : 'takeProfit' : line.field;
      protectionOpener.current = null;
      setOrderPriceSelection(null); setBatchPriceSelection(null); setProtectionError('');
      setProtectSl(command.stopLoss ? String(command.stopLoss) : ''); setProtectTp(command.takeProfit ? String(command.takeProfit) : '');
      setProtection({ accountKey: line.accountKey, order: { ...order }, field, commandId: command.id });
      void submit(command);
      // Entry stays at the acknowledged fill price; its drag creates a protection line.
      return line.field !== 'entry';
    } catch (error) { setError(error instanceof Error ? error.message : '保护价未能修改，请重新读取订单后重试。'); return false; }
  };
  const openCloseAll = () => {
    if (lock.current || !state) return;
    try {
      const plan = captureCloseAllPlan(state);
      setError(""); void executeCloseAll(plan);
    } catch(e) { setError(e instanceof Error ? e.message : "请重新读取持仓后再确认全部平仓。"); }
  };
  const executeCloseAll = async (plan: CloseAllPlan) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); pollRef.current?.abort();
    const controller = new AbortController(); closeAllController.current = controller; closeAllStop.current = false;
    setCloseAllRunning(true); setCloseAllStopping(false); setCloseAllResult(null); setCloseAllLogin(plan.login); setError(""); notify("");
    try {
      const result = await runCloseAll(plan, Number(slippage), {
        request: requestMt4, signal: controller.signal, shouldStop: () => closeAllStop.current,
        onStatus: apply, onProgress: setCloseAllProgress,
        onPending: command => { pendingRef.current = command; setPending(command); },
        isDefiniteRejection: e => e instanceof Mt4RequestError && e.definite,
      });
      if (controller.signal.aborted) return;
      const unacknowledged = result.pendingCommand && !latestState.current?.commands.some(c => c.id === result.pendingCommand?.id) ? result.pendingCommand : null;
      pendingRef.current = unacknowledged; setPending(unacknowledged);
      setCloseAllResult(result); setCloseAllProgress(result);
      if (result.outcome === "complete") notify(`已平仓 ${result.closed} 笔${result.absent ? ` · ${result.absent} 笔已不在持仓` : ""}`);
    } catch(e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "全部平仓已停止，请核对 MT4 执行回报。"); }
    finally {
      lock.current = false; closeAllController.current = null;
      if (!controller.signal.aborted) { setBusy(false); setCloseAllRunning(false); setCloseAllStopping(false); }
    }
  };
  const renderOrders = (orders: Mt4Order[], history = false) => !orders.length
    ? <div className="mt4-table-empty" role="status">{history ? "MT4 当前返回的历史范围内没有成交" : "当前没有持仓或挂单"}</div>
    : (
    <div className="mt4-table-wrap" tabIndex={0} role="region" aria-label={history ? "最近成交表格" : "持仓与挂单表格"}>
      <table className="mt4-table" aria-label={history ? "最近成交" : "持仓与挂单"}>
        <colgroup>{[11, 13, 12, 8, 12, 11, 11, 10, 12].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
        <thead><tr><th scope="col">订单号</th><th scope="col">品种</th><th scope="col">方向</th><th scope="col" className="mt4-number">手数</th><th scope="col" className="mt4-number">开仓价</th><th scope="col" className="mt4-number">止损</th><th scope="col" className="mt4-number">止盈</th><th scope="col" className="mt4-number" title={`盈亏包含手续费与隔夜费用；单位 ${account?.currency ?? "账户币种"}`}>盈亏{account?.currency && <span className="mt4-table-currency"> {account.currency}</span>}</th><th scope="col" className="mt4-row-action">{history ? "成交时间" : "操作"}</th></tr></thead>
        <tbody>{orders.map(o => {
          const digits = snapshot?.symbols.find(s => s.symbol === o.symbol)?.digits;
          const priceText = (price: number) => digits == null ? String(price) : price.toFixed(digits);
          const profit = !history && o.type < 2 ? chartView.floating.orderProfits[mt4FloatingOrderKey(o)] ?? o.profit + o.swap + o.commission : o.profit + o.swap + o.commission;
          return <tr key={o.ticket}>
            <td className="mt4-ticket">{o.ticket}</td><td className="mt4-order-symbol" title={o.symbol}>{o.symbol}</td>
            <td><span className={`mt4-order-side ${o.type % 2 === 0 ? "buy" : "sell"}`}>{orderTypes[o.type]}</span></td>
            <td className="mt4-number">{o.lots.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
            <td className="mt4-number">{priceText(o.openPrice)}</td>
            {(["stopLoss", "takeProfit"] as const).map(field => {
              const label = field === "stopLoss" ? "止损" : "止盈", value = o[field] ? priceText(o[field]) : "—";
              return <td key={field} className={`mt4-number${o[field] ? "" : " mt4-unset"}`}>{history ? value : <button type="button" className="mt4-protection-price" disabled={protectionBlocked} title={`点击图表选取${label}；取消保护请打开保护价`} aria-label={`订单 ${o.ticket} ${o.symbol} ${label} ${o[field] ? value : "未设置"}，点击图表选价`} onClick={event => openProtection(o, field, event.currentTarget)}><span>{value}</span><Pencil size={11} aria-hidden="true" /></button>}</td>;
            })}
            <td className={`mt4-number mt4-order-profit ${profit < 0 ? "down" : profit > 0 ? "up" : ""}`}>{profit > 0 ? "+" : ""}{profit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            {history ? <td className="mt4-row-action mt4-trade-time" title={o.closeTime ? new Date(o.closeTime * 1000).toLocaleString("zh-CN", { hour12: false }) : undefined}>{formatTime(o.closeTime * 1000)}</td> : <td className="mt4-row-action"><div className="mt4-actions"><button className="ghost-button" disabled={!connected || !state?.enabled || !!state?.unresolved || busy || !!pending} onClick={() => orderAction(o, o.type < 2 ? "close" : "cancel")}>{o.type < 2 ? "平仓" : "撤单"}</button>
              <button className="ghost-button" disabled={protectionBlocked} onClick={event => openProtection(o, "both", event.currentTarget)}>保护价</button></div></td>}
          </tr>;
        })}</tbody>
      </table>
    </div>
  );

  const changeShortcutTimeframe = (next: string) => {
    setDecisionSource(null);
    if (review) void readReview(timeframeMinutes[next]).catch(e => setError(e instanceof Error ? e.message : "历史周期读取失败"));
    else if (historyChart) { setHistoryChart({ ...historyChart, timeframe: timeframeMinutes[next] }); }
    else select(state?.selection.symbol ?? "", timeframeMinutes[next]);
  };
  const cycleShortcutTimeframe = (direction: number) => {
    const periods = Object.keys(timeframeMinutes);
    const index = Math.max(0, periods.indexOf(chartPeriods[displayTimeframe]));
    changeShortcutTimeframe(periods[(index + direction + periods.length) % periods.length]);
  };
  const canOpenShortcutOrder = Boolean(canTrade && symbol?.tradeAllowed && Number(lots) > 0 && (orderType === "market" || Number(price) > 0));
  const shortcutHandlers: Partial<Record<ShortcutAction, { enabled: boolean; run: () => void }>> = {
    tradeBuy: { enabled: canOpenShortcutOrder, run: () => openOrder("buy") },
    tradeSell: { enabled: canOpenShortcutOrder, run: () => openOrder("sell") },
    tradeCloseAll: { enabled: Boolean(!historical && connected && account?.connected && account.tradeAllowed && state?.enabled && !busy && !state?.unresolved && !pending && snapshot && snapshot.orderCount <= snapshot.orders.length && snapshot.orders.some(order => order.type < 2)), run: openCloseAll },
    tradeStopLoss: { enabled: !historical && chartBars.length > 0, run: () => toggleOrderPriceSelection("stop-loss") },
    tradeTakeProfit: { enabled: !historical && chartBars.length > 0, run: () => toggleOrderPriceSelection("take-profit") },
    timeframePrevious: { enabled: !busy && !review?.evidence && (historical || connected), run: () => cycleShortcutTimeframe(-1) },
    timeframeNext: { enabled: !busy && !review?.evidence && (historical || connected), run: () => cycleShortcutTimeframe(1) },
    indicators: { enabled: displayBars.length > 0, run: () => setIndicatorMenuOpen(open => !open) },
  };
  useKeyboardShortcuts({ settings: keyboardShortcuts, enabled: shortcutsEnabled, contextKey: displayKey,
    isAvailable: action => Boolean(shortcutHandlers[action]?.enabled),
    onAction: action => { const handler = shortcutHandlers[action]; if (!handler?.enabled) return false; handler.run(); return true; },
  });

  return <section className="content-page mt4-page">
    <header className="page-heading"><h1>MT4 交易</h1><div className="mt4-actions">
      <span className={connected ? "up" : ""} role="status">{loading ? "正在读取" : state ? connectionLabels[state.connection] : "连接不可用"}</span>
      {state?.commands.some(c => c.status === "queued" || c.status === "sent") && <span role="status">交易处理中</span>}
      <button className="ghost-button" disabled={busy} onClick={() => void refresh()}>验证连接</button>
      <button className="ghost-button" disabled={!snapshot} aria-expanded={decisionOpen} aria-controls="mt4-decision-card" onClick={() => setDecisionOpen(v => !v)}>事前决策</button>
      <button className="ghost-button" aria-expanded={helpOpen} onClick={() => setHelpOpen(v => !v)}>连接设置</button>
    </div></header>
    {(error || readError) && <div className="mt4-error" role="alert">{error || readError}<button className="ghost-button" disabled={busy} onClick={() => { setError(""); void refresh(); }}>重新读取</button></div>}
    {pending && !busy && <div className="mt4-error" role="alert">提交结果尚未确认，请核对后继续。<button className="ghost-button" disabled={busy} onClick={() => void submit(pending)}>核对提交结果</button></div>}
    {unresolvedCommands.map(command => <div className="mt4-error" role="alert" key={command.id}>
      <span>{commandTypes[command.type]} · {command.symbol} · 账号 {command.login} 待核对{command.error ? `：${command.error}` : ""}</span>
      <button className="ghost-button" disabled={busy} onClick={() => {
        const login = window.prompt(`请在 MT4 核对账号 ${command.login} 的持仓、挂单和历史记录。确认后输入该账号；此操作只结束待核对状态，不会撤销或再次发送订单。`);
        if (login) void act({ action: "resolve", id: command.id, confirmation: login }, "待核对状态已结束");
      }}>已在 MT4 核对</button>
    </div>)}
    {state?.transportError && <div className="mt4-error" role="alert">{state.transportError}</div>}
    {notice && <Mt4Toast key={notice.id} message={notice.message} onDismiss={dismissNotice} />}
    {(helpOpen || !state?.paired || state.connection === "waiting") && <section className="mt4-card">
      <h2>连接准备</h2>
      <div className="mt4-actions"><button className="primary-button" disabled={busy || loading} onClick={() => void act({ action: "pair" }, "连接配置已准备，请下载并在 MT4 加载")}>{state?.paired ? "准备连接配置" : "生成连接配置"}</button>
        {state?.paired && <><a className="ghost-button" href="/mt4/KLineTradeBridge.ex4" download>下载连接 EA</a><a className="ghost-button" href="/mt4/BatchOrderPanelEA.ex4" download>下载面板合并版 EA</a><button className="ghost-button" disabled={busy} onClick={() => void downloadMt4Config().catch(e => setError(e instanceof Error ? e.message : "连接配置下载失败，请重试"))}>下载连接配置</button></>}
      </div>
      <ol className="mt4-steps">
        <li>在 MT4 登录模拟账户，选择「文件 → 打开数据文件夹」，将连接 EA 放入 MQL4/Experts。</li>
        <li>在「工具 → 选项 → EA 交易」允许 WebRequest，添加 <code>http://127.0.0.1</code>。</li>
        <li>刷新导航器，选择 KLineTradeBridge 或面板合并版 BatchOrderPanelEA；在「输入参数 → 加载」中选择连接配置，在「常用」中允许实时自动交易。</li>
        <li>开启 MT4 顶部「自动交易」，返回本页验证连接，再核对账号并开启交易。只挂载一次连接 EA。</li>
      </ol>
      <details><summary>重新配对与文件版本</summary><div className="mt4-actions"><a className="ghost-button" href="/mt4/KLineTradeBridge.mq4" download>下载 EA 源码</a>
        <button className="ghost-button" disabled={busy || !!state?.unresolved} onClick={() => void act({ action: "reset-pairing" }, "已重新配对，请下载新配置并重新加载 EA")}>重新配对</button></div>
        <p>重新配对会使原配置失效。若 MT4 无法加载 EA，可在 MetaEditor 打开源码并编译后重试。</p>
      </details>
    </section>}
    {account && !historical && <section className="mt4-card mt4-account-band" aria-label="MT4 账户">
      <div className="mt4-account-identity">
        <div className="mt4-account-heading"><h2>{account.mode === "demo" ? "模拟账户" : account.mode === "real" ? "实盘账户" : "竞赛账户"} · {account.login}</h2><span className={`mt4-account-status${state?.enabled ? " active" : ""}`} role="status">{state?.enabled ? "交易已开启" : "交易已暂停"}</span></div>
        <div className="mt4-account-meta"><span title={account.server}>{account.server} · {account.currency}</span><span title="最近收到终端数据的本机时间；报价时间单独显示" aria-label={`最近收到终端数据的本机时间 ${formatTime(state?.lastSeen ?? 0)}`}>终端更新 {formatTime(state?.lastSeen ?? 0)}</span></div>
        {account.mode === "real" && <p className="mt4-account-risk"><TriangleAlert size={13} aria-hidden="true" /><span>本页交易会向真实账户发送订单。</span></p>}
      </div>
      <div className="mt4-account-controls">
      {state?.enabled ? <button className="ghost-button" disabled={busy} onClick={() => void act({ action: "pause" }, "交易已暂停；已发送指令仍需核对 MT4 回报")}>暂停交易</button> : <div className="mt4-enable">
        <label title="填写当前 MT4 账号以确认交易对象">核对账号<input value={accountConfirmation} onChange={e => setAccountConfirmation(e.target.value)} autoComplete="off" inputMode="numeric" aria-label="核对账号，填写当前 MT4 账号" /></label>
        {account.mode === "real" && <label className="mt4-check"><input type="checkbox" checked={acceptReal} onChange={e => setAcceptReal(e.target.checked)} />确认开启真实账户交易</label>}
        <button className="primary-button" disabled={!connected || busy || !!state?.unresolved || accountConfirmation !== account.login || !account.tradeAllowed || (account.mode === "real" && (!acceptReal || !account.allowReal)) || account.mode === "contest"} onClick={() => void act({ action: "enable", accountKey: state?.accountKey, confirmation: accountConfirmation, acceptReal }, "MT4 交易已开启")}>开启{account.mode === "real" ? "实盘" : "模拟"}交易</button>
      </div>}
      </div>
      {(!account.tradeAllowed || (account.mode === "real" && !account.allowReal) || account.mode === "contest") && <div className="mt4-account-notices" role="status">
        {!account.tradeAllowed && <p>MT4 未允许交易，请检查自动交易开关与 EA 交易权限。</p>}
        {account.mode === "real" && !account.allowReal && <p>MT4 尚未授权实盘交易，请在 EA 输入参数中将 InpAllowReal 设为 true，再在本页确认开启。</p>}
        {account.mode === "contest" && <p>竞赛账户仅可查看数据，交易功能支持模拟和实盘账户。</p>}
      </div>}
    </section>}
    {(snapshot || historical) && <>
      <div className="mt4-trading-grid"><section id="mt4-chart-workspace" className="mt4-card mt4-chart-card" aria-label="MT4 行情图表">
        {review && <div className="mt4-archive-review" role="status"><strong>{review.evidence ? review.evidence.source === 'observed' ? '当时证据 · 只读' : '导入时证据 · 只读' : '交易回看'}</strong><span>{review.account.login} · {review.account.server} · {review.trade.symbol} · #{review.trade.order.ticket}</span><time>{new Date(review.focus).toLocaleString('zh-CN', { timeZone: 'UTC', hour12: false })} · MT4 时间</time><button className="ghost-button" disabled={chartFetch || !!review.evidence} onClick={() => void fetchReviewChart()}>补取行情</button>{review.evidence && <button className="ghost-button" onClick={() => setReview(current => current ? { ...current, focus: current.returnFocus ?? current.trade.order.openTime * 1000, evidence: undefined } : current)}>返回复盘</button>}<button className="ghost-button" onClick={() => { setReview(null); setHistoryChart(null); setOrderPriceSelection(null); }}>返回实时</button></div>}
        {historyChart && !review && <div className="mt4-archive-review" role="status"><strong>历史筛选</strong><span>{historyChart.account.login} · {historyChart.account.server} · {historyChart.symbol}</span><span>{historyChart.filter.from || '最早'} — {historyChart.filter.to || '最新'}</span><button className="ghost-button" onClick={() => { setHistoryChart(null); }}>返回实时</button></div>}
        {!historical && chartMotion.enabled && chartView.window === "clock" && <div className="mt4-error" role="alert">
          MT4 时钟尚未就绪，请验证连接；仍未恢复时，请更新并重新加载连接 EA。可先在 MT4 设置关闭波动窗口，恢复全天实时图表。
          <button className="ghost-button" onClick={() => setHelpOpen(true)}>检查连接</button>
        </div>}
        {historyError && <div className="mt4-error" role="alert">{historyError}<button className="ghost-button" onClick={() => setArchiveRefresh(n => n+1)}>重试读取</button></div>}
        {historyRecords?.limited && <div className="mt4-analysis-notice">图表最多显示 2000 笔交易标记，请缩小时间范围；列表保留全部结果。</div>}
        <div className="mt4-chart-controls"><Mt4SymbolPicker symbols={snapshot?.symbols ?? []} value={displaySymbol} disabled={historical || busy || !connected} onChange={next => select(next, state?.selection.timeframe ?? 5)} />
          <ChartTimeframePicker value={chartPeriods[displayTimeframe]} disabled={busy || !!review?.evidence || (!historical && !connected)} onChange={changeShortcutTimeframe} />
          <ChartIndicatorMenu settings={movingAverageSettings} onChange={next => saveIndicators(next, macdSettings)} macdSettings={macdSettings} onMacdChange={next => saveIndicators(movingAverageSettings, next)} open={indicatorMenuOpen} onOpenChange={setIndicatorMenuOpen} />
          <span tabIndex={0} title="K 线时间沿用 MT4 服务器时钟，成交量为 tick 数；最新一根尚未收盘" aria-label="MT4 服务器时间，成交量为 tick 数，最新一根尚未收盘">MT4 时间</span>
          {markerOrders.length > 0 && <span tabIndex={0} title="显示已加载行情范围内的筛选交易；点击记录可定位并读取其他时段，缺失时再补取行情" aria-label={`已显示 ${tradeMarkers.length} 笔筛选交易，共 ${markerOrders.length} 笔；点击记录可定位其他时段`}>交易标记 {tradeMarkers.length} / {markerOrders.length}</span>}
          {!historical && chartMotion.enabled && <span className="mt4-window-status" role="status" tabIndex={0} title={`开盘后 ${chartMotion.startSeconds} 秒、收盘前 ${chartMotion.endSeconds} 秒更新图表；其他时间冻结图表和浮动盈亏；报价、持仓变动与交易继续实时更新。`} aria-label={`图表波动窗口：${chartView.window === "live" ? "窗口内实时更新" : chartView.window === "clock" ? "等待 MT4 时钟" : chartView.window === "paused" ? "行情已暂停" : chartView.window === "waiting" ? "等待最新 K 线" : "图表冻结"}`}>{chartView.window === "live" ? "窗口内实时" : chartView.window === "clock" ? "等待时钟" : chartView.window === "paused" ? "行情已暂停" : chartView.window === "waiting" ? "等待新 K 线" : "图表冻结"}</span>}
          {!historical && displayedBar && <div className="mt4-ohlc" aria-label="最新 K 线价格">{[["开", displayedBar.open], ["高", displayedBar.high], ["低", displayedBar.low], ["收", displayedBar.close]].map(([label, value]) => <span key={label}>{label} <strong>{Number(value).toFixed(symbol?.digits ?? 5)}</strong></span>)}</div>}</div>
        {review && !review.evidence && review.trade.focusCovered === false && displayBars.length > 0 && <div className="mt4-error">交易发生时段的行情尚不完整，请连接对应账户后补取行情。</div>}
        {candleHistory.error && <div className="mt4-error" role="alert">{candleHistory.error}<button className="ghost-button" onClick={candleHistory.retry}>重试读取行情</button></div>}
        {indicatorError && <div className="mt4-error" role="alert">{indicatorError}</div>}
        {source && <div className="mt4-archive-review" role="status"><span>编辑计划 · {chartPeriods[source.timeframe]}</span><button className="ghost-button" onClick={() => setDecisionSource(null)}>返回当前计划</button></div>}
        <Mt4PersistentAnalysis onNotice={notify} key={displayKey} storageKey={analysisKey(displayAccount, displaySymbol, analysisTimeframe)} readOnly={!!review?.evidence} context={{ accountKey: displayAccount, symbol: displaySymbol, timeframe: analysisTimeframe, scope: displayScope }} seed={source ? undefined : reviewSeed}
          showChartMarkers={showChartMarkers} editingPlanId={source?.decisionId} onOpenPlanSource={next => { setOrderPriceSelection(null); setProtection(null); setDecisionSource({ ...next, accountKey: displayAccount, symbol: displaySymbol }); }}
          liveOrderLines={liveOrderLines} onLiveOrderLineMove={moveOrderProtectionLine}
          focusTimestamp={chartFocus || undefined} onHistoryRange={candleHistory.onRange} tradeMarkers={tradeMarkers} onTradeSelect={review?.evidence ? undefined : onTradeSelect}
          bars={displayBars} symbol={displaySymbol} timeframe={chartPeriods[displayTimeframe]} digits={displayDigits} decisionOpen={decisionOpen} onOpenDecision={() => setDecisionOpen(true)}
          syncOrderPrices={!historical && !source} sharedReasonTags={sharedReasonTags} onReasonTagsChange={onReasonTagsChange} onAnalysisChange={historical || source ? undefined : onAnalysisChange} entryReceipt={historical || source ? undefined : entryReceipt}
          relatedOrders={relatedOrders} onRelatedTradeSelect={(order, event) => setChartSelection({ accountKey: displayAccount, order: { ...order, timeframe: displayTimeframe, firstSeen: 0, lastSeen: 0 }, focus: (event === "exit" ? order.closeTime : order.openTime) * 1000, nonce: Date.now() })}
          keyboardShortcuts={keyboardShortcuts} shortcutsEnabled={shortcutsEnabled}
          movingAverageSettings={movingAverageSettings} macdSettings={macdSettings}
          candleClock={historical ? undefined : chartClock}
          orderPriceSelection={historical ? null : orderPriceSelection} orderPriceSelectionLabel={protection ? `订单 #${protection.order.ticket} · ${orderPriceSelection === "stop-loss" ? "止损" : "止盈"}` : batchPriceSelection ? `第 ${batchPriceSelection.index + 1} 笔 · ${orderPriceSelection === "entry-trigger" ? "触发价" : orderPriceSelection === "stop-loss" ? "止损" : "止盈"}` : undefined} onOrderPriceSelect={onOrderPriceSelect} onPlanProtectionChange={onPlanProtectionChange} orderPrices={historical ? { stopLoss: 0, takeProfit: 0, entry: 0 } : selectedOrderPrices} onCancelOrderPriceSelection={() => { setOrderPriceSelection(null); setBatchPriceSelection(null); }}
          emptyMessage={historical ? '该时段行情尚未归档，请连接对应账户后补取行情' : chartReady ? "MT4 暂无该周期 K 线，请在 MT4 打开对应图表后重试" : "正在等待 MT4 返回所选图表"} />
      </section>{snapshot && !historical && <section className="mt4-card mt4-order-dock trade-dock" aria-label="MT4 下单">
        <div className="trade-stats" aria-label="MT4 账户指标">
          {[["账户余额", account?.balance], ["账户权益", displayedAccount?.equity], ["已用保证金", account?.margin], ["可用保证金", displayedAccount?.freeMargin]].map(([label,value]) => <span key={String(label)} title={`单位：${account?.currency ?? "账户币种"}`}>{label}<strong>{typeof value === "number" ? value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</strong></span>)}
          <span title="账户权益 ÷ 已用保证金；未占用保证金时不显示比例">保证金水平<strong>{displayedAccount && displayedAccount.margin > 0 ? `${(displayedAccount.equity / displayedAccount.margin * 100).toFixed(1)}%` : "—"}</strong></span>
          <span title={`MT4 账户当前浮动盈亏；单位 ${account?.currency ?? "账户币种"}`}>浮动盈亏<strong className={displayedAccount && displayedAccount.profit < 0 ? "down" : displayedAccount && displayedAccount.profit > 0 ? "up" : ""}>{displayedAccount ? `${displayedAccount.profit > 0 ? "+" : ""}${displayedAccount.profit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</strong></span>
        </div>
        <OrderEntryActions
          quantity={<><label title="每批 1–10 笔，逐笔设置价格、手数与保护价；按账户和品种自动保存"><span>订单数</span><input aria-label="批量订单数" type="number" min={1} max={10} step={1} value={orderCount} onChange={e => changeOrderCount(e.target.value)} disabled={busy} /></label>{Number(orderCount) <= 1 && <label title={sizingMode === "risk-percent" ? "按当前买入价格预估；卖出按对应报价计算，MT4 会在执行前重新计算" : `最小 ${symbol?.minLot ?? "—"} 手，步长 ${symbol?.lotStep ?? "—"}，最大 ${symbol?.maxLot ?? "—"} 手；按账户和品种记住最近有效手数`}><span>{sizingMode === "risk-percent" ? "风险手数" : "手数"}</span><input type="number" min={symbol?.minLot} max={symbol?.maxLot} step={symbol?.lotStep} readOnly={sizingMode === "risk-percent"} value={sizingMode === "risk-percent" ? previewLots : lots} placeholder={sizingMode === "risk-percent" ? "先选止损" : undefined} onChange={e => rememberLots(e.target.value)} aria-describedby="mt4-lots-help" disabled={!symbol || !state?.accountKey} aria-label={sizingMode === "risk-percent" ? "预估买入手数" : `手数，最小 ${symbol?.minLot ?? "未知"}，步长 ${symbol?.lotStep ?? "未知"}`} /></label>}</>}
          sell={{ label: (Number(orderCount) > 1 ? "批量" : "") + (orderType === "limit" ? "卖出限价" : orderType === "stop" ? "卖出突破" : "卖出开仓"), mobileLabel: "卖出", disabled: entryDisabled, onClick: () => openOrder("sell") }}
          buy={{ label: (Number(orderCount) > 1 ? "批量" : "") + (orderType === "limit" ? "买入限价" : orderType === "stop" ? "买入突破" : "买入开仓"), mobileLabel: "买入", disabled: entryDisabled, onClick: () => openOrder("buy") }}>
          <button type="button" className="flat-button" disabled={!connected || !account?.connected || !account.tradeAllowed || !state?.enabled || busy || !!state?.unresolved || !!pending || snapshot.orderCount > snapshot.orders.length || !snapshot.orders.some(o => o.type < 2)} title="立即平掉当前账户全部品种持仓（含手动及其他 EA）；挂单保留" onClick={openCloseAll}><CircleStop size={16} /><span className="desktop-order-label">全部平仓</span><span className="mobile-order-label">全平</span></button>
        </OrderEntryActions>
        <span id="mt4-lots-help" className="live-sr-only">按账户和品种记住最近填写的有效固定手数；切换周期保留，风险计算的预估手数不覆盖此值。</span>
        {lotsError && <div className="mt4-preference-error" role="alert">{lotsError}<button type="button" className="ghost-button" onClick={() => rememberLots(lots, true)}>重试保存手数</button></div>}
        <OrderEntryControls
          sizing={{ value: sizingMode, options: [{ value: "fixed", label: "固定手数" }, { value: "risk-percent", label: "按止损风险（余额%）", disabled: !advancedReady }], onChange: next => setSizingMode(next as typeof sizingMode) }}
          order={{ value: orderType, options: [{ value: "market", label: "市价开仓" }, { value: "limit", label: "限价挂单" }, { value: "stop", label: "突破挂单" }], onChange: next => { setOrderType(next as typeof orderType); if (next !== "market") setGapMode("off"); } }}
          gap={{ mode: gapMode, disabled: !advancedReady || orderType !== "market", title: "仅检查市价买入所在 K 线的开盘跳空；点击切换高开不买、低开不买、关闭", onChange: () => setGapMode(m => m === "off" ? "high" : m === "high" ? "low" : "off") }}
          riskField={sizingMode === "risk-percent" && <label title="按余额与止损距离计算，手数向下取整；不含滑点与费用，执行时由 MT4 复核">{Number(orderCount) > 1 ? "整批风险（余额%）" : "单笔风险（余额%）"}<input aria-label={Number(orderCount) > 1 ? "整批风险百分比" : "单笔风险百分比"} type="number" min={0.0001} max={100} step={0.1} value={riskPercent} onChange={e => setRiskPercent(e.target.value)} /></label>}
          thresholdField={gapMode !== "off" && <label>不买阈值<span className="opening-gap-threshold-control"><input aria-label="跳空不买阈值" type="number" min={0.0001} step={0.0001} value={gapThreshold} onChange={e => setGapThreshold(e.target.value)} /><select aria-label="跳空阈值单位" value={gapUnit} onChange={e => setGapUnit(e.target.value as typeof gapUnit)}><option value="percent">%</option><option value="price">价格</option></select></span></label>}
          entryField={Number(orderCount) <= 1 && orderType !== "market" && <OrderPriceInput label="触发价" inputLabel="委托价格，挂单时填写" value={price} step={symbol?.point} selected={orderPriceSelection === "entry-trigger"} pickDisabled={!chartBars.length} pickLabel="在图表选择委托触发价" onChange={setPrice} onPick={() => toggleOrderPriceSelection("entry-trigger")} />}
          stop={Number(orderCount) <= 1 ? { label: "止损", value: sl, selected: !protection && orderPriceSelection === "stop-loss", disabled: !chartBars.length, title: "点击 K 线图选择止损；下单设置中可手动填写", pickLabel: "在图表选择保护止损价", clearLabel: "清除保护止损价", onPick: () => toggleOrderPriceSelection("stop-loss"), onClear: () => setSl("") } : undefined}
          target={Number(orderCount) <= 1 ? { label: "止盈", value: tp, selected: !protection && orderPriceSelection === "take-profit", disabled: !chartBars.length, title: "点击 K 线图选择止盈；下单设置中可手动填写", pickLabel: "在图表选择保护止盈价", clearLabel: "清除保护止盈价", onPick: () => toggleOrderPriceSelection("take-profit"), onClear: () => setTp("") } : undefined}
          extra={<div className="mt4-order-settings-control"><span>参数</span><details className="mt4-order-settings" onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.stopPropagation(); e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label="下单设置" title="手动填写保护价和允许滑点"><Settings2 size={13} />设置</summary><div className="mt4-order-settings-fields" role="group" aria-label="下单设置参数">
            <label title="以报价点计，MT4 按券商执行方式处理">允许滑点<input type="number" min={0} max={1000} step={1} value={slippage} onChange={e => setSlippage(e.target.value)} aria-label="允许滑点，单位为报价点" /></label>
            {Number(orderCount) <= 1 && <label title="留空表示不设置止损">止损<input type="number" min={0} step={symbol?.point} value={sl} onChange={e => setSl(e.target.value)} aria-label="止损价格，留空表示不设置" /></label>}
            {Number(orderCount) <= 1 && <label title="留空表示不设置止盈">止盈<input type="number" min={0} step={symbol?.point} value={tp} onChange={e => setTp(e.target.value)} aria-label="止盈价格，留空表示不设置" /></label>}
          </div></details></div>}
          footer={Number(orderCount) > 1 && <Mt4BatchOrders rows={resizeMt4BatchRows(batchRows, Number(orderCount), { lots, price, sl, tp })} count={Number(orderCount)} orderType={orderType} sizingMode={sizingMode} riskPercent={Number(riskPercent)} balance={account?.balance ?? 0} symbol={symbol} disabled={busy} chartReady={!!chartBars.length} selection={batchPriceSelection && orderPriceSelection ? batchPriceSelection : null} onChange={(index, field, value) => setBatchRows(rows => rows.map((row, i) => i === index ? { ...row, [field]: value } : row))} onPick={pickBatchPrice} />}
          info={`MT4 市价使用当前报价，挂单由券商触发；本批 ${orderCount} 笔，按逐笔设置执行；固定手数为每笔，风险百分比平分到每笔。账户币种 ${account?.currency ?? "—"}，${symbol?.symbol ?? "—"} 最小 ${symbol?.minLot ?? "—"} 手，步长 ${symbol?.lotStep ?? "—"}；允许滑点 ${slippage} 报价点。`} />
        {orderSettingsError && <div className="mt4-preference-error" role="alert">{orderSettingsError}<button type="button" className="ghost-button" onClick={() => { lastOrderSettings.current = ''; setOrderSaveRetry(value => value + 1); }}>保存当前设置</button></div>}
        <div className="mt4-order-quote" aria-label="当前报价"><span>卖出价 <strong>{symbol?.bid.toFixed(symbol.digits) ?? "—"}</strong></span><span>买入价 <strong>{symbol?.ask.toFixed(symbol.digits) ?? "—"}</strong></span><span title="点差以该品种的报价点计">点差 {symbol ? ((symbol.ask - symbol.bid) / symbol.point).toFixed(1) : "—"}</span><time>报价 {formatTime((symbol?.quoteTime ?? 0) * 1000)}</time></div>
        {openBatchProgress && (openBatchRunning || openBatchResult?.outcome === "stopped") && <div className="mt4-batch-progress mt4-dock-notice" role="status">
          <span>批量下单 · 已完成 {openBatchProgress.completed} / {openBatchProgress.total} · 剩余 {openBatchProgress.remaining}{openBatchRunning && openBatchProgress.currentIndex ? ` · 等待第 ${openBatchProgress.currentIndex} 笔回报` : ""}</span>
          {openBatchRunning && <button type="button" className="ghost-button" disabled={openBatchStopping} onClick={() => { openBatchStop.current = true; setOpenBatchStopping(true); }}>{openBatchStopping ? "正在停止" : "停止后续下单"}</button>}
          {openBatchResult?.outcome === "stopped" && <p className="down" role="alert">{openBatchResult.message} 已成功订单保留。</p>}
        </div>}
        {closeAllProgress && (closeAllRunning || closeAllResult?.outcome === "stopped" || !!closeAllResult?.currentPositions) && <div className="mt4-batch-progress mt4-dock-notice" role="status">
          <span>账号 {closeAllLogin} · 已平仓 {closeAllProgress.closed} / {closeAllProgress.total}{closeAllProgress.absent > 0 ? ` · 已不在持仓 ${closeAllProgress.absent}` : ""} · 剩余 {closeAllProgress.remaining}{closeAllRunning && closeAllProgress.currentTicket ? ` · 等待 #${closeAllProgress.currentTicket} 回报` : ""}</span>
          {closeAllRunning && <button type="button" className="ghost-button" disabled={closeAllStopping} title="停止后续订单，已发送指令仍会等待回报" onClick={() => { closeAllStop.current = true; setCloseAllStopping(true); }}>{closeAllStopping ? "正在停止" : "停止后续"}</button>}
          {closeAllResult && <p className={closeAllResult.outcome === "stopped" ? "down" : ""}>{closeAllResult.message}{closeAllResult.outcome === "complete" && closeAllResult.currentPositions > 0 ? `当前仍有 ${closeAllResult.currentPositions} 笔持仓，请重新确认范围。` : ""}</p>}
        </div>}
        {!quoteFresh && <div className="mt4-error mt4-dock-notice">报价未更新，暂不能下单；请检查 MT4 行情连接。</div>}
        {!advancedReady && <div className="mt4-analysis-notice mt4-dock-notice">更新连接 EA 或加载面板合并版后，可使用风险手数与跳空过滤。</div>}
      </section>}</div>
    </>}
      <section className="mt4-card mt4-orders-card" aria-label="MT4 持仓与成交">
        {snapshot && !historical && <>
        <header className="mt4-orders-heading"><h2>持仓与挂单</h2><div className="mt4-order-counts"><span>持仓 <strong>{snapshot.orders.filter(o => o.type < 2).length}</strong></span><span>挂单 <strong>{snapshot.orders.filter(o => o.type >= 2).length}</strong></span></div></header>
        {snapshot.orderCount > snapshot.orders.length && <div className="mt4-error">当前显示 {snapshot.orders.length} / {snapshot.orderCount} 笔订单，其余订单请在 MT4 查看。</div>}
        {renderOrders(snapshot.orders)}
        {protection && <section className={`mt4-protection${protection.field === "both" ? "" : " single"}`} aria-label="订单保护价编辑" ref={protectionEditor} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setProtection(null); setOrderPriceSelection(null); } }}>
          <h3>#{protection.order.ticket} · {protection.order.symbol} · {protection.field === "both" ? "保护价" : protection.field === "stopLoss" ? "止损" : "止盈"}</h3>
          <form className="mt4-protection-form" noValidate onSubmit={event => { event.preventDefault(); if (!event.currentTarget.checkValidity()) { setProtectionError("请填写有效的保护价格，或使用取消按钮移除保护。"); return; } saveProtection(); }}>
            <div className="mt4-fields">
              {protection.field !== "takeProfit" && <OrderPricePicker label="止损" value={protectSl} selected={orderPriceSelection === "stop-loss"} disabled={protectionBlocked} title="在图表点选该订单止损；保存后同步到 MT4" pickLabel="在图表修改订单止损" clearLabel="清除订单止损选价" onPick={() => beginProtectionPricePick(protection, "stopLoss")} onClear={() => setProtectSl("")} />}
              {protection.field !== "stopLoss" && <OrderPricePicker label="止盈" value={protectTp} selected={orderPriceSelection === "take-profit"} disabled={protectionBlocked} title="在图表点选该订单止盈；保存后同步到 MT4" pickLabel="在图表修改订单止盈" clearLabel="清除订单止盈选价" onPick={() => beginProtectionPricePick(protection, "takeProfit")} onClear={() => setProtectTp("")} />}
            </div>
            <span className="live-sr-only" id="mt4-protection-help">拖动图表中的订单止损、止盈线，松手会提交修改；从开仓价线拖动可设置保护价。也可在此选价后保存，仅影响标题中的订单；清除价格后保存表示取消对应保护。按 Escape 关闭编辑。</span>
            <div className="mt4-actions">
              <button type="submit" className="primary-button" disabled={protectionBlocked}>{protection.field === "both" ? "保存保护价" : protection.field === "stopLoss" ? "保存止损" : "保存止盈"}</button>
              {protection.field !== "takeProfit" && <button type="button" className="ghost-button danger" disabled={protectionBlocked || !protection.order.stopLoss} onClick={() => saveProtection("stopLoss")}>取消止损</button>}
              {protection.field !== "stopLoss" && <button type="button" className="ghost-button danger" disabled={protectionBlocked || !protection.order.takeProfit} onClick={() => saveProtection("takeProfit")}>取消止盈</button>}
              <button type="button" className="ghost-button" onClick={() => { setProtection(null); setOrderPriceSelection(null); }}>关闭</button>
            </div>
          </form>
          {(protectionError || error || readError) && <div className="mt4-error" role="alert">{protectionError || error || readError}</div>}
          {protection.commandId && (busy || !!pending || !!state?.unresolved) && <span role="status">正在等待 MT4 确认</span>}
        </section>}
        </>}
        <Mt4ArchiveHistory onNotice={notify} accountStatusReady={!loading} activeAccountKey={state?.accountKey ?? ''} refreshAt={Math.floor((state?.lastSeen ?? 0) / 2000) + archiveRefresh} archiveStatus={state?.archive} selected={review?.trade} chartSymbol={displaySymbol} onFiltersChange={onHistoryFilters} onRecords={onHistoryRecords} chartSelection={chartSelection} onSelect={onHistorySelect} />
      </section>
  </section>;
}
