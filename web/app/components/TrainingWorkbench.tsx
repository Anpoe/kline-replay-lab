"use client";

import {
  Activity,
  BarChart3,
  BookOpenCheck,
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Database,
  Eye,
  EyeOff,
  FastForward,
  FileUp,
  Gauge,
  LineChart,
  List,
  ListChecks,
  Lock,
  Magnet,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Settings2,
  Shuffle,
  Square,
  Sparkles,
  Tag,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  Unlock,
  X,
} from "lucide-react";
import type { KLineData } from "klinecharts";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KLineReplayChart,
  type CandleContextTarget,
  type DecisionMarker,
  type DrawingRequest,
  type PersistedDrawing,
  type TradeMarker,
} from "./KLineReplayChart";
import { DataSourceManager } from "./DataSourceManager";
import { ProviderSettingsPanel } from "./ProviderSettingsPanel";
import {
  CN_A_MAINBOARD_RULES_V1,
  buyQuantityStep,
  createPriceBand,
  describeBuyQuantity,
  findNextTradingSessionIndex,
  minimumBuyQuantity,
  normalizeBuyQuantity,
  resolveMarketRules,
  tradingDate,
  validateCloseOrder,
  validateMarketFill,
  validateOpenOrder,
  type MarketRuleProfile,
  type PriceBand,
  type RuleValidation,
} from "../lib/marketRules";
import {
  advanceWithinTask,
  createLegacyTrainingTask,
  defaultTrainingTaskDraft,
  finishTask,
  resolveTrainingTask,
  taskProgress,
  trainingModeLabels,
  type TrainingMode,
  type TrainingTask,
  type TrainingTaskDraft,
} from "../lib/trainingTasks";
import { summarizePerformance, type PerformanceRecord } from "../lib/performance";
import {
  accountEquity,
  accountMarketValue,
  availableCash as calculateAvailableCash,
  executionCashFlow,
  portfolioReturnPct,
  positionReturnPct,
  settleOpenPositionsAtPrice,
  type TradingMode,
} from "../lib/tradingAccount";

type View = "replay" | "performance" | "database" | "review";
type DataMarket = "CN" | "US" | "FX" | "GOLD";
type Instrument = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  timezone: string;
  pricePrecision: number;
};
type AvailableInstrument = {
  id: string;
  short: string;
  label: string;
  market: string;
  timeframes: string[];
};
function InstrumentPicker({
  value,
  instruments,
  onChange,
  ariaLabel,
}: {
  value: string;
  instruments: AvailableInstrument[];
  onChange: (instrumentId: string) => void;
  ariaLabel: string;
}) {
  const selected = instruments.find((item) => item.id === value);
  const selectedText = selected ? `${selected.short} · ${selected.label}` : value;
  const [query, setQuery] = useState(selectedText);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized && normalized !== selectedText.toLowerCase()
      ? instruments.filter((item) =>
          item.short.toLowerCase().includes(normalized) ||
          item.label.toLowerCase().includes(normalized))
      : instruments;
    const result = filtered.slice(0, 40);
    if (selected && !result.some((item) => item.id === selected.id)) result.unshift(selected);
    return result.slice(0, 40);
  }, [instruments, query, selected, selectedText]);

  return (
    <div className="instrument-picker">
      <input
        value={open ? query : selectedText}
        aria-label={ariaLabel}
        autoComplete="off"
        onFocus={(event) => {
          setQuery(selectedText);
          setOpen(true);
          event.currentTarget.select();
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            onChange(matches[0].id);
            setOpen(false);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <div className="instrument-picker-menu" role="listbox" aria-label={`${ariaLabel}搜索结果`}>
          {matches.length ? matches.map((item) => (
            <button
              type="button"
              role="option"
              aria-selected={item.id === value}
              key={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
            >
              <strong>{item.short}</strong><span>{item.label}</span><small>{item.market}</small>
            </button>
          )) : <span className="instrument-picker-empty">没有匹配的品种</span>}
          {instruments.length > matches.length && <i>输入代码或名称继续筛选 · 最多显示 40 条</i>}
        </div>
      )}
    </div>
  );
}
type Coverage = Instrument & {
  timeframe: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  adjustmentType: string;
  source: string;
};
function coverageKey(item: Coverage) {
  return `${item.id}\u0000${item.timeframe}\u0000${item.adjustmentType}\u0000${item.source}`;
}
const dataMarkets: Array<{ id: DataMarket; label: string; description: string }> = [
  { id: "CN", label: "A股", description: "沪深京股票、指数、基金与可转债" },
  { id: "US", label: "美股", description: "Alpaca 免费历史行情" },
  { id: "FX", label: "外汇", description: "主要与交叉货币对" },
  { id: "GOLD", label: "黄金", description: "现货黄金与贵金属" },
];
type PositionSide = "long" | "short";
type OrderAction = "open" | "close";
type PendingOrder = {
  id: string;
  action: OrderAction;
  side: "buy" | "sell";
  qty: number;
  createdAt: number;
  positionId: string;
  ruleId?: string;
  ruleVersion?: string;
  priceBand?: PriceBand | null;
  reservedCash?: number;
  executeAtTimestamp?: number;
};
type PositionLot = {
  id: string;
  side: PositionSide;
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  entryOrderId: string;
  status: "open" | "closed";
  exitPrice?: number;
  exitTimestamp?: number;
  exitOrderId?: string;
  realizedPnl?: number;
};
type Execution = {
  id: string;
  orderId: string;
  positionId: string;
  action: OrderAction;
  side: "buy" | "sell";
  qty: number;
  price: number;
  timestamp: number;
  realizedPnl: number;
  ruleId?: string;
  ruleVersion?: string;
};
type OrderRejection = {
  id: string;
  orderId?: string;
  code: string;
  message: string;
  timestamp: number;
  ruleId: string;
  ruleVersion: string;
};
type Decision = {
  marketState: string;
  location: string;
  reasons: string[];
  stop: string;
  target: string;
  note: string;
};
type DecisionSubmission = {
  id: string;
  barTimestamp: number;
  cursor: number;
  referencePrice: number;
  decision: Decision;
  submittedAt: string;
  backfilled?: boolean;
  recordedAtCursor?: number;
};
type TrainingEvent = {
  id: string;
  sequence: number;
  type: string;
  barTimestamp?: number;
  payload: Record<string, unknown>;
  occurredAt: string;
};
type SnapshotMeta = {
  id: string;
  contentHash: string;
  instrumentId: string;
  timeframe: string;
  adjustmentType: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  createdAt: string;
};
type TrainingState = {
  version: 7;
  cursor: number;
  cursorTimestamp?: number;
  dataSignature?: string;
  dataSnapshotId?: string;
  snapshotHash?: string;
  randomSeed: string;
  positions: PositionLot[];
  pendingOrders: PendingOrder[];
  executions: Execution[];
  orderRejections: OrderRejection[];
  decision: Decision;
  decisionSubmissions: DecisionSubmission[];
  orderQty: number;
  drawings: PersistedDrawing[];
  events: TrainingEvent[];
  marketRules?: MarketRuleProfile;
  trainingTask?: TrainingTask;
  tradingMode: TradingMode;
  initialCapital: number;
  cashBalance: number;
  pnlSnapshot?: {
    realized: number;
    floating: number;
    total: number;
    openPositions: number;
    closedPositions: number;
    returnPct?: number;
    equity?: number;
    cashBalance?: number;
  };
};
type TrainingSession = {
  id: string;
  instrumentId: string;
  timeframe: string;
  dataSnapshotId?: string;
  stateJson: string;
  createdAt: string;
  updatedAt: string;
};
type RestoreRequest = {
  id: string;
  instrumentId: string;
  timeframe: string;
  state: TrainingState;
  updatedAt?: string;
};
type NewTaskRequest = {
  instrumentId: string;
  timeframe: string;
  draft: TrainingTaskDraft;
  snapshotId?: string;
};
type MistakeSource = {
  session: TrainingSession;
  state: TrainingState;
  count: number;
  targetCursor: number;
  label: string;
};
type SettingsTab = "basic" | "training" | "data";
type TaskSetupKind = "configured" | "random";
type PerformanceFilters = {
  instrumentId: string;
  timeframe: string;
  modeLabel: string;
  status: "all" | "active" | "completed";
  dateFrom: string;
  dateTo: string;
};
type AppSettings = {
  defaultInstrumentId: string;
  defaultTimeframe: string;
  defaultOrderQty: number;
  defaultSpeed: number;
  tradingMode: TradingMode;
  initialCapital: number;
  randomInstrumentMode: "current" | "all" | "market";
  randomMarket: string;
  randomTimeframeMode: "current" | "all" | "fixed";
  randomTimeframe: string;
  randomDateMode: "all" | "range";
  randomStartDate: string;
  randomEndDate: string;
  randomLength: number;
};

const LAST_DRAFT_KEY = "kline-replay-lab:last-training";
const APP_SETTINGS_KEY = "kline-replay-lab:settings";
const CUSTOM_REASON_TAGS_KEY = "kline-replay-lab:custom-reason-tags";
const defaultPerformanceFilters: PerformanceFilters = {
  instrumentId: "all",
  timeframe: "all",
  modeLabel: "all",
  status: "all",
  dateFrom: "",
  dateTo: "",
};
const defaultDecision: Decision = {
  marketState: "趋势",
  location: "回调位置",
  reasons: ["顺势", "关键位置"],
  stop: "",
  target: "",
  note: "",
};

const defaultInstruments = [
  { id: "600519.SH", short: "600519", label: "贵州茅台", market: "A股", timeframes: ["1d", "1w"] },
  { id: "AAPL.US", short: "AAPL", label: "Apple", market: "美股", timeframes: ["1d"] },
];
const timeframes = ["5m", "1h", "1d", "1w"];
const coveragePageSize = 100;
const defaultAppSettings: AppSettings = {
  defaultInstrumentId: "600519.SH",
  defaultTimeframe: "1d",
  defaultOrderQty: 100,
  defaultSpeed: 1,
  tradingMode: "return",
  initialCapital: 100000,
  randomInstrumentMode: "all",
  randomMarket: "A股",
  randomTimeframeMode: "all",
  randomTimeframe: "1d",
  randomDateMode: "all",
  randomStartDate: "",
  randomEndDate: "",
  randomLength: 40,
};
const reasonOptions = ["顺势", "关键位置", "突破回踩", "失败突破", "二次入场", "信号K确认"];
type DrawingTool = {
  name: string;
  label: string;
  icon: typeof LineChart;
  kind?: "rectangle" | "position";
};

const drawingToolGroups: Array<{
  id: string;
  label: string;
  icon: typeof LineChart;
  tools: DrawingTool[];
}> = [
  {
    id: "lines",
    label: "趋势线工具",
    icon: TrendingUp,
    tools: [
      { name: "segment", label: "趋势线", icon: TrendingDown },
      { name: "rayLine", label: "射线", icon: TrendingUp },
      { name: "horizontalStraightLine", label: "水平线", icon: LineChart },
    ],
  },
  {
    id: "channels",
    label: "通道工具",
    icon: Gauge,
    tools: [
      { name: "parallelStraightLine", label: "二线平行通道", icon: Gauge },
      { name: "priceChannelLine", label: "三线价格通道", icon: Gauge },
    ],
  },
  {
    id: "fibonacci",
    label: "斐波那契工具",
    icon: Target,
    tools: [{ name: "fibonacciLine", label: "斐波那契回撤", icon: Target }],
  },
  {
    id: "shapes",
    label: "几何图形",
    icon: Square,
    tools: [{ name: "trainingRectangle", label: "矩形区域", icon: Square, kind: "rectangle" }],
  },
  {
    id: "position",
    label: "测量与预测",
    icon: Gauge,
    tools: [{ name: "trainingPosition", label: "多空仓位", icon: TrendingUp, kind: "position" }],
  },
  {
    id: "notes",
    label: "画笔与注释",
    icon: Brush,
    tools: [
      { name: "brush", label: "画笔", icon: Brush },
      { name: "trainingTextBox", label: "文本框", icon: Tag },
    ],
  },
];

const allDrawingTools = drawingToolGroups.flatMap((group) => group.tools);
const defaultDrawingTools = Object.fromEntries(drawingToolGroups.map((group) => [group.id, group.tools[0].name]));

function drawingLabel(name: string) {
  if (name === "trainingLongPosition") return "多头仓位（旧）";
  if (name === "trainingShortPosition") return "空头仓位（旧）";
  if (name === "trainingTextNote") return "文字标记（旧）";
  return allDrawingTools.find((tool) => tool.name === name)?.label ?? name;
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
    text: { color, size: 12 },
  };
}

function drawingsEqual(left: PersistedDrawing[], right: PersistedDrawing[]) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function money(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function profitFactorLabel(value: number | null) {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(2);
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  const merged = { ...defaultAppSettings, ...value };
  return {
    ...merged,
    defaultInstrumentId: typeof merged.defaultInstrumentId === "string" && merged.defaultInstrumentId
      ? merged.defaultInstrumentId
      : defaultAppSettings.defaultInstrumentId,
    defaultTimeframe: timeframes.includes(merged.defaultTimeframe)
      ? merged.defaultTimeframe
      : defaultAppSettings.defaultTimeframe,
    defaultOrderQty: Math.max(1, Math.round(Number(merged.defaultOrderQty) || defaultAppSettings.defaultOrderQty)),
    tradingMode: merged.tradingMode === "capital" ? "capital" : "return",
    initialCapital: Math.max(1000, Math.round(Number(merged.initialCapital) || defaultAppSettings.initialCapital)),
    defaultSpeed: [0.5, 1, 2, 5].includes(Number(merged.defaultSpeed))
      ? Number(merged.defaultSpeed)
      : defaultAppSettings.defaultSpeed,
    randomInstrumentMode: ["current", "all", "market"].includes(merged.randomInstrumentMode)
      ? merged.randomInstrumentMode
      : defaultAppSettings.randomInstrumentMode,
    randomTimeframeMode: ["current", "all", "fixed"].includes(merged.randomTimeframeMode)
      ? merged.randomTimeframeMode
      : defaultAppSettings.randomTimeframeMode,
    randomTimeframe: timeframes.includes(merged.randomTimeframe)
      ? merged.randomTimeframe
      : defaultAppSettings.randomTimeframe,
    randomDateMode: merged.randomDateMode === "range" ? "range" : "all",
    randomLength: Math.max(0, Math.round(Number(merged.randomLength) || 0)),
  };
}

function randomUint32() {
  const values = new Uint32Array(1);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
}

function createUuid() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function randomItem<T>(items: T[]) {
  if (!items.length) return undefined;
  return items[randomUint32() % items.length];
}

function formatDate(timestamp: number, timeframe: string) {
  const date = new Date(timestamp);
  return timeframe === "5m" || timeframe === "1h"
    ? date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function createTrainingEvent(
  sequence: number,
  type: string,
  barTimestamp?: number,
  payload: Record<string, unknown> = {},
): TrainingEvent {
  return {
    id: createUuid(),
    sequence,
    type,
    barTimestamp,
    payload,
    occurredAt: new Date().toISOString(),
  };
}

function decisionScore(decision: Decision) {
  return [decision.marketState, decision.location, decision.stop, decision.target].filter(Boolean).length * 15
    + Math.min(decision.reasons.length, 2) * 20;
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    session_created: "开始训练",
    session_restored: "恢复训练",
    session_manually_saved: "手动保存",
    decision_submitted: "提交事前决策",
    decision_changed: "编辑决策草稿（旧版）",
    replay_advanced: "推进K线",
    replay_rewound: "回看上一根",
    order_queued: "提交委托",
    order_queued_for_next_session: "预约次日开盘平仓",
    order_cancelled: "撤销委托",
    orders_filled: "订单成交",
    drawings_changed: "更新图表标记",
    playback_toggled: "切换自动播放",
    playback_speed_changed: "调整播放速度",
    order_quantity_changed: "调整下单数量",
    order_rejected: "市场规则拒单",
    orders_rejected: "成交阶段拒单",
    positions_settled_at_training_end: "训练结束自动平仓",
    training_completed: "训练自动结束",
    training_revealed: "解除盲测并继续观察",
  };
  return labels[type] ?? type;
}

function priceLimitReference(
  bars: KLineData[],
  cursor: number,
  timezone: string,
) {
  const current = bars[cursor];
  const next = bars[cursor + 1];
  if (!current) return 0;
  if (!next || tradingDate(current.timestamp, timezone) !== tradingDate(next.timestamp, timezone)) {
    return current.close;
  }
  const session = tradingDate(current.timestamp, timezone);
  for (let index = cursor - 1; index >= 0; index -= 1) {
    if (tradingDate(bars[index].timestamp, timezone) !== session) return bars[index].close;
  }
  return current.close;
}

function replayPriceBand(
  rules: MarketRuleProfile,
  bars: KLineData[],
  cursor: number,
  timezone: string,
  timeframe: string,
) {
  // A weekly bar spans several sessions, so a daily price-limit band cannot be
  // inferred from its previous weekly close. Daily data is ordered from listing
  // onward in the complete local A-share library, which lets us honor IPO days.
  if (timeframe === "1w") return null;
  const listedTradingDay = timeframe === "1d" ? cursor + 2 : undefined;
  return createPriceBand(
    rules,
    priceLimitReference(bars, cursor, timezone),
    listedTradingDay,
  );
}

function createOrderRejection(
  validation: RuleValidation,
  rules: MarketRuleProfile,
  timestamp: number,
  orderId?: string,
): OrderRejection {
  return {
    id: createUuid(),
    orderId,
    code: validation.code ?? "market_rule_rejected",
    message: validation.message ?? "委托不符合当前市场规则",
    timestamp,
    ruleId: rules.id,
    ruleVersion: rules.version,
  };
}

export function TrainingWorkbench() {
  const [view, setView] = useState<View>("replay");
  const [availableInstruments, setAvailableInstruments] = useState(defaultInstruments);
  const [instrumentId, setInstrumentId] = useState("600519.SH");
  const [timeframe, setTimeframe] = useState("1d");
  const [instrument, setInstrument] = useState<Instrument>({
    id: "600519.SH",
    symbol: "600519.SH",
    name: "贵州茅台",
    market: "CN",
    timezone: "Asia/Shanghai",
    pricePrecision: 2,
  });
  const [bars, setBars] = useState<KLineData[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [positions, setPositions] = useState<PositionLot[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [orderRejections, setOrderRejections] = useState<OrderRejection[]>([]);
  const [decisionSubmissions, setDecisionSubmissions] = useState<DecisionSubmission[]>([]);
  const [orderQty, setOrderQty] = useState(100);
  const [orderPanelTab, setOrderPanelTab] = useState<"positions" | "pending" | "history">("positions");
  const [mobileOrdersExpanded, setMobileOrdersExpanded] = useState(false);
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [quickRandomMode, setQuickRandomMode] = useState<"free" | "blind">("free");
  const [decision, setDecision] = useState<Decision>(defaultDecision);
  const [customReasonTags, setCustomReasonTags] = useState<string[]>([]);
  const [customReasonInput, setCustomReasonInput] = useState("");
  const [customReasonTagsReady, setCustomReasonTagsReady] = useState(false);
  const [drawingRequest, setDrawingRequest] = useState<DrawingRequest>(null);
  const [clearNonce, setClearNonce] = useState(0);
  const [drawingsRestoreNonce, setDrawingsRestoreNonce] = useState(0);
  const [drawings, setDrawings] = useState<PersistedDrawing[]>([]);
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
  const [saveState, setSaveState] = useState("未保存");
  const [sessionId, setSessionId] = useState(createUuid);
  const [randomSeed, setRandomSeed] = useState(createUuid);
  const [dataSnapshotId, setDataSnapshotId] = useState("");
  const [snapshotHash, setSnapshotHash] = useState("");
  const [marketRules, setMarketRules] = useState<MarketRuleProfile>(CN_A_MAINBOARD_RULES_V1);
  const [tradingMode, setTradingMode] = useState<TradingMode>("return");
  const [initialCapital, setInitialCapital] = useState(defaultAppSettings.initialCapital);
  const [cashBalance, setCashBalance] = useState(defaultAppSettings.initialCapital);
  const [trainingTask, setTrainingTask] = useState<TrainingTask | null>(null);
  const [showTaskSetup, setShowTaskSetup] = useState(false);
  const [taskSetupKind, setTaskSetupKind] = useState<TaskSetupKind>("configured");
  const [showRandomComplete, setShowRandomComplete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("basic");
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(defaultAppSettings);
  const [settingsError, setSettingsError] = useState("");
  const [taskDraft, setTaskDraft] = useState<TrainingTaskDraft>(defaultTrainingTaskDraft);
  const [setupInstrumentId, setSetupInstrumentId] = useState("600519.SH");
  const [setupTimeframe, setSetupTimeframe] = useState("1d");
  const [setupError, setSetupError] = useState("");
  const [ruleNotice, setRuleNotice] = useState("");
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [selectedDecisionId, setSelectedDecisionId] = useState("");
  const [decisionTarget, setDecisionTarget] = useState<CandleContextTarget | null>(null);
  const [reviewedSession, setReviewedSession] = useState<{ session: TrainingSession; state: TrainingState } | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [coveragePage, setCoveragePage] = useState(1);
  const [coverageTotal, setCoverageTotal] = useState(0);
  const [coverageSummary, setCoverageSummary] = useState({ barCount: 0, timeframeCount: 0 });
  const [coverageSearch, setCoverageSearch] = useState("");
  const [coverageQuery, setCoverageQuery] = useState("");
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [selectedCoverageKeys, setSelectedCoverageKeys] = useState<string[]>([]);
  const [dataMarket, setDataMarket] = useState<DataMarket>("CN");
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [performanceFilters, setPerformanceFilters] = useState<PerformanceFilters>(defaultPerformanceFilters);
  const [selectedPerformanceSessionId, setSelectedPerformanceSessionId] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [chartLoadError, setChartLoadError] = useState("");
  const [startupReady, setStartupReady] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [instrumentCatalogReady, setInstrumentCatalogReady] = useState(false);
  const [trainingReady, setTrainingReady] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [restoreNotice, setRestoreNotice] = useState("");
  const restoreRequestRef = useRef<RestoreRequest | null>(null);
  const newTaskRequestRef = useRef<NewTaskRequest | null>(null);
  const saveCompletedTrainingRef = useRef(false);
  const appSettingsRef = useRef<AppSettings>(defaultAppSettings);
  const eventSequenceRef = useRef(0);
  const decisionPanelRef = useRef<HTMLElement | null>(null);
  const decisionDraftBeforeBackfillRef = useRef<Decision | null>(null);
  const marketLoadRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const startupRandomStartedRef = useRef(false);

  const visibleBars = useMemo(() => bars.slice(0, cursor + 1), [bars, cursor]);
  const dataMarketInstrumentCount = useMemo(() => availableInstruments.filter((item) => {
    const market = item.market.toUpperCase();
    if (dataMarket === "CN") return market === "CN" || market === "A股";
    if (dataMarket === "US") return market === "US" || market === "美股";
    if (dataMarket === "FX") return market === "FX" || market === "FOREX";
    if (dataMarket === "GOLD") return market === "GOLD" || market === "METAL";
    return false;
  }).length, [availableInstruments, dataMarket]);
  const dataMarketLabel = dataMarkets.find((market) => market.id === dataMarket)?.label ?? dataMarket;
  const currentBar = bars[cursor];
  const trainingDateLabel = (timestamp: number) => {
    if (!trainingTask?.hideDate) return formatDate(timestamp, timeframe);
    const index = bars.findIndex((bar) => bar.timestamp === timestamp);
    return index >= 0 ? `K线 #${index + 1}` : "日期已隐藏";
  };
  const trainingPriceLabel = (price: number | undefined) => (
    trainingTask?.hidePrice ? "•••" : price?.toFixed(instrument.pricePrecision) ?? "--"
  );
  const openPositions = useMemo(() => positions.filter((position) => position.status === "open"), [positions]);
  const closedPositions = useMemo(() => positions.filter((position) => position.status === "closed"), [positions]);
  const closablePositions = useMemo(() => currentBar
    ? openPositions.filter((position) => validateCloseOrder(
      marketRules,
      position,
      currentBar.timestamp,
      instrument.timezone,
    ).ok)
    : [], [currentBar, instrument.timezone, marketRules, openPositions]);
  const openPnl = currentBar
    ? openPositions.reduce((sum, position) => sum + (currentBar.close - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1), 0)
    : 0;
  const realizedPnl = closedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
  const totalPnl = realizedPnl + openPnl;
  const currentPrice = currentBar?.close ?? 0;
  const floatingReturnPct = portfolioReturnPct(openPositions, currentPrice);
  const realizedReturnPct = portfolioReturnPct(closedPositions, currentPrice);
  const totalReturnPct = portfolioReturnPct(positions, currentPrice);
  const availableBuyingPower = calculateAvailableCash(cashBalance, pendingOrders);
  const marketValue = accountMarketValue(positions, currentPrice);
  const equity = accountEquity(cashBalance, positions, currentPrice);
  const tradeMarkers = useMemo<TradeMarker[]>(() => positions
    .filter((position) => !currentBar || position.entryTimestamp <= currentBar.timestamp)
    .map((position) => {
      const exitIsVisible = position.exitTimestamp != null && (!currentBar || position.exitTimestamp <= currentBar.timestamp);
      return {
        id: position.id,
        side: position.side,
        qty: position.qty,
        entryPrice: position.entryPrice,
        entryTimestamp: position.entryTimestamp,
        exitPrice: exitIsVisible ? position.exitPrice : undefined,
        exitTimestamp: exitIsVisible ? position.exitTimestamp : undefined,
        realizedPnl: exitIsVisible ? position.realizedPnl : undefined,
      };
    }), [currentBar, positions]);
  const currentTaskProgress = trainingTask
    ? taskProgress(trainingTask, cursor)
    : { revealed: 0, total: 0, percent: 0 };
  const progress = trainingTask
    ? currentTaskProgress.percent
    : bars.length > 1 ? (cursor / (bars.length - 1)) * 100 : 0;
  const trainingComplete = trainingTask?.status === "completed";
  const rewindLocked = Boolean(trainingTask?.randomRun);
  const reviewLocked = Boolean(
    trainingTask?.status === "active"
    && (trainingTask.hideInstrument || trainingTask.hideDate || trainingTask.hidePrice),
  );
  const planScore = decisionScore(decision);
  const decisionMarkers = useMemo<DecisionMarker[]>(() => decisionSubmissions
    .filter((submission) => !currentBar || submission.barTimestamp <= currentBar.timestamp)
    .map((submission, index) => {
      const submissionBar = bars[submission.cursor] ?? bars.find((bar) => bar.timestamp === submission.barTimestamp);
      return {
        id: submission.id,
        timestamp: submission.barTimestamp,
        price: submissionBar?.high ?? submission.referencePrice,
        label: `计划 ${index + 1}`,
      };
    }), [bars, currentBar, decisionSubmissions]);
  const selectedDecision = decisionSubmissions.find((submission) => submission.id === selectedDecisionId);

  const dataSignature = useMemo(() => bars.length
    ? `${bars.length}:${bars[0].timestamp}:${bars[bars.length - 1].timestamp}`
    : "", [bars]);
  const trainingState = useMemo<TrainingState>(() => ({
    version: 7,
    cursor,
    cursorTimestamp: currentBar?.timestamp,
    dataSignature,
    dataSnapshotId,
    snapshotHash,
    randomSeed,
    positions,
    pendingOrders,
    executions,
    orderRejections,
    decision,
    decisionSubmissions,
    orderQty,
    drawings,
    events,
    marketRules,
    trainingTask: trainingTask ?? undefined,
    tradingMode,
    initialCapital,
    cashBalance,
    pnlSnapshot: {
      realized: realizedPnl,
      floating: openPnl,
      total: totalPnl,
      openPositions: openPositions.length,
      closedPositions: closedPositions.length,
      returnPct: totalReturnPct,
      equity,
      cashBalance,
    },
  }), [cashBalance, closedPositions.length, cursor, currentBar?.timestamp, dataSignature, dataSnapshotId, decision, decisionSubmissions, drawings, equity, events, executions, initialCapital, marketRules, openPnl, openPositions.length, orderQty, orderRejections, pendingOrders, positions, randomSeed, realizedPnl, snapshotHash, totalPnl, totalReturnPct, tradingMode, trainingTask]);
  const reviewState = reviewedSession?.state ?? trainingState;
  const reviewClosedPositions = reviewState.positions.filter((position) => position.status === "closed");
  const reviewRealizedPnl = reviewClosedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
  const reviewRealizedReturnPct = portfolioReturnPct(reviewClosedPositions, 0);
  const reviewWinningTrades = reviewClosedPositions.filter((position) => (position.realizedPnl ?? 0) > 0).length;
  const reviewLosingTrades = reviewClosedPositions.filter((position) => (position.realizedPnl ?? 0) < 0).length;
  const reviewFlatTrades = reviewClosedPositions.length - reviewWinningTrades - reviewLosingTrades;
  const reviewTradeWinRate = reviewClosedPositions.length
    ? Math.round(reviewWinningTrades / reviewClosedPositions.length * 100)
    : 0;
  const reviewTotalResult = reviewState.tradingMode === "capital"
    ? reviewState.pnlSnapshot?.total ?? reviewRealizedPnl
    : reviewState.pnlSnapshot?.returnPct ?? reviewRealizedReturnPct;
  const reviewLatestSubmission = reviewState.decisionSubmissions.at(-1);
  const reviewDecision = reviewLatestSubmission?.decision ?? reviewState.decision;
  const reviewPlanScore = decisionScore(reviewDecision);
  const reviewTitle = reviewedSession
    ? `${reviewedSession.session.instrumentId} · ${reviewedSession.session.timeframe}`
    : `${instrumentId} · ${timeframe} · 当前训练`;

  const parseTrainingState = useCallback((value: unknown): TrainingState | null => {
    if (!value || typeof value !== "object") return null;
    const state = value as Partial<TrainingState>;
    if (!Number.isFinite(state.cursor) || !Array.isArray(state.positions) || !Array.isArray(state.pendingOrders)) return null;
    return {
      version: 7,
      cursor: Number(state.cursor),
      cursorTimestamp: typeof state.cursorTimestamp === "number" ? state.cursorTimestamp : undefined,
      dataSignature: typeof state.dataSignature === "string" ? state.dataSignature : undefined,
      dataSnapshotId: typeof state.dataSnapshotId === "string" ? state.dataSnapshotId : undefined,
      snapshotHash: typeof state.snapshotHash === "string" ? state.snapshotHash : undefined,
      randomSeed: typeof state.randomSeed === "string" ? state.randomSeed : createUuid(),
      positions: state.positions,
      pendingOrders: state.pendingOrders,
      executions: Array.isArray(state.executions) ? state.executions : [],
      orderRejections: Array.isArray(state.orderRejections) ? state.orderRejections : [],
      decision: state.decision && typeof state.decision === "object" ? { ...defaultDecision, ...state.decision } : defaultDecision,
      decisionSubmissions: Array.isArray(state.decisionSubmissions) ? state.decisionSubmissions : [],
      orderQty: typeof state.orderQty === "number" && state.orderQty > 0 ? state.orderQty : 100,
      drawings: Array.isArray(state.drawings) ? state.drawings : [],
      events: Array.isArray(state.events) ? state.events : [],
      marketRules: state.marketRules && typeof state.marketRules === "object" ? state.marketRules : undefined,
      trainingTask: state.trainingTask && typeof state.trainingTask === "object" ? state.trainingTask : undefined,
      tradingMode: state.tradingMode === "capital" ? "capital" : "return",
      initialCapital: typeof state.initialCapital === "number" && state.initialCapital > 0
        ? state.initialCapital
        : defaultAppSettings.initialCapital,
      cashBalance: typeof state.cashBalance === "number" && Number.isFinite(state.cashBalance)
        ? state.cashBalance
        : defaultAppSettings.initialCapital,
      pnlSnapshot: state.pnlSnapshot && typeof state.pnlSnapshot === "object"
        ? state.pnlSnapshot
        : {
          realized: state.positions
            .filter((position) => position.status === "closed")
            .reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0),
          floating: 0,
          total: state.positions
            .filter((position) => position.status === "closed")
            .reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0),
          openPositions: state.positions.filter((position) => position.status === "open").length,
          closedPositions: state.positions.filter((position) => position.status === "closed").length,
        },
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(APP_SETTINGS_KEY);
        const nextSettings = stored
          ? normalizeSettings(JSON.parse(stored) as Partial<AppSettings>)
          : defaultAppSettings;
        appSettingsRef.current = nextSettings;
        setAppSettings(nextSettings);
        setSettingsDraft(nextSettings);
        setSpeed(nextSettings.defaultSpeed);
        setOrderQty(nextSettings.defaultOrderQty);
      } catch {
        window.localStorage.removeItem(APP_SETTINGS_KEY);
      } finally {
        setSettingsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(CUSTOM_REASON_TAGS_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        if (Array.isArray(parsed)) {
          setCustomReasonTags(parsed
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter((tag, index, items) => tag && !reasonOptions.includes(tag) && items.indexOf(tag) === index)
            .slice(0, 30));
        }
      } catch {
        window.localStorage.removeItem(CUSTOM_REASON_TAGS_KEY);
      } finally {
        setCustomReasonTagsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!customReasonTagsReady) return;
    window.localStorage.setItem(CUSTOM_REASON_TAGS_KEY, JSON.stringify(customReasonTags));
  }, [customReasonTags, customReasonTagsReady]);

  useEffect(() => () => marketLoadRef.current.controller?.abort(), []);

  const appendEvent = useCallback((
    type: string,
    payload: Record<string, unknown> = {},
    barTimestamp = currentBar?.timestamp,
  ) => {
    const sequence = eventSequenceRef.current + 1;
    eventSequenceRef.current = sequence;
    const event = createTrainingEvent(sequence, type, barTimestamp, payload);
    setEvents((items) => [...items, event]);
    setSaveState("有未保存更改");
    return event;
  }, [currentBar?.timestamp]);

  const queueRestore = useCallback((request: RestoreRequest) => {
    restoreRequestRef.current = request;
    newTaskRequestRef.current = null;
    setInstrumentId(request.instrumentId);
    setTimeframe(request.timeframe);
    setView("replay");
    setLoadNonce((value) => value + 1);
  }, []);

  const loadBars = useCallback(async () => {
    if (!startupReady) return;
    marketLoadRef.current.controller?.abort();
    const requestId = marketLoadRef.current.id + 1;
    const controller = new AbortController();
    marketLoadRef.current = { id: requestId, controller };
    const restoreRequest = restoreRequestRef.current;
    restoreRequestRef.current = null;
    const newTaskRequest = newTaskRequestRef.current;
    newTaskRequestRef.current = null;
    const requestInstrumentId = restoreRequest?.instrumentId ?? newTaskRequest?.instrumentId ?? instrumentId;
    const requestTimeframe = restoreRequest?.timeframe ?? newTaskRequest?.timeframe ?? timeframe;
    setLoading(true);
    setChartLoadError("");
    setTrainingReady(false);
    setPlaying(false);
    setShowRandomComplete(false);
    setDecisionTarget(null);
    decisionDraftBeforeBackfillRef.current = null;
    saveCompletedTrainingRef.current = false;
    try {
      const requestedSnapshotId = restoreRequest?.state.dataSnapshotId
        ?? restoreRequest?.dataSnapshotId
        ?? newTaskRequest?.snapshotId;
      let data: { instrument: Instrument; candles: KLineData[]; snapshot: SnapshotMeta };
      let legacySnapshotCreated = false;
      if (requestedSnapshotId) {
        const response = await fetch(`/api/snapshots?id=${encodeURIComponent(requestedSnapshotId)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("训练绑定的数据快照不存在，无法进行确定性恢复");
        data = await response.json() as typeof data;
      } else {
        // Snapshot creation already loads and returns the complete candle set.
        // Avoid reading and serializing the same market file twice per launch.
        const snapshotResponse = await fetch("/api/snapshots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instrumentId: requestInstrumentId, timeframe: requestTimeframe, adjustmentType: "none" }),
          signal: controller.signal,
        });
        if (!snapshotResponse.ok) {
          const failure = await snapshotResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(failure?.error ?? "不可变行情快照创建失败");
        }
        data = await snapshotResponse.json() as typeof data;
        legacySnapshotCreated = Boolean(restoreRequest);
      }
      if (marketLoadRef.current.id !== requestId) return;
      setInstrument(data.instrument);
      setBars(data.candles);
      setDataSnapshotId(data.snapshot.id);
      setSnapshotHash(data.snapshot.contentHash);
      const loadedMarketRules = restoreRequest?.state.marketRules
        ?? resolveMarketRules(data.instrument.market, data.instrument.id);
      setMarketRules(loadedMarketRules);
      setRuleNotice("");
      if (restoreRequest) {
        const timestampCursor = restoreRequest.state.cursorTimestamp == null
          ? -1
          : data.candles.findIndex((bar) => bar.timestamp === restoreRequest.state.cursorTimestamp);
        const restoredCursor = timestampCursor >= 0 ? timestampCursor : restoreRequest.state.cursor;
        setCursor(Math.max(0, Math.min(data.candles.length - 1, restoredCursor)));
        setPositions(restoreRequest.state.positions);
        setPendingOrders(restoreRequest.state.pendingOrders);
        setExecutions(restoreRequest.state.executions);
        setOrderRejections(restoreRequest.state.orderRejections);
        setDecision(restoreRequest.state.decision);
        setDecisionSubmissions(restoreRequest.state.decisionSubmissions);
        setSelectedDecisionId("");
        setDecisionTarget(null);
        setOrderQty(restoreRequest.state.orderQty);
        setTradingMode(restoreRequest.state.tradingMode);
        setInitialCapital(restoreRequest.state.initialCapital);
        setCashBalance(restoreRequest.state.cashBalance);
        setDrawings(restoreRequest.state.drawings);
        setDrawingUndoStack([]);
        setDrawingRedoStack([]);
        setDrawingsRestoreNonce(Date.now());
        setSessionId(restoreRequest.id);
        setRandomSeed(restoreRequest.state.randomSeed);
        const restoredTask = restoreRequest.state.trainingTask
          ?? createLegacyTrainingTask(data.candles, Math.max(0, Math.min(data.candles.length - 1, restoredCursor)));
        setTrainingTask(finishTask(restoredTask, restoredCursor));
        const lastSequence = restoreRequest.state.events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
        eventSequenceRef.current = lastSequence + 1;
        setEvents([
          ...restoreRequest.state.events,
          createTrainingEvent(lastSequence + 1, "session_restored", data.candles[restoredCursor]?.timestamp, {
            snapshotId: data.snapshot.id,
            snapshotHash: data.snapshot.contentHash,
            marketRuleId: loadedMarketRules.id,
            marketRuleVersion: loadedMarketRules.version,
          }),
        ]);
        setSaveState("已恢复保存点");
        setRestoreNotice(legacySnapshotCreated
          ? "旧训练已恢复，并从当前行情建立首份不可变快照；从本次保存开始可以跨行情版本完全复现。"
          : `已从不可变快照恢复，哈希 ${data.snapshot.contentHash.slice(0, 12)}；当前行情库后续变化不会影响本次训练。`);
      } else {
        const nextSessionId = createUuid();
        const nextSeed = createUuid();
        const nextTask = resolveTrainingTask(
          newTaskRequest?.draft ?? defaultTrainingTaskDraft,
          data.candles,
          data.instrument.timezone,
          nextSeed,
        );
        setCursor(nextTask.startCursor);
        setTrainingTask(nextTask);
        saveCompletedTrainingRef.current = nextTask.status === "completed";
        setPositions([]);
        setPendingOrders([]);
        setExecutions([]);
        setOrderRejections([]);
        setDecision(defaultDecision);
        setDecisionSubmissions([]);
        setSelectedDecisionId("");
        setDecisionTarget(null);
        setOrderQty(normalizeBuyQuantity(loadedMarketRules, appSettingsRef.current.defaultOrderQty));
        setTradingMode(appSettingsRef.current.tradingMode);
        setInitialCapital(appSettingsRef.current.initialCapital);
        setCashBalance(appSettingsRef.current.initialCapital);
        setSpeed(appSettingsRef.current.defaultSpeed);
        setDrawings([]);
        setDrawingUndoStack([]);
        setDrawingRedoStack([]);
        setClearNonce(Date.now());
        setSessionId(nextSessionId);
        setRandomSeed(nextSeed);
        eventSequenceRef.current = 1;
        setEvents([createTrainingEvent(1, "session_created", data.candles[nextTask.startCursor]?.timestamp, {
          instrumentId: requestInstrumentId,
          timeframe: requestTimeframe,
          snapshotId: data.snapshot.id,
          snapshotHash: data.snapshot.contentHash,
          randomSeed: nextSeed,
          startCursor: nextTask.startCursor,
          endCursor: nextTask.endCursor,
          trainingMode: nextTask.mode,
          hiddenFields: {
            instrument: nextTask.hideInstrument,
            date: nextTask.hideDate,
            price: nextTask.hidePrice,
          },
          sourceSessionId: nextTask.sourceSessionId,
          marketRuleId: loadedMarketRules.id,
          marketRuleVersion: loadedMarketRules.version,
          tradingMode: appSettingsRef.current.tradingMode,
          initialCapital: appSettingsRef.current.initialCapital,
        })]);
        setSaveState("新训练 · 尚未保存");
        setRestoreNotice("");
      }
      setOrderPanelTab("positions");
      setTrainingReady(true);
    } catch (error) {
      if (marketLoadRef.current.id !== requestId || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "行情加载失败";
      setChartLoadError(message);
      setImportStatus(message);
      setTrainingReady(false);
    } finally {
      if (marketLoadRef.current.id === requestId) {
        marketLoadRef.current.controller = null;
        setLoading(false);
      }
    }
  }, [instrumentId, startupReady, timeframe]);

  useEffect(() => {
    const timer = window.setTimeout(loadBars, 0);
    return () => window.clearTimeout(timer);
  }, [loadBars, loadNonce]);

  const persistTrainingState = useCallback(async (
    state: TrainingState,
    successMessage: string,
  ) => {
    const savedAt = new Date().toISOString();
    window.localStorage.setItem(LAST_DRAFT_KEY, JSON.stringify({
      id: sessionId,
      instrumentId,
      timeframe,
      state,
      updatedAt: savedAt,
    }));
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: sessionId, instrumentId, timeframe, dataSnapshotId, state }),
      });
      setSaveState(response.ok ? successMessage : "浏览器保存点已写入 · 数据库保存失败");
      return response.ok;
    } catch {
      setSaveState("浏览器保存点已写入 · 数据库保存失败");
      return false;
    }
  }, [dataSnapshotId, instrumentId, sessionId, timeframe]);

  useEffect(() => {
    if (!trainingReady || !trainingComplete || !saveCompletedTrainingRef.current) return;
    saveCompletedTrainingRef.current = false;
    setSaveState("训练完成 · 正在保存…");
    void persistTrainingState(trainingState, "训练完成 · 已保存");
  }, [persistTrainingState, trainingComplete, trainingReady, trainingState]);

  const executeOrders = useCallback((orders: PendingOrder[], bar: KLineData) => {
    const nextPositions = [...positions];
    const fills: Execution[] = [];
    const rejections: OrderRejection[] = [];
    let nextCashBalance = cashBalance;

    if (!orders.length) {
      return {
        positions: nextPositions,
        cashBalance: nextCashBalance,
        fills,
        rejections,
      };
    }

    orders.forEach((order) => {
      const priceBand = order.priceBand
        ?? replayPriceBand(marketRules, bars, cursor, instrument.timezone, timeframe);
      const fillValidation = validateMarketFill(marketRules, order.side, bar.open, priceBand);
      if (!fillValidation.ok) {
        rejections.push(createOrderRejection(fillValidation, marketRules, bar.timestamp, order.id));
        return;
      }
      if (order.action === "open") {
        const cashFlow = executionCashFlow(order.side, bar.open, order.qty);
        if (tradingMode === "capital" && cashFlow < 0 && nextCashBalance + cashFlow < -0.000001) {
          rejections.push(createOrderRejection({
            ok: false,
            code: "insufficient_cash_at_fill",
            message: `下一根开盘需要 ${Math.abs(cashFlow).toFixed(2)}，可用资金仅 ${nextCashBalance.toFixed(2)}`,
          }, marketRules, bar.timestamp, order.id));
          return;
        }
        const side: PositionSide = order.side === "buy" ? "long" : "short";
        nextPositions.push({
          id: order.positionId,
          side,
          qty: order.qty,
          entryPrice: bar.open,
          entryTimestamp: bar.timestamp,
          entryOrderId: order.id,
          status: "open",
        });
        fills.push({
          id: createUuid(),
          orderId: order.id,
          positionId: order.positionId,
          action: "open",
          side: order.side,
          qty: order.qty,
          price: bar.open,
          timestamp: bar.timestamp,
          realizedPnl: 0,
          ruleId: order.ruleId ?? marketRules.id,
          ruleVersion: order.ruleVersion ?? marketRules.version,
        });
        if (tradingMode === "capital") nextCashBalance += cashFlow;
        return;
      }

      const positionIndex = nextPositions.findIndex((position) => position.id === order.positionId && position.status === "open");
      if (positionIndex < 0) return;
      const position = nextPositions[positionIndex];
      const direction = position.side === "long" ? 1 : -1;
      const realized = (bar.open - position.entryPrice) * position.qty * direction;
      nextPositions[positionIndex] = {
        ...position,
        status: "closed",
        exitPrice: bar.open,
        exitTimestamp: bar.timestamp,
        exitOrderId: order.id,
        realizedPnl: realized,
      };
      fills.push({
        id: createUuid(),
        orderId: order.id,
        positionId: position.id,
        action: "close",
        side: order.side,
        qty: position.qty,
        price: bar.open,
        timestamp: bar.timestamp,
        realizedPnl: realized,
        ruleId: order.ruleId ?? marketRules.id,
        ruleVersion: order.ruleVersion ?? marketRules.version,
      });
      if (tradingMode === "capital") {
        nextCashBalance += executionCashFlow(order.side, bar.open, position.qty);
      }
    });

    setPositions(nextPositions);
    if (tradingMode === "capital") setCashBalance(nextCashBalance);
    if (fills.length) {
      setExecutions((items) => [...items, ...fills]);
      appendEvent("orders_filled", {
        fills,
        marketRuleId: marketRules.id,
        marketRuleVersion: marketRules.version,
        tradingMode,
        cashBalance: nextCashBalance,
      }, bar.timestamp);
    }
    if (rejections.length) {
      setOrderRejections((items) => [...items, ...rejections]);
      setRuleNotice(rejections.map((rejection) => rejection.message).join("；"));
      appendEvent("orders_rejected", { rejections }, bar.timestamp);
    }
    return {
      positions: nextPositions,
      cashBalance: nextCashBalance,
      fills,
      rejections,
    };
  }, [appendEvent, bars, cashBalance, cursor, instrument.timezone, marketRules, positions, timeframe, tradingMode]);

  const settleTrainingAtBar = useCallback((
    basePositions: PositionLot[],
    baseCashBalance: number,
    bar: KLineData,
    cancelledOrders: PendingOrder[],
  ) => {
    const positionsToClose = basePositions.filter((position) => position.status === "open");
    const exitOrderIds = new Map(positionsToClose.map((position) => [position.id, createUuid()]));
    const settledPositions = settleOpenPositionsAtPrice(
      basePositions,
      bar.close,
      bar.timestamp,
      (position) => exitOrderIds.get(position.id) ?? createUuid(),
    );
    const settlementFills: Execution[] = positionsToClose.map((position) => {
      const direction = position.side === "long" ? 1 : -1;
      return {
        id: createUuid(),
        orderId: exitOrderIds.get(position.id) ?? createUuid(),
        positionId: position.id,
        action: "close",
        side: position.side === "long" ? "sell" : "buy",
        qty: position.qty,
        price: bar.close,
        timestamp: bar.timestamp,
        realizedPnl: (bar.close - position.entryPrice) * position.qty * direction,
        ruleId: marketRules.id,
        ruleVersion: marketRules.version,
      };
    });
    const settledCashBalance = tradingMode === "capital"
      ? settlementFills.reduce((balance, fill) => (
          balance + executionCashFlow(fill.side, fill.price, fill.qty)
        ), baseCashBalance)
      : baseCashBalance;

    setPositions(settledPositions);
    setPendingOrders([]);
    if (settlementFills.length) setExecutions((items) => [...items, ...settlementFills]);
    if (tradingMode === "capital") setCashBalance(settledCashBalance);
    appendEvent("positions_settled_at_training_end", {
      price: bar.close,
      timestamp: bar.timestamp,
      closedPositionIds: positionsToClose.map((position) => position.id),
      executionIds: settlementFills.map((fill) => fill.id),
      cancelledOrderIds: cancelledOrders.map((order) => order.id),
      tradingMode,
      cashBalance: settledCashBalance,
    }, bar.timestamp);
  }, [appendEvent, marketRules.id, marketRules.version, tradingMode]);

  const revealMany = useCallback((count: number) => {
    const endCursor = trainingTask?.endCursor ?? bars.length - 1;
    if (cursor >= endCursor || trainingTask?.status === "completed") {
      setPlaying(false);
      return;
    }
    const requestedNextCursor = trainingTask
      ? advanceWithinTask(trainingTask, cursor, count)
      : Math.min(cursor + Math.max(1, count), bars.length - 1);
    const earliestScheduledIndex = pendingOrders
      .filter((order) => order.executeAtTimestamp != null)
      .map((order) => bars.findIndex((bar, index) => index > cursor && bar.timestamp >= Number(order.executeAtTimestamp)))
      .filter((index) => index >= 0)
      .reduce((earliest, index) => Math.min(earliest, index), Number.POSITIVE_INFINITY);
    const nextCursor = Number.isFinite(earliestScheduledIndex)
      && earliestScheduledIndex > cursor + 1
      && requestedNextCursor >= earliestScheduledIndex
      ? earliestScheduledIndex - 1
      : requestedNextCursor;
    const nextBar = bars[cursor + 1];
    const dueOrders = pendingOrders.filter((order) => (
      order.executeAtTimestamp == null || order.executeAtTimestamp <= nextBar.timestamp
    ));
    const executionResult = executeOrders(dueOrders, nextBar);
    const dueIds = new Set(dueOrders.map((order) => order.id));
    const remainingOrders = pendingOrders.filter((order) => !dueIds.has(order.id));
    if (dueOrders.length) {
      setPendingOrders((orders) => orders.filter((order) => !dueIds.has(order.id)));
    }
    setCursor(nextCursor);
    appendEvent("replay_advanced", {
      fromCursor: cursor,
      toCursor: nextCursor,
      requestedCount: count,
      executedOrderIds: dueOrders.map((order) => order.id),
    }, bars[nextCursor]?.timestamp);
    if (trainingTask && nextCursor >= trainingTask.endCursor) {
      settleTrainingAtBar(
        executionResult.positions,
        executionResult.cashBalance,
        bars[nextCursor] ?? nextBar,
        remainingOrders,
      );
      const completedTask = finishTask(trainingTask, nextCursor);
      setTrainingTask(completedTask);
      setPlaying(false);
      if (completedTask.randomRun) setShowRandomComplete(true);
      saveCompletedTrainingRef.current = true;
      appendEvent("training_completed", {
        trainingMode: completedTask.mode,
        startCursor: completedTask.startCursor,
        endCursor: completedTask.endCursor,
      }, bars[nextCursor]?.timestamp);
    }
    setSaveState("有未保存更改");
  }, [appendEvent, bars, cursor, executeOrders, pendingOrders, settleTrainingAtBar, trainingTask]);

  const revealNext = useCallback(() => revealMany(1), [revealMany]);
  const revealPrevious = () => {
    if (rewindLocked) return;
    const nextCursor = Math.max(trainingTask?.startCursor ?? 0, cursor - 1);
    if (nextCursor === cursor) return;
    if (decisionTarget && decisionTarget.dataIndex > nextCursor) {
      if (decisionDraftBeforeBackfillRef.current) setDecision(decisionDraftBeforeBackfillRef.current);
      decisionDraftBeforeBackfillRef.current = null;
      setDecisionTarget(null);
    }
    setCursor(nextCursor);
    appendEvent("replay_rewound", { fromCursor: cursor, toCursor: nextCursor }, bars[nextCursor]?.timestamp);
  };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(revealNext, Math.max(120, 950 / speed));
    return () => window.clearInterval(timer);
  }, [playing, revealNext, speed]);

  const rejectOrderAttempt = (validation: RuleValidation, details: Record<string, unknown> = {}) => {
    if (!currentBar || validation.ok) return;
    const rejection = createOrderRejection(validation, marketRules, currentBar.timestamp);
    setOrderRejections((items) => [...items, rejection]);
    setRuleNotice(rejection.message);
    appendEvent("order_rejected", {
      rejection,
      ...details,
    }, currentBar.timestamp);
    setSaveState("市场规则已拒绝委托");
  };

  const queueOpenOrder = (side: "buy" | "sell", qty = orderQty) => {
    if (!currentBar || qty <= 0 || cursor >= (trainingTask?.endCursor ?? bars.length - 1) || trainingComplete) return;
    const validation = validateOpenOrder(marketRules, side, qty);
    if (!validation.ok) {
      rejectOrderAttempt(validation, { action: "open", side, qty });
      return;
    }
    const reservedCash = side === "buy" ? currentBar.close * qty : 0;
    if (tradingMode === "capital" && reservedCash > availableBuyingPower + 0.000001) {
      rejectOrderAttempt({
        ok: false,
        code: "insufficient_cash",
        message: `预计需要 ${reservedCash.toFixed(2)}，当前可用资金仅 ${availableBuyingPower.toFixed(2)}`,
      }, { action: "open", side, qty, availableBuyingPower });
      return;
    }
    const priceBand = replayPriceBand(marketRules, bars, cursor, instrument.timezone, timeframe);
    const order: PendingOrder = {
      id: createUuid(),
      action: "open",
      side,
      qty,
      createdAt: currentBar.timestamp,
      positionId: createUuid(),
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
      priceBand,
      reservedCash,
    };
    setPendingOrders((items) => [...items, order]);
    setRuleNotice("");
    appendEvent("order_queued", {
      order,
      marketRuleId: marketRules.id,
      marketRuleVersion: marketRules.version,
      tradingMode,
      initialCapital,
    });
    setOrderPanelTab("pending");
    setSaveState("有未保存更改");
  };

  const queueClosePosition = (positionId: string) => {
    if (!currentBar || cursor >= (trainingTask?.endCursor ?? bars.length - 1) || trainingComplete) return;
    const position = openPositions.find((item) => item.id === positionId);
    if (!position || pendingOrders.some((order) => order.action === "close" && order.positionId === positionId)) return;
    const validation = validateCloseOrder(marketRules, position, currentBar.timestamp, instrument.timezone);
    if (!validation.ok) {
      rejectOrderAttempt(validation, { action: "close", positionId, position });
      return;
    }
    const priceBand = replayPriceBand(marketRules, bars, cursor, instrument.timezone, timeframe);
    const order: PendingOrder = {
      id: createUuid(),
      action: "close",
      side: position.side === "long" ? "sell" : "buy",
      qty: position.qty,
      createdAt: currentBar.timestamp,
      positionId,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
      priceBand,
    };
    setPendingOrders((items) => [...items, order]);
    setRuleNotice("");
    appendEvent("order_queued", {
      order,
      position,
      marketRuleId: marketRules.id,
      marketRuleVersion: marketRules.version,
    });
    setSaveState("有未保存更改");
  };

  const queueCloseNextSession = (positionId: string) => {
    if (!currentBar || trainingComplete) return;
    const position = openPositions.find((item) => item.id === positionId);
    if (!position || pendingOrders.some((order) => order.action === "close" && order.positionId === positionId)) return;
    const targetIndex = findNextTradingSessionIndex(bars, cursor, instrument.timezone);
    const taskEndCursor = trainingTask?.endCursor ?? bars.length - 1;
    if (targetIndex < 0 || targetIndex > taskEndCursor) {
      setRuleNotice("本次训练结束前没有可用的下一交易日开盘，无法预约平仓");
      return;
    }
    const targetBar = bars[targetIndex];
    const validation = validateCloseOrder(marketRules, position, targetBar.timestamp, instrument.timezone);
    if (!validation.ok) {
      rejectOrderAttempt(validation, { action: "close_next_session", positionId, position });
      return;
    }
    const order: PendingOrder = {
      id: createUuid(),
      action: "close",
      side: position.side === "long" ? "sell" : "buy",
      qty: position.qty,
      createdAt: currentBar.timestamp,
      positionId,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
      executeAtTimestamp: targetBar.timestamp,
    };
    setPendingOrders((items) => [...items, order]);
    setRuleNotice(`已预约 ${trainingDateLabel(targetBar.timestamp)} 开盘平仓`);
    appendEvent("order_queued_for_next_session", {
      order,
      position,
      targetTimestamp: targetBar.timestamp,
      marketRuleId: marketRules.id,
      marketRuleVersion: marketRules.version,
    });
    setOrderPanelTab("pending");
    setSaveState("有未保存更改");
  };

  const queueCloseAll = () => {
    openPositions.forEach((position) => {
      const validation: RuleValidation = currentBar
        ? validateCloseOrder(marketRules, position, currentBar.timestamp, instrument.timezone)
        : { ok: false };
      if (validation.ok) queueClosePosition(position.id);
      else if (validation.code === "t_plus_one_locked") queueCloseNextSession(position.id);
    });
    setOrderPanelTab("pending");
  };

  const cancelPendingOrder = (orderId: string) => {
    const order = pendingOrders.find((item) => item.id === orderId);
    setPendingOrders((items) => items.filter((order) => order.id !== orderId));
    appendEvent("order_cancelled", { orderId, order });
    setSaveState("有未保存更改");
  };

  const startFreshTraining = (nextInstrumentId: string, nextTimeframe: string) => {
    restoreRequestRef.current = null;
    newTaskRequestRef.current = {
      instrumentId: nextInstrumentId,
      timeframe: nextTimeframe,
      draft: defaultTrainingTaskDraft,
    };
    setInstrumentId(nextInstrumentId);
    setTimeframe(nextTimeframe);
    setLoadNonce((value) => value + 1);
  };

  const resetTraining = () => {
    if (rewindLocked) return;
    saveCompletedTrainingRef.current = false;
    setShowRandomComplete(false);
    const nextRandomSeed = createUuid();
    const nextSessionId = createUuid();
    const baseTask = trainingTask ?? createLegacyTrainingTask(bars, Math.max(0, Math.floor(bars.length * 0.68)));
    const nextTask: TrainingTask = {
      ...baseTask,
      status: baseTask.startCursor >= baseTask.endCursor ? "completed" : "active",
      completedAt: undefined,
    };
    const nextCursor = nextTask.startCursor;
    setCursor(nextCursor);
    setTrainingTask(nextTask);
    setPlaying(false);
    setPositions([]);
    setPendingOrders([]);
    setExecutions([]);
    setOrderRejections([]);
    setRuleNotice("");
    setDecision(defaultDecision);
    setDecisionSubmissions([]);
    setSelectedDecisionId("");
    setDecisionTarget(null);
    decisionDraftBeforeBackfillRef.current = null;
    setOrderQty(normalizeBuyQuantity(marketRules, appSettingsRef.current.defaultOrderQty));
    setCashBalance(initialCapital);
    setDrawings([]);
    setDrawingUndoStack([]);
    setDrawingRedoStack([]);
    setClearNonce(Date.now());
    setOrderPanelTab("positions");
    setSessionId(nextSessionId);
    setRandomSeed(nextRandomSeed);
    eventSequenceRef.current = 1;
    setEvents([createTrainingEvent(1, "session_created", bars[nextCursor]?.timestamp, {
      instrumentId,
      timeframe,
      snapshotId: dataSnapshotId,
      snapshotHash,
      randomSeed: nextRandomSeed,
      startCursor: nextCursor,
      endCursor: nextTask.endCursor,
      trainingMode: nextTask.mode,
      restarted: true,
      marketRuleId: marketRules.id,
      marketRuleVersion: marketRules.version,
      tradingMode,
      initialCapital,
    })]);
    setRestoreNotice("");
    setSaveState("新训练 · 尚未保存");
  };

  const saveSession = async () => {
    setSaveState("保存中…");
    const savedEvent = appendEvent("session_manually_saved");
    await persistTrainingState({
      ...trainingState,
      events: [...trainingState.events, savedEvent],
    }, "已手动保存");
  };

  const resumeSession = (session: TrainingSession) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) throw new Error("invalid session");
      setReviewedSession(null);
      queueRestore({ ...session, state });
    } catch {
      setImportStatus("这条训练记录不完整，暂时无法恢复。");
    }
  };

  const deleteSession = async (session: TrainingSession) => {
    if (!window.confirm(`确定删除 ${session.instrumentId} · ${session.timeframe} 的这次训练吗？此操作不可撤销。`)) return;
    const response = await fetch(`/api/sessions?id=${encodeURIComponent(session.id)}`, { method: "DELETE" });
    if (!response.ok) {
      setImportStatus("训练记录删除失败。");
      return;
    }
    setSessions((items) => items.filter((item) => item.id !== session.id));
    if (reviewedSession?.session.id === session.id) setReviewedSession(null);
    const localDraft = window.localStorage.getItem(LAST_DRAFT_KEY);
    if (localDraft) {
      try {
        const parsed = JSON.parse(localDraft) as { id?: string };
        if (parsed.id === session.id) window.localStorage.removeItem(LAST_DRAFT_KEY);
      } catch {
        window.localStorage.removeItem(LAST_DRAFT_KEY);
      }
    }
    if (session.id === sessionId) {
      resetTraining();
      setSaveState("原训练已删除，已开始一场新的空白训练");
    }
  };

  const updateDecision = (field: keyof Decision, value: string | string[]) => {
    const nextDecision = { ...decision, [field]: value } as Decision;
    setDecision(nextDecision);
    setSaveState("决策草稿已更新");
  };

  const addCustomReasonTag = () => {
    const nextTag = customReasonInput.trim().replace(/\s+/g, " ").slice(0, 20);
    if (!nextTag) return;
    if (!reasonOptions.includes(nextTag)) {
      setCustomReasonTags((tags) => tags.includes(nextTag) ? tags : [...tags, nextTag].slice(-30));
    }
    if (!decision.reasons.includes(nextTag)) updateDecision("reasons", [...decision.reasons, nextTag]);
    setCustomReasonInput("");
  };

  const openDecisionForCandle = useCallback((target: CandleContextTarget) => {
    const targetCursor = bars.findIndex((bar) => bar.timestamp === target.timestamp);
    if (targetCursor < 0 || targetCursor > cursor) return;
    const targetBar = bars[targetCursor];
    if (!decisionTarget) {
      decisionDraftBeforeBackfillRef.current = {
        ...decision,
        reasons: [...decision.reasons],
      };
      setDecision(defaultDecision);
    }
    setDecisionTarget({
      dataIndex: targetCursor,
      timestamp: targetBar.timestamp,
      referencePrice: targetBar.close,
    });
    setSelectedDecisionId("");
    setPlaying(false);
    setSaveState("正在补写历史 K 线决策");
    requestAnimationFrame(() => decisionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [bars, cursor, decision, decisionTarget]);

  const cancelDecisionBackfill = () => {
    if (decisionDraftBeforeBackfillRef.current) setDecision(decisionDraftBeforeBackfillRef.current);
    decisionDraftBeforeBackfillRef.current = null;
    setDecisionTarget(null);
    setSaveState("已取消补写，原决策草稿已恢复");
  };

  const submitDecision = () => {
    const backfillTarget = decisionTarget && decisionTarget.dataIndex <= cursor ? decisionTarget : null;
    const targetCursor = backfillTarget?.dataIndex ?? cursor;
    const targetBar = bars[targetCursor] ?? currentBar;
    if (!targetBar) return;
    const submission: DecisionSubmission = {
      id: createUuid(),
      barTimestamp: targetBar.timestamp,
      cursor: targetCursor,
      referencePrice: targetBar.close,
      decision: {
        ...decision,
        reasons: [...decision.reasons],
      },
      submittedAt: new Date().toISOString(),
      backfilled: Boolean(backfillTarget),
      recordedAtCursor: backfillTarget ? cursor : undefined,
    };
    setDecisionSubmissions((items) => [...items, submission]);
    setSelectedDecisionId(submission.id);
    appendEvent("decision_submitted", {
      submissionId: submission.id,
      cursor: targetCursor,
      referencePrice: targetBar.close,
      decision: submission.decision,
      backfilled: Boolean(backfillTarget),
      recordedAtCursor: backfillTarget ? cursor : undefined,
    }, targetBar.timestamp);
    if (backfillTarget) {
      if (decisionDraftBeforeBackfillRef.current) setDecision(decisionDraftBeforeBackfillRef.current);
      decisionDraftBeforeBackfillRef.current = null;
      setDecisionTarget(null);
      setSaveState(trainingComplete ? "补写决策已加入，请保存训练" : "补写决策已保存 · 回放位置未改变");
      return;
    }
    setSaveState("决策已提交");
    revealNext();
  };

  const inspectSession = (session: TrainingSession, openReview = false) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) throw new Error("invalid session");
      setReviewedSession({ session, state });
      if (openReview) setView("review");
    } catch {
      setImportStatus("这条训练记录不完整，无法查看复盘。");
    }
  };

  const handleDrawingsChange = (nextDrawings: PersistedDrawing[]) => {
    if (drawingsEqual(drawings, nextDrawings)) return;
    setDrawingUndoStack((history) => [...history, drawings].slice(-60));
    setDrawingRedoStack([]);
    setDrawings(nextDrawings);
    if (selectedDrawingId && !nextDrawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId("");
    }
    appendEvent("drawings_changed", { action: "change", drawings: nextDrawings });
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
    setSelectedDrawingId("");
    setDrawingRequest((request) => ({
      name: "trainingTextBox",
      nonce: (request?.nonce ?? 0) + 1,
      mode: drawingMagnetMode,
      styles: drawingStyles(drawingColor, drawingLineWidth),
      extendData: { toolLabel: "文本框", toolKind: "text", text },
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
    appendEvent("drawings_changed", { action: "undo", drawings: previous });
  };

  const redoDrawing = () => {
    const next = drawingRedoStack.at(-1);
    if (!next) return;
    setDrawingRedoStack((history) => history.slice(0, -1));
    setDrawingUndoStack((history) => [...history, drawings].slice(-60));
    setDrawings(next);
    setDrawingsRestoreNonce((nonce) => nonce + 1);
    appendEvent("drawings_changed", { action: "redo", drawings: next });
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
  const selectedDrawingTextSize = selectedDrawingStyles.text?.size ?? 12;
  const selectedDrawingText = selectedDrawing?.extendData && typeof selectedDrawing.extendData === "object"
    ? String((selectedDrawing.extendData as { text?: unknown }).text ?? "")
    : "";
  const selectedDrawingInputColor = /^#[0-9a-f]{6}$/i.test(selectedDrawingColor) ? selectedDrawingColor : drawingColor;

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const response = await fetch(`/api/candles?coverage=1&page=${coveragePage}&pageSize=${coveragePageSize}&q=${encodeURIComponent(coverageQuery)}&market=${dataMarket}`);
      if (response.ok) {
        const data = await response.json() as {
          coverage: Coverage[];
          total: number;
          summary: { barCount: number; timeframeCount: number };
        };
        setCoverage(data.coverage);
        setSelectedCoverageKeys([]);
        setCoverageTotal(data.total);
        setCoverageSummary(data.summary);
      }
    } finally {
      setCoverageLoading(false);
    }
  }, [coveragePage, coverageQuery, dataMarket]);

  const deleteSelectedCoverage = async () => {
    const selected = coverage.filter((item) => selectedCoverageKeys.includes(coverageKey(item)));
    if (!selected.length) return;
    const localCount = new Set(
      selected.filter((item) => item.source === "tdx-official").map((item) => item.id),
    ).size;
    const explanation = localCount
      ? `\n\n其中包含 ${localCount} 个 TDX 品种。TDX 周线由日线生成，删除任一周期会同时删除该品种的日线和周线。`
      : "";
    if (!window.confirm(`确定删除选中的 ${selected.length} 条数据记录？训练快照会保留，但当前行情库数据将被删除。${explanation}`)) return;
    setCoverageLoading(true);
    try {
      const response = await fetch("/api/candles", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selections: selected.map((item) => ({
            id: item.id,
            timeframe: item.timeframe,
            adjustmentType: item.adjustmentType,
            source: item.source,
          })),
        }),
      });
      const result = await response.json() as {
        deletedRows?: number;
        deletedLocalInstruments?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "删除失败");
      setImportStatus(`删除完成：数据库 K 线 ${Number(result.deletedRows ?? 0).toLocaleString()} 根，TDX 品种 ${Number(result.deletedLocalInstruments ?? 0).toLocaleString()} 个。训练快照未受影响。`);
      setSelectedCoverageKeys([]);
      await Promise.all([loadCoverage(), loadInstrumentCatalog()]);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "删除失败");
    } finally {
      setCoverageLoading(false);
    }
  };

  const loadInstrumentCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/candles?instruments=1");
      if (!response.ok) return;
      const data = await response.json() as { instruments: Array<Instrument & { timeframes?: string[] }> };
      const instruments = data.instruments
        .map((item) => ({
          id: item.id,
          short: item.symbol,
          label: item.name,
          market: item.market === "CN" ? "A股" : item.market === "US" ? "美股" : item.market,
          timeframes: (item.timeframes ?? []).filter((value) => timeframes.includes(value)),
        }))
        .filter((item) => item.timeframes.length > 0);
      if (instruments.length) setAvailableInstruments(instruments);
    } finally {
      setInstrumentCatalogReady(true);
    }
  }, []);

  const loadSessions = useCallback(async (includeAll = false) => {
    const response = await fetch(includeAll ? "/api/sessions?all=1" : "/api/sessions");
    if (response.ok) {
      const data = await response.json() as { sessions: typeof sessions };
      setSessions(data.sessions);
    }
  }, []);

  const sessionSummaries = useMemo(() => sessions.flatMap((session) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) return [];
      const task = state.trainingTask;
      const closedSessionPositions = state.positions.filter((position) => position.status === "closed");
      const openSessionPositions = state.positions.filter((position) => position.status === "open");
      const closedTradePnls = closedSessionPositions.map((position) => position.realizedPnl ?? 0);
      const closedTradeReturns = closedSessionPositions.map((position) => (
        positionReturnPct(position, position.exitPrice ?? position.entryPrice)
      ));
      const winningTrades = closedTradePnls.filter((value) => value > 0).length;
      const losingTrades = closedTradePnls.filter((value) => value < 0).length;
      const flatTrades = closedTradePnls.length - winningTrades - losingTrades;
      const pnl = state.pnlSnapshot ?? {
        realized: closedTradePnls.reduce((sum, value) => sum + value, 0),
        floating: 0,
        total: closedTradePnls.reduce((sum, value) => sum + value, 0),
        openPositions: openSessionPositions.length,
        closedPositions: closedSessionPositions.length,
      };
      const returnPct = pnl.returnPct ?? portfolioReturnPct(
        closedSessionPositions,
        0,
      );
      const realizedReturnPct = portfolioReturnPct(closedSessionPositions, 0);
      const openEntryNotional = openSessionPositions.reduce(
        (sum, position) => sum + position.entryPrice * position.qty,
        0,
      );
      const floatingReturnPct = openEntryNotional > 0 ? pnl.floating / openEntryNotional * 100 : 0;
      const progressSummary = task
        ? taskProgress(task, state.cursor)
        : { revealed: 0, total: 0, percent: 0 };
      return [{
        session,
        state,
        task,
        pnl,
        returnPct,
        progressSummary,
        modeLabel: task
          ? task.randomRun
            ? task.mode === "blind" ? "随机盲测" : "随机训练"
            : trainingModeLabels[task.mode]
          : "旧版自由训练",
        rangeLabel: task
          ? `${formatDate(task.startTimestamp, session.timeframe)} → ${formatDate(task.endTimestamp, session.timeframe)}`
          : `保存于 K线 ${state.cursor + 1}`,
        closedTradePnls,
        closedTradeReturns,
        winningTrades,
        losingTrades,
        flatTrades,
        realizedReturnPct,
        floatingReturnPct,
        planScores: state.decisionSubmissions.map((submission) => decisionScore(submission.decision)),
      }];
    } catch {
      return [];
    }
  }), [parseTrainingState, sessions]);

  const performanceSessionSummaries = useMemo(
    () => sessionSummaries.filter((summary) => summary.state.tradingMode === tradingMode),
    [sessionSummaries, tradingMode],
  );

  const performanceModeOptions = useMemo(
    () => [...new Set(performanceSessionSummaries.map((summary) => summary.modeLabel))],
    [performanceSessionSummaries],
  );

  const filteredSessionSummaries = useMemo(() => {
    const dateFrom = performanceFilters.dateFrom
      ? Date.parse(`${performanceFilters.dateFrom}T00:00:00`)
      : Number.NEGATIVE_INFINITY;
    const dateTo = performanceFilters.dateTo
      ? Date.parse(`${performanceFilters.dateTo}T23:59:59.999`)
      : Number.POSITIVE_INFINITY;
    return performanceSessionSummaries.filter((summary) => {
      const updatedAt = Date.parse(summary.session.updatedAt);
      return (
        (performanceFilters.instrumentId === "all" || summary.session.instrumentId === performanceFilters.instrumentId)
        && (performanceFilters.timeframe === "all" || summary.session.timeframe === performanceFilters.timeframe)
        && (performanceFilters.modeLabel === "all" || summary.modeLabel === performanceFilters.modeLabel)
        && (
          performanceFilters.status === "all"
          || (performanceFilters.status === "completed" ? summary.task?.status === "completed" : summary.task?.status !== "completed")
        )
        && updatedAt >= dateFrom
        && updatedAt <= dateTo
      );
    });
  }, [performanceFilters, performanceSessionSummaries]);

  const performanceRecord = useCallback((summary: typeof sessionSummaries[number]): PerformanceRecord => {
    const capitalMode = summary.state.tradingMode === "capital";
    return {
      totalPnl: capitalMode ? summary.pnl.total : summary.returnPct,
      realizedPnl: capitalMode ? summary.pnl.realized : summary.realizedReturnPct,
      floatingPnl: capitalMode ? summary.pnl.floating : summary.floatingReturnPct,
      status: summary.task?.status === "completed" ? "completed" : "active",
      closedTradePnls: capitalMode ? summary.closedTradePnls : summary.closedTradeReturns,
      planScores: summary.planScores,
      updatedAt: summary.session.updatedAt,
    };
  }, []);

  const overallPerformance = useMemo(
    () => summarizePerformance(performanceSessionSummaries.map(performanceRecord)),
    [performanceRecord, performanceSessionSummaries],
  );
  const filteredPerformance = useMemo(
    () => summarizePerformance(filteredSessionSummaries.map(performanceRecord)),
    [filteredSessionSummaries, performanceRecord],
  );
  const selectedPerformanceSession = filteredSessionSummaries.find(
    (summary) => summary.session.id === selectedPerformanceSessionId,
  );
  const performanceUsesCapital = tradingMode === "capital";
  const formatPerformanceValue = (value: number) => performanceUsesCapital ? money(value) : percent(value);

  const mistakeSources = useMemo<MistakeSource[]>(() => sessions.flatMap((session) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) return [];
      const weakPlans = state.decisionSubmissions.filter((submission) => decisionScore(submission.decision) < 80);
      const count = weakPlans.length + state.orderRejections.length;
      if (!count) return [];
      const targetCursor = weakPlans.at(-1)?.cursor ?? state.cursor;
      return [{
        session,
        state,
        count,
        targetCursor,
        label: `${session.instrumentId} · ${session.timeframe} · ${count} 个错题点 · ${new Date(session.updatedAt).toLocaleDateString("zh-CN")}`,
      }];
    } catch {
      return [];
    }
  }), [parseTrainingState, sessions]);

  const openSettingsPanel = (tab: SettingsTab = "basic") => {
    setSettingsDraft(appSettings);
    setSettingsTab(tab);
    setSettingsError("");
    setShowSettings(true);
  };

  const saveSettings = () => {
    if (
      settingsDraft.randomDateMode === "range"
      && (!settingsDraft.randomStartDate || !settingsDraft.randomEndDate)
    ) {
      setSettingsError("随机时间段需要填写开始和结束日期。");
      return;
    }
    if (
      settingsDraft.randomDateMode === "range"
      && settingsDraft.randomEndDate < settingsDraft.randomStartDate
    ) {
      setSettingsError("随机时间段的结束日期不能早于开始日期。");
      return;
    }
    const nextSettings = normalizeSettings(settingsDraft);
    window.localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(nextSettings));
    appSettingsRef.current = nextSettings;
    setAppSettings(nextSettings);
    setSettingsDraft(nextSettings);
    setSpeed(nextSettings.defaultSpeed);
    setOrderQty(nextSettings.defaultOrderQty);
    setShowSettings(false);
  };

  const openTaskSetup = () => {
    setTaskSetupKind("configured");
    setSetupInstrumentId(appSettings.defaultInstrumentId);
    setSetupTimeframe(appSettings.defaultTimeframe);
    setTaskDraft({
      ...defaultTrainingTaskDraft,
      randomRun: false,
      startDate: currentBar ? tradingDate(currentBar.timestamp, instrument.timezone) : "",
      startBar: cursor + 1,
      endDate: bars.at(-1) ? tradingDate(bars.at(-1)!.timestamp, instrument.timezone) : "",
    });
    setSetupError("");
    setShowTaskSetup(true);
    void loadSessions();
  };

  const openRandomTraining = () => {
    setTaskSetupKind("random");
    setTaskDraft({
      ...defaultTrainingTaskDraft,
      mode: "free",
      startMode: "random",
      length: appSettings.randomLength,
      randomRun: true,
    });
    setSetupError("");
    setShowTaskSetup(true);
  };

  const selectTrainingMode = (mode: TrainingMode) => {
    setTaskDraft((draft) => ({
      ...draft,
      mode,
      startMode: mode === "range" ? "date" : mode === "mistake" ? "bar" : draft.startMode,
      length: mode === "mistake" && !draft.length ? 40 : draft.length,
      hideInstrument: mode === "blind",
      hideDate: mode === "blind",
      hidePrice: mode === "blind",
      sourceSessionId: mode === "mistake" ? draft.sourceSessionId : undefined,
      sourceLabel: mode === "mistake" ? draft.sourceLabel : undefined,
    }));
    setSetupError("");
  };

  const launchTraining = (
    requestInstrumentId: string,
    requestTimeframe: string,
    draft: TrainingTaskDraft,
    snapshotId?: string,
  ) => {
    setLoading(true);
    setChartLoadError("");
    setTrainingReady(false);
    setPlaying(false);
    newTaskRequestRef.current = {
      instrumentId: requestInstrumentId,
      timeframe: requestTimeframe,
      draft,
      snapshotId,
    };
    restoreRequestRef.current = null;
    setInstrumentId(requestInstrumentId);
    setTimeframe(requestTimeframe);
    setReviewedSession(null);
    setShowRandomComplete(false);
    setView("replay");
    setShowTaskSetup(false);
    setLoadNonce((value) => value + 1);
  };

  const resolveRandomRequest = useCallback((draft: TrainingTaskDraft) => {
    const instrumentCandidates = appSettings.randomInstrumentMode === "current"
      ? availableInstruments.filter((item) => item.id === instrumentId)
      : appSettings.randomInstrumentMode === "market"
        ? availableInstruments.filter((item) => item.market === appSettings.randomMarket)
        : availableInstruments;
    const requestedTimeframes = appSettings.randomTimeframeMode === "current"
      ? [timeframe]
      : appSettings.randomTimeframeMode === "fixed"
        ? [appSettings.randomTimeframe]
        : timeframes;
    const createPairs = (instruments: AvailableInstrument[], allowedTimeframes?: string[]) => instruments.flatMap((item) =>
      item.timeframes
        .filter((candidateTimeframe) => !allowedTimeframes || allowedTimeframes.includes(candidateTimeframe))
        .map((candidateTimeframe) => ({ instrument: item, timeframe: candidateTimeframe })));
    const exactPairs = createPairs(instrumentCandidates, requestedTimeframes);
    const sameScopePairs = createPairs(instrumentCandidates);
    const allPairs = createPairs(availableInstruments);
    const selectedPair = randomItem(exactPairs)
      ?? randomItem(sameScopePairs)
      ?? randomItem(allPairs)
      ?? { instrument: defaultInstruments[0], timeframe: "1d" };
    return {
      instrumentId: selectedPair.instrument.id,
      timeframe: selectedPair.timeframe,
      draft: {
        ...draft,
        startMode: "random" as const,
        length: draft.length > 0 ? draft.length : appSettings.randomLength,
        randomStartDate: appSettings.randomDateMode === "range" ? appSettings.randomStartDate : undefined,
        randomEndDate: appSettings.randomDateMode === "range" ? appSettings.randomEndDate : undefined,
        randomRun: true,
      },
    };
  }, [appSettings, availableInstruments, instrumentId, timeframe]);

  const startConfiguredTraining = () => {
    let requestInstrumentId = setupInstrumentId;
    let requestTimeframe = setupTimeframe;
    let requestSnapshotId: string | undefined;
    let draft = { ...taskDraft };

    if (draft.startMode === "random" && draft.mode !== "range" && draft.mode !== "mistake") {
      const request = resolveRandomRequest(draft);
      requestInstrumentId = request.instrumentId;
      requestTimeframe = request.timeframe;
      draft = request.draft;
    }

    if (draft.mode === "range") {
      if (!draft.startDate || !draft.endDate) {
        setSetupError("测试区间需要填写开始和结束日期。");
        return;
      }
      if (draft.endDate < draft.startDate) {
        setSetupError("结束日期不能早于开始日期。");
        return;
      }
    } else if (draft.mode === "mistake") {
      const sourceId = draft.sourceSessionId ?? mistakeSources[0]?.session.id;
      const source = mistakeSources.find((item) => item.session.id === sourceId);
      if (!source) {
        setSetupError("还没有可重练的错题。先完成一份低于 80% 的计划或产生一条规则拒单。");
        return;
      }
      requestInstrumentId = source.session.instrumentId;
      requestTimeframe = source.session.timeframe;
      requestSnapshotId = source.state.dataSnapshotId ?? source.session.dataSnapshotId;
      draft = {
        ...draft,
        startMode: "bar",
        startBar: Math.max(1, source.targetCursor - 19),
        length: draft.length > 0 ? draft.length : 40,
        sourceSessionId: source.session.id,
        sourceLabel: source.label,
      };
    } else if (draft.startMode === "date" && !draft.startDate) {
      setSetupError("请填写训练开始日期。");
      return;
    }

    launchTraining(requestInstrumentId, requestTimeframe, draft, requestSnapshotId);
  };

  const startQuickRandomTraining = () => {
    const blind = quickRandomMode === "blind";
    const request = resolveRandomRequest({
      ...defaultTrainingTaskDraft,
      mode: quickRandomMode,
      startMode: "random",
      length: appSettings.randomLength,
      hideInstrument: blind,
      hideDate: blind,
      hidePrice: blind,
      randomRun: true,
    });
    setMobileToolbarOpen(false);
    launchTraining(request.instrumentId, request.timeframe, request.draft);
  };

  const continueRandomTraining = () => {
    const blind = trainingTask?.mode === "blind";
    const request = resolveRandomRequest({
      ...defaultTrainingTaskDraft,
      mode: blind ? "blind" : "free",
      startMode: "random",
      length: trainingTask?.requestedLength ?? appSettings.randomLength,
      hideInstrument: blind,
      hideDate: blind,
      hidePrice: blind,
      randomRun: true,
    });
    launchTraining(request.instrumentId, request.timeframe, request.draft);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (view === "database") loadCoverage();
      if (view === "review" || view === "performance") loadSessions(view === "performance");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCoverage, loadSessions, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInstrumentCatalog();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadInstrumentCatalog]);

  useEffect(() => {
    if (!settingsReady || !instrumentCatalogReady || startupRandomStartedRef.current) return;
    startupRandomStartedRef.current = true;
    const request = resolveRandomRequest({
      ...defaultTrainingTaskDraft,
      mode: "free",
      startMode: "random",
      length: appSettingsRef.current.randomLength,
      randomRun: true,
    });
    newTaskRequestRef.current = {
      instrumentId: request.instrumentId,
      timeframe: request.timeframe,
      draft: request.draft,
    };
    restoreRequestRef.current = null;
    setInstrumentId(request.instrumentId);
    setTimeframe(request.timeframe);
    setLoading(true);
    setChartLoadError("");
    setStartupReady(true);
    setLoadNonce((value) => value + 1);
  }, [instrumentCatalogReady, resolveRandomRequest, settingsReady]);

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportStatus("正在校验…");
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const headers = lines[0].split(",").map((item) => item.trim().toLowerCase());
      const barsToImport = lines.slice(1).filter(Boolean).map((line) => {
        const cells = line.split(",").map((item) => item.trim());
        const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
        let timestamp = Number(row.timestamp);
        if (!Number.isFinite(timestamp)) timestamp = Date.parse(row.date ?? row.datetime ?? row.time);
        if (timestamp < 10_000_000_000) timestamp *= 1000;
        return {
          timestamp,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: row.volume ? Number(row.volume) : undefined,
          turnover: row.turnover ? Number(row.turnover) : undefined,
        };
      });
      const customId = `CUSTOM.${dataMarket}.${file.name.replace(/\.[^.]+$/, "").toUpperCase()}`;
      const timezone = dataMarket === "CN"
        ? "Asia/Shanghai"
        : dataMarket === "US"
          ? "America/New_York"
          : "UTC";
      const response = await fetch("/api/candles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrument: { id: customId, symbol: customId, name: file.name, market: dataMarket, timezone },
          timeframe: "1d",
          adjustmentType: "none",
          bars: barsToImport,
        }),
      });
      const result = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "导入失败");
      setImportStatus(`已导入 ${result.imported} 根日 K`);
      await Promise.all([loadCoverage(), loadInstrumentCatalog()]);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="app-shell">
      <aside className="main-rail">
        <button className="brand-mark" aria-label="K线训练营">K</button>
        <nav aria-label="主导航">
          <button className={view === "replay" ? "active" : ""} onClick={() => setView("replay")}>
            <BarChart3 size={20} /><span>训练</span>
          </button>
          <button className={view === "performance" ? "active" : ""} onClick={() => setView("performance")}>
            <Activity size={20} /><span>表现</span>
          </button>
          <button className={view === "database" ? "active" : ""} onClick={() => setView("database")}>
            <Database size={20} /><span>数据</span>
          </button>
          <button
            className={view === "review" ? "active" : ""}
            disabled={reviewLocked}
            title={reviewLocked ? "盲测结束后才能查看复盘答案" : ""}
            onClick={() => setView("review")}
          >
            <BookOpenCheck size={20} /><span>复盘</span>
          </button>
        </nav>
        <button className={`rail-bottom ${showSettings ? "active" : ""}`} aria-label="设置" onClick={() => openSettingsPanel()}>
          <Settings2 size={20} /><span>设置</span>
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="instrument-selectors">
            {trainingTask?.hideInstrument ? (
              <span className="blind-pill">品种已隐藏</span>
            ) : (
              <>
                <InstrumentPicker
                  value={instrumentId}
                  instruments={availableInstruments}
                  ariaLabel="选择品种"
                  onChange={(nextInstrumentId) => startFreshTraining(nextInstrumentId, timeframe)}
                />
                <span className="market-pill">{availableInstruments.find((item) => item.id === instrumentId)?.market}</span>
              </>
            )}
            <span className="rule-pill">{trainingTask ? trainingModeLabels[trainingTask.mode] : "自由训练"}</span>
            <span className="rule-pill">{tradingMode === "capital" ? "资金账户" : "收益率"}</span>
            <div className="timeframes" aria-label="周期">
              {timeframes.map((item) => (
                <button key={item} className={timeframe === item ? "active" : ""} onClick={() => startFreshTraining(instrumentId, item)}>{item}</button>
              ))}
            </div>
          </div>
          <div className="top-actions">
            <span className={`save-state ${saveState.includes("已") ? "saved" : ""}`}>{saveState}</span>
            <button className="ghost-button" onClick={openRandomTraining}><Shuffle size={16} />随机训练</button>
            <button className="ghost-button" onClick={openTaskSetup}><Play size={16} />新建 Replay 训练</button>
            <button className="primary-button" onClick={saveSession}><Save size={16} />保存训练</button>
          </div>
          <div className="mobile-quick-actions" aria-label="训练快捷操作">
            <button type="button" aria-label="立即开始随机训练" title="立即开始随机训练" onClick={startQuickRandomTraining}><Shuffle size={15} /></button>
            <button type="button" aria-label="新建 Replay 训练" title="新建 Replay 训练" onClick={openTaskSetup}><Play size={15} /></button>
            <button type="button" className="save" aria-label="保存训练" title="保存训练" onClick={saveSession}><Save size={15} /></button>
          </div>
          <button
            className="mobile-toolbar-toggle"
            type="button"
            aria-label="周期与训练工具"
            aria-expanded={mobileToolbarOpen}
            aria-controls="mobile-training-toolbar"
            onClick={() => setMobileToolbarOpen((value) => !value)}
          >
            <span>{timeframe}</span><ChevronDown size={15} />
          </button>
          {mobileToolbarOpen && (
            <div className="mobile-toolbar-popover" id="mobile-training-toolbar">
              <div className="mobile-toolbar-meta">
                <span>{trainingTask ? trainingModeLabels[trainingTask.mode] : "自由训练"}</span>
                <span>{tradingMode === "capital" ? "资金账户" : "收益率"}</span>
              </div>
              <div className="mobile-timeframes" aria-label="手机端周期">
                {timeframes.map((item) => (
                  <button key={item} className={timeframe === item ? "active" : ""} onClick={() => {
                    setMobileToolbarOpen(false);
                    startFreshTraining(instrumentId, item);
                  }}>{item}</button>
                ))}
              </div>
              <div className="mobile-random-mode" aria-label="随机训练方式">
                <span>随机方式</span>
                <button className={quickRandomMode === "free" ? "active" : ""} onClick={() => setQuickRandomMode("free")}>普通</button>
                <button className={quickRandomMode === "blind" ? "active" : ""} onClick={() => setQuickRandomMode("blind")}>盲测</button>
                <button onClick={() => { setMobileToolbarOpen(false); openSettingsPanel("training"); }}>规则</button>
              </div>
            </div>
          )}
        </header>

        {restoreNotice && (
          <div className="restore-notice">
            <span><RotateCcw size={14} />{restoreNotice}</span>
            <button onClick={() => setRestoreNotice("")}>知道了</button>
          </div>
        )}

        {showSettings && (
          <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowSettings(false);
          }}>
            <section className="task-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
              <div className="task-modal-head">
                <div>
                  <span>SETTINGS</span>
                  <h2 id="settings-modal-title">本地设置</h2>
                  <p>管理训练偏好、随机抽样规则和本机数据源凭证。</p>
                </div>
                <button aria-label="关闭设置" onClick={() => setShowSettings(false)}><X size={19} /></button>
              </div>

              <div className="settings-tabs" role="tablist" aria-label="设置分类">
                <button className={settingsTab === "basic" ? "active" : ""} onClick={() => setSettingsTab("basic")}>基本设置</button>
                <button className={settingsTab === "training" ? "active" : ""} onClick={() => setSettingsTab("training")}>训练设置</button>
                <button className={settingsTab === "data" ? "active" : ""} onClick={() => setSettingsTab("data")}>数据源设置</button>
              </div>

              {settingsTab === "basic" ? (
                <div className="settings-section">
                  <div className="settings-section-head">
                    <strong>新训练默认值</strong>
                    <span>打开“新建 Replay 训练”时优先使用这些选项。</span>
                  </div>
                  <div className="settings-rule">
                    <span>模拟交易账户</span>
                    <div className="task-start-options">
                      <button
                        className={settingsDraft.tradingMode === "return" ? "active" : ""}
                        onClick={() => setSettingsDraft((draft) => ({ ...draft, tradingMode: "return" }))}
                      >收益率模式</button>
                      <button
                        className={settingsDraft.tradingMode === "capital" ? "active" : ""}
                        onClick={() => setSettingsDraft((draft) => ({ ...draft, tradingMode: "capital" }))}
                      >资金账户模式</button>
                    </div>
                    <small>{settingsDraft.tradingMode === "return"
                      ? "不限制本金和购买力，只比较仓位收益率，适合练习入场与出场质量。"
                      : "按初始资金核算现金、持仓市值和账户权益；买入资金不足时拒单。"}</small>
                    {settingsDraft.tradingMode === "capital" && (
                      <label>新训练初始资金
                        <input
                          type="number"
                          min="1000"
                          step="1000"
                          value={settingsDraft.initialCapital}
                          onChange={(event) => setSettingsDraft((draft) => ({ ...draft, initialCapital: Math.max(1000, Number(event.target.value)) }))}
                        />
                      </label>
                    )}
                    <small>切换只影响之后新建的训练；已开始和已保存训练会继续使用创建时锁定的账户模式。</small>
                  </div>
                  <div className="task-form-row">
                    <label>默认品种
                      <InstrumentPicker
                        value={settingsDraft.defaultInstrumentId}
                        instruments={availableInstruments}
                        ariaLabel="默认品种"
                        onChange={(defaultInstrumentId) => setSettingsDraft((draft) => ({ ...draft, defaultInstrumentId }))}
                      />
                    </label>
                    <label>默认周期
                      <select value={settingsDraft.defaultTimeframe} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, defaultTimeframe: event.target.value }))}>
                        {timeframes.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <label>默认下单数量
                      <input type="number" min="1" value={settingsDraft.defaultOrderQty} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, defaultOrderQty: Math.max(1, Number(event.target.value)) }))} />
                    </label>
                    <label>默认播放速度
                      <select value={settingsDraft.defaultSpeed} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, defaultSpeed: Number(event.target.value) }))}>
                        {[0.5, 1, 2, 5].map((item) => <option key={item} value={item}>{item}x</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              ) : settingsTab === "training" ? (
                <div className="settings-section">
                  <div className="settings-section-head">
                    <strong>随机训练规则</strong>
                    <span>点击顶部“随机训练”时，按这里的范围抽取品种、周期和历史片段。</span>
                  </div>

                  <div className="settings-rule">
                    <span>如何选择品种</span>
                    <div className="task-start-options">
                      {([
                        ["current", "固定当前品种"],
                        ["all", "全部品种随机"],
                        ["market", "指定市场随机"],
                      ] as const).map(([value, label]) => (
                        <button key={value} className={settingsDraft.randomInstrumentMode === value ? "active" : ""} onClick={() => setSettingsDraft((draft) => ({ ...draft, randomInstrumentMode: value }))}>{label}</button>
                      ))}
                    </div>
                    {settingsDraft.randomInstrumentMode === "market" && (
                      <label>指定市场
                        <select value={settingsDraft.randomMarket} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, randomMarket: event.target.value }))}>
                          {[...new Set(availableInstruments.map((item) => item.market))].map((market) => <option key={market}>{market}</option>)}
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="settings-rule">
                    <span>如何选择时间周期</span>
                    <div className="task-start-options">
                      {([
                        ["current", "固定当前周期"],
                        ["all", "全部周期随机"],
                        ["fixed", "指定周期"],
                      ] as const).map(([value, label]) => (
                        <button key={value} className={settingsDraft.randomTimeframeMode === value ? "active" : ""} onClick={() => setSettingsDraft((draft) => ({ ...draft, randomTimeframeMode: value }))}>{label}</button>
                      ))}
                    </div>
                    {settingsDraft.randomTimeframeMode === "fixed" && (
                      <label>指定周期
                        <select value={settingsDraft.randomTimeframe} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, randomTimeframe: event.target.value }))}>
                          {timeframes.map((item) => <option key={item}>{item}</option>)}
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="settings-rule">
                    <span>随机历史时间段</span>
                    <div className="task-start-options">
                      <button className={settingsDraft.randomDateMode === "all" ? "active" : ""} onClick={() => setSettingsDraft((draft) => ({ ...draft, randomDateMode: "all" }))}>全部历史</button>
                      <button className={settingsDraft.randomDateMode === "range" ? "active" : ""} onClick={() => setSettingsDraft((draft) => ({ ...draft, randomDateMode: "range" }))}>指定时间段</button>
                    </div>
                    {settingsDraft.randomDateMode === "range" && (
                      <div className="task-form-row">
                        <label>开始日期<input type="date" value={settingsDraft.randomStartDate} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, randomStartDate: event.target.value }))} /></label>
                        <label>结束日期<input type="date" value={settingsDraft.randomEndDate} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, randomEndDate: event.target.value }))} /></label>
                      </div>
                    )}
                  </div>

                  <label className="task-wide-field">默认训练长度（揭示 K 线数）
                    <input type="number" min="0" value={settingsDraft.randomLength} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, randomLength: Math.max(0, Number(event.target.value)) }))} />
                    <small>每局随机训练的默认长度；0 表示一直练到该数据集末尾。</small>
                  </label>
                </div>
              ) : (
                <ProviderSettingsPanel />
              )}

              {settingsError && <div className="task-error">{settingsError}</div>}
              <div className="task-modal-actions">
                <button className="ghost-button" onClick={() => setShowSettings(false)}>{settingsTab === "data" ? "关闭" : "取消"}</button>
                {settingsTab !== "data" && <button className="primary-button" onClick={saveSettings}><Save size={16} />保存设置</button>}
              </div>
            </section>
          </div>
        )}

        {showTaskSetup && (
          <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowTaskSetup(false);
          }}>
            <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
              <div className="task-modal-head">
                <div>
                  <span>{taskSetupKind === "random" ? "RANDOM REPLAY" : "TRAINING TASK"}</span>
                  <h2 id="task-modal-title">{taskSetupKind === "random" ? "随机训练" : "新建 Replay 训练"}</h2>
                  <p>只有点击“保存训练”或训练自动结束后，才会出现在可恢复训练中。</p>
                </div>
                <button aria-label={taskSetupKind === "random" ? "关闭随机训练设置" : "关闭新建训练"} onClick={() => setShowTaskSetup(false)}><X size={19} /></button>
              </div>

              <div
                className={`task-mode-grid ${taskSetupKind === "random" ? "random-mode-grid" : ""}`}
                role="group"
                aria-label="训练模式"
              >
                {(taskSetupKind === "random"
                  ? (["free", "blind"] as TrainingMode[])
                  : (Object.keys(trainingModeLabels) as TrainingMode[])
                ).map((mode) => (
                  <button
                    key={mode}
                    className={taskDraft.mode === mode ? "active" : ""}
                    onClick={() => selectTrainingMode(mode)}
                  >
                    <strong>{taskSetupKind === "random" && mode === "free" ? "普通随机" : mode === "blind" ? "盲测随机（隐藏答案）" : trainingModeLabels[mode]}</strong>
                    <span>{mode === "free" ? (taskSetupKind === "random" ? "显示品种、日期和价格" : "按自己的节奏练习") : mode === "blind" ? "只看结构做判断，结束后揭示" : mode === "range" ? "固定日期区间自动结束" : "重做低分计划与规则拒单"}</span>
                  </button>
                ))}
              </div>

              {taskDraft.mode === "blind" && (
                <div className="blind-explainer">
                  <EyeOff size={18} />
                  <div>
                    <strong>什么是盲测？</strong>
                    <p>系统隐藏品种名、日期和绝对价格，你只能根据 K 线结构制定计划，避免因为“记得这段行情”而提前知道答案。训练结束后再进入复盘查看真实信息。{taskSetupKind === "configured" ? "下面三个隐藏项仍可单独调整。" : ""}</p>
                  </div>
                </div>
              )}

              {taskSetupKind === "configured" && taskDraft.mode !== "mistake" && (
                <div className="task-form-row">
                  <label>品种
                    <InstrumentPicker
                      value={setupInstrumentId}
                      instruments={availableInstruments}
                      ariaLabel="训练品种"
                      onChange={setSetupInstrumentId}
                    />
                  </label>
                  <label>周期
                    <select value={setupTimeframe} onChange={(event) => setSetupTimeframe(event.target.value)}>
                      {timeframes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {taskSetupKind === "random" && (
                <div className="random-rule-summary">
                  <Shuffle size={18} />
                  <div>
                    <strong>使用训练设置中的随机规则</strong>
                    <span>
                      {appSettings.randomInstrumentMode === "current" ? "固定当前品种" : appSettings.randomInstrumentMode === "market" ? `${appSettings.randomMarket}中随机标的` : "全部品种随机"}
                      {" · "}
                      {appSettings.randomTimeframeMode === "current" ? "固定当前周期" : appSettings.randomTimeframeMode === "fixed" ? `固定 ${appSettings.randomTimeframe}` : "全部周期随机"}
                      {" · "}
                      {appSettings.randomDateMode === "range" ? `${appSettings.randomStartDate || "未设置"} 至 ${appSettings.randomEndDate || "未设置"}` : "全部历史"}
                    </span>
                  </div>
                  <button onClick={() => {
                    setShowTaskSetup(false);
                    openSettingsPanel("training");
                  }}>调整规则</button>
                </div>
              )}

              {taskSetupKind === "configured" && (taskDraft.mode === "range" ? (
                <div className="task-form-row">
                  <label>区间开始
                    <input type="date" value={taskDraft.startDate} onChange={(event) => setTaskDraft((draft) => ({ ...draft, startDate: event.target.value }))} />
                  </label>
                  <label>区间结束
                    <input type="date" value={taskDraft.endDate} onChange={(event) => setTaskDraft((draft) => ({ ...draft, endDate: event.target.value }))} />
                  </label>
                </div>
              ) : taskDraft.mode === "mistake" ? (
                <label className="task-wide-field">错题来源
                  <select value={taskDraft.sourceSessionId ?? mistakeSources[0]?.session.id ?? ""} onChange={(event) => {
                    const source = mistakeSources.find((item) => item.session.id === event.target.value);
                    setTaskDraft((draft) => ({
                      ...draft,
                      sourceSessionId: event.target.value,
                      sourceLabel: source?.label,
                    }));
                  }}>
                    {!mistakeSources.length && <option value="">暂无错题训练</option>}
                    {mistakeSources.map((source) => <option key={source.session.id} value={source.session.id}>{source.label}</option>)}
                  </select>
                  <small>错题点当前定义为：计划完整度低于 80%，或被市场规则拒绝的委托。系统从错题前约 20 根开始。</small>
                </label>
              ) : (
                <div className="task-start-block">
                  <span>训练起点</span>
                  <div className="task-start-options">
                    {([
                      ["default", "默认位置"],
                      ["date", "指定日期"],
                      ["bar", "指定 K 线"],
                    ] as const).map(([value, label]) => (
                      <button key={value} className={taskDraft.startMode === value ? "active" : ""} onClick={() => setTaskDraft((draft) => ({
                        ...draft,
                        startMode: value,
                      }))}>{label}</button>
                    ))}
                  </div>
                  {taskDraft.startMode === "date" && (
                    <label>开始日期<input type="date" value={taskDraft.startDate} onChange={(event) => setTaskDraft((draft) => ({ ...draft, startDate: event.target.value }))} /></label>
                  )}
                  {taskDraft.startMode === "bar" && (
                    <label>第几根 K 线<input type="number" min="1" value={taskDraft.startBar} onChange={(event) => setTaskDraft((draft) => ({ ...draft, startBar: Math.max(1, Number(event.target.value)) }))} /></label>
                  )}
                </div>
              ))}

              {taskDraft.mode !== "range" && (
                <label className="task-wide-field">训练长度（揭示 K 线数）
                  <input type="number" min="0" value={taskDraft.length} onChange={(event) => setTaskDraft((draft) => ({ ...draft, length: Math.max(0, Number(event.target.value)) }))} />
                  <small>填 0 表示练到数据末尾；填入数量后，到达边界会按最后一根收盘价自动平仓、保存并进入完成状态。</small>
                </label>
              )}

              {taskSetupKind === "configured" && (
                <fieldset className="task-privacy">
                  <legend>训练中隐藏</legend>
                  <label><input type="checkbox" checked={taskDraft.hideInstrument} onChange={(event) => setTaskDraft((draft) => ({ ...draft, hideInstrument: event.target.checked }))} />品种名称</label>
                  <label><input type="checkbox" checked={taskDraft.hideDate} onChange={(event) => setTaskDraft((draft) => ({ ...draft, hideDate: event.target.checked }))} />日期坐标</label>
                  <label><input type="checkbox" checked={taskDraft.hidePrice} onChange={(event) => setTaskDraft((draft) => ({ ...draft, hidePrice: event.target.checked }))} />绝对价格</label>
                </fieldset>
              )}

              {setupError && <div className="task-error">{setupError}</div>}
              <div className="task-modal-actions">
                <button className="ghost-button" onClick={() => setShowTaskSetup(false)}>取消</button>
                <button className="primary-button" onClick={startConfiguredTraining}><Play size={16} />{taskSetupKind === "random" ? "开始随机训练" : "开始训练"}</button>
              </div>
            </section>
          </div>
        )}

        {showRandomComplete && trainingTask?.randomRun && (
          <div className="task-modal-backdrop">
            <section className="random-complete-modal" role="dialog" aria-modal="true" aria-labelledby="random-complete-title">
              <button className="random-complete-close" aria-label="退出随机训练" onClick={() => setShowRandomComplete(false)}><X size={20} /></button>
              <span>RANDOM ROUND COMPLETE</span>
              <h2 id="random-complete-title">本局随机训练已结束</h2>
              <p>{trainingTask.mode === "blind" ? "盲测答案现在已经解锁。" : "已到达本局设定的 K 线边界。"} 所有持仓已按最后一根收盘价自动平仓并保存，可以继续抽取下一局或查看复盘。</p>
              <div className="random-complete-stats">
                <div><span>{tradingMode === "capital" ? "账户总盈亏" : "总收益率"}</span><strong className={totalPnl >= 0 ? "up" : "down"}>{tradingMode === "capital" ? money(totalPnl) : percent(totalReturnPct)}</strong></div>
                <div><span>{tradingMode === "capital" ? "账户权益" : "已实现收益率"}</span><strong>{tradingMode === "capital" ? money(equity) : percent(realizedReturnPct)}</strong></div>
                <div><span>本局进度</span><strong>{currentTaskProgress.revealed}/{currentTaskProgress.total}</strong></div>
              </div>
              <div className="random-complete-actions">
                <button className="ghost-button" onClick={() => {
                  setShowRandomComplete(false);
                  setView("review");
                }}><BookOpenCheck size={16} />查看复盘</button>
                <button className="primary-button" onClick={continueRandomTraining}><Shuffle size={16} />继续随机</button>
              </div>
            </section>
          </div>
        )}

        {view === "replay" && (
          <div className="replay-layout">
            <section className="chart-stage">
              <div className="chart-heading">
                <div>
                  <strong>{trainingTask?.hideInstrument ? "BLIND" : instrument.symbol}</strong>
                  <span>{trainingTask?.hideInstrument ? `品种已隐藏 · ${timeframe}` : `${instrument.name} · ${timeframe} · 历史训练`}</span>
                </div>
                {currentBar && (
                  <div className="ohlc-line">
                    {trainingTask?.hidePrice ? <span><EyeOff size={13} />绝对价格已隐藏</span> : (
                      <>
                        <span>O {currentBar.open.toFixed(instrument.pricePrecision)}</span>
                        <span>H {currentBar.high.toFixed(instrument.pricePrecision)}</span>
                        <span>L {currentBar.low.toFixed(instrument.pricePrecision)}</span>
                        <span className={currentBar.close >= currentBar.open ? "up" : "down"}>C {currentBar.close.toFixed(instrument.pricePrecision)}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="chart-area">
                <div className="drawing-rail" aria-label="画图工具">
                  <button
                    className={!selectedDrawingId && !drawingGroupOpen && !drawingRequest && !drawingTextOpen ? "active" : ""}
                    title="光标"
                    aria-label="光标"
                    onClick={() => {
                      setDrawingRequest(null);
                      setDrawingTextOpen(false);
                      setSelectedDrawingId("");
                      setDrawingGroupOpen("");
                    }}
                  ><MousePointer2 size={18} /></button>
                  {drawingToolGroups.map((group) => {
                    const selectedTool = group.tools.find((tool) => tool.name === groupDrawingTools[group.id]) ?? group.tools[0];
                    const Icon = selectedTool.icon;
                    if (group.tools.length === 1) {
                      return (
                        <button
                          key={group.id}
                          className={drawingRequest?.name === selectedTool.name ? "active" : ""}
                          title={selectedTool.label}
                          aria-label={selectedTool.label}
                          onClick={() => beginDrawing(selectedTool)}
                        ><Icon size={18} /></button>
                      );
                    }
                    return (
                      <div className="drawing-tool-group" key={group.id}>
                        <button
                          className={drawingGroupOpen === group.id || drawingRequest?.name === selectedTool.name ? "active" : ""}
                          title={selectedTool.label}
                          aria-label={selectedTool.label}
                          onClick={() => beginDrawing(selectedTool)}
                        ><Icon size={18} /></button>
                        <button
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
                    className={drawingMagnetMode !== "normal" ? "active" : ""}
                    title={drawingMagnetMode === "normal" ? "磁吸 OHLC：关闭；开启后落点会自动对齐附近 K 线的开高低收" : drawingMagnetMode === "weak_magnet" ? "磁吸 OHLC：弱吸附" : "磁吸 OHLC：强吸附"}
                    aria-label="切换磁吸 OHLC"
                    onClick={() => setDrawingMagnetMode((mode) => mode === "normal" ? "weak_magnet" : mode === "weak_magnet" ? "strong_magnet" : "normal")}
                  ><Magnet size={18} /><small>{drawingMagnetMode === "weak_magnet" ? "弱" : drawingMagnetMode === "strong_magnet" ? "强" : ""}</small></button>
                  <button title="撤销上一笔绘图" aria-label="撤销绘图" disabled={!drawingUndoStack.length} onClick={undoDrawing}><Undo2 size={18} /></button>
                  <button title="重做已撤销的绘图" aria-label="重做绘图" disabled={!drawingRedoStack.length} onClick={redoDrawing}><Redo2 size={18} /></button>
                  <button className={drawingObjectsOpen ? "active" : ""} title="对象树" aria-label="绘图对象列表" onClick={() => setDrawingObjectsOpen((open) => !open)}><List size={18} /></button>
                  <button title="清除绘图" aria-label="清除绘图" onClick={() => {
                    handleDrawingsChange([]);
                    setSelectedDrawingId("");
                    setClearNonce(Date.now());
                  }}><Trash2 size={18} /></button>
                </div>

                {drawingGroupOpen && (() => {
                  const groupIndex = drawingToolGroups.findIndex((group) => group.id === drawingGroupOpen);
                  const group = drawingToolGroups[groupIndex];
                  if (!group) return null;
                  const precedingToolRows = groupIndex;
                  return (
                    <div className="drawing-tool-flyout" style={{ top: `${42 + precedingToolRows * 35}px` }}>
                      <strong>{group.label}</strong>
                      {group.tools.map((tool) => {
                        const Icon = tool.icon;
                        return (
                          <button key={tool.name} onClick={() => {
                            setGroupDrawingTools((current) => ({ ...current, [group.id]: tool.name }));
                            beginDrawing(tool);
                          }}>
                            <Icon size={17} />
                            <span>{tool.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                {drawingTextOpen && (
                  <form className="drawing-text-editor" aria-label="文本框输入" onSubmit={(event) => {
                    event.preventDefault();
                    beginTextDrawing();
                  }}>
                    <input
                      autoFocus
                      value={drawingText}
                      aria-label="图表文字"
                      placeholder="输入要写在图表上的文字"
                      onChange={(event) => setDrawingText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setDrawingTextOpen(false);
                      }}
                    />
                    <button type="submit" disabled={!drawingText.trim()}>放置</button>
                    <button type="button" aria-label="取消文本框" onClick={() => setDrawingTextOpen(false)}><X size={15} /></button>
                    <small>输入后点“放置”，再在图上确定文本框的两个角点。</small>
                  </form>
                )}

                {selectedDrawing && (
                  <div className={`drawing-property-bar ${selectedDrawing.name === "trainingTextBox" ? "text-box-properties" : ""}`} aria-label="绘图属性">
                    <span className="drawing-selected-name">{drawingLabel(selectedDrawing.name)}</span>
                    {selectedDrawing.name === "trainingTextBox" && (
                      <input
                        className="drawing-text-content"
                        value={selectedDrawingText}
                        aria-label="文本框内容"
                        title="文本框内容"
                        onChange={(event) => updateDrawingTextContent(selectedDrawing.id, event.target.value)}
                      />
                    )}
                    <label className="drawing-color-control" title={selectedDrawing.name === "trainingTextBox" ? "文字与边框颜色" : "线条颜色"}>
                      <input
                        type="color"
                        value={selectedDrawingInputColor}
                        aria-label={selectedDrawing.name === "trainingTextBox" ? "文字与边框颜色" : "线条颜色"}
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
                        {[10, 12, 14, 16, 18, 22, 28].map((size) => <option key={size} value={size}>{size}px</option>)}
                      </select>
                    )}
                    <button title={selectedDrawing.lock ? "解锁绘图" : "锁定绘图"} aria-label={selectedDrawing.lock ? "解锁绘图" : "锁定绘图"} onClick={() => updateDrawing(selectedDrawing.id, { lock: !selectedDrawing.lock })}>
                      {selectedDrawing.lock ? <Unlock size={16} /> : <Lock size={16} />}
                    </button>
                    <button title={selectedDrawing.visible ? "隐藏绘图" : "显示绘图"} aria-label={selectedDrawing.visible ? "隐藏绘图" : "显示绘图"} onClick={() => updateDrawing(selectedDrawing.id, { visible: !selectedDrawing.visible })}>
                      {selectedDrawing.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                    <button className="danger" title="删除绘图" aria-label="删除当前绘图" onClick={() => removeDrawing(selectedDrawing.id)}><Trash2 size={16} /></button>
                    <button title="关闭属性栏" aria-label="关闭绘图属性" onClick={() => setSelectedDrawingId("")}><X size={15} /></button>
                  </div>
                )}

                {drawingObjectsOpen && (
                  <aside className="drawing-object-panel" aria-label="绘图对象列表">
                    <header><strong>对象树</strong><button aria-label="关闭对象树" onClick={() => setDrawingObjectsOpen(false)}><X size={15} /></button></header>
                    <div className="drawing-object-list">
                      {drawings.length ? [...drawings].reverse().map((drawing, index) => (
                        <div className={drawing.id === selectedDrawingId ? "active" : ""} key={drawing.id}>
                          <button className="drawing-object-name" onClick={() => setSelectedDrawingId(drawing.id)}>
                            <span>{drawingLabel(drawing.name)}</span><small>#{drawings.length - index}</small>
                          </button>
                          <button aria-label={drawing.visible ? "隐藏对象" : "显示对象"} onClick={() => updateDrawing(drawing.id, { visible: !drawing.visible })}>{drawing.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                          <button aria-label={drawing.lock ? "解锁对象" : "锁定对象"} onClick={() => updateDrawing(drawing.id, { lock: !drawing.lock })}>{drawing.lock ? <Lock size={14} /> : <Unlock size={14} />}</button>
                          <button className="danger" aria-label="删除对象" onClick={() => removeDrawing(drawing.id)}><Trash2 size={14} /></button>
                        </div>
                      )) : <p>还没有绘图对象。</p>}
                    </div>
                  </aside>
                )}
                <div className="chart-wrap">
                  {loading ? <div className="chart-loading">正在准备历史 K 线…</div> : chartLoadError ? (
                    <div className="chart-loading" role="alert">
                      <strong>这组行情无法开始训练</strong>
                      <span>{chartLoadError}</span>
                      <button type="button" className="ghost-button" onClick={startQuickRandomTraining}>重新随机</button>
                    </div>
                  ) : (
                    <KLineReplayChart
                      bars={visibleBars}
                      symbol={trainingTask?.hideInstrument ? "BLIND" : instrument.symbol}
                      timezone={instrument.timezone}
                      timeframe={timeframe}
                      pricePrecision={instrument.pricePrecision}
                      drawingRequest={drawingRequest}
                      clearNonce={clearNonce}
                      tradeMarkers={tradeMarkers}
                      decisionMarkers={decisionMarkers}
                      drawings={drawings}
                      drawingsRestoreNonce={drawingsRestoreNonce}
                      hideDate={Boolean(trainingTask?.hideDate)}
                      hidePrice={Boolean(trainingTask?.hidePrice)}
                      onDecisionSelect={setSelectedDecisionId}
                      onCandleContextMenu={openDecisionForCandle}
                      onDrawingsChange={handleDrawingsChange}
                      onDrawingSelect={(id) => setSelectedDrawingId(id ?? "")}
                    />
                  )}
                  {selectedDecision && (
                    <div className="decision-chart-card">
                      <div className="decision-chart-card-head">
                        <div>
                          <span>{selectedDecision.backfilled ? "补写决策" : "已提交决策"}</span>
                          <strong>{trainingTask?.hideDate ? `K线 #${selectedDecision.cursor + 1}` : formatDate(selectedDecision.barTimestamp, timeframe)}</strong>
                        </div>
                        <button aria-label="关闭决策卡" onClick={() => setSelectedDecisionId("")}>×</button>
                      </div>
                      <div className="decision-chart-tags">
                        <span>{selectedDecision.decision.marketState}</span>
                        <span>{selectedDecision.decision.location}</span>
                        {selectedDecision.decision.reasons.map((reason) => <span key={reason}>{reason}</span>)}
                      </div>
                      <div className="decision-chart-levels">
                        <span>参考价 <strong>{trainingTask?.hidePrice ? "已隐藏" : selectedDecision.referencePrice.toFixed(instrument.pricePrecision)}</strong></span>
                        <span>失效 <strong>{trainingTask?.hidePrice ? "训练结束后揭示" : selectedDecision.decision.stop || "未填写"}</strong></span>
                        <span>目标 <strong>{trainingTask?.hidePrice ? "训练结束后揭示" : selectedDecision.decision.target || "未填写"}</strong></span>
                      </div>
                      <p>{selectedDecision.decision.note || "没有填写计划说明"}</p>
                    </div>
                  )}
                  <div className="replay-watermark">REPLAY · 未来已隐藏</div>
                  <div className="chart-touch-hint">长按 K 线补写决策</div>
                </div>
              </div>

              <div className="replay-controls">
                <div className="progress-meta">
                  <span>{currentBar ? (trainingTask?.hideDate ? `训练第 ${currentTaskProgress.revealed} 根` : formatDate(currentBar.timestamp, timeframe)) : "--"}</span>
                  <span>{trainingTask ? `${currentTaskProgress.revealed} / ${currentTaskProgress.total} 根` : `${cursor + 1} / ${bars.length} 根`}</span>
                </div>
                <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="transport">
                  <button aria-label={rewindLocked ? "随机训练不可重置" : "重置"} title={rewindLocked ? "随机训练为单向揭示，不允许重置" : undefined} disabled={rewindLocked} onClick={resetTraining}><RotateCcw size={17} /></button>
                  <button aria-label={rewindLocked ? "随机训练不可回退" : "上一根"} title={rewindLocked ? "随机训练为单向揭示，不允许查看上一根" : undefined} disabled={rewindLocked || trainingComplete || cursor <= (trainingTask?.startCursor ?? 0)} onClick={revealPrevious}><ChevronLeft size={19} /></button>
                  <button className="play-button" disabled={trainingComplete} aria-label={playing ? "暂停" : "播放"} onClick={() => {
                    const nextPlaying = !playing;
                    setPlaying(nextPlaying);
                    appendEvent("playback_toggled", { playing: nextPlaying, speed });
                  }}>
                    {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
                  </button>
                  <button aria-label="下一根" disabled={trainingComplete} onClick={revealNext}><ChevronRight size={19} /></button>
                  <button aria-label="前进五根" disabled={trainingComplete} onClick={() => revealMany(5)}><FastForward size={18} /></button>
                </div>
                <div className="speed-control">
                  {[0.5, 1, 2, 5].map((value) => <button key={value} className={speed === value ? "active" : ""} onClick={() => {
                    setSpeed(value);
                    appendEvent("playback_speed_changed", { speed: value });
                  }}>{value}x</button>)}
                </div>
              </div>

              {trainingComplete && !trainingTask?.randomRun && (
                <div className="training-complete-banner">
                  <div>
                    <span>TRAINING COMPLETE</span>
                    <strong>{trainingTask ? `${trainingModeLabels[trainingTask.mode]}已自动结束` : "训练已结束"}</strong>
                    <small>已到达设定边界，所有持仓已按最后一根收盘价自动平仓并保存。</small>
                  </div>
                  <button className="ghost-button" onClick={resetTraining}><RotateCcw size={15} />按原条件重练</button>
                  <button className="primary-button" onClick={() => setView("review")}><BookOpenCheck size={15} />查看复盘</button>
                </div>
              )}

              <div className="trade-dock">
                <div className="trade-stats">
                  {tradingMode === "capital" ? (
                    <>
                      <span>账户权益 <strong className={equity >= initialCapital ? "up" : "down"}>{money(equity)}</strong></span>
                      <span>可用资金 <strong>{money(availableBuyingPower)}</strong></span>
                      <span>持仓市值 <strong>{money(marketValue)}</strong></span>
                      <span>总盈亏 <strong className={totalPnl >= 0 ? "up" : "down"}>{money(totalPnl)}</strong></span>
                    </>
                  ) : (
                    <>
                      <span>持仓笔数 <strong>{openPositions.length}</strong></span>
                      <span>总收益率 <strong className={totalReturnPct >= 0 ? "up" : "down"}>{percent(totalReturnPct)}</strong></span>
                      <span>浮动收益率 <strong className={floatingReturnPct >= 0 ? "up" : "down"}>{percent(floatingReturnPct)}</strong></span>
                      <span>已实现收益率 <strong className={realizedReturnPct >= 0 ? "up" : "down"}>{percent(realizedReturnPct)}</strong></span>
                    </>
                  )}
                </div>
                <div className="order-entry">
                  <label><span className="quantity-label">数量</span><input aria-label="下单数量" type="number" min={minimumBuyQuantity(marketRules)} value={orderQty} onChange={(event) => {
                    const quantity = Math.max(1, Number(event.target.value));
                    setOrderQty(quantity);
                    appendEvent("order_quantity_changed", { quantity });
                  }} step={buyQuantityStep(marketRules)} /></label>
                  <button
                    className="sell-button"
                    disabled={trainingComplete || !marketRules.tradingEnabled || !marketRules.allowShort}
                    title={!marketRules.allowShort ? `${marketRules.name}禁止卖出开仓` : ""}
                    onClick={() => queueOpenOrder("sell")}
                  ><TrendingDown size={16} /><span className="desktop-order-label">{marketRules.allowShort ? "卖出开仓" : "A股禁做空"}</span><span className="mobile-order-label">{marketRules.allowShort ? "卖出" : "禁做空"}</span></button>
                  <button
                    className="buy-button"
                    disabled={trainingComplete || !marketRules.tradingEnabled}
                    onClick={() => queueOpenOrder("buy")}
                  ><TrendingUp size={16} /><span className="desktop-order-label">买入开仓</span><span className="mobile-order-label">买入</span></button>
                  <button className="flat-button" disabled={trainingComplete || !openPositions.some((position) => !pendingOrders.some((order) => order.action === "close" && order.positionId === position.id))} onClick={queueCloseAll}>
                    <CircleStop size={16} /><span className="desktop-order-label">{openPositions.length && !closablePositions.length ? "次日开盘全平" : "全部平仓"}</span><span className="mobile-order-label">{openPositions.length && !closablePositions.length ? "次日全平" : "全平"}</span>
                  </button>
                </div>
                <div className={`pending-note ${ruleNotice ? "rule-warning" : ""} ${ruleNotice || pendingOrders.length ? "has-message" : ""}`}>
                  {ruleNotice || (pendingOrders.length
                    ? `${pendingOrders.length} 笔委托将在下一根开盘按 ${marketRules.name} 规则校验${tradingMode === "capital" ? ` · 已预留 ${(cashBalance - availableBuyingPower).toFixed(2)}` : ""}`
                    : `${marketRules.name}：${describeBuyQuantity(marketRules)}${marketRules.tPlusOne ? " · T+1" : ""}${marketRules.priceLimitRatio ? ` · 涨跌幅 ${(marketRules.priceLimitRatio * 100).toFixed(0)}%` : ""}`)}
                </div>

                <div className={`orders-board ${mobileOrdersExpanded ? "mobile-expanded" : ""}`}>
                  <div className="orders-board-head">
                    <div className="orders-board-title">
                      <strong>订单与持仓</strong>
                      <button className="orders-mobile-toggle" aria-expanded={mobileOrdersExpanded} onClick={() => setMobileOrdersExpanded((value) => !value)}>{mobileOrdersExpanded ? "收起" : "明细"}</button>
                    </div>
                    <div className="orders-tabs">
                      <button className={orderPanelTab === "positions" ? "active" : ""} onClick={() => { setOrderPanelTab("positions"); setMobileOrdersExpanded(true); }}>当前持仓 <span>{openPositions.length}</span></button>
                      <button className={orderPanelTab === "pending" ? "active" : ""} onClick={() => { setOrderPanelTab("pending"); setMobileOrdersExpanded(true); }}>待成交 <span>{pendingOrders.length}</span></button>
                      <button className={orderPanelTab === "history" ? "active" : ""} onClick={() => { setOrderPanelTab("history"); setMobileOrdersExpanded(true); }}>已平仓 <span>{closedPositions.length}</span></button>
                    </div>
                  </div>

                  <div className="orders-table-wrap">
                    {orderPanelTab === "positions" && (
                      <table className="orders-table">
                        <thead><tr><th>仓位</th><th>方向</th><th>数量</th><th>开仓时间</th><th>开仓价</th><th>现价</th><th>浮动盈亏</th><th>操作</th></tr></thead>
                        <tbody>{openPositions.length ? openPositions.map((position) => {
                          const pnl = currentBar ? (currentBar.close - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1) : 0;
                          const closeQueued = pendingOrders.some((order) => order.action === "close" && order.positionId === position.id);
                          const closeValidation = currentBar
                            ? validateCloseOrder(marketRules, position, currentBar.timestamp, instrument.timezone)
                            : { ok: false, message: "行情未就绪" };
                          return (
                            <tr key={position.id}>
                              <td data-label="仓位"><span className="position-id">#{position.id.slice(0, 6)}</span></td>
                              <td data-label="方向"><span className={position.side === "long" ? "side-long" : "side-short"}>{position.side === "long" ? "多 / 买" : "空 / 卖"}</span></td>
                              <td data-label="数量">{position.qty}</td>
                              <td data-label="开仓时间">{trainingDateLabel(position.entryTimestamp)}</td>
                              <td data-label="开仓价">{trainingPriceLabel(position.entryPrice)}</td>
                              <td data-label="现价">{trainingPriceLabel(currentBar?.close)}</td>
                              <td data-label="浮动盈亏"><strong className={pnl >= 0 ? "up" : "down"}>{tradingMode === "capital" ? money(pnl) : percent(positionReturnPct(position, currentPrice))}</strong></td>
                              <td data-label="操作"><button
                                className="row-action"
                                disabled={trainingComplete || closeQueued || (!closeValidation.ok && closeValidation.code !== "t_plus_one_locked")}
                                title={closeValidation.code === "t_plus_one_locked" ? "预约到下一交易日第一根K线开盘平仓" : closeValidation.message}
                                onClick={() => closeValidation.ok ? queueClosePosition(position.id) : queueCloseNextSession(position.id)}
                              >{closeQueued ? "已委托" : closeValidation.ok ? "平仓" : closeValidation.code === "t_plus_one_locked" ? "次日开盘平仓" : "不可平仓"}</button></td>
                            </tr>
                          );
                        }) : <tr><td className="orders-empty" colSpan={8}>暂无持仓。买入或卖出委托会在下一根 K 线开盘形成独立仓位。</td></tr>}</tbody>
                      </table>
                    )}

                    {orderPanelTab === "pending" && (
                      <table className="orders-table">
                        <thead><tr><th>委托</th><th>动作</th><th>方向</th><th>数量</th><th>提交时间</th><th>关联仓位</th><th>成交规则</th><th>操作</th></tr></thead>
                        <tbody>{pendingOrders.length ? pendingOrders.map((order) => (
                          <tr key={order.id}>
                            <td data-label="委托"><span className="position-id">#{order.id.slice(0, 6)}</span></td>
                            <td data-label="动作">{order.action === "open" ? "开仓" : "平仓"}</td>
                            <td data-label="方向"><span className={order.side === "buy" ? "side-long" : "side-short"}>{order.side === "buy" ? "买入" : "卖出"}</span></td>
                            <td data-label="数量">{order.qty}</td>
                            <td data-label="提交时间">{trainingDateLabel(order.createdAt)}</td>
                            <td data-label="关联仓位">#{order.positionId.slice(0, 6)}</td>
                            <td data-label="成交规则">{order.executeAtTimestamp ? `${trainingDateLabel(order.executeAtTimestamp)} 开盘` : "下一根开盘"} · {order.ruleVersion ?? "旧规则"}</td>
                            <td data-label="操作"><button className="row-action danger" onClick={() => cancelPendingOrder(order.id)}>撤单</button></td>
                          </tr>
                        )) : <tr><td className="orders-empty" colSpan={8}>暂无待成交委托。</td></tr>}</tbody>
                      </table>
                    )}

                    {orderPanelTab === "history" && (
                      <table className="orders-table">
                        <thead><tr><th>仓位</th><th>方向</th><th>数量</th><th>开仓时间</th><th>开仓价</th><th>平仓时间</th><th>平仓价</th><th>已实现</th></tr></thead>
                        <tbody>{closedPositions.length ? [...closedPositions].reverse().map((position) => (
                          <tr key={position.id}>
                            <td data-label="仓位"><span className="position-id">#{position.id.slice(0, 6)}</span></td>
                            <td data-label="方向"><span className={position.side === "long" ? "side-long" : "side-short"}>{position.side === "long" ? "多 / 买" : "空 / 卖"}</span></td>
                            <td data-label="数量">{position.qty}</td>
                            <td data-label="开仓时间">{trainingDateLabel(position.entryTimestamp)}</td>
                            <td data-label="开仓价">{trainingPriceLabel(position.entryPrice)}</td>
                            <td data-label="平仓时间">{position.exitTimestamp ? trainingDateLabel(position.exitTimestamp) : "--"}</td>
                            <td data-label="平仓价">{trainingPriceLabel(position.exitPrice)}</td>
                            <td data-label="已实现"><strong className={(position.realizedPnl ?? 0) >= 0 ? "up" : "down"}>{tradingMode === "capital" ? money(position.realizedPnl ?? 0) : percent(positionReturnPct(position, position.exitPrice ?? position.entryPrice))}</strong></td>
                          </tr>
                        )) : <tr><td className="orders-empty" colSpan={8}>平仓后，买卖点会以浅色虚线连接并保留在这里。</td></tr>}</tbody>
                      </table>
                    )}
                  </div>
                </div>
                {orderRejections.length > 0 && (
                  <div className="rule-rejections">
                    <strong>最近规则拒单</strong>
                    {[...orderRejections].reverse().slice(0, 3).map((rejection) => (
                      <span key={rejection.id}>{trainingDateLabel(rejection.timestamp)} · {rejection.message}</span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <aside className="decision-panel" ref={decisionPanelRef}>
              <div className="panel-title">
                <div><span>{decisionTarget ? "补写事前决策" : "事前决策卡"}</span><strong>{planScore}%</strong></div>
                <p>{decisionTarget ? "仅补充记录，不回退行情，也不改变持仓" : "先写计划，再揭示下一根"}</p>
              </div>
              {decisionTarget && (
                <div className="decision-backfill-target">
                  <div>
                    <span>正在补写</span>
                    <strong>{trainingTask?.hideDate ? `K线 #${decisionTarget.dataIndex + 1}` : formatDate(decisionTarget.timestamp, timeframe)}</strong>
                    <small>{trainingTask?.hidePrice ? "参考价已隐藏" : `参考价 ${decisionTarget.referencePrice.toFixed(instrument.pricePrecision)}`}</small>
                  </div>
                  <button type="button" onClick={cancelDecisionBackfill}>取消</button>
                </div>
              )}
              <label>市场状态
                <select value={decision.marketState} onChange={(event) => updateDecision("marketState", event.target.value)}>
                  <option>趋势</option><option>宽通道</option><option>震荡区间</option><option>突破模式</option><option>反转尝试</option>
                </select>
              </label>
              <label>当前位置
                <select value={decision.location} onChange={(event) => updateDecision("location", event.target.value)}>
                  <option>回调位置</option><option>区间上沿</option><option>区间中部</option><option>区间下沿</option><option>关键突破位</option>
                </select>
              </label>
              <fieldset>
                <legend>交易理由 <small>至少 2 个</small></legend>
                <div className="reason-chips">
                  {[...reasonOptions, ...customReasonTags].map((reason) => {
                    const selected = decision.reasons.includes(reason);
                    return (
                      <button type="button" key={reason} className={selected ? "selected" : ""} onClick={() => updateDecision(
                        "reasons",
                        selected ? decision.reasons.filter((item) => item !== reason) : [...decision.reasons, reason],
                      )}>{selected ? "✓ " : "+ "}{reason}</button>
                    );
                  })}
                </div>
                <form className="custom-reason-tag" onSubmit={(event) => {
                  event.preventDefault();
                  addCustomReasonTag();
                }}>
                  <input
                    aria-label="自定义交易理由标签"
                    maxLength={20}
                    placeholder="输入自定义 Tag"
                    value={customReasonInput}
                    onChange={(event) => setCustomReasonInput(event.target.value)}
                  />
                  <button type="submit" disabled={!customReasonInput.trim()}>添加</button>
                </form>
              </fieldset>
              <div className="price-plan">
                <label>失效 / 止损<input inputMode="decimal" placeholder="价格" value={decision.stop} onChange={(event) => updateDecision("stop", event.target.value)} /></label>
                <label>第一目标<input inputMode="decimal" placeholder="价格" value={decision.target} onChange={(event) => updateDecision("target", event.target.value)} /></label>
              </div>
              <label>计划说明
                <textarea placeholder="我在等待什么？什么情况放弃？" value={decision.note} onChange={(event) => updateDecision("note", event.target.value)} />
              </label>
              <div className="discipline-card">
                <Sparkles size={18} />
                <div><strong>{decision.reasons.length >= 2 ? "条件已成形" : "再找一个独立理由"}</strong><span>评分关注过程，不用结果倒推理由</span></div>
              </div>
              <div className="submitted-plan-count">已提交 <strong>{decisionSubmissions.length}</strong> 份计划 · 右键或长按历史 K 线可补写</div>
              <button className="commit-plan" disabled={trainingComplete && !decisionTarget} onClick={submitDecision}><ListChecks size={17} />{decisionTarget ? "保存补写决策" : trainingComplete ? "训练已结束" : "提交决策并揭示下一根"}</button>
            </aside>
          </div>
        )}

        {view === "performance" && (
          <section className="content-page performance-page">
            <div className="page-heading">
              <div>
                <span>PERFORMANCE</span>
                <h1>训练表现</h1>
                <p>先看全部已保存训练的整体结果，再筛选一组训练比较表现。</p>
              </div>
            </div>

            <div className="performance-section-head">
              <div>
                <span className="section-label">全部训练</span>
                <h2>整体表现</h2>
              </div>
              <small>当前仅统计{performanceUsesCapital ? "资金账户" : "收益率"}模式：{overallPerformance.sessions} 场已保存训练，未保存的临时训练不计入。</small>
            </div>
            <div className="performance-overview">
              <div className="performance-hero">
                <span>{performanceUsesCapital ? "累计总盈亏" : "训练收益率合计"}</span>
                <strong className={overallPerformance.totalPnl >= 0 ? "up" : "down"}>{formatPerformanceValue(overallPerformance.totalPnl)}</strong>
                <small>{performanceUsesCapital
                  ? `已实现 ${money(overallPerformance.realizedPnl)} · 浮动 ${money(overallPerformance.floatingPnl)}`
                  : `已实现收益率合计 ${percent(overallPerformance.realizedPnl)} · 浮动收益率合计 ${percent(overallPerformance.floatingPnl)}`}</small>
              </div>
              <div className="performance-metric">
                <span>训练场次</span>
                <strong>{overallPerformance.sessions}</strong>
                <small>{overallPerformance.completedSessions} 场完成 · 完成率 {overallPerformance.completionRate}%</small>
              </div>
              <div className="performance-metric">
                <span>按交易胜率</span>
                <strong>{overallPerformance.winRate}%</strong>
                <small>跨全部训练共 {overallPerformance.closedTrades} 笔已平仓交易：{overallPerformance.winningTrades} 胜 / {overallPerformance.losingTrades} 负 / {overallPerformance.flatTrades} 平</small>
              </div>
              <div className="performance-metric">
                <span>按训练胜率</span>
                <strong>{overallPerformance.sessionWinRate}%</strong>
                <small>{overallPerformance.winningSessions} 胜 / {overallPerformance.losingSessions} 负 / {overallPerformance.flatSessions} 平 · 每场已保存训练</small>
              </div>
              <div className="performance-metric">
                <span>{performanceUsesCapital ? "平均每场盈亏" : "平均每场收益率"}</span>
                <strong className={overallPerformance.averagePnl >= 0 ? "up" : "down"}>{formatPerformanceValue(overallPerformance.averagePnl)}</strong>
                <small>最大回撤 {formatPerformanceValue(-overallPerformance.maxDrawdown)}</small>
              </div>
              <div className="performance-metric">
                <span>Profit Factor</span>
                <strong>{profitFactorLabel(overallPerformance.profitFactor)}</strong>
                <small>{performanceUsesCapital ? "交易总盈利 ÷ 交易总亏损" : "盈利收益率合计 ÷ 亏损收益率合计"}</small>
              </div>
            </div>

            <article className="performance-filter-card">
              <div className="performance-section-head">
                <div>
                  <span className="section-label">TRAINING SET</span>
                  <h2>筛选训练集</h2>
                </div>
                <button className="ghost-button" onClick={() => {
                  setPerformanceFilters(defaultPerformanceFilters);
                  setSelectedPerformanceSessionId("");
                }}>清除筛选</button>
              </div>
              <div className="performance-filters">
                <label>品种
                  <select value={performanceFilters.instrumentId} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, instrumentId: event.target.value }))}>
                    <option value="all">全部品种</option>
                    {[...new Set(performanceSessionSummaries.map((summary) => summary.session.instrumentId))].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>周期
                  <select value={performanceFilters.timeframe} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, timeframe: event.target.value }))}>
                    <option value="all">全部周期</option>
                    {timeframes.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>训练模式
                  <select value={performanceFilters.modeLabel} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, modeLabel: event.target.value }))}>
                    <option value="all">全部模式</option>
                    {performanceModeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>状态
                  <select value={performanceFilters.status} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, status: event.target.value as PerformanceFilters["status"] }))}>
                    <option value="all">全部状态</option>
                    <option value="completed">已完成</option>
                    <option value="active">可继续</option>
                  </select>
                </label>
                <label>保存日期从
                  <input type="date" value={performanceFilters.dateFrom} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, dateFrom: event.target.value }))} />
                </label>
                <label>到
                  <input type="date" value={performanceFilters.dateTo} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, dateTo: event.target.value }))} />
                </label>
              </div>
            </article>

            <div className="filtered-performance-head">
              <div>
                <span className="section-label">筛选结果</span>
                <h2>{filteredPerformance.sessions} 场训练的组合表现</h2>
              </div>
              <small>指标会随上方筛选条件即时更新。</small>
            </div>
            <div className="filtered-performance-grid">
              <div><span>{performanceUsesCapital ? "组合总盈亏" : "训练集收益率合计"}</span><strong className={filteredPerformance.totalPnl >= 0 ? "up" : "down"}>{formatPerformanceValue(filteredPerformance.totalPnl)}</strong></div>
              <div><span>按交易胜率</span><strong>{filteredPerformance.winRate}%</strong><small>跨所选训练共 {filteredPerformance.closedTrades} 笔：{filteredPerformance.winningTrades} 胜 / {filteredPerformance.losingTrades} 负 / {filteredPerformance.flatTrades} 平</small></div>
              <div><span>按训练胜率</span><strong>{filteredPerformance.sessionWinRate}%</strong><small>{filteredPerformance.winningSessions} 胜 / {filteredPerformance.losingSessions} 负 / {filteredPerformance.flatSessions} 平 · {filteredPerformance.sessions} 场</small></div>
              <div><span>Profit Factor</span><strong>{profitFactorLabel(filteredPerformance.profitFactor)}</strong><small>{performanceUsesCapital ? `交易总盈利 ${money(filteredPerformance.grossProfit)}` : `盈利收益率合计 ${percent(filteredPerformance.grossProfit)}`}</small></div>
              <div><span>最大回撤</span><strong className="down">{formatPerformanceValue(-filteredPerformance.maxDrawdown)}</strong><small>按训练保存顺序计算</small></div>
              <div><span>计划完整度</span><strong>{filteredPerformance.averagePlanScore}%</strong><small>{filteredPerformance.planCount} 份正式计划</small></div>
            </div>

            <div className="performance-distribution">
              <div className="performance-section-head">
                <div><span className="section-label">交易结果</span><h2>胜负分布</h2></div>
                <small>{filteredPerformance.closedTrades ? "已汇总所选训练内的每一笔已平仓交易；未平仓浮盈亏不计入交易胜率" : "筛选范围内还没有已平仓交易"}</small>
              </div>
              <div className="distribution-track" aria-label="已平仓交易胜负分布">
                <span className="wins" style={{ width: `${filteredPerformance.closedTrades ? filteredPerformance.winningTrades / filteredPerformance.closedTrades * 100 : 0}%` }} />
                <span className="flats" style={{ width: `${filteredPerformance.closedTrades ? filteredPerformance.flatTrades / filteredPerformance.closedTrades * 100 : 0}%` }} />
                <span className="losses" style={{ width: `${filteredPerformance.closedTrades ? filteredPerformance.losingTrades / filteredPerformance.closedTrades * 100 : 0}%` }} />
              </div>
              <div className="distribution-legend">
                <span><i className="wins" />盈利 {filteredPerformance.winningTrades}</span>
                <span><i className="flats" />持平 {filteredPerformance.flatTrades}</span>
                <span><i className="losses" />亏损 {filteredPerformance.losingTrades}</span>
              </div>
            </div>

            <article className="performance-sessions">
              <div className="performance-section-head">
                <div><span className="section-label">训练明细</span><h2>选择具体训练</h2></div>
                <small>选中一场后，可以查看完整复盘或继续训练。</small>
              </div>
              {filteredSessionSummaries.length ? (
                <div className="performance-session-list">
                  <div className="performance-session-header">
                    <span>训练</span><span>模式 / 区间</span><span>状态</span><span>{performanceUsesCapital ? "总盈亏" : "总收益率"}</span><span>保存时间</span>
                  </div>
                  {filteredSessionSummaries.map((summary) => (
                    <button
                      className={`performance-session-row ${selectedPerformanceSession?.session.id === summary.session.id ? "selected" : ""}`}
                      key={summary.session.id}
                      aria-pressed={selectedPerformanceSession?.session.id === summary.session.id}
                      onClick={() => setSelectedPerformanceSessionId(summary.session.id)}
                    >
                      <span><strong>{summary.session.instrumentId}</strong><small>{summary.session.timeframe}</small></span>
                      <span><strong>{summary.modeLabel}</strong><small>{summary.rangeLabel}</small></span>
                      <span className={summary.task?.status === "completed" ? "session-status completed" : "session-status"}>{summary.task?.status === "completed" ? "已完成" : "可继续"}</span>
                      <span className="performance-session-result">
                        <strong className={(summary.state.tradingMode === "capital" ? summary.pnl.total : summary.returnPct) >= 0 ? "up" : "down"}>{summary.state.tradingMode === "capital" ? money(summary.pnl.total) : percent(summary.returnPct)}</strong>
                        <small>{summary.closedTradePnls.length} 笔已平仓 · {summary.winningTrades}胜/{summary.losingTrades}负/{summary.flatTrades}平</small>
                      </span>
                      <time>{new Date(summary.session.updatedAt).toLocaleString("zh-CN")}</time>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">没有符合当前筛选条件的训练，可以清除筛选后重新选择。</div>
              )}

              {selectedPerformanceSession ? (
                <div className="selected-performance-session">
                  <div>
                    <span>已选训练</span>
                    <strong>{selectedPerformanceSession.session.instrumentId} · {selectedPerformanceSession.session.timeframe} · {selectedPerformanceSession.modeLabel}</strong>
                    <small>{selectedPerformanceSession.rangeLabel} · {selectedPerformanceSession.state.tradingMode === "capital" ? `总盈亏 ${money(selectedPerformanceSession.pnl.total)}` : `总收益率 ${percent(selectedPerformanceSession.returnPct)}`}</small>
                  </div>
                  <div>
                    <button className="review-session" onClick={() => inspectSession(selectedPerformanceSession.session, true)}>
                      <BookOpenCheck size={14} />查看复盘
                    </button>
                    <button className="resume-session" onClick={() => resumeSession(selectedPerformanceSession.session)}>
                      <RotateCcw size={14} />继续训练
                    </button>
                  </div>
                </div>
              ) : filteredSessionSummaries.length ? (
                <div className="performance-selection-hint">请先从上方训练明细中选择一场训练。</div>
              ) : null}
            </article>
          </section>
        )}

        {view === "database" && (
          <section className="content-page">
            <div className="page-heading"><div><span>DATA LIBRARY</span><h1>K 线数据库</h1><p>当前只管理历史 K 线及其覆盖、来源和质量。</p></div>
              <label className="primary-button file-button"><FileUp size={17} />导入到{dataMarketLabel}<input type="file" accept=".csv,text/csv" onChange={importCsv} /></label>
            </div>
            {importStatus && <div className="status-banner">{importStatus}</div>}
            <div className="data-market-tabs" role="tablist" aria-label="选择要管理的数据市场">
              {dataMarkets.map((market) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={dataMarket === market.id}
                  className={dataMarket === market.id ? "active" : ""}
                  key={market.id}
                  onClick={() => {
                    setDataMarket(market.id);
                    setCoveragePage(1);
                    setCoverageSearch("");
                    setCoverageQuery("");
                    setSelectedCoverageKeys([]);
                  }}
                >
                  <strong>{market.label}</strong><span>{market.description}</span>
                </button>
              ))}
            </div>
            <div className="database-summary">
              <div><strong>{dataMarketInstrumentCount.toLocaleString()}</strong><span>品种</span></div>
              <div><strong>{coverageSummary.barCount.toLocaleString()}</strong><span>K 线总数</span></div>
              <div><strong>{coverageSummary.timeframeCount}</strong><span>周期</span></div>
              <div><strong>0</strong><span>已知异常</span></div>
            </div>
            <DataSourceManager
              market={dataMarket}
              onOpenSettings={() => openSettingsPanel("data")}
              onDataChanged={() => {
                void Promise.all([loadCoverage(), loadInstrumentCatalog()]);
              }}
            />
            <div className="coverage-toolbar">
              <form onSubmit={(event) => {
                event.preventDefault();
                setCoveragePage(1);
                setCoverageQuery(coverageSearch.trim());
              }}>
                <input
                  value={coverageSearch}
                  onChange={(event) => setCoverageSearch(event.target.value)}
                  placeholder="搜索代码、名称或来源"
                  aria-label="搜索行情覆盖"
                />
                <button type="submit">查询</button>
                {coverageQuery && <button type="button" onClick={() => {
                  setCoverageSearch("");
                  setCoverageQuery("");
                  setCoveragePage(1);
                }}>清除</button>}
              </form>
              <span>
                {coverageLoading ? "正在读取…" : `共 ${coverageTotal.toLocaleString()} 条，仅渲染当前 ${coverage.length} 条`}
              </span>
              <button
                type="button"
                className="coverage-delete-button"
                disabled={!selectedCoverageKeys.length || coverageLoading}
                onClick={() => void deleteSelectedCoverage()}
              >
                <Trash2 size={13} />删除所选数据
                {selectedCoverageKeys.length > 0 && ` (${selectedCoverageKeys.length})`}
              </button>
              <div>
                <button disabled={coveragePage <= 1 || coverageLoading} onClick={() => setCoveragePage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} />上一页</button>
                <strong>{coveragePage} / {Math.max(1, Math.ceil(coverageTotal / coveragePageSize))}</strong>
                <button disabled={coveragePage >= Math.ceil(coverageTotal / coveragePageSize) || coverageLoading} onClick={() => setCoveragePage((value) => value + 1)}>下一页<ChevronRight size={14} /></button>
              </div>
            </div>
            <div className="coverage-table-wrap">
              <table className="coverage-table">
                <thead><tr>
                  <th className="coverage-select-cell">
                    <input
                      type="checkbox"
                      aria-label="全选当前页数据"
                      checked={coverage.length > 0 && coverage.every((item) => selectedCoverageKeys.includes(coverageKey(item)))}
                      onChange={() => {
                        const pageKeys = coverage.map(coverageKey);
                        const pageKeySet = new Set(pageKeys);
                        const allSelected = pageKeys.every((key) => selectedCoverageKeys.includes(key));
                        setSelectedCoverageKeys((current) => allSelected
                          ? current.filter((key) => !pageKeySet.has(key))
                          : Array.from(new Set([...current, ...pageKeys])));
                      }}
                    />
                  </th>
                  <th>品种</th><th>市场</th><th>周期</th><th>数量</th><th>覆盖范围</th><th>复权</th><th>来源</th><th>状态</th>
                </tr></thead>
                <tbody>{coverage.map((item) => {
                  const key = coverageKey(item);
                  const selected = selectedCoverageKeys.includes(key);
                  return (
                  <tr className={selected ? "selected" : ""} key={key}>
                    <td className="coverage-select-cell" data-label="选择">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${item.symbol} ${item.timeframe} ${item.source}`}
                        checked={selected}
                        onChange={() => setSelectedCoverageKeys((current) => current.includes(key)
                          ? current.filter((value) => value !== key)
                          : [...current, key])}
                      />
                    </td>
                    <td data-label="品种"><strong>{item.symbol}</strong><span>{item.name}</span></td>
                    <td data-label="市场">{item.market}</td><td data-label="周期"><span className="tf-badge">{item.timeframe}</span></td>
                    <td data-label="数量">{Number(item.barCount).toLocaleString()}</td>
                    <td data-label="覆盖范围">{new Date(item.firstTimestamp).toLocaleDateString("zh-CN")} — {new Date(item.lastTimestamp).toLocaleDateString("zh-CN")}</td>
                    <td data-label="复权">{item.adjustmentType}</td><td data-label="来源">{item.source}</td><td data-label="状态"><span className="healthy-dot" />完整</td>
                  </tr>
                );})}</tbody>
              </table>
            </div>
            <div className="csv-help"><strong>CSV 格式</strong><code>timestamp,open,high,low,close,volume,turnover</code><span>时间可用毫秒时间戳或可解析日期；单次最多 5000 根。</span></div>
          </section>
        )}

        {view === "review" && (
          <section className="content-page review-page">
            <div className="page-heading">
              <div><span>REVIEW</span><h1>训练复盘</h1><p>{reviewTitle} · 先看事前计划，再判断执行质量。</p></div>
              {reviewedSession && <button className="ghost-button" onClick={() => setReviewedSession(null)}>返回当前训练</button>}
            </div>
            <div className="review-grid">
              <div className="review-hero">
                <span>{reviewState.tradingMode === "capital" ? "本次已实现盈亏" : "本次已实现收益率"}</span><strong className={reviewRealizedPnl >= 0 ? "up" : "down"}>{reviewState.tradingMode === "capital" ? money(reviewRealizedPnl) : percent(reviewRealizedReturnPct)}</strong><small>{reviewClosedPositions.length} 笔已平仓 · {reviewState.executions.length} 笔成交 · 最近计划完整度 {reviewPlanScore}%</small>
              </div>
              <div className="metric-card"><span>本场按交易胜率</span><strong>{reviewTradeWinRate}%</strong><small>{reviewWinningTrades} 胜 / {reviewLosingTrades} 负 / {reviewFlatTrades} 平 · 盈利仓位 ÷ 已平仓仓位</small></div>
              <div className="metric-card"><span>已提交计划</span><strong>{reviewState.decisionSubmissions.length}</strong><small>每次提交均绑定原始K线</small></div>
              <div className="metric-card"><span>本场训练结果</span><strong className={reviewTotalResult >= 0 ? "up" : "down"}>{reviewState.tradingMode === "capital" ? money(reviewTotalResult) : percent(reviewTotalResult)}</strong><small>{reviewTotalResult > 0 ? "本场计为训练胜" : reviewTotalResult < 0 ? "本场计为训练负" : "本场计为训练平"} · {reviewState.executions.length} 笔成交</small></div>
            </div>
            <div className="review-columns">
              <article className="insight-card">
                <div className="section-label">最近一份事前计划</div>
                <h2>{reviewPlanScore >= 80 ? "计划完整，可以进入样本积累" : "先补齐失效点和目标"}</h2>
                <p>{reviewLatestSubmission ? `提交于 ${formatDate(reviewLatestSubmission.barTimestamp, reviewedSession?.session.timeframe ?? timeframe)}` : "当前内容还是草稿，尚未形成正式提交记录。"}</p>
                <div className="evidence-row"><span>市场状态</span><strong>{reviewDecision.marketState || "未填写"}</strong></div>
                <div className="evidence-row"><span>位置</span><strong>{reviewDecision.location || "未填写"}</strong></div>
                <div className="evidence-row"><span>交易理由</span><strong>{reviewDecision.reasons.join("、") || "未填写"}</strong></div>
                <div className="evidence-row"><span>失效 / 止损</span><strong>{reviewDecision.stop || "未填写"}</strong></div>
                <div className="evidence-row"><span>第一目标</span><strong>{reviewDecision.target || "未填写"}</strong></div>
                <div className="evidence-row"><span>训练模式</span><strong>{reviewState.trainingTask ? reviewState.trainingTask.randomRun ? reviewState.trainingTask.mode === "blind" ? "随机盲测" : "随机训练" : trainingModeLabels[reviewState.trainingTask.mode] : "旧版自由训练"}</strong></div>
                <div className="evidence-row"><span>任务状态</span><strong>{reviewState.trainingTask?.status === "completed" ? "已完成" : "进行中"}</strong></div>
                <div className="evidence-row"><span>市场规则</span><strong>{reviewState.marketRules ? `${reviewState.marketRules.name} · ${reviewState.marketRules.version}` : "旧训练未锁定规则版本"}</strong></div>
                <div className="evidence-row"><span>交易账户</span><strong>{reviewState.tradingMode === "capital" ? `资金账户 · 初始 ${reviewState.initialCapital.toFixed(2)} · 现金 ${reviewState.cashBalance.toFixed(2)}` : "收益率模式 · 不限制本金"}</strong></div>
                <div className="evidence-row"><span>规则拒单</span><strong>{reviewState.orderRejections.length}</strong></div>
                <div className="review-note"><span>计划说明</span><p>{reviewDecision.note || "未填写"}</p></div>
              </article>
              <article className="history-card">
                <div className="section-label">可恢复训练</div>
                {sessionSummaries.length ? sessionSummaries.map((summary) => (
                  <div className={`session-row ${reviewedSession?.session.id === summary.session.id ? "active" : ""}`} key={summary.session.id}>
                    <div className="session-main">
                      <div className="session-title">
                        <strong>{summary.session.instrumentId} · {summary.session.timeframe}</strong>
                        <span className={summary.task?.status === "completed" ? "session-status completed" : "session-status"}>
                          {summary.task?.status === "completed" ? "已完成" : "已保存，可继续"}
                        </span>
                      </div>
                      <div className="session-tags">
                        <span>{summary.modeLabel}</span>
                        <span>{summary.rangeLabel}</span>
                        {summary.task && <span>进度 {summary.progressSummary.revealed}/{summary.progressSummary.total}</span>}
                      </div>
                      <div className="session-pnl">
                        <span>{summary.state.tradingMode === "capital" ? "总盈亏" : "总收益率"}<strong className={(summary.state.tradingMode === "capital" ? summary.pnl.total : summary.returnPct) >= 0 ? "up" : "down"}>{summary.state.tradingMode === "capital" ? money(summary.pnl.total) : percent(summary.returnPct)}</strong></span>
                        <span>{summary.state.tradingMode === "capital" ? "已实现" : "已实现收益率"}<strong>{summary.state.tradingMode === "capital" ? money(summary.pnl.realized) : percent(summary.realizedReturnPct)}</strong></span>
                        <span>{summary.state.tradingMode === "capital" ? "浮动" : "浮动收益率"}<strong>{summary.state.tradingMode === "capital" ? money(summary.pnl.floating) : percent(summary.floatingReturnPct)}</strong></span>
                        <span>{summary.pnl.openPositions} 笔持仓 · {summary.pnl.closedPositions} 笔平仓</span>
                        <span>已平仓交易 {summary.winningTrades} 胜 / {summary.losingTrades} 负 / {summary.flatTrades} 平</span>
                      </div>
                      <small>保存时间 {new Date(summary.session.updatedAt).toLocaleString("zh-CN")}</small>
                    </div>
                    <div className="session-actions">
                      <button className="review-session" onClick={() => inspectSession(summary.session)}>
                        <BookOpenCheck size={13} />查看复盘
                      </button>
                      <button className="resume-session" onClick={() => resumeSession(summary.session)}>
                        <RotateCcw size={13} />继续训练
                      </button>
                      <button className="delete-session" aria-label={`删除 ${summary.session.instrumentId} 训练`} onClick={() => deleteSession(summary.session)}>
                        <Trash2 size={13} />删除
                      </button>
                    </div>
                  </div>
                )) : <div className="empty-state">这里还没有保存记录。点击“保存训练”，或完成一场有结束边界的训练后，才会出现在这里。</div>}
              </article>
            </div>
            <div className="review-detail-grid">
              <article className="decision-history-card">
                <div className="section-label">事前决策记录</div>
                <h2>{reviewState.decisionSubmissions.length ? `${reviewState.decisionSubmissions.length} 份已提交计划` : "还没有正式提交的计划"}</h2>
                {reviewState.decisionSubmissions.length ? (
                  <div className="decision-history-list">
                    {[...reviewState.decisionSubmissions].reverse().map((submission, reverseIndex) => (
                      <div className="decision-history-item" key={submission.id}>
                        <div className="decision-history-head">
                          <div>
                            <strong>计划 {reviewState.decisionSubmissions.length - reverseIndex}{submission.backfilled ? " · 补写" : ""}</strong>
                            <span>{formatDate(submission.barTimestamp, reviewedSession?.session.timeframe ?? timeframe)} · 参考价 {submission.referencePrice.toFixed(2)}</span>
                          </div>
                          <b>{decisionScore(submission.decision)}%</b>
                        </div>
                        <div className="decision-history-tags">
                          <span>{submission.decision.marketState}</span>
                          <span>{submission.decision.location}</span>
                          {submission.decision.reasons.map((reason) => <span key={reason}>{reason}</span>)}
                        </div>
                        <div className="decision-history-levels">
                          <span>失效 / 止损<strong>{submission.decision.stop || "未填写"}</strong></span>
                          <span>第一目标<strong>{submission.decision.target || "未填写"}</strong></span>
                        </div>
                        <p>{submission.decision.note || "没有填写计划说明"}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">旧训练中的当前决策草稿仍显示在上方，但只有以后点击“提交决策”生成的内容才会冻结为独立记录。</div>
                )}
              </article>
              <details className="audit-timeline">
                <summary>
                  <span><span className="section-label">操作时间线</span><strong>{reviewState.events.length} 条记录</strong></span>
                  <small>用于追溯训练过程，点击展开</small>
                </summary>
                <div className="audit-event-list">
                  {[...reviewState.events].reverse().slice(0, 80).map((event) => (
                    <div className="audit-event" key={event.id}>
                      <span>#{event.sequence}</span>
                      <div><strong>{eventLabel(event.type)}</strong><small>{new Date(event.occurredAt).toLocaleString("zh-CN")}{event.barTimestamp ? ` · K线 ${formatDate(event.barTimestamp, reviewedSession?.session.timeframe ?? timeframe)}` : ""}</small></div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
