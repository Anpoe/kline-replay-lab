"use client";

import {
  Brush,
  ChevronRight,
  Gauge,
  LineChart,
  List,
  Lock,
  Magnet,
  MousePointer2,
  Redo2,
  Square,
  Tag,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  Unlock,
  Eye,
  EyeOff,
  X,
  type LucideIcon,
} from "lucide-react";
import type { KLineData } from "klinecharts";
import { useState } from "react";
import {
  KLineReplayChart,
  type DecisionMarker,
  type DrawingRequest,
  type PersistedDrawing,
  type TradeMarker,
} from "../../../components/KLineReplayChart";
import type { MovingAverageSettings } from "../../../lib/chartIndicators";

type ReviewChartInstrument = {
  symbol: string;
  name: string;
  timezone: string;
  pricePrecision: number;
};

type DrawingTool = {
  name: string;
  label: string;
  icon: LucideIcon;
  kind?: "rectangle" | "text";
};

type DrawingToolGroup = {
  id: string;
  label: string;
  tools: DrawingTool[];
};

const drawingToolGroups: DrawingToolGroup[] = [
  {
    id: "lines",
    label: "趋势线工具",
    tools: [
      { name: "segment", label: "趋势线", icon: TrendingDown },
      { name: "rayLine", label: "射线", icon: TrendingUp },
      { name: "horizontalStraightLine", label: "水平线", icon: LineChart },
    ],
  },
  {
    id: "channels",
    label: "通道工具",
    tools: [
      { name: "parallelStraightLine", label: "二线平行通道", icon: Gauge },
      { name: "priceChannelLine", label: "三线价格通道", icon: Gauge },
    ],
  },
  {
    id: "fibonacci",
    label: "斐波那契工具",
    tools: [{ name: "fibonacciLine", label: "斐波那契回撤", icon: Target }],
  },
  {
    id: "shapes",
    label: "几何图形",
    tools: [{ name: "trainingRectangle", label: "矩形区域", icon: Square, kind: "rectangle" }],
  },
  {
    id: "notes",
    label: "画笔",
    tools: [{ name: "brush", label: "画笔", icon: Brush }],
  },
  {
    id: "text",
    label: "文字标记",
    tools: [{ name: "trainingTextBox", label: "文字标记", icon: Tag, kind: "text" }],
  },
];

const defaultDrawingTools = Object.fromEntries(
  drawingToolGroups.map((group) => [group.id, group.tools[0].name]),
);

function drawingLabel(name: string) {
  if (name === "trainingTextBox") return "文字标记";
  return drawingToolGroups.flatMap((group) => group.tools).find((tool) => tool.name === name)?.label ?? name;
}

function drawingStyles(color: string, size: number) {
  return {
    line: { color, size, style: "solid" },
    rect: {
      color: `${color}24`,
      borderColor: color,
      borderSize: size,
      borderStyle: "solid",
    },
    point: { color: "#0c1416", borderColor: color, borderSize: 2, radius: 4 },
  };
}

function drawingsEqual(left: PersistedDrawing[], right: PersistedDrawing[]) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

type ReviewChartPreviewProps = {
  bars: KLineData[];
  instrument: ReviewChartInstrument;
  timeframe: string;
  dataIndexOffset: number;
  movingAverageSettings: MovingAverageSettings;
  initialDrawings: PersistedDrawing[];
  tradeMarkers: TradeMarker[];
  decisionMarkers: DecisionMarker[];
  loading?: boolean;
  error?: string;
};

export function ReviewChartPreview({
  bars,
  instrument,
  timeframe,
  dataIndexOffset,
  movingAverageSettings,
  initialDrawings,
  tradeMarkers,
  decisionMarkers,
  loading = false,
  error = "",
}: ReviewChartPreviewProps) {
  const [drawingRequest, setDrawingRequest] = useState<DrawingRequest>(null);
  const [clearNonce, setClearNonce] = useState(0);
  const [drawingsRestoreNonce, setDrawingsRestoreNonce] = useState(0);
  const [drawings, setDrawings] = useState<PersistedDrawing[]>(initialDrawings);
  const [drawingUndoStack, setDrawingUndoStack] = useState<PersistedDrawing[][]>([]);
  const [drawingRedoStack, setDrawingRedoStack] = useState<PersistedDrawing[][]>([]);
  const [drawingGroupOpen, setDrawingGroupOpen] = useState("");
  const [groupDrawingTools, setGroupDrawingTools] = useState<Record<string, string>>(defaultDrawingTools);
  const [drawingMagnetMode, setDrawingMagnetMode] = useState<"normal" | "weak_magnet" | "strong_magnet">("normal");
  const [drawingColor, setDrawingColor] = useState("#2962ff");
  const [drawingLineWidth, setDrawingLineWidth] = useState(2);
  const [selectedDrawingId, setSelectedDrawingId] = useState("");
  const [drawingObjectsOpen, setDrawingObjectsOpen] = useState(false);
  const [drawingTextOpen, setDrawingTextOpen] = useState(false);
  const [drawingText, setDrawingText] = useState("");

  const handleDrawingsChange = (nextDrawings: PersistedDrawing[]) => {
    if (drawingsEqual(drawings, nextDrawings)) return;
    setDrawingUndoStack((history) => [...history, drawings].slice(-60));
    setDrawingRedoStack([]);
    setDrawings(nextDrawings);
    if (selectedDrawingId && !nextDrawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId("");
    }
  };

  const beginDrawing = (tool: DrawingTool) => {
    setDrawingGroupOpen("");
    setSelectedDrawingId("");
    if (tool.name === "trainingTextBox") {
      setDrawingRequest(null);
      setDrawingTextOpen(true);
      return;
    }
    setDrawingTextOpen(false);
    setDrawingRequest((request) => ({
      name: tool.name,
      nonce: (request?.nonce ?? 0) + 1,
      mode: drawingMagnetMode,
      styles: drawingStyles(drawingColor, drawingLineWidth),
      extendData: { toolLabel: tool.label, toolKind: tool.kind ?? "drawing" },
    }));
  };

  const beginTextDrawing = () => {
    const text = drawingText.trim();
    if (!text) return;
    setDrawingTextOpen(false);
    setDrawingText("");
    setSelectedDrawingId("");
    setDrawingRequest((request) => ({
      name: "trainingTextBox",
      nonce: (request?.nonce ?? 0) + 1,
      mode: "normal",
      styles: {
        ...drawingStyles(drawingColor, drawingLineWidth),
        text: { color: drawingColor, size: 18 },
      },
      extendData: { toolLabel: "文字标记", toolKind: "text", text },
    }));
  };

  const updateDrawing = (drawingId: string, updates: Partial<PersistedDrawing>) => {
    const nextDrawings = drawings.map((drawing) => drawing.id === drawingId ? { ...drawing, ...updates } : drawing);
    handleDrawingsChange(nextDrawings);
    setDrawingsRestoreNonce((nonce) => nonce + 1);
  };

  const removeDrawing = (drawingId: string) => {
    handleDrawingsChange(drawings.filter((drawing) => drawing.id !== drawingId));
    setSelectedDrawingId("");
    setDrawingsRestoreNonce((nonce) => nonce + 1);
  };

  const updateDrawingVisualStyle = (drawingId: string, color: string, size: number) => {
    const selected = drawings.find((drawing) => drawing.id === drawingId);
    if (!selected) return;
    const existing = selected.styles && typeof selected.styles === "object"
      ? selected.styles as Record<string, unknown>
      : {};
    const existingLine = existing.line && typeof existing.line === "object"
      ? existing.line as Record<string, unknown>
      : {};
    const existingRect = existing.rect && typeof existing.rect === "object"
      ? existing.rect as Record<string, unknown>
      : {};
    const existingText = existing.text && typeof existing.text === "object"
      ? existing.text as Record<string, unknown>
      : {};
    updateDrawing(drawingId, {
      styles: {
        ...existing,
        line: { ...existingLine, color, size },
        rect: { ...existingRect, color: `${color}24`, borderColor: color, borderSize: size },
        text: { ...existingText, color },
      },
    });
  };

  const updateDrawingTextSize = (drawingId: string, size: number) => {
    const selected = drawings.find((drawing) => drawing.id === drawingId);
    if (!selected) return;
    const existing = selected.styles && typeof selected.styles === "object"
      ? selected.styles as Record<string, unknown>
      : {};
    const existingText = existing.text && typeof existing.text === "object"
      ? existing.text as Record<string, unknown>
      : {};
    updateDrawing(drawingId, {
      styles: { ...existing, text: { ...existingText, size } },
    });
  };

  const updateDrawingTextContent = (drawingId: string, text: string) => {
    const selected = drawings.find((drawing) => drawing.id === drawingId);
    if (!selected) return;
    const existing = selected.extendData && typeof selected.extendData === "object"
      ? selected.extendData as Record<string, unknown>
      : {};
    updateDrawing(drawingId, { extendData: { ...existing, text } });
  };

  const undoDrawing = () => {
    const previous = drawingUndoStack.at(-1);
    if (!previous) return;
    setDrawingUndoStack((history) => history.slice(0, -1));
    setDrawingRedoStack((history) => [...history, drawings].slice(-60));
    setDrawings(previous);
    setDrawingsRestoreNonce((nonce) => nonce + 1);
  };

  const redoDrawing = () => {
    const next = drawingRedoStack.at(-1);
    if (!next) return;
    setDrawingRedoStack((history) => history.slice(0, -1));
    setDrawingUndoStack((history) => [...history, drawings].slice(-60));
    setDrawings(next);
    setDrawingsRestoreNonce((nonce) => nonce + 1);
  };

  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null;
  const selectedDrawingStyles = selectedDrawing?.styles && typeof selectedDrawing.styles === "object"
    ? selectedDrawing.styles as {
      line?: { color?: string; size?: number };
      rect?: { borderColor?: string; borderSize?: number };
      text?: { color?: string; size?: number };
    }
    : {};
  const selectedDrawingColor = selectedDrawing?.name === "trainingTextBox"
    ? selectedDrawingStyles.text?.color ?? selectedDrawingStyles.line?.color ?? drawingColor
    : selectedDrawingStyles.line?.color ?? selectedDrawingStyles.rect?.borderColor ?? drawingColor;
  const selectedDrawingWidth = selectedDrawingStyles.line?.size ?? selectedDrawingStyles.rect?.borderSize ?? drawingLineWidth;
  const selectedDrawingTextSize = selectedDrawingStyles.text?.size ?? 18;
  const drawingTextSizeOptions = Array.from(new Set([
    12, 14, 16, 18, 22, 28, 36, 48,
    selectedDrawingTextSize,
  ])).sort((left, right) => left - right);
  const selectedDrawingText = selectedDrawing?.extendData && typeof selectedDrawing.extendData === "object"
    ? String((selectedDrawing.extendData as { text?: unknown }).text ?? "")
    : "";
  const selectedDrawingInputColor = /^#[0-9a-f]{6}$/i.test(selectedDrawingColor) ? selectedDrawingColor : drawingColor;

  return (
    <article className="review-chart-card" aria-label="训练图表预览">
      <header className="review-chart-preview-head">
        <div>
          <span className="section-label">训练图表预览</span>
          <strong>{instrument.symbol}</strong>
          <small>{instrument.name} · {timeframe} · 以查看为主</small>
        </div>
        <span className="review-chart-preview-badge">仅查看 · 可画图</span>
      </header>

      <div className="review-chart-area">
        <div className="drawing-rail review-drawing-rail" aria-label="复盘画图工具">
          <button
            type="button"
            className={!selectedDrawingId && !drawingGroupOpen && !drawingRequest && !drawingTextOpen ? "active" : ""}
            title="光标"
            aria-label="光标"
            onClick={() => {
              setDrawingRequest(null);
              setDrawingTextOpen(false);
              setSelectedDrawingId("");
              setDrawingGroupOpen("");
            }}
          ><MousePointer2 size={17} /></button>
          {drawingToolGroups.map((group) => {
            const selectedTool = group.tools.find((tool) => tool.name === groupDrawingTools[group.id]) ?? group.tools[0];
            const Icon = selectedTool.icon;
            if (group.tools.length === 1) {
              return (
                <button
                  type="button"
                  key={group.id}
                  className={drawingRequest?.name === selectedTool.name ? "active" : ""}
                  title={selectedTool.label}
                  aria-label={selectedTool.label}
                  onClick={() => beginDrawing(selectedTool)}
                ><Icon size={17} /></button>
              );
            }
            return (
              <div className="drawing-tool-group" key={group.id}>
                <button
                  type="button"
                  className={drawingGroupOpen === group.id || drawingRequest?.name === selectedTool.name ? "active" : ""}
                  title={selectedTool.label}
                  aria-label={selectedTool.label}
                  onClick={() => beginDrawing(selectedTool)}
                ><Icon size={17} /></button>
                <button
                  type="button"
                  className="drawing-group-trigger"
                  aria-label={`展开${group.label}`}
                  title={`展开${group.label}`}
                  onClick={() => setDrawingGroupOpen((open) => open === group.id ? "" : group.id)}
                ><ChevronRight size={9} /></button>
              </div>
            );
          })}
          <span className="tool-divider" />
          <button
            type="button"
            className={drawingMagnetMode !== "normal" ? "active" : ""}
            title={drawingMagnetMode === "normal" ? "磁吸 OHLC：关闭" : drawingMagnetMode === "weak_magnet" ? "磁吸 OHLC：弱吸附" : "磁吸 OHLC：强吸附"}
            aria-label="切换磁吸 OHLC"
            onClick={() => setDrawingMagnetMode((mode) => mode === "normal" ? "weak_magnet" : mode === "weak_magnet" ? "strong_magnet" : "normal")}
          ><Magnet size={17} /><small>{drawingMagnetMode === "weak_magnet" ? "弱" : drawingMagnetMode === "strong_magnet" ? "强" : ""}</small></button>
          <button type="button" title="撤销上一笔绘图" aria-label="撤销绘图" disabled={!drawingUndoStack.length} onClick={undoDrawing}><Undo2 size={17} /></button>
          <button type="button" title="重做已撤销的绘图" aria-label="重做绘图" disabled={!drawingRedoStack.length} onClick={redoDrawing}><Redo2 size={17} /></button>
          <button type="button" className={drawingObjectsOpen ? "active" : ""} title="对象树" aria-label="绘图对象列表" onClick={() => setDrawingObjectsOpen((open) => !open)}><List size={17} /></button>
          <button
            type="button"
            title="清除临时绘图"
            aria-label="清除临时绘图"
            onClick={() => {
              handleDrawingsChange([]);
              setSelectedDrawingId("");
              setClearNonce((nonce) => nonce + 1);
            }}
          ><Trash2 size={17} /></button>
        </div>

        {drawingGroupOpen && (() => {
          const groupIndex = drawingToolGroups.findIndex((group) => group.id === drawingGroupOpen);
          const group = drawingToolGroups[groupIndex];
          if (!group) return null;
          return (
            <div className="drawing-tool-flyout review-drawing-tool-flyout" style={{ top: `${38 + groupIndex * 34}px` }}>
              <strong>{group.label}</strong>
              {group.tools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button type="button" key={tool.name} onClick={() => {
                    setGroupDrawingTools((current) => ({ ...current, [group.id]: tool.name }));
                    beginDrawing(tool);
                  }}>
                    <Icon size={16} />
                    <span>{tool.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {drawingTextOpen && (
          <form className="drawing-text-editor review-drawing-text-editor" aria-label="复盘文字标记输入" onSubmit={(event) => {
            event.preventDefault();
            beginTextDrawing();
          }}>
            <input
              autoFocus
              value={drawingText}
              aria-label="图表文字"
              placeholder="输入图表标记"
              onChange={(event) => setDrawingText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setDrawingTextOpen(false);
              }}
            />
            <button type="submit" disabled={!drawingText.trim()}>放置</button>
            <button type="button" aria-label="取消文字标记" onClick={() => setDrawingTextOpen(false)}><X size={14} /></button>
          </form>
        )}

        {selectedDrawing && (
          <div className={`drawing-property-bar review-drawing-property-bar ${selectedDrawing.name === "trainingTextBox" ? "text-box-properties" : ""}`} aria-label="临时绘图属性">
            <span className="drawing-selected-name">{drawingLabel(selectedDrawing.name)}</span>
            {selectedDrawing.name === "trainingTextBox" && (
              <input
                className="drawing-text-content"
                value={selectedDrawingText}
                aria-label="文字内容"
                title="文字内容"
                onChange={(event) => updateDrawingTextContent(selectedDrawing.id, event.target.value)}
              />
            )}
            <label className="drawing-color-control" title="标记颜色">
              <input
                type="color"
                value={selectedDrawingInputColor}
                aria-label="标记颜色"
                onChange={(event) => {
                  setDrawingColor(event.target.value);
                  updateDrawingVisualStyle(selectedDrawing.id, event.target.value, selectedDrawingWidth);
                }}
              />
            </label>
            <select
              value={selectedDrawingWidth}
              aria-label="线条粗细"
              title="线条粗细"
              onChange={(event) => {
                const size = Number(event.target.value);
                setDrawingLineWidth(size);
                updateDrawingVisualStyle(selectedDrawing.id, selectedDrawingInputColor, size);
              }}
            >
              {[1, 2, 3, 4].map((size) => <option key={size} value={size}>{size}px</option>)}
            </select>
            {selectedDrawing.name === "trainingTextBox" && (
              <select
                value={selectedDrawingTextSize}
                aria-label="文字大小"
                title="文字大小"
                onChange={(event) => updateDrawingTextSize(selectedDrawing.id, Number(event.target.value))}
              >
                {drawingTextSizeOptions.map((size) => <option key={size} value={size}>{size}px</option>)}
              </select>
            )}
            <button type="button" title={selectedDrawing.lock ? "解锁临时绘图" : "锁定临时绘图"} aria-label={selectedDrawing.lock ? "解锁临时绘图" : "锁定临时绘图"} onClick={() => updateDrawing(selectedDrawing.id, { lock: !selectedDrawing.lock })}>
              {selectedDrawing.lock ? <Unlock size={15} /> : <Lock size={15} />}
            </button>
            <button type="button" title={selectedDrawing.visible ? "隐藏临时绘图" : "显示临时绘图"} aria-label={selectedDrawing.visible ? "隐藏临时绘图" : "显示临时绘图"} onClick={() => updateDrawing(selectedDrawing.id, { visible: !selectedDrawing.visible })}>
              {selectedDrawing.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button type="button" className="danger" title="删除临时绘图" aria-label="删除当前临时绘图" onClick={() => removeDrawing(selectedDrawing.id)}><Trash2 size={15} /></button>
            <button type="button" title="关闭属性栏" aria-label="关闭临时绘图属性" onClick={() => setSelectedDrawingId("")}><X size={14} /></button>
          </div>
        )}

        {drawingObjectsOpen && (
          <aside className="drawing-object-panel review-drawing-object-panel" aria-label="临时绘图对象列表">
            <header><strong>临时对象</strong><button type="button" aria-label="关闭对象树" onClick={() => setDrawingObjectsOpen(false)}><X size={14} /></button></header>
            <div className="drawing-object-list">
              {drawings.length ? [...drawings].reverse().map((drawing, index) => (
                <div className={drawing.id === selectedDrawingId ? "active" : ""} key={drawing.id}>
                  <button type="button" className="drawing-object-name" onClick={() => setSelectedDrawingId(drawing.id)}>
                    <span>{drawingLabel(drawing.name)}</span><small>#{drawings.length - index}</small>
                  </button>
                  <button type="button" aria-label={drawing.visible ? "隐藏对象" : "显示对象"} onClick={() => updateDrawing(drawing.id, { visible: !drawing.visible })}>{drawing.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                  <button type="button" aria-label={drawing.lock ? "解锁对象" : "锁定对象"} onClick={() => updateDrawing(drawing.id, { lock: !drawing.lock })}>{drawing.lock ? <Lock size={13} /> : <Unlock size={13} />}</button>
                  <button type="button" className="danger" aria-label="删除对象" onClick={() => removeDrawing(drawing.id)}><Trash2 size={13} /></button>
                </div>
              )) : <p>还没有临时绘图。</p>}
            </div>
          </aside>
        )}

        <div className="review-chart-wrap">
          <KLineReplayChart
            bars={bars}
            dataIndexOffset={dataIndexOffset}
            symbol={instrument.symbol}
            timezone={instrument.timezone}
            timeframe={timeframe}
            pricePrecision={instrument.pricePrecision}
            movingAverageSettings={movingAverageSettings}
            drawingRequest={drawingRequest}
            clearNonce={clearNonce}
            tradeMarkers={tradeMarkers}
            decisionMarkers={decisionMarkers}
            protectionLines={[]}
            priceSelectionMode={null}
            drawings={drawings}
            selectedDrawingId={selectedDrawingId}
            drawingsRestoreNonce={drawingsRestoreNonce}
            hideDate={false}
            hidePrice={false}
            enableCandleContextMenu={false}
            onDecisionSelect={() => undefined}
            onProtectionPriceSelect={() => undefined}
            onProtectionLineMove={() => false}
            onCandleContextMenu={() => undefined}
            onDrawingsChange={handleDrawingsChange}
            onDrawingSelect={(id) => setSelectedDrawingId(id ?? "")}
          />
          {loading && <div className="review-chart-state">正在准备训练行情…</div>}
          {!loading && error && <div className="review-chart-state error" role="alert">{error}</div>}
          {!loading && !error && !bars.length && <div className="review-chart-state">暂无可预览的 K 线</div>}
          <div className="review-chart-watermark">REVIEW · READ ONLY</div>
        </div>
      </div>
      <footer className="review-chart-preview-note">图表以查看为主；左侧标记仅用于本次复盘，不会修改训练记录。</footer>
    </article>
  );
}
