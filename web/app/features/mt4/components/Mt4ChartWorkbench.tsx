"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { KLineData } from "klinecharts";
import { DecisionDetails, DecisionHistory, DecisionTradeSummary } from "../../../components/DecisionReview";
import { decisionChartView, draftAfterDecisionSaved, type DecisionRecord } from "../../../lib/decisionWorkflow";
import { timeframeMinutes } from "../../../lib/timeframeCatalog";
import { requestMt4Archive } from "../mt4Gateway";
import type { ArchiveTrade, ArchiveContext, ArchiveDecisionPlan, DecisionPlanSource } from "../mt4ArchiveContracts";
import type { Mt4Order } from "../mt4Contracts";
import type { Mt4OrderProtectionLine } from '../mt4Protection.mjs';
import { decisionRecord, decisionValue, mt4Draft, mt4PlanViews, ensureProtectiveAnalysis, applyEntryReceipt, linkDecisionTrade, type Mt4EntryReceipt } from "../mt4Analysis";
import { DecisionPlanCard } from "../../../components/DecisionPlanCard";
import { ChartDrawingRail } from "../../../components/ChartDrawingRail";
import { ChartDrawingTextEditor } from "../../../components/ChartDrawingTextEditor";
import { DrawingObjectPanel } from "../../../components/DrawingObjectPanel";
import { DrawingPropertyBar } from "../../../components/DrawingPropertyBar";
import { allDrawingTools, defaultDrawingTools, trainingPositionTool, type DrawingTool } from "../../../components/chartDrawingTools";
import { useKeyboardShortcuts } from "../../../components/useKeyboardShortcuts";
import type { ShortcutAction, ShortcutSettings } from "../../../lib/keyboardShortcuts";
import { KLineReplayChart, type DrawingRequest, type PersistedDrawing, type PriceSelectionMode, type ProtectionLine, type TradeMarker } from "../../../components/KLineReplayChart";
import type { MacdSettings, MovingAverageSettings } from "../../../lib/chartIndicators";
import type { Mt4CandleClock } from "../../../lib/mt4ChartWindow.mjs";
import { mt4CandleCountdown } from "../../../lib/mt4CandleCountdown.mjs";
import { mt4PeriodEnd } from '../../../lib/mt4History.mjs';
import { addReasonTag, applyAnalysisDrawings, deleteDecisionRecord, editDecisionRecord, emptyAnalysis, readAnalysis, recordDecision, removeReasonTag, renameReasonTag, type Mt4Analysis, type Mt4Decision, type Mt4DecisionDraft } from "../mt4Analysis";

const noop = () => {};
const decisionDate = (timestamp: number) => new Date(timestamp).toLocaleString("zh-CN", { timeZone: "UTC", hour12: false }) + " · MT4 时间";

function load(key: string) {
  let raw: string | null = null;
  try { raw = typeof window === "undefined" ? null : window.localStorage.getItem(key); return { data: readAnalysis(raw), error: "", raw }; }
  catch { return { data: emptyAnalysis(), error: "已有绘图与决策记录无法读取。请先导出原记录，再保存新内容。", raw }; }
}

export function Mt4ChartWorkbench({ syncOrderPrices = true, accountKey, relatedOrders = [], onRelatedTradeSelect, onAnalysisChange, entryReceipt, sharedReasonTags, onReasonTagsChange, storageKey, initialAnalysis, persistedAnalysis, onPersist, onNotice, readOnly = false, showChartMarkers = true, planContext, archivedPlans = [], onOpenPlanSource, editingPlanId, liveOrderLines = [], onLiveOrderLineMove, tradeMarkers = [], onTradeSelect, focusTimestamp, onHistoryRange, bars, symbol, timeframe, digits, decisionOpen, emptyMessage, onOpenDecision, orderPriceSelection, orderPriceSelectionLabel, onOrderPriceSelect, onPlanProtectionChange, orderPrices, onCancelOrderPriceSelection, candleClock, movingAverageSettings, macdSettings, keyboardShortcuts, shortcutsEnabled = true }: {
  syncOrderPrices?: boolean; accountKey: string; relatedOrders?: Mt4Order[]; onRelatedTradeSelect?: (order: Mt4Order, event: 'entry' | 'exit') => void;
  onAnalysisChange?: (key: string, value: Mt4Analysis | null) => void; entryReceipt?: Mt4EntryReceipt;
  sharedReasonTags?: string[]; onReasonTagsChange?: (tags: string[]) => void;
  keyboardShortcuts?: ShortcutSettings; shortcutsEnabled?: boolean;
  onNotice?: (message: string) => void;
  showChartMarkers?: boolean; planContext?: Pick<ArchiveContext, 'timeframe' | 'scope'>; archivedPlans?: ArchiveDecisionPlan[];
  onOpenPlanSource?: (source: DecisionPlanSource) => void; editingPlanId?: string;
  liveOrderLines?: Mt4OrderProtectionLine[]; onLiveOrderLineMove?: (line: Mt4OrderProtectionLine, price: number) => boolean;
  initialAnalysis?: Mt4Analysis; persistedAnalysis?: Mt4Analysis | null; onPersist?: (next: Mt4Analysis) => void; readOnly?: boolean; tradeMarkers?: TradeMarker[]; onTradeSelect?: (id: string, event: "entry" | "exit") => void; focusTimestamp?: number;
  onHistoryRange?: (range: { before: boolean; after: boolean }) => void;
  storageKey: string; bars: KLineData[]; symbol: string; timeframe: string; digits: number; decisionOpen: boolean; emptyMessage: string; onOpenDecision: () => void;
  orderPriceSelectionLabel?: string; orderPriceSelection: PriceSelectionMode | null; onOrderPriceSelect: (kind: PriceSelectionMode, price: number) => void;
  onPlanProtectionChange: (changes: { stopLoss?: string; takeProfit?: string }) => void; orderPrices: { stopLoss: number; takeProfit: number; entry: number };
  onCancelOrderPriceSelection: () => void;
  candleClock?: Mt4CandleClock;
  movingAverageSettings: MovingAverageSettings; macdSettings: MacdSettings;
}) {
  const [initial] = useState(() => initialAnalysis ? { data: initialAnalysis, error: '', raw: null } : load(storageKey));
  const [analysis, setAnalysis] = useState(initial.data);
  const current = useRef(analysis);
  const unreadable = useRef(Boolean(initial.error && initial.raw));
  const [needsExport, setNeedsExport] = useState(Boolean(initial.error && initial.raw));
  const [error, setError] = useState(initial.error);
  const [drawingRequest, setDrawingRequest] = useState<DrawingRequest>(null);
  const nonce = useRef(0);
  const [restoreNonce, setRestoreNonce] = useState(0);
  const [clearNonce, setClearNonce] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [undo, setUndo] = useState<PersistedDrawing[][]>([]);
  const [redo, setRedo] = useState<PersistedDrawing[][]>([]);
  const [textOpen, setTextOpen] = useState(false);
  const [text, setText] = useState("");
  const [drawingGroupOpen, setDrawingGroupOpen] = useState("");
  const [groupDrawingTools, setGroupDrawingTools] = useState(defaultDrawingTools);
  const [drawingMagnetMode, setDrawingMagnetMode] = useState<"normal" | "weak_magnet" | "strong_magnet">("normal");
  const [drawingObjectsOpen, setDrawingObjectsOpen] = useState(false);
  const [customReason, setCustomReason] = useState("");
  const [tagMode, setTagMode] = useState<"" | "edit" | "delete">("");
  const [editingTag, setEditingTag] = useState("");
  const [editingTagValue, setEditingTagValue] = useState("");
  const [selectedDecisionId, setSelectedDecisionId] = useState("");
  const store = useCallback((next: Mt4Analysis, atomic = false) => {
    if (readOnly) return false;
    if (unreadable.current) { setError("原记录暂时无法读取，请先导出原记录。当前编辑内容仍保留在页面中。"); if (!atomic) { current.current = next; setAnalysis(next); } return false; }
    try { if (onPersist) onPersist(next); else window.localStorage.setItem(storageKey, JSON.stringify(next)); setError(""); }
    catch { setError("本机保存未完成，当前内容仍在页面中。请释放浏览器存储空间后重试保存。"); if (atomic) return false; }
    current.current = next; setAnalysis(next); return true;
  }, [readOnly, onPersist, storageKey]);

  const pendingDecisionSave = useRef<{ id: string; record: string; draft: Mt4DecisionDraft; editor: string; returnDraft: Mt4DecisionDraft } | null>(null);
  const finishDecisionSave = useCallback((persisted: Mt4Analysis) => {
    const pendingSave = pendingDecisionSave.current;
    if (!pendingSave || JSON.stringify(persisted.decisions.find(item => item.id === pendingSave.id)) !== pendingSave.record) return;
    pendingDecisionSave.current = null;
    const previous = current.current;
    if (JSON.stringify(previous.editor ?? null) !== pendingSave.editor) return;
    const currentValue = decisionValue(previous.draft);
    const draft = draftAfterDecisionSaved(currentValue, decisionValue(pendingSave.draft), decisionValue(pendingSave.returnDraft));
    if (draft === currentValue) return;
    const next = { ...previous, draft: mt4Draft(draft) };
    delete next.editor;
    if (store(next, true) && previous.editor) onPlanProtectionChange({ stopLoss: next.draft.stopLoss, takeProfit: next.draft.takeProfit });
  }, [store, onPlanProtectionChange]);
  useEffect(() => { if (persistedAnalysis) finishDecisionSave(persistedAnalysis); }, [persistedAnalysis, finishDecisionSave]);

  const [decisionFocus, setDecisionFocus] = useState<{ timestamp: number; nonce: number } | null>(null);
  const [backfillAssociation, setBackfillAssociation] = useState(true);
  const visibleOrders = relatedOrders.filter(order => order.symbol === symbol && order.type <= 1);

  const [archivedLinkedOrders, setArchivedLinkedOrders] = useState<Mt4Order[]>([]);
  const [linkedRead, setLinkedRead] = useState({ loading: false, error: '', nonce: 0 });
  const visibleOrdersRef = useRef(visibleOrders);
  useEffect(() => { visibleOrdersRef.current = visibleOrders; }, [visibleOrders]);
  const selectedLinks = analysis.tradeLinks?.filter(link => link.decisionId === selectedDecisionId && link.accountKey === accountKey && link.symbol === symbol) ?? [];
  const selectedLinkSignature = JSON.stringify(selectedLinks);
  useEffect(() => {
    const links = JSON.parse(selectedLinkSignature) as NonNullable<Mt4Analysis['tradeLinks']>;
    const controller = new AbortController();
    const missing = links.filter(link => !visibleOrdersRef.current.some(order => order.ticket === link.ticket && order.openTime === link.openTime));
    if (!missing.length) { setLinkedRead(previous => previous.loading || previous.error ? { ...previous, loading: false, error: "" } : previous); return; }
    setLinkedRead(previous => ({ ...previous, loading: true, error: '' }));
    void (async () => {
      try {
        for (let index = 0; index < missing.length; index += 4) {
          const result = await Promise.all(missing.slice(index, index + 4).map(async link => {
            const trade = await requestMt4Archive<ArchiveTrade>({ action: 'trade', accountKey, symbol, ticket: link.ticket, timeframe: Number(timeframeMinutes(timeframe)), focus: link.openTime * 1000 }, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
            if (trade.accountKey !== accountKey || trade.order.symbol !== symbol || trade.order.ticket !== link.ticket || trade.order.openTime !== link.openTime) throw new Error('关联交易身份不匹配，请重新读取档案。');
            return trade.order;
          }));
          if (controller.signal.aborted) return;
          setArchivedLinkedOrders(previous => [...new Map([...previous, ...result].map(order => [order.ticket + ':' + order.openTime, order])).values()]);
        }
        setLinkedRead(previous => ({ ...previous, loading: false, error: '' }));
      } catch (error) {
        if (!controller.signal.aborted) setLinkedRead(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : '关联交易未能读取，计划内容已保留。' }));
      }
    })();
    return () => controller.abort();
  }, [selectedLinkSignature, linkedRead.nonce, accountKey, symbol, timeframe]);

  useEffect(() => { onAnalysisChange?.(storageKey, analysis); }, [storageKey, analysis, onAnalysisChange]);
  useEffect(() => () => onAnalysisChange?.(storageKey, null), [storageKey, onAnalysisChange]);
  useEffect(() => {
    if (!entryReceipt || entryReceipt.accountKey !== accountKey || entryReceipt.symbol !== symbol || entryReceipt.timeframe !== Number(timeframeMinutes(timeframe))) return;
    const next = applyEntryReceipt(current.current, entryReceipt);
    if (next !== current.current) store(next);
  }, [entryReceipt, accountKey, symbol, timeframe, store]);
  const locateDecision = (record: DecisionRecord) => {
    setSelectedDecisionId(record.id);
    const marker = decisionChartView([record], bars, { periodEnd: planPeriodEnd }).markers[0];
    if (!marker) { setError('这份决策的行情不在当前窗口，请在历史档案补取对应时段行情。'); return; }
    setDecisionFocus({ timestamp: marker.timestamp, nonce: ++nonce.current });
  };
  const deleteSavedDecision = (record: Mt4Decision) => {
    if (!window.confirm('确定删除这份决策吗？它会从图表标记与决策记录中移除，历史修订仍会保留。')) return;
    const next = deleteDecisionRecord(current.current, record.id);
    if (next.editor?.decisionId === record.id) { next.draft = next.editor.originalDraft; delete next.editor; }
    if (store(next, true)) setSelectedDecisionId('');
  };
  const linkedTradeSummary = (record: DecisionRecord) => {
    const links = analysis.tradeLinks?.filter(link => link.decisionId === record.id && link.accountKey === accountKey && link.symbol === symbol) ?? [];
    const orders = [...new Map([...archivedLinkedOrders, ...visibleOrders].map(order => [order.ticket + ":" + order.openTime, order])).values()].filter(order => links.some(link => link.ticket === order.ticket && link.openTime === order.openTime));
    return <DecisionTradeSummary compact totalCount={links.length} loading={record.id === selectedDecisionId && linkedRead.loading} error={record.id === selectedDecisionId ? linkedRead.error : undefined} onRetry={() => { setSelectedDecisionId(record.id); setLinkedRead(previous => ({ ...previous, nonce: previous.nonce + 1 })); }} trades={orders.map(order => ({
      id: String(order.ticket), label: '交易 #' + order.ticket, side: order.type === 0 ? 'long' : 'short', quantity: order.lots + ' 手',
      result: order.closeTime ? (order.profit + order.swap + order.commission).toFixed(2) : '持仓中',
      tone: order.closeTime ? order.profit + order.swap + order.commission >= 0 ? 'up' : 'down' : undefined,
      entryTime: decisionDate(order.openTime * 1000), entryPrice: order.openPrice.toFixed(digits),
      exitTime: order.closeTime ? decisionDate(order.closeTime * 1000) : undefined, exitPrice: order.closeTime ? order.closePrice.toFixed(digits) : undefined,
    }))} onEvidence={(id, event) => { const order = orders.find(item => String(item.ticket) === id); if (order) onRelatedTradeSelect?.(order, event); }} />;
  };
  const [priceMode, setPriceMode] = useState<PriceSelectionMode | null>(null);
  const last = bars.at(-1);
  const openTime = last?.timestamp ?? 0;
  const [countdown, setCountdown] = useState<string | null>(null);
  const clockInput = useRef(candleClock ? { openTime, ...candleClock } : null);
  useEffect(() => { clockInput.current = candleClock ? { openTime, ...candleClock } : null; }, [openTime, candleClock]);
  useEffect(() => {
    // Poll the clock cheaply; React only redraws when the displayed second changes.
    const timer = setInterval(() => setCountdown(clockInput.current ? mt4CandleCountdown({ ...clockInput.current, now: Date.now(), monotonicNow: performance.now() }) : null), 100);
    return () => clearInterval(timer);
  }, []);
  const planViews = mt4PlanViews(analysis, planContext ?? { timeframe: Number(timeframeMinutes(timeframe)) || 43200 }, archivedPlans);
  const selectedPlan = planViews.find(view => view.record.id === selectedDecisionId);
  const planPeriodEnd = (timestamp: number) => mt4PeriodEnd(timestamp, Number(timeframeMinutes(timeframe)) || 43200);
  const planChart = decisionChartView(planViews.map(view => view.record), bars, { selectedId: analysis.editor ? '' : selectedDecisionId, visible: showChartMarkers, periodEnd: planPeriodEnd });
  const orderPricesInitialized = useRef(false);
  const lastOrderProtection = useRef({ stopLoss: orderPrices.stopLoss, takeProfit: orderPrices.takeProfit });
  useEffect(() => {
    if (!syncOrderPrices || current.current.editor) return;
    if (!orderPricesInitialized.current) {
      orderPricesInitialized.current = true;
      lastOrderProtection.current = { stopLoss: Number(current.current.draft.stopLoss) || 0, takeProfit: Number(current.current.draft.takeProfit) || 0 };
      onPlanProtectionChange({ stopLoss: current.current.draft.stopLoss, takeProfit: current.current.draft.takeProfit });
      return;
    }
    if (lastOrderProtection.current.stopLoss === orderPrices.stopLoss && lastOrderProtection.current.takeProfit === orderPrices.takeProfit) return;
    lastOrderProtection.current = { stopLoss: orderPrices.stopLoss, takeProfit: orderPrices.takeProfit };
    const draft = current.current.draft;
    if (Number(draft.stopLoss) !== orderPrices.stopLoss || Number(draft.takeProfit) !== orderPrices.takeProfit) {
      store({ ...current.current, draft: { ...draft, stopLoss: orderPrices.stopLoss > 0 ? orderPrices.stopLoss.toFixed(digits) : '', takeProfit: orderPrices.takeProfit > 0 ? orderPrices.takeProfit.toFixed(digits) : '' } });
    }
  }, [orderPrices.stopLoss, orderPrices.takeProfit, digits, onPlanProtectionChange, syncOrderPrices, store]);
  const reasonTagsInitialized = useRef(false);
  useEffect(() => {
    if (!sharedReasonTags) return;
    if (!reasonTagsInitialized.current) {
      reasonTagsInitialized.current = true;
      const merged = [...new Set([...sharedReasonTags, ...current.current.reasonTags])].slice(-30);
      if (JSON.stringify(merged) !== JSON.stringify(sharedReasonTags)) { onReasonTagsChange?.(merged); return; }
    }
    if (JSON.stringify(sharedReasonTags) !== JSON.stringify(current.current.reasonTags)) store({ ...current.current, reasonTags: [...sharedReasonTags] });
  }, [sharedReasonTags, onReasonTagsChange, store]);


  const withProtectiveDecision = (next: Mt4Analysis) => next.editor || !last ? next : ensureProtectiveAnalysis(next, { id: crypto.randomUUID(), recordedAt: Date.now(), candleTimestamp: last.timestamp, referencePrice: last.close });
  const updateDraft = (changes: Partial<Mt4DecisionDraft>, recordProtection = false) => {
    const next = { ...current.current, draft: { ...current.current.draft, ...changes } };
    store(recordProtection ? withProtectiveDecision(next) : next);
    if (!current.current.editor && (changes.stopLoss != null || changes.takeProfit != null)) onPlanProtectionChange(changes);
  };
  const changeDrawings = (next: PersistedDrawing[]) => {
    if (JSON.stringify(next) === JSON.stringify(current.current.drawings)) return;
    const previous = current.current.drawings;
    setUndo(history => [...history, previous].slice(-60)); setRedo([]);
    const updated = applyAnalysisDrawings(current.current, next, digits), protectionChanged = updated.draft !== current.current.draft;
    store(protectionChanged ? withProtectiveDecision(updated) : updated);
    if (!updated.editor && protectionChanged) onPlanProtectionChange({ stopLoss: updated.draft.stopLoss, takeProfit: updated.draft.takeProfit });
  };
  const startDrawing = (name: string, label: string, annotation?: string) => {
    onCancelOrderPriceSelection();
    const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    setPriceMode(null); setSelectedId(""); setTextOpen(false); setDrawingGroupOpen("");
    setDrawingRequest({ name, nonce: ++nonce.current, mode: drawingMagnetMode,
      styles: { line: { color, size: 2, style: "solid" }, rect: { color: `${color}24`, borderColor: color, borderSize: 2 }, text: { color, size: 18 } },
      extendData: { toolLabel: label, toolKind: name === "trainingTextBox" ? "text" : name === "trainingRectangle" ? "rectangle" : name === "trainingPosition" ? "position" : "drawing", ...(annotation ? { text: annotation } : {}) } });
  };
  const beginSharedDrawing = (tool: DrawingTool) => {
    if (tool.kind === "text") { onCancelOrderPriceSelection(); setDrawingRequest(null); setPriceMode(null); setTextOpen(true); setDrawingGroupOpen(""); }
    else startDrawing(tool.name, tool.label);
  };
  const restore = (next: PersistedDrawing[]) => {
    const updated = applyAnalysisDrawings(current.current, next, digits), protectionChanged = updated.draft !== current.current.draft;
    setDrawingRequest(null); setSelectedId(""); store(protectionChanged ? withProtectiveDecision(updated) : updated); setRestoreNonce(n => n + 1);
    if (!updated.editor && protectionChanged) onPlanProtectionChange({ stopLoss: updated.draft.stopLoss, takeProfit: updated.draft.takeProfit });
  };
  const updateDrawing = (id: string, changes: Partial<PersistedDrawing>) => {
    changeDrawings(current.current.drawings.map(d => d.id === id ? { ...d, ...changes } : d)); setRestoreNonce(n => n + 1);
  };
  const removeDrawing = (id: string) => { changeDrawings(current.current.drawings.filter(d => d.id !== id)); setSelectedId(""); setRestoreNonce(n => n + 1); };
  const selectedDrawing = analysis.drawings.find(d => d.id === selectedId);
  const selectedStyles = (selectedDrawing?.styles ?? {}) as { line?: { color?: string; size?: number }; text?: { color?: string; size?: number }; rect?: Record<string, unknown> };
  const selectedText = String((selectedDrawing?.extendData as { text?: string } | undefined)?.text ?? "");
  const selectedColor = selectedStyles.text?.color ?? selectedStyles.line?.color ?? "#20c997";
  const selectedWidth = selectedStyles.line?.size ?? 2;
  const selectedTextSize = selectedStyles.text?.size ?? 18;
  const changeVisual = (color: string, width: number) => { if (selectedDrawing) updateDrawing(selectedDrawing.id, { styles: { ...selectedStyles,
    line: { ...selectedStyles.line, color, size: width }, text: { ...selectedStyles.text, color }, rect: { ...selectedStyles.rect, color: `${color}24`, borderColor: color, borderSize: width } } }); };
  const cancelEditor = () => {
    const previous = current.current.editor;
    if (previous) { const next = { ...current.current, draft: previous.originalDraft }; delete next.editor; store(next); onPlanProtectionChange({ stopLoss: next.draft.stopLoss, takeProfit: next.draft.takeProfit }); }
  };
  const beginEditor = useCallback((target: { timestamp: number; referencePrice: number }, record?: Mt4Decision) => {
    const previous = current.current;
    store({ ...previous, draft: record ? structuredClone(record.draft) : emptyAnalysis().draft,
      editor: { ...(record ? { decisionId: record.id } : {}), candleTimestamp: target.timestamp, referencePrice: target.referencePrice, originalDraft: previous.editor?.originalDraft ?? structuredClone(previous.draft) } });
    setPriceMode(null); setDrawingRequest(null); setSelectedDecisionId(record?.id ?? ""); setBackfillAssociation(true);
    onOpenDecision();
  }, [store, onOpenDecision]);
  const startedPlanEdit = useRef('');
  useEffect(() => {
    if (!editingPlanId || readOnly || startedPlanEdit.current === editingPlanId) return;
    const record = analysis.decisions.find(record => record.id === editingPlanId);
    if (record) { startedPlanEdit.current = editingPlanId; beginEditor({ timestamp: record.candleTimestamp, referencePrice: record.referencePrice }, record); }
  }, [editingPlanId, readOnly, analysis.decisions, beginEditor]);
  const tagAction = (action: () => Mt4Analysis) => {
    try { const next = action(); if (store(next, true)) { onReasonTagsChange?.(next.reasonTags); setEditingTag(""); setEditingTagValue(""); setCustomReason(""); } }
    catch (e) { setError(e instanceof Error ? e.message : "标签未保存，请重试。"); }
  };
  const saveDecision = (recordedAt: number) => {
    try {
      const editor = current.current.editor;
      const next = editor?.decisionId ? editDecisionRecord(current.current, editor.decisionId, current.current.draft, recordedAt)
        : recordDecision(current.current, { id: pendingDecisionSave.current?.editor === JSON.stringify(editor ?? null) ? pendingDecisionSave.current.id : crypto.randomUUID(), recordedAt, candleTimestamp: editor?.candleTimestamp ?? last?.timestamp ?? 0, referencePrice: editor?.referencePrice ?? last?.close ?? 0, ...(editor ? { backfilled: true } : {}) });
      if (editor && !editor.decisionId && backfillAssociation) {
        const decisionId = next.decisions[0].id;
        const nextPlan = current.current.decisions.filter(item => item.candleTimestamp > editor.candleTimestamp).sort((a,b) => a.candleTimestamp - b.candleTimestamp)[0];
        for (const order of visibleOrders.filter(order => order.openTime * 1000 >= editor.candleTimestamp && (!nextPlan || order.openTime * 1000 < nextPlan.candleTimestamp) && !current.current.tradeLinks?.some(link => link.accountKey === accountKey && link.symbol === symbol && link.ticket === order.ticket && link.openTime === order.openTime))) {
          const linked = linkDecisionTrade(next, decisionId, { accountKey, symbol, ticket: order.ticket, openTime: order.openTime }); next.tradeLinks = linked.tradeLinks;
        }
      }
      const savedId = editor?.decisionId ?? next.decisions[0]?.id;
      if (savedId) pendingDecisionSave.current = { id: savedId, record: JSON.stringify(next.decisions.find(item => item.id === savedId)), draft: structuredClone(current.current.draft), editor: JSON.stringify(editor ?? null), returnDraft: structuredClone(editor?.originalDraft ?? emptyAnalysis().draft) };
      if (store(next, true)) { setSelectedDecisionId(savedId ?? ""); if (!onPersist) { finishDecisionSave(next); onNotice?.(editor?.decisionId ? "决策已更新" : "决策已保存"); } }
    } catch (e) { setError(e instanceof Error ? e.message : "决策保存未完成，请保留当前内容并重试。"); }
  };
  const pickPrice = (kind: PriceSelectionMode, value: number) => {
    if (orderPriceSelection) { onOrderPriceSelect(orderPriceSelection, value); if (orderPriceSelection !== "entry-trigger" && !current.current.editor) updateDraft(orderPriceSelection === "stop-loss" ? { stopLoss: value.toFixed(digits) } : { takeProfit: value.toFixed(digits) }, true); return; }
    updateDraft(kind === "stop-loss" ? { stopLoss: value.toFixed(digits) } : { takeProfit: value.toFixed(digits) }, true); setPriceMode(null);
  };
  const protectionLines: ProtectionLine[] = last ? ([
    { kind: "stop-loss", value: analysis.draft.stopLoss, label: "计划止损" },
    { kind: "take-profit", value: analysis.draft.takeProfit, label: "计划目标" },
  ] as const).filter(p => Number(p.value) > 0).map(p => ({ id: `mt4-plan-${p.kind}`, kind: p.kind, price: Number(p.value), timestamp: last.timestamp, label: p.label, movable: !readOnly, source: "draft" })) : [];
  if (last) for (const item of [{ kind: "stop-loss", price: orderPrices.stopLoss, label: "委托止损" }, { kind: "take-profit", price: orderPrices.takeProfit, label: "委托止盈" }, { kind: "entry-trigger", price: orderPrices.entry, label: "委托触发价" }] as const) {
    if (item.price > 0 && !protectionLines.some(p => p.kind === item.kind && Math.abs(p.price - item.price) < 10 ** -digits / 2)) protectionLines.push({ id: `mt4-order-${item.kind}`, kind: item.kind, price: item.price, timestamp: last.timestamp, label: item.label, movable: true, source: "draft" });
  }
  protectionLines.push(...planChart.protectionLines);
  if (!readOnly) protectionLines.push(...liveOrderLines);

  const shortcutCursor = () => { onCancelOrderPriceSelection(); setDrawingRequest(null); setTextOpen(false); setPriceMode(null); setSelectedId(""); setDrawingGroupOpen(""); };
  const undoDrawing = () => { const previous = undo.at(-1); const present = current.current.drawings; if (previous) { setRedo(history => [...history, present]); setUndo(history => history.slice(0, -1)); restore(previous); } };
  const redoDrawing = () => { const next = redo.at(-1); const present = current.current.drawings; if (next) { setUndo(history => [...history, present]); setRedo(history => history.slice(0, -1)); restore(next); } };
  const drawingShortcuts: Partial<Record<ShortcutAction, { enabled: boolean; run: () => void }>> = {
    drawingTrend: { enabled: bars.length > 0, run: () => beginSharedDrawing(allDrawingTools.find(tool => tool.name === "segment")!) },
    drawingPosition: { enabled: bars.length > 0, run: () => beginSharedDrawing(trainingPositionTool) },
    drawingCursor: { enabled: true, run: shortcutCursor },
    drawingUndo: { enabled: undo.length > 0, run: undoDrawing },
    drawingRedo: { enabled: redo.length > 0, run: redoDrawing },
  };
  useKeyboardShortcuts({ settings: keyboardShortcuts, enabled: shortcutsEnabled && !readOnly, contextKey: storageKey,
    isAvailable: action => Boolean(drawingShortcuts[action]?.enabled),
    onAction: action => { const handler = drawingShortcuts[action]; if (!handler?.enabled) return false; handler.run(); return true; },
  });

  return <fieldset className="mt4-analysis-fieldset"><div className={`mt4-analysis-layout ${decisionOpen ? "with-decision" : ""}`}>
    <div className="mt4-drawing-stage">
      <ChartDrawingRail className="drawing-rail mt4-drawing-rail" disabled={!bars.length}
        cursorActive={!drawingRequest && !priceMode && !orderPriceSelection && !textOpen}
        onCursor={shortcutCursor}
        activeTool={drawingRequest?.name} groupTools={groupDrawingTools} openGroup={drawingGroupOpen} onOpenGroup={setDrawingGroupOpen}
        onSelectTool={beginSharedDrawing} onGroupTool={(group, tool) => setGroupDrawingTools(current => ({ ...current, [group]: tool }))}
        magnetMode={drawingMagnetMode} onMagnetMode={setDrawingMagnetMode} canUndo={!!undo.length} canRedo={!!redo.length}
        onUndo={undoDrawing}
        onRedo={redoDrawing}
        objectsOpen={drawingObjectsOpen} onObjects={() => setDrawingObjectsOpen(open => !open)}
        onClear={() => { changeDrawings([]); setDrawingRequest(null); setSelectedId(""); setRestoreNonce(n => n + 1); setClearNonce(n => n + 1); }} />
      {drawingObjectsOpen && <DrawingObjectPanel drawings={analysis.drawings} selectedId={selectedId} onSelect={setSelectedId} onUpdate={updateDrawing} onDelete={removeDrawing} onClose={() => setDrawingObjectsOpen(false)} />}
      {selectedDrawing && <DrawingPropertyBar drawing={selectedDrawing} text={selectedText} color={selectedColor} lineWidth={selectedWidth} textSize={selectedTextSize}
        textSizeOptions={[...new Set([12, 14, 16, 18, 20, 24, 28, 32, selectedTextSize])].sort((a,b)=>a-b)}
        onText={text => updateDrawing(selectedDrawing.id, { extendData: { ...(selectedDrawing.extendData as object), text } })}
        onColor={color => changeVisual(color, selectedWidth)} onWidth={width => changeVisual(selectedColor, width)}
        onTextSize={size => updateDrawing(selectedDrawing.id, { styles: { ...selectedStyles, text: { ...selectedStyles.text, size } } })}
        onLock={() => updateDrawing(selectedDrawing.id, { lock: !selectedDrawing.lock })} onVisible={() => updateDrawing(selectedDrawing.id, { visible: !selectedDrawing.visible })}
        onDelete={() => removeDrawing(selectedDrawing.id)} onClose={() => setSelectedId("")} />}
      <div className="mt4-chart">
        {countdown && <span className="live-sr-only" role="timer" aria-live="off" title="按 MT4 服务器时间计算最新一根 K 线的剩余时间">K 线剩余时间 {countdown}</span>}
        {bars.length ? <KLineReplayChart bars={bars} symbol={symbol} timeframe={timeframe} timezone="UTC" pricePrecision={digits} dataIndexOffset={0}
          keyboardShortcuts={keyboardShortcuts} shortcutsEnabled={shortcutsEnabled}
          movingAverageSettings={movingAverageSettings} macdSettings={macdSettings} drawingRequest={drawingRequest} clearNonce={clearNonce} drawings={readOnly ? analysis.drawings.map(d => ({ ...d, lock: true })) : analysis.drawings}
          selectedDrawingId={selectedId} drawingsRestoreNonce={restoreNonce} tradeMarkers={tradeMarkers} onTradeSelect={onTradeSelect} focusTimestamp={decisionFocus?.timestamp ?? focusTimestamp} focusNonce={decisionFocus?.nonce} decisionMarkers={planChart.markers}
          corporateActionMarkers={[]} protectionLines={protectionLines} priceSelectionMode={orderPriceSelection ?? priceMode} hideDate={false} hidePrice={false} enableCandleContextMenu
          latestCandleCountdown={countdown} liveUpdates onHistoryRange={onHistoryRange}
          onDecisionSelect={id => setSelectedDecisionId(id)}
          onCorporateActionSelect={noop} onProtectionPriceSelect={pickPrice} onProtectionLineMove={(line, price) => {
            if (readOnly) return false;
            if (orderPriceSelection || priceMode) return false;
            if (line.source === 'position' && 'accountKey' in line && 'order' in line) return onLiveOrderLineMove?.(line as Mt4OrderProtectionLine, price) ?? false;
            if (line.id.startsWith("mt4-order-")) onOrderPriceSelect(line.kind as PriceSelectionMode, price);
            else updateDraft(line.kind === "stop-loss" ? { stopLoss: price.toFixed(digits) } : { takeProfit: price.toFixed(digits) }, true);
            return true;
          }} onCandleContextMenu={readOnly ? noop : target => beginEditor(target)}
          onDrawingsChange={readOnly ? noop : changeDrawings} onDrawingSelect={readOnly ? noop : id => setSelectedId(id ?? "")} /> : <div className="mt4-empty">{emptyMessage}</div>}
        {showChartMarkers && selectedPlan && !analysis.editor && <DecisionDetails record={selectedPlan.record} dateLabel={decisionDate} priceLabel={value => value.toFixed(digits)}
          onClose={() => setSelectedDecisionId('')} onLocate={() => locateDecision(selectedPlan.record)}
          onEdit={readOnly ? undefined : () => { const original = analysis.decisions.find(record => record.id === selectedPlan.record.id); if (original) beginEditor({ timestamp: original.candleTimestamp, referencePrice: original.referencePrice }, original); else onOpenPlanSource?.(selectedPlan.source); }}
          onDelete={readOnly || !selectedPlan.local ? undefined : () => { const original = analysis.decisions.find(record => record.id === selectedPlan.record.id); if (original) deleteSavedDecision(original); }} linkedTrades={selectedPlan.local ? linkedTradeSummary(selectedPlan.record) : undefined} />}
      </div>
      {textOpen && <ChartDrawingTextEditor className="drawing-text-editor mt4-text-editor" maxLength={500} value={text} onChange={setText}
        onPlace={() => { if (text.trim()) { startDrawing("trainingTextBox", "文字标记", text.trim()); setText(""); } }} onCancel={() => setTextOpen(false)} />}

      {(priceMode || orderPriceSelection) && <div className="mt4-pick-status" role="status">点击图表设置{orderPriceSelection ? orderPriceSelectionLabel ?? "委托价格" : priceMode === "stop-loss" ? "计划止损" : "计划目标"}<button aria-label="取消图表取价" onClick={() => { setPriceMode(null); onCancelOrderPriceSelection(); }}><X size={14} /></button></div>}
    </div>
    {decisionOpen && !readOnly && <DecisionPlanCard className="mt4-decision-card" id="mt4-decision-card"
      value={{ marketState: analysis.draft.marketState, location: analysis.draft.location, reasons: analysis.draft.reasons, stop: analysis.draft.stopLoss, target: analysis.draft.takeProfit, note: analysis.draft.note }}
      onChange={changes => { const { stop, target, ...rest } = changes; updateDraft({ ...rest, ...(stop != null ? { stopLoss: stop } : {}), ...(target != null ? { takeProfit: target } : {}) }); }}
      title={analysis.editor?.decisionId ? "编辑事前决策" : analysis.editor ? "补写事前决策" : "事前决策卡"}
      reasonTags={[...new Set([...(sharedReasonTags ?? analysis.reasonTags), ...analysis.draft.reasons])]}
      reasonEditor={{ mode: tagMode, onMode: setTagMode, editingTag, editingValue: editingTagValue,
        onStartEdit: reason => { setEditingTag(reason); setEditingTagValue(reason); }, onEditValue: setEditingTagValue,
        onSaveEdit: () => tagAction(() => renameReasonTag(current.current, editingTag, editingTagValue)), onCancelEdit: () => { setEditingTag(""); setEditingTagValue(""); },
        customValue: customReason, onCustomValue: setCustomReason, onAdd: () => tagAction(() => addReasonTag(current.current, customReason)),
        onDelete: reason => { if (window.confirm(`确定删除标签“${reason}”吗？已保存决策保留当时的文字。`)) tagAction(() => removeReasonTag(current.current, reason)); } }}
      selectedPrice={priceMode} drawingDisabled={!bars.length}
      onPickPrice={kind => { onCancelOrderPriceSelection(); setDrawingRequest(null); setPriceMode(current => current === kind ? null : kind); }} onDrawPosition={() => beginSharedDrawing(trainingPositionTool)}
      hasPosition={analysis.drawings.some(drawing => drawing.name === "trainingPosition")} submitDisabled={!bars.length && !analysis.editor} onSubmit={() => saveDecision(Date.now())}
      submitLabel={analysis.editor?.decisionId ? "保存编辑" : analysis.editor ? "保存补写决策" : "保存事前决策"}
      context={<>
      {analysis.editor && !analysis.editor.decisionId && <label className="decision-backfill-toggle" title="把这根 K 线之后、下一份计划之前尚未关联的当前账户品种交易关联到本卡"><input type="checkbox" checked={backfillAssociation} onChange={event => setBackfillAssociation(event.target.checked)} />{backfillAssociation ? "保存并关联" : "只保存计划"}</label>}
      {analysis.editor && <div className="mt4-decision-context"><div><strong>{analysis.editor.decisionId ? "正在编辑" : "正在补写"}</strong><time>{new Date(analysis.editor.candleTimestamp).toLocaleString("zh-CN", { timeZone: "UTC" })} · MT4 时间</time><span>参考价 {analysis.editor.referencePrice.toFixed(digits)}</span></div><button className="ghost-button" onClick={cancelEditor}>取消</button></div>}
      </>}
      history={<DecisionHistory records={[...analysis.decisions].reverse().map(decisionRecord)} dateLabel={decisionDate} priceLabel={value => value.toFixed(digits)}
        onLocate={locateDecision} onEdit={record => { const original = analysis.decisions.find(item => item.id === record.id); if (original) beginEditor({ timestamp: original.candleTimestamp, referencePrice: original.referencePrice }, original); }}
        onDelete={record => { const original = analysis.decisions.find(item => item.id === record.id); if (original) deleteSavedDecision(original); }} linkedTrades={linkedTradeSummary} />}
    />}
    {error && <div className="mt4-error mt4-analysis-error" role="alert">{error}<button className="ghost-button" onClick={() => {
      const blob = new Blob([unreadable.current && initial.raw ? initial.raw : JSON.stringify(current.current, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "MT4-绘图与决策.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); unreadable.current = false; setNeedsExport(false); setError("");
    }}>{needsExport ? "导出原记录" : "导出当前内容"}</button></div>}
  </div></fieldset>;
}
