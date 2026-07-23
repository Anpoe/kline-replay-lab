"use client";

import {
  BarChart3,
  BookOpenCheck,
  Brush,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Database,
  EyeOff,
  FastForward,
  FileUp,
  Gauge,
  LineChart,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  Save,
  Settings2,
  Shuffle,
  Sparkles,
  Tag,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import type { KLineData } from "klinecharts";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KLineReplayChart,
  type DecisionMarker,
  type PersistedDrawing,
  type TradeMarker,
} from "./KLineReplayChart";
import {
  CN_A_MAINBOARD_RULES_V1,
  createPriceBand,
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

type View = "replay" | "database" | "review";
type Instrument = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  timezone: string;
  pricePrecision: number;
};
type Coverage = Instrument & {
  timeframe: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  adjustmentType: string;
  source: string;
};
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
  version: 6;
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
  pnlSnapshot?: {
    realized: number;
    floating: number;
    total: number;
    openPositions: number;
    closedPositions: number;
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
type SettingsTab = "basic" | "training";
type AppSettings = {
  defaultInstrumentId: string;
  defaultTimeframe: string;
  defaultOrderQty: number;
  defaultSpeed: number;
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
const defaultDecision: Decision = {
  marketState: "趋势",
  location: "回调位置",
  reasons: ["顺势", "关键位置"],
  stop: "",
  target: "",
  note: "",
};

const instruments = [
  { id: "600519.SH", short: "600519", label: "贵州茅台", market: "A股" },
  { id: "AAPL.US", short: "AAPL", label: "Apple", market: "美股" },
];
const timeframes = ["5m", "1h", "1d", "1w"];
const defaultAppSettings: AppSettings = {
  defaultInstrumentId: "600519.SH",
  defaultTimeframe: "1d",
  defaultOrderQty: 100,
  defaultSpeed: 1,
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
const drawingTools = [
  { name: "horizontalStraightLine", label: "水平线", icon: LineChart },
  { name: "rayLine", label: "趋势线", icon: TrendingUp },
  { name: "priceChannelLine", label: "通道", icon: Gauge },
  { name: "fibonacciLine", label: "斐波那契", icon: Target },
  { name: "brush", label: "自由画笔", icon: Brush },
  { name: "simpleAnnotation", label: "K线标记", icon: Tag },
];

function money(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  const merged = { ...defaultAppSettings, ...value };
  return {
    ...merged,
    defaultInstrumentId: instruments.some((item) => item.id === merged.defaultInstrumentId)
      ? merged.defaultInstrumentId
      : defaultAppSettings.defaultInstrumentId,
    defaultTimeframe: timeframes.includes(merged.defaultTimeframe)
      ? merged.defaultTimeframe
      : defaultAppSettings.defaultTimeframe,
    defaultOrderQty: Math.max(1, Math.round(Number(merged.defaultOrderQty) || defaultAppSettings.defaultOrderQty)),
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

function randomItem<T>(items: T[]) {
  if (!items.length) return undefined;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return items[values[0] % items.length];
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
    id: crypto.randomUUID(),
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
    order_cancelled: "撤销委托",
    orders_filled: "订单成交",
    drawings_changed: "更新图表标记",
    playback_toggled: "切换自动播放",
    playback_speed_changed: "调整播放速度",
    order_quantity_changed: "调整下单数量",
    order_rejected: "市场规则拒单",
    orders_rejected: "成交阶段拒单",
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

function createOrderRejection(
  validation: RuleValidation,
  rules: MarketRuleProfile,
  timestamp: number,
  orderId?: string,
): OrderRejection {
  return {
    id: crypto.randomUUID(),
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
  const [decision, setDecision] = useState<Decision>(defaultDecision);
  const [drawingRequest, setDrawingRequest] = useState<{ name: string; nonce: number } | null>(null);
  const [clearNonce, setClearNonce] = useState(0);
  const [drawingsRestoreNonce, setDrawingsRestoreNonce] = useState(0);
  const [drawings, setDrawings] = useState<PersistedDrawing[]>([]);
  const [saveState, setSaveState] = useState("未保存");
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [randomSeed, setRandomSeed] = useState(() => crypto.randomUUID());
  const [dataSnapshotId, setDataSnapshotId] = useState("");
  const [snapshotHash, setSnapshotHash] = useState("");
  const [marketRules, setMarketRules] = useState<MarketRuleProfile>(CN_A_MAINBOARD_RULES_V1);
  const [trainingTask, setTrainingTask] = useState<TrainingTask | null>(null);
  const [showTaskSetup, setShowTaskSetup] = useState(false);
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
  const [reviewedSession, setReviewedSession] = useState<{ session: TrainingSession; state: TrainingState } | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [importStatus, setImportStatus] = useState("");
  const [startupReady, setStartupReady] = useState(false);
  const [trainingReady, setTrainingReady] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [restoreNotice, setRestoreNotice] = useState("");
  const restoreRequestRef = useRef<RestoreRequest | null>(null);
  const newTaskRequestRef = useRef<NewTaskRequest | null>(null);
  const saveCompletedTrainingRef = useRef(false);
  const appSettingsRef = useRef<AppSettings>(defaultAppSettings);
  const eventSequenceRef = useRef(0);

  const visibleBars = useMemo(() => bars.slice(0, cursor + 1), [bars, cursor]);
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
  const netQty = openPositions.reduce((sum, position) => sum + (position.side === "long" ? position.qty : -position.qty), 0);
  const grossQty = openPositions.reduce((sum, position) => sum + position.qty, 0);
  const openPnl = currentBar
    ? openPositions.reduce((sum, position) => sum + (currentBar.close - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1), 0)
    : 0;
  const realizedPnl = closedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
  const totalPnl = realizedPnl + openPnl;
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
    version: 6,
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
    pnlSnapshot: {
      realized: realizedPnl,
      floating: openPnl,
      total: totalPnl,
      openPositions: openPositions.length,
      closedPositions: closedPositions.length,
    },
  }), [closedPositions.length, cursor, currentBar?.timestamp, dataSignature, dataSnapshotId, decision, decisionSubmissions, drawings, events, executions, marketRules, openPnl, openPositions.length, orderQty, orderRejections, pendingOrders, positions, randomSeed, realizedPnl, snapshotHash, totalPnl, trainingTask]);
  const reviewState = reviewedSession?.state ?? trainingState;
  const reviewClosedPositions = reviewState.positions.filter((position) => position.status === "closed");
  const reviewRealizedPnl = reviewClosedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
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
      version: 6,
      cursor: Number(state.cursor),
      cursorTimestamp: typeof state.cursorTimestamp === "number" ? state.cursorTimestamp : undefined,
      dataSignature: typeof state.dataSignature === "string" ? state.dataSignature : undefined,
      dataSnapshotId: typeof state.dataSnapshotId === "string" ? state.dataSnapshotId : undefined,
      snapshotHash: typeof state.snapshotHash === "string" ? state.snapshotHash : undefined,
      randomSeed: typeof state.randomSeed === "string" ? state.randomSeed : crypto.randomUUID(),
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
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    const findLastTraining = async () => {
      let request: RestoreRequest | null = null;
      try {
        const localDraft = window.localStorage.getItem(LAST_DRAFT_KEY);
        if (localDraft) {
          const parsed = JSON.parse(localDraft) as Omit<RestoreRequest, "state"> & { state: unknown };
          const state = parseTrainingState(parsed.state);
          if (parsed.id && parsed.instrumentId && parsed.timeframe && state) request = { ...parsed, state };
        }
        if (!request) {
          const response = await fetch("/api/sessions");
          if (response.ok) {
            const data = await response.json() as { sessions: TrainingSession[] };
            const latest = data.sessions[0];
            if (latest) {
              const state = parseTrainingState(JSON.parse(latest.stateJson));
              if (state) request = { ...latest, state };
            }
          }
        }
      } catch {
        window.localStorage.removeItem(LAST_DRAFT_KEY);
      }
      if (cancelled) return;
      if (request) {
        restoreRequestRef.current = request;
        setInstrumentId(request.instrumentId);
        setTimeframe(request.timeframe);
      }
      setStartupReady(true);
    };
    void findLastTraining();
    return () => {
      cancelled = true;
    };
  }, [parseTrainingState]);

  const loadBars = useCallback(async () => {
    if (!startupReady) return;
    const restoreRequest = restoreRequestRef.current;
    restoreRequestRef.current = null;
    const newTaskRequest = newTaskRequestRef.current;
    newTaskRequestRef.current = null;
    setLoading(true);
    setTrainingReady(false);
    setPlaying(false);
    saveCompletedTrainingRef.current = false;
    try {
      const requestedSnapshotId = restoreRequest?.state.dataSnapshotId
        ?? restoreRequest?.dataSnapshotId
        ?? newTaskRequest?.snapshotId;
      let data: { instrument: Instrument; candles: KLineData[]; snapshot: SnapshotMeta };
      let legacySnapshotCreated = false;
      if (requestedSnapshotId) {
        const response = await fetch(`/api/snapshots?id=${encodeURIComponent(requestedSnapshotId)}`);
        if (!response.ok) throw new Error("训练绑定的数据快照不存在，无法进行确定性恢复");
        data = await response.json() as typeof data;
      } else {
        const candlesResponse = await fetch(`/api/candles?instrument=${encodeURIComponent(instrumentId)}&timeframe=${timeframe}`);
        if (!candlesResponse.ok) throw new Error("行情加载失败");
        const snapshotResponse = await fetch("/api/snapshots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instrumentId, timeframe, adjustmentType: "none" }),
        });
        if (!snapshotResponse.ok) throw new Error("不可变行情快照创建失败");
        data = await snapshotResponse.json() as typeof data;
        legacySnapshotCreated = Boolean(restoreRequest);
      }
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
        setOrderQty(restoreRequest.state.orderQty);
        setDrawings(restoreRequest.state.drawings);
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
        const nextSessionId = crypto.randomUUID();
        const nextSeed = crypto.randomUUID();
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
        setOrderQty(appSettingsRef.current.defaultOrderQty);
        setSpeed(appSettingsRef.current.defaultSpeed);
        setDrawings([]);
        setClearNonce(Date.now());
        setSessionId(nextSessionId);
        setRandomSeed(nextSeed);
        eventSequenceRef.current = 1;
        setEvents([createTrainingEvent(1, "session_created", data.candles[nextTask.startCursor]?.timestamp, {
          instrumentId,
          timeframe,
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
        })]);
        setSaveState("新训练 · 尚未保存");
        setRestoreNotice("");
      }
      setOrderPanelTab("positions");
      setTrainingReady(true);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "行情加载失败");
    } finally {
      setLoading(false);
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
    if (!orders.length) return;
    const nextPositions = [...positions];
    const fills: Execution[] = [];
    const rejections: OrderRejection[] = [];

    orders.forEach((order) => {
      const priceBand = order.priceBand
        ?? createPriceBand(marketRules, priceLimitReference(bars, cursor, instrument.timezone));
      const fillValidation = validateMarketFill(marketRules, order.side, bar.open, priceBand);
      if (!fillValidation.ok) {
        rejections.push(createOrderRejection(fillValidation, marketRules, bar.timestamp, order.id));
        return;
      }
      if (order.action === "open") {
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
          id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
    });

    setPositions(nextPositions);
    if (fills.length) {
      setExecutions((items) => [...items, ...fills]);
      appendEvent("orders_filled", {
        fills,
        marketRuleId: marketRules.id,
        marketRuleVersion: marketRules.version,
      }, bar.timestamp);
    }
    if (rejections.length) {
      setOrderRejections((items) => [...items, ...rejections]);
      setRuleNotice(rejections.map((rejection) => rejection.message).join("；"));
      appendEvent("orders_rejected", { rejections }, bar.timestamp);
    }
  }, [appendEvent, bars, cursor, instrument.timezone, marketRules, positions]);

  const revealMany = useCallback((count: number) => {
    const endCursor = trainingTask?.endCursor ?? bars.length - 1;
    if (cursor >= endCursor || trainingTask?.status === "completed") {
      setPlaying(false);
      return;
    }
    const nextBar = bars[cursor + 1];
    executeOrders(pendingOrders, nextBar);
    if (pendingOrders.length) setPendingOrders([]);
    const nextCursor = trainingTask
      ? advanceWithinTask(trainingTask, cursor, count)
      : Math.min(cursor + Math.max(1, count), bars.length - 1);
    setCursor(nextCursor);
    appendEvent("replay_advanced", {
      fromCursor: cursor,
      toCursor: nextCursor,
      requestedCount: count,
      executedOrderIds: pendingOrders.map((order) => order.id),
    }, bars[nextCursor]?.timestamp);
    if (trainingTask && nextCursor >= trainingTask.endCursor) {
      const completedTask = finishTask(trainingTask, nextCursor);
      setTrainingTask(completedTask);
      setPlaying(false);
      saveCompletedTrainingRef.current = true;
      appendEvent("training_completed", {
        trainingMode: completedTask.mode,
        startCursor: completedTask.startCursor,
        endCursor: completedTask.endCursor,
      }, bars[nextCursor]?.timestamp);
    }
    setSaveState("有未保存更改");
  }, [appendEvent, bars, cursor, executeOrders, pendingOrders, trainingTask]);

  const revealNext = useCallback(() => revealMany(1), [revealMany]);
  const revealPrevious = () => {
    const nextCursor = Math.max(trainingTask?.startCursor ?? 0, cursor - 1);
    if (nextCursor === cursor) return;
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
    const priceBand = createPriceBand(
      marketRules,
      priceLimitReference(bars, cursor, instrument.timezone),
    );
    const order: PendingOrder = {
      id: crypto.randomUUID(),
      action: "open",
      side,
      qty,
      createdAt: currentBar.timestamp,
      positionId: crypto.randomUUID(),
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
      priceBand,
    };
    setPendingOrders((items) => [...items, order]);
    setRuleNotice("");
    appendEvent("order_queued", {
      order,
      marketRuleId: marketRules.id,
      marketRuleVersion: marketRules.version,
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
    const priceBand = createPriceBand(
      marketRules,
      priceLimitReference(bars, cursor, instrument.timezone),
    );
    const order: PendingOrder = {
      id: crypto.randomUUID(),
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

  const queueCloseAll = () => {
    openPositions.forEach((position) => queueClosePosition(position.id));
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
    saveCompletedTrainingRef.current = false;
    const nextRandomSeed = crypto.randomUUID();
    const nextSessionId = crypto.randomUUID();
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
    setOrderQty(100);
    setDrawings([]);
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

  const submitDecision = () => {
    if (!currentBar) return;
    const submission: DecisionSubmission = {
      id: crypto.randomUUID(),
      barTimestamp: currentBar.timestamp,
      cursor,
      referencePrice: currentBar.close,
      decision: {
        ...decision,
        reasons: [...decision.reasons],
      },
      submittedAt: new Date().toISOString(),
    };
    setDecisionSubmissions((items) => [...items, submission]);
    setSelectedDecisionId(submission.id);
    appendEvent("decision_submitted", {
      submissionId: submission.id,
      cursor,
      referencePrice: currentBar.close,
      decision: submission.decision,
    }, currentBar.timestamp);
    setSaveState("决策已提交");
    revealNext();
  };

  const inspectSession = (session: TrainingSession) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) throw new Error("invalid session");
      setReviewedSession({ session, state });
    } catch {
      setImportStatus("这条训练记录不完整，无法查看复盘。");
    }
  };

  const handleDrawingsChange = (nextDrawings: PersistedDrawing[]) => {
    setDrawings(nextDrawings);
    appendEvent("drawings_changed", { drawings: nextDrawings });
  };

  const loadCoverage = useCallback(async () => {
    const response = await fetch("/api/candles?coverage=1");
    if (response.ok) {
      const data = await response.json() as { coverage: Coverage[] };
      setCoverage(data.coverage);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/sessions");
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
      const pnl = state.pnlSnapshot ?? {
        realized: 0,
        floating: 0,
        total: 0,
        openPositions: state.positions.filter((position) => position.status === "open").length,
        closedPositions: state.positions.filter((position) => position.status === "closed").length,
      };
      const progressSummary = task
        ? taskProgress(task, state.cursor)
        : { revealed: 0, total: 0, percent: 0 };
      return [{
        session,
        state,
        task,
        pnl,
        progressSummary,
        modeLabel: task ? trainingModeLabels[task.mode] : "旧版自由训练",
        rangeLabel: task
          ? `${formatDate(task.startTimestamp, session.timeframe)} → ${formatDate(task.endTimestamp, session.timeframe)}`
          : `保存于 K线 ${state.cursor + 1}`,
      }];
    } catch {
      return [];
    }
  }), [parseTrainingState, sessions]);

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
    setSetupInstrumentId(appSettings.defaultInstrumentId);
    setSetupTimeframe(appSettings.defaultTimeframe);
    setTaskDraft({
      ...defaultTrainingTaskDraft,
      startDate: currentBar ? tradingDate(currentBar.timestamp, instrument.timezone) : "",
      startBar: cursor + 1,
      endDate: bars.at(-1) ? tradingDate(bars.at(-1)!.timestamp, instrument.timezone) : "",
    });
    setSetupError("");
    setShowTaskSetup(true);
    void loadSessions();
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

  const startConfiguredTraining = () => {
    let requestInstrumentId = setupInstrumentId;
    let requestTimeframe = setupTimeframe;
    let requestSnapshotId: string | undefined;
    let draft = { ...taskDraft };

    if (draft.startMode === "random" && draft.mode !== "range" && draft.mode !== "mistake") {
      const instrumentCandidates = appSettings.randomInstrumentMode === "current"
        ? instruments.filter((item) => item.id === instrumentId)
        : appSettings.randomInstrumentMode === "market"
          ? instruments.filter((item) => item.market === appSettings.randomMarket)
          : instruments;
      const selectedInstrument = randomItem(instrumentCandidates) ?? instruments[0];
      const selectedTimeframe = appSettings.randomTimeframeMode === "current"
        ? timeframe
        : appSettings.randomTimeframeMode === "fixed"
          ? appSettings.randomTimeframe
          : randomItem(timeframes) ?? timeframe;
      requestInstrumentId = selectedInstrument.id;
      requestTimeframe = selectedTimeframe;
      draft = {
        ...draft,
        length: draft.length > 0 ? draft.length : appSettings.randomLength,
        randomStartDate: appSettings.randomDateMode === "range" ? appSettings.randomStartDate : undefined,
        randomEndDate: appSettings.randomDateMode === "range" ? appSettings.randomEndDate : undefined,
      };
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

    newTaskRequestRef.current = {
      instrumentId: requestInstrumentId,
      timeframe: requestTimeframe,
      draft,
      snapshotId: requestSnapshotId,
    };
    restoreRequestRef.current = null;
    setInstrumentId(requestInstrumentId);
    setTimeframe(requestTimeframe);
    setReviewedSession(null);
    setView("replay");
    setShowTaskSetup(false);
    setLoadNonce((value) => value + 1);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (view === "database") loadCoverage();
      if (view === "review") loadSessions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCoverage, loadSessions, view]);

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
      const customId = `CUSTOM.${file.name.replace(/\.[^.]+$/, "").toUpperCase()}`;
      const response = await fetch("/api/candles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrument: { id: customId, symbol: customId, name: file.name, market: "CUSTOM", timezone: "Asia/Shanghai" },
          timeframe: "1d",
          adjustmentType: "none",
          bars: barsToImport,
        }),
      });
      const result = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "导入失败");
      setImportStatus(`已导入 ${result.imported} 根日 K`);
      await loadCoverage();
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
                <select value={instrumentId} onChange={(event) => startFreshTraining(event.target.value, timeframe)} aria-label="选择品种">
                  {instruments.map((item) => <option key={item.id} value={item.id}>{item.short} · {item.label}</option>)}
                </select>
                <span className="market-pill">{instruments.find((item) => item.id === instrumentId)?.market}</span>
              </>
            )}
            <span className="rule-pill">{trainingTask ? trainingModeLabels[trainingTask.mode] : "自由训练"}</span>
            <div className="timeframes" aria-label="周期">
              {timeframes.map((item) => (
                <button key={item} className={timeframe === item ? "active" : ""} onClick={() => startFreshTraining(instrumentId, item)}>{item}</button>
              ))}
            </div>
          </div>
          <div className="top-actions">
            <span className={`save-state ${saveState.includes("已") ? "saved" : ""}`}>{saveState}</span>
            <button className="ghost-button" onClick={openTaskSetup}><Play size={16} />新建 Replay 训练</button>
            <button className="primary-button" onClick={saveSession}><Save size={16} />保存训练</button>
          </div>
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
                  <p>设置只保存在这台电脑，用于新训练的默认值和随机抽样规则。</p>
                </div>
                <button aria-label="关闭设置" onClick={() => setShowSettings(false)}><X size={19} /></button>
              </div>

              <div className="settings-tabs" role="tablist" aria-label="设置分类">
                <button className={settingsTab === "basic" ? "active" : ""} onClick={() => setSettingsTab("basic")}>基本设置</button>
                <button className={settingsTab === "training" ? "active" : ""} onClick={() => setSettingsTab("training")}>训练设置</button>
              </div>

              {settingsTab === "basic" ? (
                <div className="settings-section">
                  <div className="settings-section-head">
                    <strong>新训练默认值</strong>
                    <span>打开“新建 Replay 训练”时优先使用这些选项。</span>
                  </div>
                  <div className="task-form-row">
                    <label>默认品种
                      <select value={settingsDraft.defaultInstrumentId} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, defaultInstrumentId: event.target.value }))}>
                        {instruments.map((item) => <option key={item.id} value={item.id}>{item.short} · {item.label}</option>)}
                      </select>
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
              ) : (
                <div className="settings-section">
                  <div className="settings-section-head">
                    <strong>随机训练规则</strong>
                    <span>在新建训练中选择“随机起点”时，按这里的范围抽取品种、周期和历史片段。</span>
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
                          {[...new Set(instruments.map((item) => item.market))].map((market) => <option key={market}>{market}</option>)}
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
                    <small>选择随机起点时作为默认长度；0 表示一直练到该数据集末尾。</small>
                  </label>
                </div>
              )}

              {settingsError && <div className="task-error">{settingsError}</div>}
              <div className="task-modal-actions">
                <button className="ghost-button" onClick={() => setShowSettings(false)}>取消</button>
                <button className="primary-button" onClick={saveSettings}><Save size={16} />保存设置</button>
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
                  <span>TRAINING TASK</span>
                  <h2 id="task-modal-title">新建 Replay 训练</h2>
                  <p>只有点击“保存训练”或训练自动结束后，才会出现在可恢复训练中。</p>
                </div>
                <button aria-label="关闭新建训练" onClick={() => setShowTaskSetup(false)}><X size={19} /></button>
              </div>

              <div className="task-mode-grid" role="group" aria-label="训练模式">
                {(Object.keys(trainingModeLabels) as TrainingMode[]).map((mode) => (
                  <button
                    key={mode}
                    className={taskDraft.mode === mode ? "active" : ""}
                    onClick={() => selectTrainingMode(mode)}
                  >
                    <strong>{mode === "blind" ? "盲测（隐藏答案）" : trainingModeLabels[mode]}</strong>
                    <span>{mode === "free" ? "按自己的节奏练习" : mode === "blind" ? "只看结构做判断，结束后揭示" : mode === "range" ? "固定日期区间自动结束" : "重做低分计划与规则拒单"}</span>
                  </button>
                ))}
              </div>

              {taskDraft.mode === "blind" && (
                <div className="blind-explainer">
                  <EyeOff size={18} />
                  <div>
                    <strong>什么是盲测？</strong>
                    <p>系统隐藏品种名、日期和绝对价格，你只能根据 K 线结构制定计划，避免因为“记得这段行情”而提前知道答案。训练结束后再进入复盘查看真实信息。下面三个隐藏项仍可单独调整。</p>
                  </div>
                </div>
              )}

              {taskDraft.mode !== "mistake" && taskDraft.startMode !== "random" && (
                <div className="task-form-row">
                  <label>品种
                    <select value={setupInstrumentId} onChange={(event) => setSetupInstrumentId(event.target.value)}>
                      {instruments.map((item) => <option key={item.id} value={item.id}>{item.short} · {item.label}</option>)}
                    </select>
                  </label>
                  <label>周期
                    <select value={setupTimeframe} onChange={(event) => setSetupTimeframe(event.target.value)}>
                      {timeframes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {taskDraft.mode !== "mistake" && taskDraft.startMode === "random" && (
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

              {taskDraft.mode === "range" ? (
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
                      ["random", "随机起点"],
                    ] as const).map(([value, label]) => (
                      <button key={value} className={taskDraft.startMode === value ? "active" : ""} onClick={() => setTaskDraft((draft) => ({
                        ...draft,
                        startMode: value,
                        length: value === "random" && draft.length === 0 ? appSettings.randomLength : draft.length,
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
              )}

              {taskDraft.mode !== "range" && (
                <label className="task-wide-field">训练长度（揭示 K 线数）
                  <input type="number" min="0" value={taskDraft.length} onChange={(event) => setTaskDraft((draft) => ({ ...draft, length: Math.max(0, Number(event.target.value)) }))} />
                  <small>填 0 表示练到数据末尾；填入数量后，到达边界会自动停止并进入完成状态。</small>
                </label>
              )}

              <fieldset className="task-privacy">
                <legend>训练中隐藏</legend>
                <label><input type="checkbox" checked={taskDraft.hideInstrument} onChange={(event) => setTaskDraft((draft) => ({ ...draft, hideInstrument: event.target.checked }))} />品种名称</label>
                <label><input type="checkbox" checked={taskDraft.hideDate} onChange={(event) => setTaskDraft((draft) => ({ ...draft, hideDate: event.target.checked }))} />日期坐标</label>
                <label><input type="checkbox" checked={taskDraft.hidePrice} onChange={(event) => setTaskDraft((draft) => ({ ...draft, hidePrice: event.target.checked }))} />绝对价格</label>
              </fieldset>

              {setupError && <div className="task-error">{setupError}</div>}
              <div className="task-modal-actions">
                <button className="ghost-button" onClick={() => setShowTaskSetup(false)}>取消</button>
                <button className="primary-button" onClick={startConfiguredTraining}><Play size={16} />开始训练</button>
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
                  {drawingTools.map(({ name, label, icon: Icon }) => (
                    <button key={name} title={label} aria-label={label} onClick={() => setDrawingRequest({ name, nonce: Date.now() })}><Icon size={18} /></button>
                  ))}
                  <span className="tool-divider" />
                  <button title="清除绘图" aria-label="清除绘图" onClick={() => {
                    handleDrawingsChange([]);
                    setClearNonce(Date.now());
                  }}><Trash2 size={18} /></button>
                </div>
                <div className="chart-wrap">
                  {loading ? <div className="chart-loading">正在准备历史 K 线…</div> : (
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
                      onDrawingsChange={handleDrawingsChange}
                    />
                  )}
                  {selectedDecision && (
                    <div className="decision-chart-card">
                      <div className="decision-chart-card-head">
                        <div>
                          <span>已提交决策</span>
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
                </div>
              </div>

              <div className="replay-controls">
                <div className="progress-meta">
                  <span>{currentBar ? (trainingTask?.hideDate ? `训练第 ${currentTaskProgress.revealed} 根` : formatDate(currentBar.timestamp, timeframe)) : "--"}</span>
                  <span>{trainingTask ? `${currentTaskProgress.revealed} / ${currentTaskProgress.total} 根` : `${cursor + 1} / ${bars.length} 根`}</span>
                </div>
                <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="transport">
                  <button aria-label="重置" onClick={resetTraining}><RotateCcw size={17} /></button>
                  <button aria-label="上一根" disabled={trainingComplete || cursor <= (trainingTask?.startCursor ?? 0)} onClick={revealPrevious}><ChevronLeft size={19} /></button>
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

              {trainingComplete && (
                <div className="training-complete-banner">
                  <div>
                    <span>TRAINING COMPLETE</span>
                    <strong>{trainingTask ? `${trainingModeLabels[trainingTask.mode]}已自动结束` : "训练已结束"}</strong>
                    <small>已到达设定边界，未来 K 线不会继续揭示。</small>
                  </div>
                  <button className="ghost-button" onClick={resetTraining}><RotateCcw size={15} />按原条件重练</button>
                  <button className="primary-button" onClick={() => setView("review")}><BookOpenCheck size={15} />查看复盘</button>
                </div>
              )}

              <div className="trade-dock">
                <div className="trade-stats">
                  <span>持仓笔数 <strong>{openPositions.length}</strong></span>
                  <span>净 / 总数量 <strong>{netQty} / {grossQty}</strong></span>
                  <span>浮盈 <strong className={openPnl >= 0 ? "up" : "down"}>{money(openPnl)}</strong></span>
                  <span>已实现 <strong className={realizedPnl >= 0 ? "up" : "down"}>{money(realizedPnl)}</strong></span>
                </div>
                <div className="order-entry">
                  <label>数量<input type="number" min="1" value={orderQty} onChange={(event) => {
                    const quantity = Math.max(1, Number(event.target.value));
                    setOrderQty(quantity);
                    appendEvent("order_quantity_changed", { quantity });
                  }} step={marketRules.boardLot} /></label>
                  <button
                    className="sell-button"
                    disabled={trainingComplete || !marketRules.tradingEnabled || !marketRules.allowShort}
                    title={!marketRules.allowShort ? `${marketRules.name}禁止卖出开仓` : ""}
                    onClick={() => queueOpenOrder("sell")}
                  ><TrendingDown size={16} />{marketRules.allowShort ? "卖出开仓" : "A股禁做空"}</button>
                  <button
                    className="buy-button"
                    disabled={trainingComplete || !marketRules.tradingEnabled}
                    onClick={() => queueOpenOrder("buy")}
                  ><TrendingUp size={16} />买入开仓</button>
                  <button className="flat-button" disabled={trainingComplete || !closablePositions.length} onClick={queueCloseAll}>
                    <CircleStop size={16} />{openPositions.length && !closablePositions.length ? "T+1锁定" : "全部平仓"}
                  </button>
                </div>
                <div className={`pending-note ${ruleNotice ? "rule-warning" : ""}`}>
                  {ruleNotice || (pendingOrders.length
                    ? `${pendingOrders.length} 笔委托将在下一根开盘按 ${marketRules.name} 规则校验`
                    : `${marketRules.name}：买入 ${marketRules.boardLot} 股整数倍${marketRules.tPlusOne ? " · T+1" : ""}${marketRules.priceLimitRatio ? ` · 涨跌幅 ${(marketRules.priceLimitRatio * 100).toFixed(0)}%` : ""}`)}
                </div>

                <div className="orders-board">
                  <div className="orders-board-head">
                    <strong>订单与持仓</strong>
                    <div className="orders-tabs">
                      <button className={orderPanelTab === "positions" ? "active" : ""} onClick={() => setOrderPanelTab("positions")}>当前持仓 <span>{openPositions.length}</span></button>
                      <button className={orderPanelTab === "pending" ? "active" : ""} onClick={() => setOrderPanelTab("pending")}>待成交 <span>{pendingOrders.length}</span></button>
                      <button className={orderPanelTab === "history" ? "active" : ""} onClick={() => setOrderPanelTab("history")}>已平仓 <span>{closedPositions.length}</span></button>
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
                              <td><span className="position-id">#{position.id.slice(0, 6)}</span></td>
                              <td><span className={position.side === "long" ? "side-long" : "side-short"}>{position.side === "long" ? "多 / 买" : "空 / 卖"}</span></td>
                              <td>{position.qty}</td>
                              <td>{trainingDateLabel(position.entryTimestamp)}</td>
                              <td>{trainingPriceLabel(position.entryPrice)}</td>
                              <td>{trainingPriceLabel(currentBar?.close)}</td>
                              <td><strong className={pnl >= 0 ? "up" : "down"}>{money(pnl)}</strong></td>
                              <td><button
                                className="row-action"
                                disabled={trainingComplete || closeQueued || !closeValidation.ok}
                                title={closeValidation.message}
                                onClick={() => queueClosePosition(position.id)}
                              >{closeQueued ? "已委托" : closeValidation.ok ? "平仓" : "T+1锁定"}</button></td>
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
                            <td><span className="position-id">#{order.id.slice(0, 6)}</span></td>
                            <td>{order.action === "open" ? "开仓" : "平仓"}</td>
                            <td><span className={order.side === "buy" ? "side-long" : "side-short"}>{order.side === "buy" ? "买入" : "卖出"}</span></td>
                            <td>{order.qty}</td>
                            <td>{trainingDateLabel(order.createdAt)}</td>
                            <td>#{order.positionId.slice(0, 6)}</td>
                            <td>下一根开盘 · {order.ruleVersion ?? "旧规则"}</td>
                            <td><button className="row-action danger" onClick={() => cancelPendingOrder(order.id)}>撤单</button></td>
                          </tr>
                        )) : <tr><td className="orders-empty" colSpan={8}>暂无待成交委托。</td></tr>}</tbody>
                      </table>
                    )}

                    {orderPanelTab === "history" && (
                      <table className="orders-table">
                        <thead><tr><th>仓位</th><th>方向</th><th>数量</th><th>开仓时间</th><th>开仓价</th><th>平仓时间</th><th>平仓价</th><th>已实现</th></tr></thead>
                        <tbody>{closedPositions.length ? [...closedPositions].reverse().map((position) => (
                          <tr key={position.id}>
                            <td><span className="position-id">#{position.id.slice(0, 6)}</span></td>
                            <td><span className={position.side === "long" ? "side-long" : "side-short"}>{position.side === "long" ? "多 / 买" : "空 / 卖"}</span></td>
                            <td>{position.qty}</td>
                            <td>{trainingDateLabel(position.entryTimestamp)}</td>
                            <td>{trainingPriceLabel(position.entryPrice)}</td>
                            <td>{position.exitTimestamp ? trainingDateLabel(position.exitTimestamp) : "--"}</td>
                            <td>{trainingPriceLabel(position.exitPrice)}</td>
                            <td><strong className={(position.realizedPnl ?? 0) >= 0 ? "up" : "down"}>{money(position.realizedPnl ?? 0)}</strong></td>
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

            <aside className="decision-panel">
              <div className="panel-title">
                <div><span>事前决策卡</span><strong>{planScore}%</strong></div>
                <p>先写计划，再揭示下一根</p>
              </div>
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
                  {reasonOptions.map((reason) => {
                    const selected = decision.reasons.includes(reason);
                    return (
                      <button key={reason} className={selected ? "selected" : ""} onClick={() => updateDecision(
                        "reasons",
                        selected ? decision.reasons.filter((item) => item !== reason) : [...decision.reasons, reason],
                      )}>{selected ? "✓ " : "+ "}{reason}</button>
                    );
                  })}
                </div>
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
              <div className="submitted-plan-count">已提交 <strong>{decisionSubmissions.length}</strong> 份计划 · 点击盘面“计划”标记可查看</div>
              <button className="commit-plan" disabled={trainingComplete} onClick={submitDecision}><ListChecks size={17} />{trainingComplete ? "训练已结束" : "提交决策并揭示下一根"}</button>
            </aside>
          </div>
        )}

        {view === "database" && (
          <section className="content-page">
            <div className="page-heading"><div><span>DATA LIBRARY</span><h1>K 线数据库</h1><p>当前只管理历史 K 线及其覆盖、来源和质量。</p></div>
              <label className="primary-button file-button"><FileUp size={17} />导入 CSV<input type="file" accept=".csv,text/csv" onChange={importCsv} /></label>
            </div>
            {importStatus && <div className="status-banner">{importStatus}</div>}
            <div className="database-summary">
              <div><strong>{new Set(coverage.map((item) => item.id)).size}</strong><span>品种</span></div>
              <div><strong>{coverage.reduce((sum, item) => sum + Number(item.barCount), 0).toLocaleString()}</strong><span>K 线总数</span></div>
              <div><strong>{new Set(coverage.map((item) => item.timeframe)).size}</strong><span>周期</span></div>
              <div><strong>0</strong><span>已知异常</span></div>
            </div>
            <div className="coverage-table-wrap">
              <table className="coverage-table">
                <thead><tr><th>品种</th><th>市场</th><th>周期</th><th>数量</th><th>覆盖范围</th><th>复权</th><th>来源</th><th>状态</th></tr></thead>
                <tbody>{coverage.map((item) => (
                  <tr key={`${item.id}-${item.timeframe}`}>
                    <td><strong>{item.symbol}</strong><span>{item.name}</span></td>
                    <td>{item.market}</td><td><span className="tf-badge">{item.timeframe}</span></td>
                    <td>{Number(item.barCount).toLocaleString()}</td>
                    <td>{new Date(item.firstTimestamp).toLocaleDateString("zh-CN")} — {new Date(item.lastTimestamp).toLocaleDateString("zh-CN")}</td>
                    <td>{item.adjustmentType}</td><td>{item.source}</td><td><span className="healthy-dot" />完整</td>
                  </tr>
                ))}</tbody>
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
                <span>本次已实现盈亏</span><strong className={reviewRealizedPnl >= 0 ? "up" : "down"}>{money(reviewRealizedPnl)}</strong><small>{reviewClosedPositions.length} 笔已平仓 · {reviewState.executions.length} 笔成交 · 最近计划完整度 {reviewPlanScore}%</small>
              </div>
              <div className="metric-card"><span>胜率</span><strong>{reviewClosedPositions.length ? Math.round(reviewClosedPositions.filter((position) => (position.realizedPnl ?? 0) > 0).length / reviewClosedPositions.length * 100) : 0}%</strong><small>仅统计已平仓成交</small></div>
              <div className="metric-card"><span>已提交计划</span><strong>{reviewState.decisionSubmissions.length}</strong><small>每次提交均绑定原始K线</small></div>
              <div className="metric-card"><span>成交记录</span><strong>{reviewState.executions.length}</strong><small>{reviewState.snapshotHash ? `快照 ${reviewState.snapshotHash.slice(0, 8)}` : "旧训练待建立快照"}</small></div>
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
                <div className="evidence-row"><span>训练模式</span><strong>{reviewState.trainingTask ? trainingModeLabels[reviewState.trainingTask.mode] : "旧版自由训练"}</strong></div>
                <div className="evidence-row"><span>任务状态</span><strong>{reviewState.trainingTask?.status === "completed" ? "已完成" : "进行中"}</strong></div>
                <div className="evidence-row"><span>市场规则</span><strong>{reviewState.marketRules ? `${reviewState.marketRules.name} · ${reviewState.marketRules.version}` : "旧训练未锁定规则版本"}</strong></div>
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
                        <span>总盈亏<strong className={summary.pnl.total >= 0 ? "up" : "down"}>{money(summary.pnl.total)}</strong></span>
                        <span>已实现<strong>{money(summary.pnl.realized)}</strong></span>
                        <span>浮动<strong>{money(summary.pnl.floating)}</strong></span>
                        <span>{summary.pnl.openPositions} 笔持仓 · {summary.pnl.closedPositions} 笔平仓</span>
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
                            <strong>计划 {reviewState.decisionSubmissions.length - reverseIndex}</strong>
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
