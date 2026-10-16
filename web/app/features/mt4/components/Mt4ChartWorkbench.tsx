"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { KLineData } from "klinecharts";
import { DecisionPlanCard } from "../../../components/DecisionPlanCard";
import { ChartDrawingRail } from "../../../components/ChartDrawingRail";
import { ChartDrawingTextEditor } from "../../../components/ChartDrawingTextEditor";
import { DrawingObjectPanel } from "../../../components/DrawingObjectPanel";
import { DrawingPropertyBar } from "../../../components/DrawingPropertyBar";
import { defaultDrawingTools, trainingPositionTool, type DrawingTool } from "../../../components/chartDrawingTools";
import { KLineReplayChart, type DrawingRequest, type PersistedDrawing, type PriceSelectionMode, type ProtectionLine, type TradeMarker } from "../../../components/KLineReplayChart";
import type { MacdSettings, MovingAverageSettings } from "../../../lib/chartIndicators";
import { mt4CandleCountdown } from "../../../lib/mt4CandleCountdown.mjs";
import { addReasonTag, applyAnalysisDrawings, decisionScore, deleteDecisionRecord, editDecisionRecord, emptyAnalysis, readAnalysis, recordDecision, removeReasonTag, renameReasonTag, type Mt4Analysis, type Mt4Decision, type Mt4DecisionDraft } from "../mt4Analysis";

const noop = () => {};

function load(key: string) {
  let raw: string | null = null;
  try { raw = typeof window === "undefined" ? null : window.localStorage.getItem(key); return { data: readAnalysis(raw), error: "", raw }; }
  catch { return { data: emptyAnalysis(), error: "已有绘图与决策记录无法读取。请先导出原记录，再保存新内容。", raw }; }
}

export function Mt4ChartWorkbench({ storageKey, initialAnalysis, onPersist, onNotice, readOnly = false, tradeMarkers = [], onTradeSelect, focusTimestamp, bars, symbol, timeframe, digits, decisionOpen, emptyMessage, onOpenDecision, orderPriceSelection, onOrderPriceSelect, onPlanProtectionChange, orderPrices, onCancelOrderPriceSelection, candleClock, movingAverageSettings, macdSettings }: {
  onNotice?: (message: string) => void;
  initialAnalysis?: Mt4Analysis; onPersist?: (next: Mt4Analysis) => void; readOnly?: boolean; tradeMarkers?: TradeMarker[]; onTradeSelect?: (id: string, event: "entry" | "exit") => void; focusTimestamp?: number;
  storageKey: string; bars: KLineData[]; symbol: string; timeframe: string; digits: number; decisionOpen: boolean; emptyMessage: string; onOpenDecision: () => void;
  orderPriceSelection: PriceSelectionMode | null; onOrderPriceSelect: (kind: PriceSelectionMode, price: number) => void;
  onPlanProtectionChange: (changes: { stopLoss?: string; takeProfit?: string }) => void; orderPrices: { stopLoss: number; takeProfit: number; entry: number };
  onCancelOrderPriceSelection: () => void;
  candleClock: { serverTime?: number; receivedAt: number; connected: boolean; timeframe: number };
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
  const [priceMode, setPriceMode] = useState<PriceSelectionMode | null>(null);
  const last = bars.at(-1);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const countdown = mt4CandleCountdown({ openTime: last?.timestamp ?? 0, ...candleClock, now });
  const selectedDecision = analysis.decisions.find(d => d.id === selectedDecisionId);
  useEffect(() => { if (!initial.data.editor) onPlanProtectionChange({ stopLoss: initial.data.draft.stopLoss, takeProfit: initial.data.draft.takeProfit }); }, [initial, onPlanProtectionChange]);

  const store = (next: Mt4Analysis, atomic = false) => {
    if (readOnly) return false;
    if (unreadable.current) { setError("原记录暂时无法读取，请先导出原记录。当前编辑内容仍保留在页面中。"); if (!atomic) { current.current = next; setAnalysis(next); } return false; }
    try { if (onPersist) onPersist(next); else window.localStorage.setItem(storageKey, JSON.stringify(next)); setError(""); }
    catch { setError("本机保存未完成，当前内容仍在页面中。请释放浏览器存储空间后重试保存。"); if (atomic) return false; }
    current.current = next; setAnalysis(next); return true;
  };
  const updateDraft = (changes: Partial<Mt4DecisionDraft>) => {
    store({ ...current.current, draft: { ...current.current.draft, ...changes } });
    if (!current.current.editor && (changes.stopLoss != null || changes.takeProfit != null)) onPlanProtectionChange(changes);
  };
  const changeDrawings = (next: PersistedDrawing[]) => {
    if (JSON.stringify(next) === JSON.stringify(current.current.drawings)) return;
    const previous = current.current.drawings;
    setUndo(history => [...history, previous].slice(-60)); setRedo([]);
    const updated = applyAnalysisDrawings(current.current, next, digits); store(updated);
    if (!updated.editor && (previous.some(d => d.name === "trainingPosition") || next.some(d => d.name === "trainingPosition"))) onPlanProtectionChange({ stopLoss: updated.draft.stopLoss, takeProfit: updated.draft.takeProfit });
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
    const hadPosition = current.current.drawings.some(d => d.name === "trainingPosition");
    const updated = applyAnalysisDrawings(current.current, next, digits);
    setDrawingRequest(null); setSelectedId(""); store(updated); setRestoreNonce(n => n + 1);
    if (!updated.editor && (hadPosition || next.some(d => d.name === "trainingPosition"))) onPlanProtectionChange({ stopLoss: updated.draft.stopLoss, takeProfit: updated.draft.takeProfit });
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
  const beginEditor = (target: { timestamp: number; referencePrice: number }, record?: Mt4Decision) => {
    const previous = current.current;
    store({ ...previous, draft: record ? structuredClone(record.draft) : emptyAnalysis().draft,
      editor: { ...(record ? { decisionId: record.id } : {}), candleTimestamp: target.timestamp, referencePrice: target.referencePrice, originalDraft: previous.editor?.originalDraft ?? structuredClone(previous.draft) } });
    setPriceMode(null); setDrawingRequest(null); setSelectedDecisionId(record?.id ?? "");
    onOpenDecision();
  };
  const tagAction = (action: () => Mt4Analysis) => {
    try { if (store(action(), true)) { setEditingTag(""); setEditingTagValue(""); setCustomReason(""); } }
    catch (e) { setError(e instanceof Error ? e.message : "标签未保存，请重试。"); }
  };
  const saveDecision = (recordedAt: number) => {
    try {
      const editor = current.current.editor;
      const next = editor?.decisionId ? editDecisionRecord(current.current, editor.decisionId, current.current.draft, recordedAt)
        : recordDecision(current.current, { id: crypto.randomUUID(), recordedAt, candleTimestamp: editor?.candleTimestamp ?? last?.timestamp ?? 0, referencePrice: editor?.referencePrice ?? last?.close ?? 0, ...(editor ? { backfilled: true } : {}) });
      if (editor) { next.draft = editor.originalDraft; delete next.editor; }
      if (store(next, true)) { if (editor) onPlanProtectionChange({ stopLoss: next.draft.stopLoss, takeProfit: next.draft.takeProfit }); if (!onPersist) onNotice?.(editor?.decisionId ? "决策已更新" : "决策已保存"); }
    } catch (e) { setError(e instanceof Error ? e.message : "决策保存未完成，请保留当前内容并重试。"); }
  };
  const pickPrice = (kind: PriceSelectionMode, value: number) => {
    if (orderPriceSelection) { onOrderPriceSelect(orderPriceSelection, value); return; }
    updateDraft(kind === "stop-loss" ? { stopLoss: value.toFixed(digits) } : { takeProfit: value.toFixed(digits) }); setPriceMode(null);
  };
  const protectionLines: ProtectionLine[] = last ? ([
    { kind: "stop-loss", value: analysis.draft.stopLoss, label: "计划止损" },
    { kind: "take-profit", value: analysis.draft.takeProfit, label: "计划目标" },
  ] as const).filter(p => Number(p.value) > 0).map(p => ({ id: `mt4-plan-${p.kind}`, kind: p.kind, price: Number(p.value), timestamp: last.timestamp, label: p.label, movable: !readOnly, source: "draft" })) : [];
  if (last) for (const item of [{ kind: "stop-loss", price: orderPrices.stopLoss, label: "委托止损" }, { kind: "take-profit", price: orderPrices.takeProfit, label: "委托止盈" }, { kind: "entry-trigger", price: orderPrices.entry, label: "委托触发价" }] as const) {
    if (item.price > 0 && !protectionLines.some(p => p.kind === item.kind && Math.abs(p.price - item.price) < 10 ** -digits / 2)) protectionLines.push({ id: `mt4-order-${item.kind}`, kind: item.kind, price: item.price, timestamp: last.timestamp, label: item.label, movable: true, source: "draft" });
  }

  return <fieldset disabled={readOnly} className="mt4-analysis-fieldset"><div className={`mt4-analysis-layout ${decisionOpen ? "with-decision" : ""}`}>
    <div className="mt4-drawing-stage">
      <ChartDrawingRail className="drawing-rail mt4-drawing-rail" disabled={!bars.length}
        cursorActive={!drawingRequest && !priceMode && !orderPriceSelection && !textOpen}
        onCursor={() => { onCancelOrderPriceSelection(); setDrawingRequest(null); setTextOpen(false); setPriceMode(null); setSelectedId(""); setDrawingGroupOpen(""); }}
        activeTool={drawingRequest?.name} groupTools={groupDrawingTools} openGroup={drawingGroupOpen} onOpenGroup={setDrawingGroupOpen}
        onSelectTool={beginSharedDrawing} onGroupTool={(group, tool) => setGroupDrawingTools(current => ({ ...current, [group]: tool }))}
        magnetMode={drawingMagnetMode} onMagnetMode={setDrawingMagnetMode} canUndo={!!undo.length} canRedo={!!redo.length}
        onUndo={() => { const previous = undo.at(-1); const present = current.current.drawings; if (previous) { setRedo(history => [...history, present]); setUndo(history => history.slice(0, -1)); restore(previous); } }}
        onRedo={() => { const next = redo.at(-1); const present = current.current.drawings; if (next) { setUndo(history => [...history, present]); setRedo(history => history.slice(0, -1)); restore(next); } }}
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
          movingAverageSettings={movingAverageSettings} macdSettings={macdSettings} drawingRequest={drawingRequest} clearNonce={clearNonce} drawings={readOnly ? analysis.drawings.map(d => ({ ...d, lock: true })) : analysis.drawings}
          selectedDrawingId={selectedId} drawingsRestoreNonce={restoreNonce} tradeMarkers={tradeMarkers} onTradeSelect={onTradeSelect} focusTimestamp={focusTimestamp} decisionMarkers={analysis.decisions.map(d => ({ id: d.id, timestamp: d.candleTimestamp, price: d.referencePrice, label: "事前决策" }))}
          corporateActionMarkers={[]} protectionLines={protectionLines} priceSelectionMode={orderPriceSelection ?? priceMode} hideDate={false} hidePrice={false} enableCandleContextMenu
          latestCandleCountdown={countdown} enableChartShift liveUpdates
          onDecisionSelect={id => { setSelectedDecisionId(id); onOpenDecision(); }}
          onCorporateActionSelect={noop} onProtectionPriceSelect={pickPrice} onProtectionLineMove={(line, price) => {
            if (readOnly) return false;
            if (orderPriceSelection || priceMode) return false;
            if (line.id.startsWith("mt4-order-")) onOrderPriceSelect(line.kind as PriceSelectionMode, price);
            else updateDraft(line.kind === "stop-loss" ? { stopLoss: price.toFixed(digits) } : { takeProfit: price.toFixed(digits) });
            return true;
          }} onCandleContextMenu={readOnly ? noop : target => beginEditor(target)}
          onDrawingsChange={readOnly ? noop : changeDrawings} onDrawingSelect={readOnly ? noop : id => setSelectedId(id ?? "")} /> : <div className="mt4-empty">{emptyMessage}</div>}
      </div>
      {textOpen && <ChartDrawingTextEditor className="drawing-text-editor mt4-text-editor" maxLength={500} value={text} onChange={setText}
        onPlace={() => { if (text.trim()) { startDrawing("trainingTextBox", "文字标记", text.trim()); setText(""); } }} onCancel={() => setTextOpen(false)} />}

      {(priceMode || orderPriceSelection) && <div className="mt4-pick-status" role="status">点击图表设置{orderPriceSelection ? "委托价格" : priceMode === "stop-loss" ? "计划止损" : "计划目标"}<button aria-label="取消图表取价" onClick={() => { setPriceMode(null); onCancelOrderPriceSelection(); }}><X size={14} /></button></div>}
    </div>
    {decisionOpen && <DecisionPlanCard className="mt4-decision-card" id="mt4-decision-card"
      value={{ marketState: analysis.draft.marketState, location: analysis.draft.location, reasons: analysis.draft.reasons, stop: analysis.draft.stopLoss, target: analysis.draft.takeProfit, note: analysis.draft.note }}
      onChange={changes => { const { stop, target, ...rest } = changes; updateDraft({ ...rest, ...(stop != null ? { stopLoss: stop } : {}), ...(target != null ? { takeProfit: target } : {}) }); }}
      title={analysis.editor?.decisionId ? "编辑事前决策" : analysis.editor ? "补写事前决策" : "事前决策卡"}
      reasonTags={[...new Set([...analysis.reasonTags, ...analysis.draft.reasons])]}
      reasonEditor={{ mode: tagMode, onMode: setTagMode, editingTag, editingValue: editingTagValue,
        onStartEdit: reason => { setEditingTag(reason); setEditingTagValue(reason); }, onEditValue: setEditingTagValue,
        onSaveEdit: () => tagAction(() => renameReasonTag(current.current, editingTag, editingTagValue)), onCancelEdit: () => { setEditingTag(""); setEditingTagValue(""); },
        customValue: customReason, onCustomValue: setCustomReason, onAdd: () => tagAction(() => addReasonTag(current.current, customReason)),
        onDelete: reason => { if (window.confirm(`确定删除标签“${reason}”吗？已保存决策保留当时的文字。`)) tagAction(() => removeReasonTag(current.current, reason)); } }}
      selectedPrice={priceMode} drawingDisabled={!bars.length}
      onPickPrice={kind => { onCancelOrderPriceSelection(); setDrawingRequest(null); setPriceMode(kind); }} onDrawPosition={() => beginSharedDrawing(trainingPositionTool)}
      hasPosition={drawingRequest?.name === "trainingPosition"} submitDisabled={!bars.length && !analysis.editor} onSubmit={() => saveDecision(Date.now())}
      submitLabel={analysis.editor?.decisionId ? "保存编辑" : analysis.editor ? "保存补写决策" : "保存事前决策"}
      context={<>
      {analysis.editor && <div className="mt4-decision-context"><div><strong>{analysis.editor.decisionId ? "正在编辑" : "正在补写"}</strong><time>{new Date(analysis.editor.candleTimestamp).toLocaleString("zh-CN", { timeZone: "UTC" })} · MT4 时间</time><span>参考价 {analysis.editor.referencePrice.toFixed(digits)}</span></div><button className="ghost-button" onClick={cancelEditor}>取消</button></div>}
      {selectedDecision && !analysis.editor && <article className="mt4-decision-selected" aria-label="选中决策详情"><header><strong>{selectedDecision.backfilled ? "补写决策" : "事前决策"} · {decisionScore(selectedDecision.draft)}%</strong><button className="ghost-button" aria-label="关闭决策详情" onClick={() => setSelectedDecisionId("")}><X size={14} /></button></header><time>{new Date(selectedDecision.candleTimestamp).toLocaleString("zh-CN", { timeZone: "UTC" })} · MT4 时间</time><span>{selectedDecision.draft.marketState || "—"} · {selectedDecision.draft.location || "—"}</span><span>{selectedDecision.draft.reasons.join("、") || "未填写理由"}</span><span>止损 {selectedDecision.draft.stopLoss || "—"} · 目标 {selectedDecision.draft.takeProfit || "—"}</span><p>{selectedDecision.draft.note || "未填写说明"}</p><button className="ghost-button" onClick={() => beginEditor({ timestamp: selectedDecision.candleTimestamp, referencePrice: selectedDecision.referencePrice }, selectedDecision)}>编辑这份决策</button></article>}
      </>}
      history={<>
      <details className="mt4-decision-history"><summary title="右键或长按历史 K 线可以补写计划">已保存决策 {analysis.decisions.length}</summary>{analysis.decisions.length ? analysis.decisions.map(d => <article key={d.id}><time>{new Date(d.recordedAt).toLocaleString("zh-CN")}{d.backfilled ? " · 补写" : ""}{d.updatedAt ? " · 已编辑" : ""}</time><strong>{d.draft.marketState || "—"} · {d.draft.location || "—"} · {decisionScore(d.draft)}%</strong><span>{d.draft.reasons.join("、")}</span><span>止损 {d.draft.stopLoss || "—"} · 目标 {d.draft.takeProfit || "—"}</span><p>{d.draft.note}</p><div className="mt4-actions"><button className="ghost-button" onClick={() => setSelectedDecisionId(d.id)}>查看</button><button className="ghost-button" aria-label={`编辑决策 ${d.id}`} onClick={() => beginEditor({ timestamp: d.candleTimestamp, referencePrice: d.referencePrice }, d)}>编辑</button><button className="ghost-button" aria-label={`删除决策 ${d.id}`} onClick={() => { if (!window.confirm("确定删除这份决策吗？它会从图表标记与决策记录中移除。")) return; const next = deleteDecisionRecord(current.current, d.id); if (next.editor?.decisionId === d.id) { next.draft = next.editor.originalDraft; delete next.editor; } if (store(next, true)) setSelectedDecisionId(""); }}>删除</button></div></article>) : <p>暂无已保存决策</p>}</details>      </>}
    />}
    {error && <div className="mt4-error mt4-analysis-error" role="alert">{error}<button className="ghost-button" onClick={() => {
      const blob = new Blob([unreadable.current && initial.raw ? initial.raw : JSON.stringify(current.current, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "MT4-绘图与决策.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); unreadable.current = false; setNeedsExport(false); setError("");
    }}>{needsExport ? "导出原记录" : "导出当前内容"}</button></div>}
  </div></fieldset>;
}
