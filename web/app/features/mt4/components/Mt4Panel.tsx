"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleStop, MousePointer2, Settings2 } from "lucide-react";
import { OrderEntryControls, OrderEntryActions } from "../../../components/OrderEntryControls";
import { Mt4PersistentAnalysis } from "./Mt4PersistentAnalysis";
import { Mt4Toast } from "./Mt4Toast";
import { Mt4ArchiveHistory } from "./Mt4ArchiveHistory";
import type { ArchiveAccount, ArchiveTrade, ArchiveChart, HistoryFilterSelection, HistoryRecords, HistoryChartSelection } from '../mt4ArchiveContracts';
import { Mt4SymbolPicker } from "./Mt4SymbolPicker";
import { ChartTimeframePicker } from "../../../components/ChartTimeframePicker";
import { ChartIndicatorMenu } from "../../../components/ChartIndicatorMenu";
import { defaultMovingAverageSettings, defaultMacdSettings, normalizeMovingAverageSettings, normalizeMacdSettings, type MovingAverageSettings, type MacdSettings } from "../../../lib/chartIndicators";
import { analysisKey } from "../mt4Analysis";
import { downloadMt4Config, Mt4RequestError, requestMt4, requestMt4Archive } from "../mt4Gateway";
import type { Mt4CommandInput, Mt4Order, Mt4Status } from "../mt4Contracts";
import type { PriceSelectionMode } from "../../../components/KLineReplayChart";
import { buildMt4HistoryMarkers } from "../../../lib/mt4History.mjs";
import { riskSizedMt4Lots, checkMt4OpeningGap } from "../../../lib/mt4OrderRules.mjs";
import { captureCloseAllPlan, runCloseAll, type CloseAllPlan, type CloseAllProgress, type CloseAllResult } from "../mt4CloseAll";

const timeframeMinutes: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080, "1mo": 43200 };
const chartPeriods: Record<number, string> = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d", 10080: "1w", 43200: "1mo" };
const orderTypes = ["买入", "卖出", "买入限价", "卖出限价", "买入止损", "卖出止损"];
const commandLabels = { queued: "待发送", sent: "等待回报", unknown: "待核对", succeeded: "已执行", failed: "已拒绝", cancelled: "已结束", resolved: "已核对" };
const commandTypes = { open: "开仓", close: "平仓", cancel: "撤单", protect: "修改保护价" };
const connectionLabels = { unpaired: "未配置", waiting: "等待 MT4", connected: "已连接", offline: "已断开" };
function formatTime(value: number) { return value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "—"; }
function loadIndicators() {
  try {
    const stored = typeof window === "undefined" ? {} : JSON.parse(localStorage.getItem("kline.mt4.indicators.v1") ?? "{}");
    return { ma: normalizeMovingAverageSettings(stored.movingAverageSettings), macd: normalizeMacdSettings(stored.macdSettings), error: "" };
  } catch { return { ma: defaultMovingAverageSettings, macd: defaultMacdSettings, error: "指标设置未能读取，修改指标后可重新保存。" }; }
}

export function Mt4Panel() {
  const [state, setState] = useState<Mt4Status | null>(null);
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
  const [lots, setLots] = useState("0.01");
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
  const [protection, setProtection] = useState<Mt4Order | null>(null);
  const [protectSl, setProtectSl] = useState("");
  const [protectTp, setProtectTp] = useState("");
  const [pending, setPending] = useState<Mt4CommandInput | null>(null);
  const [review, setReview] = useState<{ trade: ArchiveTrade; account: ArchiveAccount; focus: number; returnFocus?: number; evidence?: ArchiveTrade['events'][number] } | null>(null);
  const [archiveRefresh, setArchiveRefresh] = useState(0);
  const [historyChart, setHistoryChart] = useState<(HistoryFilterSelection & { symbol: string; timeframe: number }) | null>(null);
  const [historyData, setHistoryData] = useState<ArchiveChart | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyRecords, setHistoryRecords] = useState<HistoryRecords | null>(null);
  const [chartSelection, setChartSelection] = useState<HistoryChartSelection | null>(null);
  const historical = !!review || !!historyChart;
  useEffect(() => {
    if (!historyChart) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await requestMt4Archive<ArchiveChart>({ action: 'chart', accountKey: historyChart.account.accountKey, symbol: historyChart.symbol, timeframe: historyChart.timeframe, from: historyChart.filter.from, to: historyChart.filter.to }, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
        if (!controller.signal.aborted) { setHistoryData(result); setHistoryError(''); }
      } catch(e) { if (!controller.signal.aborted) setHistoryError(e instanceof Error ? e.message : '筛选行情读取失败，请刷新重试'); }
      if (!controller.signal.aborted) timer = setTimeout(load, 2000);
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [historyChart, archiveRefresh]);
  const [chartFetch, setChartFetch] = useState(false);
  const reviewLoadSequence = useRef(0);
  const [closeAllProgress, setCloseAllProgress] = useState<CloseAllProgress | null>(null);
  const [closeAllResult, setCloseAllResult] = useState<CloseAllResult | null>(null);
  const [closeAllLogin, setCloseAllLogin] = useState("");
  const [closeAllRunning, setCloseAllRunning] = useState(false);
  const [closeAllStopping, setCloseAllStopping] = useState(false);
  const closeAllController = useRef<AbortController | null>(null);
  const closeAllStop = useRef(false);
  const latestState = useRef<Mt4Status | null>(null);
  const lock = useRef(false);
  const accountKeyRef = useRef("");
  const pendingRef = useRef<Mt4CommandInput | null>(null);
  const pollRef = useRef<AbortController | null>(null);

  const onHistoryFilters = useCallback((selection: HistoryFilterSelection) => {
    if (!selection.navigate) return;
    const symbol = selection.filter.symbol || (selection.account.symbols.includes(latestState.current?.selection.symbol ?? '') ? latestState.current!.selection.symbol : selection.account.symbols[0]);
    reviewLoadSequence.current++; setReview(null); setHistoryData(null); setHistoryError(''); setOrderPriceSelection(null); setProtection(null);
    setHistoryChart({ ...selection, symbol, timeframe: latestState.current?.selection.timeframe ?? 15 });
  }, []);
  const onHistoryRecords = useCallback((records: HistoryRecords) => setHistoryRecords(records), []);
  const onHistorySelect = useCallback((trade: ArchiveTrade, archivedAccount: ArchiveAccount, focus?: number, evidence?: ArchiveTrade['events'][number]) => {
    reviewLoadSequence.current++; setReview(previous => ({ trade, account: archivedAccount, focus: focus ?? trade.order.openTime * 1000, evidence, returnFocus: evidence ? previous?.focus : undefined }));
    setOrderPriceSelection(null); setProtection(null);
  }, []);

  useEffect(() => () => { closeAllController.current?.abort(); }, []);

  const apply = useCallback((next: Mt4Status) => {
    if (next.accountKey !== accountKeyRef.current) {
      accountKeyRef.current = next.accountKey; setAccountConfirmation(""); setAcceptReal(false); setProtection(null);
    }
    if (pendingRef.current && next.commands.some(c => c.id === pendingRef.current?.id)) { pendingRef.current = null; setPending(null); }
    latestState.current = next; setState(next);
  }, []);
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
    pendingRef.current = command; setPending(command);
    try {
      const next = await requestMt4({ action: "command", command }, AbortSignal.timeout(7000)); apply(next);
      notify("指令已提交，请查看 MT4 执行回报");
    } catch (e) {
      if (e instanceof Mt4RequestError && e.definite) { pendingRef.current = null; setPending(null); }
      setError(e instanceof Error ? e.message : "提交结果尚未确认，请核对提交结果");
    } finally { lock.current = false; setBusy(false); }
  };
  const snapshot = state?.snapshot;
  const account = snapshot?.account;
  const symbol = snapshot?.symbols.find(s => s.symbol === state?.selection.symbol);
  const connected = state?.connection === "connected" && !loading && !readError;
  const quoteFresh = symbol && symbol.bid > 0 && symbol.ask > 0 && symbol.quoteTime > 0 && snapshot && snapshot.capturedAt - symbol.quoteTime <= 30;
  const canTrade = Boolean(!historical && connected && state?.enabled && account?.tradeAllowed && quoteFresh && !state?.unresolved && !busy && !pending);
  const chartReady = snapshot && snapshot.chart.symbol === state?.selection.symbol && snapshot.chart.timeframe === state?.selection.timeframe;
  const chartBars = chartReady ? snapshot.chart.bars : [];
  const latestBar = chartBars.at(-1);
  const displaySymbol = review?.trade.symbol ?? historyChart?.symbol ?? state?.selection.symbol ?? '';
  const displayTimeframe = review?.trade.timeframe ?? historyChart?.timeframe ?? state?.selection.timeframe ?? 5;
  const displayBars = review?.evidence?.evidence.chart?.bars ?? review?.trade.bars ?? (historyChart ? historyData?.bars ?? [] : chartBars);
  const displayDigits = review?.trade.digits ?? historyData?.digits ?? symbol?.digits ?? 5;
  const displayAccount = review?.trade.accountKey ?? historyChart?.account.accountKey ?? state?.accountKey ?? '';
  const markerOrders = historyRecords?.accountKey === displayAccount && historyRecords.chartSymbol === displaySymbol && historyRecords.showOnChart ? historyRecords.orders : [];
  const tradeMarkers = buildMt4HistoryMarkers(markerOrders, displayBars, displayTimeframe, displayAccount);
  const onTradeSelect = (id: string, event: 'entry' | 'exit') => {
    const marker = tradeMarkers.find(marker => marker.id === id);
    const order = marker && markerOrders.find(order => order.ticket === marker.ticket && order.symbol === marker.symbol);
    if (order) setChartSelection({ accountKey: displayAccount, order: { ...order, timeframe: displayTimeframe }, focus: (event === 'exit' ? order.closeTime : order.openTime) * 1000, nonce: Date.now() });
  };
  const displayScope = review ? `trade:${review.trade.order.ticket}` : 'chart';
  const displayKey = `${analysisKey(displayAccount, displaySymbol, displayTimeframe)}:${displayScope}:${review?.evidence?.id ?? 0}`;
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
    try { previewLots = String(riskSizedMt4Lots({ balance: account?.balance ?? 0, riskPercent: Number(riskPercent), entryPrice: orderType === "market" ? symbol.ask : Number(price), stopLoss: Number(sl), symbol }).lots); } catch { /* The submit action shows the specific incomplete sizing input. */ }
  }
  const onPlanProtectionChange = useCallback((changes: { stopLoss?: string; takeProfit?: string }) => {
    if (historical) return;
    if (changes.stopLoss != null) setSl(changes.stopLoss);
    if (changes.takeProfit != null) setTp(changes.takeProfit);
  }, [historical]);
  const onOrderPriceSelect = (kind: PriceSelectionMode, value: number) => {
    const formatted = value.toFixed(symbol?.digits ?? 5);
    if (kind === "entry-trigger") setPrice(formatted); else if (kind === "stop-loss") setSl(formatted); else setTp(formatted);
    setOrderPriceSelection(null);
  };
  const select = (nextSymbol: string, timeframe: number) => {
    setOrderPriceSelection(null); setPrice(""); setSl(""); setTp("");
    const spec = snapshot?.symbols.find(s => s.symbol === nextSymbol); if (spec?.minLot) setLots(String(spec.minLot));
    void act({ action: "select", symbol: nextSymbol, timeframe });
  };
  const openOrder = (side: "buy" | "sell") => {
    if (!state || !symbol || !canTrade) return;
    try {
      const entryPrice = orderType === "market" ? side === "buy" ? symbol.ask : symbol.bid : Number(price);
      const plannedLots = sizingMode === "risk-percent" ? riskSizedMt4Lots({ balance: account?.balance ?? 0, riskPercent: Number(riskPercent), entryPrice, stopLoss: Number(sl), symbol }).lots : Number(lots);
      const gapActive = side === "buy" && gapMode !== "off";
      if (gapActive) checkMt4OpeningGap({ previousClose: chartBars.at(-2)?.close ?? 0, openingPrice: latestBar?.open ?? 0, mode: gapMode, unit: gapUnit, threshold: Number(gapThreshold) });
      void submit({ id: crypto.randomUUID(), accountKey: state.accountKey, type: "open", symbol: symbol.symbol, side, orderType,
        lots: plannedLots, price: orderType === "market" ? 0 : Number(price), stopLoss: Number(sl), takeProfit: Number(tp), slippage: Number(slippage),
        ...(sizingMode === "risk-percent" ? { sizingMode, riskPercent: Number(riskPercent) } : {}),
        ...(gapActive ? { gapMode, gapUnit, gapThreshold: Number(gapThreshold), gapTimeframe: state.selection.timeframe, gapBarTime: latestBar?.timestamp ?? 0 } : {}) });
    } catch (e) { setError(e instanceof Error ? e.message : "下单参数无效，请调整后重试。"); }
  };
  const orderAction = (order: Mt4Order, type: "close" | "cancel" | "protect") => {
    if (!state) return;
    void submit({ id: crypto.randomUUID(), accountKey: state.accountKey, type, symbol: order.symbol, ticket: order.ticket,
      stopLoss: type === "protect" ? Number(protectSl) : 0, takeProfit: type === "protect" ? Number(protectTp) : 0, slippage: Number(slippage) });
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
          const profit = o.profit + o.swap + o.commission;
          return <tr key={o.ticket}>
            <td className="mt4-ticket">{o.ticket}</td><td className="mt4-order-symbol" title={o.symbol}>{o.symbol}</td>
            <td><span className={`mt4-order-side ${o.type % 2 === 0 ? "buy" : "sell"}`}>{orderTypes[o.type]}</span></td>
            <td className="mt4-number">{o.lots.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</td>
            <td className="mt4-number">{priceText(o.openPrice)}</td><td className={`mt4-number${o.stopLoss ? "" : " mt4-unset"}`}>{o.stopLoss ? priceText(o.stopLoss) : "—"}</td><td className={`mt4-number${o.takeProfit ? "" : " mt4-unset"}`}>{o.takeProfit ? priceText(o.takeProfit) : "—"}</td>
            <td className={`mt4-number mt4-order-profit ${profit < 0 ? "down" : profit > 0 ? "up" : ""}`}>{profit > 0 ? "+" : ""}{profit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            {history ? <td className="mt4-row-action mt4-trade-time" title={o.closeTime ? new Date(o.closeTime * 1000).toLocaleString("zh-CN", { hour12: false }) : undefined}>{formatTime(o.closeTime * 1000)}</td> : <td className="mt4-row-action"><div className="mt4-actions"><button className="ghost-button" disabled={!connected || !state?.enabled || !!state?.unresolved || busy || !!pending} onClick={() => orderAction(o, o.type < 2 ? "close" : "cancel")}>{o.type < 2 ? "平仓" : "撤单"}</button>
              <button className="ghost-button" disabled={!connected || !state?.enabled || !!state?.unresolved || busy || !!pending} onClick={() => { setProtection(o); setProtectSl(o.stopLoss ? String(o.stopLoss) : ""); setProtectTp(o.takeProfit ? String(o.takeProfit) : ""); }}>保护价</button></div></td>}
          </tr>;
        })}</tbody>
      </table>
    </div>
  );

  return <section className="content-page mt4-page">
    <header className="page-heading"><h1>MT4 交易</h1><div className="mt4-actions">
      <span className={connected ? "up" : ""} role="status">{loading ? "正在读取" : state ? connectionLabels[state.connection] : "连接不可用"}</span>
      <button className="ghost-button" disabled={busy} onClick={() => void refresh()}>验证连接</button>
      <button className="ghost-button" disabled={!snapshot} aria-expanded={decisionOpen} aria-controls="mt4-decision-card" onClick={() => setDecisionOpen(v => !v)}>事前决策</button>
      <button className="ghost-button" aria-expanded={helpOpen} onClick={() => setHelpOpen(v => !v)}>连接设置</button>
    </div></header>
    {(error || readError) && <div className="mt4-error" role="alert">{error || readError}<button className="ghost-button" disabled={busy} onClick={() => { setError(""); void refresh(); }}>重新读取</button></div>}
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
      <div className="mt4-account-identity"><h2>{account.mode === "demo" ? "模拟账户" : account.mode === "real" ? "实盘账户" : "竞赛账户"} · {account.login}</h2><span title={account.server}>{account.server} · {account.currency}</span></div>
      {account.mode === "real" && <div className="mt4-error">本页交易会向真实账户发送订单。</div>}
      <div className="mt4-account-controls"><div className="mt4-account-status"><span title="最近收到终端数据的本机时间；报价时间单独显示">终端更新 {formatTime(state?.lastSeen ?? 0)}</span><span className={state?.enabled ? "up" : ""}>{state?.enabled ? "交易已开启" : "交易已暂停"}</span></div>
      {state?.enabled ? <button className="ghost-button" disabled={busy} onClick={() => void act({ action: "pause" }, "交易已暂停；已发送指令仍需核对 MT4 回报")}>暂停交易</button> : <div className="mt4-enable">
        <label title="填写当前 MT4 账号以确认交易对象">核对账号<input value={accountConfirmation} onChange={e => setAccountConfirmation(e.target.value)} autoComplete="off" inputMode="numeric" aria-label="核对账号，填写当前 MT4 账号" /></label>
        {account.mode === "real" && <label className="mt4-check"><input type="checkbox" checked={acceptReal} onChange={e => setAcceptReal(e.target.checked)} />确认开启真实账户交易</label>}
        <button className="primary-button" disabled={!connected || busy || !!state?.unresolved || accountConfirmation !== account.login || !account.tradeAllowed || (account.mode === "real" && (!acceptReal || !account.allowReal)) || account.mode === "contest"} onClick={() => void act({ action: "enable", accountKey: state?.accountKey, confirmation: accountConfirmation, acceptReal }, "MT4 交易已开启")}>开启{account.mode === "real" ? "实盘" : "模拟"}交易</button>
      </div>}
      </div>
      {!account.tradeAllowed && <div className="mt4-error">MT4 未允许交易，请检查自动交易开关与 EA 交易权限。</div>}
      {account.mode === "real" && !account.allowReal && <div className="mt4-error">请先在 MT4 的 EA 输入参数中将 InpAllowReal 设为 true，再在本页确认开启。</div>}
      {account.mode === "contest" && <div className="mt4-error">当前版本仅支持模拟和实盘账户，竞赛账户可查看数据。</div>}
    </section>}
    {(snapshot || historical) && <>
      <div className="mt4-trading-grid"><section id="mt4-chart-workspace" className="mt4-card mt4-chart-card" aria-label="MT4 行情图表">
        {review && <div className="mt4-archive-review" role="status"><strong>{review.evidence ? review.evidence.source === 'observed' ? '当时证据 · 只读' : '导入时证据 · 只读' : '交易回看'}</strong><span>{review.account.login} · {review.account.server} · {review.trade.symbol} · #{review.trade.order.ticket}</span><time>{new Date(review.focus).toLocaleString('zh-CN', { timeZone: 'UTC', hour12: false })} · MT4 时间</time><button className="ghost-button" disabled={chartFetch || !!review.evidence} onClick={() => void fetchReviewChart()}>补取行情</button>{review.evidence && <button className="ghost-button" onClick={() => setReview(current => current ? { ...current, focus: current.returnFocus ?? current.trade.order.openTime * 1000, evidence: undefined } : current)}>返回复盘</button>}<button className="ghost-button" onClick={() => { setReview(null); setHistoryChart(null); setHistoryData(null); setOrderPriceSelection(null); }}>返回实时</button></div>}
        {historyChart && !review && <div className="mt4-archive-review" role="status"><strong>历史筛选</strong><span>{historyChart.account.login} · {historyChart.account.server} · {historyChart.symbol}</span><span>{historyChart.filter.from || '最早'} — {historyChart.filter.to || '最新'}</span><button className="ghost-button" onClick={() => { setHistoryChart(null); setHistoryData(null); }}>返回实时</button></div>}
        {historyError && <div className="mt4-error" role="alert">{historyError}<button className="ghost-button" onClick={() => setArchiveRefresh(n => n+1)}>重试读取</button></div>}
        {historyRecords?.limited && <div className="mt4-analysis-notice">图表最多显示 2000 笔交易标记，请缩小时间范围；列表保留全部结果。</div>}
        {historyChart && historyData?.limited && <div className="mt4-analysis-notice">当前显示最近 5000 根已归档 K 线，请缩小时间范围查看更早行情。</div>}
        <div className="mt4-chart-controls"><Mt4SymbolPicker symbols={snapshot?.symbols ?? []} value={displaySymbol} disabled={historical || busy || !connected} onChange={next => select(next, state?.selection.timeframe ?? 5)} />
          <ChartTimeframePicker value={chartPeriods[displayTimeframe]} disabled={busy || !!review?.evidence || (!historical && !connected)} onChange={next => { if (review) void readReview(timeframeMinutes[next]).catch(e => setError(e instanceof Error ? e.message : '历史周期读取失败')); else if (historyChart) { setHistoryData(null); setHistoryChart({ ...historyChart, timeframe: timeframeMinutes[next] }); } else select(state?.selection.symbol ?? "", timeframeMinutes[next]); }} />
          <ChartIndicatorMenu settings={movingAverageSettings} onChange={next => saveIndicators(next, macdSettings)} macdSettings={macdSettings} onMacdChange={next => saveIndicators(movingAverageSettings, next)} open={indicatorMenuOpen} onOpenChange={setIndicatorMenuOpen} />
          <span tabIndex={0} title="K 线时间沿用 MT4 服务器时钟，成交量为 tick 数；最新一根尚未收盘" aria-label="MT4 服务器时间，成交量为 tick 数，最新一根尚未收盘">MT4 时间</span>
          {markerOrders.length > 0 && <span tabIndex={0} title="显示当前账户与图表品种的筛选交易；行情尚未归档时，点击列表中的开仓或平仓后补取行情" aria-label={`已定位 ${tradeMarkers.length} 笔筛选交易，共 ${markerOrders.length} 笔；未定位交易可从列表回看并补取行情`}>交易标记 {tradeMarkers.length} / {markerOrders.length}{tradeMarkers.length < markerOrders.length ? ' · 待补行情' : ''}</span>}
          {!historical && latestBar && <div className="mt4-ohlc" aria-label="最新 K 线价格">{[["开", latestBar.open], ["高", latestBar.high], ["低", latestBar.low], ["收", latestBar.close]].map(([label, value]) => <span key={label}>{label} <strong>{Number(value).toFixed(symbol?.digits ?? 5)}</strong></span>)}</div>}</div>
        {review && !review.evidence && review.trade.focusCovered === false && review.trade.bars.length > 0 && <div className="mt4-error">交易发生时段的行情尚不完整，请连接对应账户后补取行情。</div>}
        {indicatorError && <div className="mt4-error" role="alert">{indicatorError}</div>}
        <Mt4PersistentAnalysis onNotice={notify} key={displayKey} storageKey={analysisKey(displayAccount, displaySymbol, displayTimeframe)} readOnly={!!review?.evidence} context={{ accountKey: displayAccount, symbol: displaySymbol, timeframe: displayTimeframe, scope: displayScope }} seed={reviewSeed}
          focusTimestamp={review?.focus ?? (historyChart && markerOrders.length ? (markerOrders[0].closeTime || markerOrders[0].openTime) * 1000 : undefined)} tradeMarkers={tradeMarkers} onTradeSelect={review?.evidence ? undefined : onTradeSelect}
          bars={displayBars} symbol={displaySymbol} timeframe={chartPeriods[displayTimeframe]} digits={displayDigits} decisionOpen={decisionOpen} onOpenDecision={() => setDecisionOpen(true)}
          movingAverageSettings={movingAverageSettings} macdSettings={macdSettings}
          candleClock={{ serverTime: snapshot?.serverUtcOffset == null ? undefined : snapshot.capturedAt + snapshot.serverUtcOffset, receivedAt: state?.lastSeen ?? 0, connected: Boolean(!historical && connected && account?.connected && quoteFresh), timeframe: displayTimeframe }}
          orderPriceSelection={historical ? null : orderPriceSelection} onOrderPriceSelect={onOrderPriceSelect} onPlanProtectionChange={onPlanProtectionChange} orderPrices={historical ? { stopLoss: 0, takeProfit: 0, entry: 0 } : { stopLoss: Number(sl), takeProfit: Number(tp), entry: orderType === "market" ? 0 : Number(price) }} onCancelOrderPriceSelection={() => setOrderPriceSelection(null)}
          emptyMessage={historical ? '该时段行情尚未归档，请连接对应账户后补取行情' : chartReady ? "MT4 暂无该周期 K 线，请在 MT4 打开对应图表后重试" : "正在等待 MT4 返回所选图表"} />
      </section>{snapshot && !historical && <section className="mt4-card mt4-order-dock trade-dock" aria-label="MT4 下单">
        <div className="trade-stats" aria-label="MT4 账户指标">
          {[["账户余额", account?.balance], ["账户权益", account?.equity], ["已用保证金", account?.margin], ["可用保证金", account?.freeMargin]].map(([label,value]) => <span key={String(label)} title={`单位：${account?.currency ?? "账户币种"}`}>{label}<strong>{typeof value === "number" ? value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</strong></span>)}
          <span title="账户权益 ÷ 已用保证金；未占用保证金时不显示比例">保证金水平<strong>{account && account.margin > 0 ? `${(account.equity / account.margin * 100).toFixed(1)}%` : "—"}</strong></span>
          <span title={`MT4 账户当前浮动盈亏；单位 ${account?.currency ?? "账户币种"}`}>浮动盈亏<strong className={account && account.profit < 0 ? "down" : account && account.profit > 0 ? "up" : ""}>{account ? `${account.profit > 0 ? "+" : ""}${account.profit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</strong></span>
        </div>
        <OrderEntryActions
          quantity={<label title={sizingMode === "risk-percent" ? "按当前买入价格预估；卖出按对应报价计算，MT4 会在执行前重新计算" : `最小 ${symbol?.minLot ?? "—"} 手，步长 ${symbol?.lotStep ?? "—"}，最大 ${symbol?.maxLot ?? "—"} 手`}><span>{sizingMode === "risk-percent" ? "风险手数" : "手数"}</span><input type="number" min={symbol?.minLot} max={symbol?.maxLot} step={symbol?.lotStep} readOnly={sizingMode === "risk-percent"} value={sizingMode === "risk-percent" ? previewLots : lots} placeholder={sizingMode === "risk-percent" ? "先选止损" : undefined} onChange={e => setLots(e.target.value)} aria-label={sizingMode === "risk-percent" ? "预估买入手数" : `手数，最小 ${symbol?.minLot ?? "未知"}，步长 ${symbol?.lotStep ?? "未知"}`} /></label>}
          sell={{ label: "卖出开仓", mobileLabel: "卖出", disabled: !canTrade || !symbol?.tradeAllowed || Number(lots) <= 0 || (orderType !== "market" && Number(price) <= 0), onClick: () => openOrder("sell") }}
          buy={{ label: "买入开仓", mobileLabel: "买入", disabled: !canTrade || !symbol?.tradeAllowed || Number(lots) <= 0 || (orderType !== "market" && Number(price) <= 0), onClick: () => openOrder("buy") }}>
          <button type="button" className="flat-button" disabled={!connected || !account?.connected || !account.tradeAllowed || !state?.enabled || busy || !!state?.unresolved || !!pending || snapshot.orderCount > snapshot.orders.length || !snapshot.orders.some(o => o.type < 2)} title="立即平掉当前账户全部品种持仓（含手动及其他 EA）；挂单保留" onClick={openCloseAll}><CircleStop size={16} /><span className="desktop-order-label">全部平仓</span><span className="mobile-order-label">全平</span></button>
        </OrderEntryActions>
        <OrderEntryControls
          sizing={{ value: sizingMode, options: [{ value: "fixed", label: "固定手数" }, { value: "risk-percent", label: "按止损风险（余额%）", disabled: !advancedReady }], onChange: next => setSizingMode(next as typeof sizingMode) }}
          order={{ value: orderType, options: [{ value: "market", label: "市价 · 即时报价" }, { value: "limit", label: "限价单（Limit Order）" }, { value: "stop", label: "突破单（Stop Order）" }], onChange: next => { setOrderType(next as typeof orderType); if (next !== "market") setGapMode("off"); } }}
          gap={{ mode: gapMode, disabled: !advancedReady || orderType !== "market", title: "仅检查市价买入所在 K 线的开盘跳空；点击切换高开不买、低开不买、关闭", onChange: () => setGapMode(m => m === "off" ? "high" : m === "high" ? "low" : "off") }}
          riskField={sizingMode === "risk-percent" && <label title="按余额与止损距离计算，手数向下取整；不含滑点与费用，执行时由 MT4 复核">单笔风险（余额%）<input aria-label="单笔风险百分比" type="number" min={0.0001} max={100} step={0.1} value={riskPercent} onChange={e => setRiskPercent(e.target.value)} /></label>}
          thresholdField={gapMode !== "off" && <label>不买阈值<span className="opening-gap-threshold-control"><input aria-label="跳空不买阈值" type="number" min={0.0001} step={0.0001} value={gapThreshold} onChange={e => setGapThreshold(e.target.value)} /><select aria-label="跳空阈值单位" value={gapUnit} onChange={e => setGapUnit(e.target.value as typeof gapUnit)}><option value="percent">%</option><option value="price">价格</option></select></span></label>}
          entryField={orderType !== "market" && <label>触发价<span className="entry-trigger-control"><input type="number" min={0} value={price} step={symbol?.point} onChange={e => setPrice(e.target.value)} aria-label="委托价格，挂单时填写" /><button type="button" disabled={!chartBars.length} aria-label="在图表选择委托触发价" aria-pressed={orderPriceSelection === "entry-trigger"} className={orderPriceSelection === "entry-trigger" ? "active" : ""} title="点击 K 线图选择委托触发价" onClick={() => setOrderPriceSelection(current => current === "entry-trigger" ? null : "entry-trigger")}><MousePointer2 size={12} />图表</button></span></label>}
          stop={{ label: "止损", value: sl, selected: orderPriceSelection === "stop-loss", disabled: !chartBars.length, title: "点击 K 线图选择止损；下单设置中可手动填写", pickLabel: "在图表选择保护止损价", clearLabel: "清除保护止损价", onPick: () => setOrderPriceSelection(current => current === "stop-loss" ? null : "stop-loss"), onClear: () => setSl("") }}
          target={{ label: "止盈", value: tp, selected: orderPriceSelection === "take-profit", disabled: !chartBars.length, title: "点击 K 线图选择止盈；下单设置中可手动填写", pickLabel: "在图表选择保护止盈价", clearLabel: "清除保护止盈价", onPick: () => setOrderPriceSelection(current => current === "take-profit" ? null : "take-profit"), onClear: () => setTp("") }}
          extra={<div className="mt4-order-settings-control"><span>参数</span><details className="mt4-order-settings" onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.stopPropagation(); e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label="下单设置" title="手动填写保护价和允许滑点"><Settings2 size={13} />设置</summary><div className="mt4-order-settings-fields" role="group" aria-label="下单设置参数">
            <label title="以报价点计，MT4 按券商执行方式处理">允许滑点<input type="number" min={0} max={1000} step={1} value={slippage} onChange={e => setSlippage(e.target.value)} aria-label="允许滑点，单位为报价点" /></label>
            <label title="留空表示不设置止损">止损<input type="number" min={0} step={symbol?.point} value={sl} onChange={e => setSl(e.target.value)} aria-label="止损价格，留空表示不设置" /></label>
            <label title="留空表示不设置止盈">止盈<input type="number" min={0} step={symbol?.point} value={tp} onChange={e => setTp(e.target.value)} aria-label="止盈价格，留空表示不设置" /></label>
          </div></details></div>}
          info={`MT4 市价使用当前报价，挂单由券商触发；每次提交一笔。账户币种 ${account?.currency ?? "—"}，${symbol?.symbol ?? "—"} 最小 ${symbol?.minLot ?? "—"} 手，步长 ${symbol?.lotStep ?? "—"}；允许滑点 ${slippage} 报价点。`} />
        <div className="mt4-order-quote" aria-label="当前报价"><span>Bid <strong>{symbol?.bid.toFixed(symbol.digits) ?? "—"}</strong></span><span>Ask <strong>{symbol?.ask.toFixed(symbol.digits) ?? "—"}</strong></span><span title="点差以该品种的报价点计">点差 {symbol ? ((symbol.ask - symbol.bid) / symbol.point).toFixed(1) : "—"}</span><time>报价 {formatTime((symbol?.quoteTime ?? 0) * 1000)}</time></div>
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
        {protection && <div className="mt4-protection"><h3>订单 {protection.ticket} · 保护价</h3><div className="mt4-fields"><label title="留空会移除原止损">止损<input type="number" min={0} value={protectSl} onChange={e => setProtectSl(e.target.value)} aria-label="修改止损，留空会移除原止损" /></label><label title="留空会移除原止盈">止盈<input type="number" min={0} value={protectTp} onChange={e => setProtectTp(e.target.value)} aria-label="修改止盈，留空会移除原止盈" /></label></div>
          <div className="mt4-actions"><button className="primary-button" disabled={!connected || !state?.enabled || busy || !!state?.unresolved || !!pending} onClick={() => orderAction(protection, "protect")}>确认修改</button><button className="ghost-button" onClick={() => setProtection(null)}>关闭</button></div></div>}
        </>}
        <Mt4ArchiveHistory onNotice={notify} activeAccountKey={state?.accountKey ?? ''} refreshAt={Math.floor((state?.lastSeen ?? 0) / 2000) + archiveRefresh} archiveStatus={state?.archive} selected={review?.trade} chartSymbol={displaySymbol} onFiltersChange={onHistoryFilters} onRecords={onHistoryRecords} chartSelection={chartSelection} onSelect={onHistorySelect} />
      </section>
    {(pending || !!state?.commands.length) && <section className="mt4-card"><h2>执行回报</h2>
      {pending && <div className="mt4-error">提交结果尚未确认。核对会使用同一指令标识，避免重复下单。<button className="ghost-button" disabled={busy} onClick={() => void submit(pending)}>核对提交结果</button></div>}
      <div className="mt4-command-list">{state?.commands.map(c => <div key={c.id} className="mt4-command"><div><strong>{commandTypes[c.type]} · {c.symbol}</strong><span>{c.login} · {formatTime(c.createdAt)}{c.ticket ? ` · #${c.ticket}` : ""}</span></div><span className={c.status === "failed" || c.status === "unknown" ? "down" : ""}>{commandLabels[c.status]}</span>{c.error && <p>{c.error}</p>}
        {c.status === "unknown" && <button className="ghost-button" disabled={busy} onClick={() => {
          const login = window.prompt(`请在 MT4 核对账号 ${c.login} 的持仓、挂单和历史记录。确认后输入该账号；此操作只结束待核对状态，不会撤销或再次发送订单。`);
          if (login) void act({ action: "resolve", id: c.id, confirmation: login });
        }}>已在 MT4 核对</button>}</div>)}</div>
    </section>}
  </section>;
}
