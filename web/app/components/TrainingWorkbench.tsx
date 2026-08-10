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
  ListFilter,
  ListChecks,
  Lock,
  Magnet,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Plus,
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
import { aggregateM1To5m } from "../lib/fx/dukascopyAggregation";
import { parseDukascopyCsv } from "../lib/fx/dukascopyCsv";
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
  DEFAULT_REPLAY_HISTORY_BARS,
  defaultTrainingTaskDraft,
  finishTask,
  MAX_REPLAY_HISTORY_BARS,
  MIN_REPLAY_HISTORY_BARS,
  normalizeReplayHistoryBars,
  rebaseTrainingTaskToBars,
  resolveTrainingTask,
  taskVisibleStartCursor,
  taskProgress,
  trainingModeLabels,
  type RandomTrainingConfig,
  type TrainingMode,
  type TrainingTask,
  type TrainingTaskDraft,
} from "../lib/trainingTasks";
import {
  analyzePerformanceHabits,
  summarizePerformance,
  type HabitTrade,
  type PerformanceBreakdown,
  type PerformanceRecord,
} from "../lib/performance";
import {
  defaultPatternPresets,
  findPatternMatches,
  normalizePatternPresets,
  patternParameterDefinitions,
  type PatternCandle,
  type PatternMatch,
  type PatternPreset,
} from "../lib/patternFilters";
import {
  defaultMovingAverageSettings,
  MAX_MOVING_AVERAGE_LINES,
  MAX_MOVING_AVERAGE_PERIOD,
  MIN_MOVING_AVERAGE_PERIOD,
  normalizeMovingAveragePeriods,
  normalizeMovingAverageSettings,
  type MovingAverageKind,
  type MovingAverageSettings,
} from "../lib/chartIndicators";
import {
  isUsMarket,
  randomEligibleStartIndices,
  trailingAverageDailyDollarVolume,
} from "../lib/randomLiquidity";
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
  assetType?: InstrumentAssetType;
};
type InstrumentAssetType = "stock" | "index" | "fund" | "convertible-bond" | "other";
type AvailableInstrument = {
  id: string;
  short: string;
  label: string;
  market: string;
  assetType: InstrumentAssetType;
  timeframes: string[];
};

function inferInstrumentAssetType(
  instrumentId: string,
  market: string,
  declaredType?: string,
): InstrumentAssetType {
  if (["stock", "index", "fund", "convertible-bond", "other"].includes(declaredType ?? "")) {
    return declaredType as InstrumentAssetType;
  }
  const [code, exchange = ""] = instrumentId.toUpperCase().split(".");
  const normalizedMarket = market.toUpperCase();
  if (normalizedMarket === "CN" || market === "A股") {
    if ((exchange === "SZ" && code.startsWith("399")) || (exchange === "SH" && code.startsWith("000"))) return "index";
    if ((exchange === "SH" && /^(110|113)/.test(code)) || (exchange === "SZ" && /^(123|127|128)/.test(code))) return "convertible-bond";
    if ((exchange === "SH" && /^(5|51|56|58)/.test(code)) || (exchange === "SZ" && /^(15|16|18)/.test(code))) return "fund";
    if (
      (exchange === "SH" && /^(600|601|603|605|688|689)/.test(code))
      || (exchange === "SZ" && /^(000|001|002|003|300|301)/.test(code))
      || (exchange === "BJ" && /^[489]/.test(code))
    ) return "stock";
    return "other";
  }
  return "stock";
}

function marketRuleCode(market: string) {
  return market === "A股" ? "CN" : market === "美股" ? "US" : market;
}

function performanceMarketCode(market: string | undefined, instrumentId: string) {
  const fallback = /\.(SH|SZ|BJ)$/i.test(instrumentId) ? "CN" : "US";
  const code = marketRuleCode((market ?? fallback).trim()).toUpperCase();
  if (code === "FOREX") return "FX";
  if (code === "METAL") return "GOLD";
  return code;
}

function performanceMarketLabel(market: string) {
  if (market === "CN") return "A股";
  if (market === "US") return "美股";
  if (market === "FX") return "外汇";
  if (market === "GOLD") return "黄金";
  return market;
}

function instrumentAssetLabel(item: Pick<AvailableInstrument, "market" | "assetType">) {
  if (item.assetType === "index") return "指数";
  if (item.assetType === "fund") return "基金";
  if (item.assetType === "convertible-bond") return "可转债";
  if (item.assetType === "other") return "其他证券";
  return item.market;
}

function isRandomInstrumentAllowed(item: AvailableInstrument, includeIndices: boolean) {
  if (item.assetType === "index") return includeIndices;
  return resolveMarketRules(marketRuleCode(item.market), item.id).tradingEnabled;
}

function isLowLiquidityUsSecurityByName(item: AvailableInstrument) {
  if (!isUsMarket(item.market)) return false;
  return /\b(rights?|warrants?|units?)\b/i.test(item.label);
}
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
              <strong>{item.short}</strong><span>{item.label}</span><small>{instrumentAssetLabel(item)}</small>
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
type LiveScanMarket = "CN" | "US";
type LiveScanResult = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: LiveScanMarket;
  timestamp: number;
  close: number;
  changePct: number;
  volume: number;
  turnover: number;
  averageVolume: number;
  averageTurnover: number;
  presetIds: string[];
  presetNames: string[];
};
type LiveScanResponse = {
  market: LiveScanMarket;
  latestTimestamp: number;
  scannedCount: number;
  matchedCount: number;
  results: LiveScanResult[];
  error?: string;
};
type LivePortfolioRecord = {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  market: LiveScanMarket;
  latestTimestamp: number;
  latestClose: number;
  scanTimestamp: number;
  presetIds: string[];
  presetNames: string[];
  positions: PositionLot[];
  pendingOrders: PendingOrder[];
  executions: Execution[];
  orderRejections: OrderRejection[];
  tradingMode: TradingMode;
  initialCapital: number;
  cashBalance: number;
  /** The decision card belongs to the live ledger when the user is observing a symbol. */
  decision?: Decision;
  decisionSubmissions?: DecisionSubmission[];
  updatedAt: string;
};
type LiveWatchRecord = {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  market: LiveScanMarket;
  latestTimestamp: number;
  latestClose: number;
  /** Baseline price captured when the symbol was added (stored in the legacy observation_close field). */
  observationTimestamp?: number;
  observationClose?: number;
  /** Legacy simulated-fill fields retained only for old database records. */
  entryTimestamp?: number;
  entryPrice?: number;
  scanTimestamp: number;
  presetIds: string[];
  presetNames: string[];
  updatedAt: string;
};

type LiveNavigatorSource = "scan" | "portfolio" | "watch";

function livePortfolioResult(portfolio: LivePortfolioRecord): LiveScanResult {
  return {
    instrumentId: portfolio.instrumentId,
    symbol: portfolio.symbol,
    name: portfolio.name,
    market: portfolio.market,
    timestamp: portfolio.latestTimestamp,
    close: portfolio.latestClose,
    changePct: 0,
    volume: 0,
    turnover: 0,
    averageVolume: 0,
    averageTurnover: 0,
    presetIds: portfolio.presetIds,
    presetNames: portfolio.presetNames,
  };
}

function liveWatchResult(watch: LiveWatchRecord): LiveScanResult {
  return {
    instrumentId: watch.instrumentId,
    symbol: watch.symbol,
    name: watch.name,
    market: watch.market,
    timestamp: watch.latestTimestamp,
    close: watch.latestClose,
    changePct: 0,
    volume: 0,
    turnover: 0,
    averageVolume: 0,
    averageTurnover: 0,
    presetIds: watch.presetIds,
    presetNames: watch.presetNames,
  };
}

function liveWatchObservationPrice(watch: LiveWatchRecord) {
  return typeof watch.observationClose === "number"
    && Number.isFinite(watch.observationClose)
    && watch.observationClose > 0
    ? watch.observationClose
    : watch.latestClose;
}

function liveWatchObservationTimestamp(watch: LiveWatchRecord) {
  // `scanTimestamp` is the signal/observation day.  Older records may have
  // had `observationTimestamp` backfilled from the latest price, so prefer the
  // original scan day whenever it is available.
  if (typeof watch.scanTimestamp === "number" && Number.isFinite(watch.scanTimestamp) && watch.scanTimestamp > 0) {
    return watch.scanTimestamp;
  }
  return typeof watch.observationTimestamp === "number"
    && Number.isFinite(watch.observationTimestamp)
    ? watch.observationTimestamp
    : watch.latestTimestamp;
}

function liveWatchHasLaterPrice(watch: LiveWatchRecord) {
  const observationTimestamp = liveWatchObservationTimestamp(watch);
  return Number.isFinite(watch.latestTimestamp)
    && Number.isFinite(observationTimestamp)
    && watch.latestTimestamp > observationTimestamp;
}

type SnapshotTradeContext = {
  averageDailyVolume?: number;
  averageDailyTurnover?: number;
  marketCap?: number;
};
type SnapshotTradeContextMap = Record<string, Record<string, SnapshotTradeContext>>;
type TrainingState = {
  version: 7;
  cursor: number;
  cursorTimestamp?: number;
  dataIndexOffset?: number;
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
  deletedAt?: string;
};
type RestoreRequest = {
  id: string;
  instrumentId: string;
  timeframe: string;
  state: TrainingState;
  updatedAt?: string;
  preview?: boolean;
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
  market: string;
  timeframe: string;
  modeLabel: string;
  patternPresetId: string;
  status: "all" | "active" | "completed";
  outcome: "all" | "profit" | "loss" | "flat";
  dateFrom: string;
  dateTo: string;
};
type LivePerformanceFilters = {
  buyDateFrom: string;
  buyDateTo: string;
  market: "all" | LiveScanMarket;
  holdingStatus: "all" | "holding" | "pending" | "closed";
  outcome: "all" | "profit" | "loss" | "flat";
};
type ReviewSessionFilters = {
  query: string;
  timeframe: string;
  modeLabel: string;
  status: "all" | "active" | "completed";
};
type AppSettings = {
  defaultInstrumentId: string;
  defaultTimeframe: string;
  defaultOrderQty: number;
  defaultSpeed: number;
  tradingMode: TradingMode;
  initialCapital: number;
  replayHistoryBars: number;
  randomInstrumentMode: "current" | "all" | "market";
  randomMarket: string;
  randomTimeframeMode: "current" | "all" | "fixed";
  randomTimeframe: string;
  randomDateMode: "all" | "range";
  randomStartDate: string;
  randomEndDate: string;
  randomLength: number;
  randomIncludeIndices: boolean;
  randomUsLiquidityFilter: boolean;
  randomUsMinAverageDailyDollarVolume: number;
  patternCooldownBars: number;
  patternScanAttempts: number;
};
type SyncedPreferences = {
  version: 1;
  appSettings: AppSettings;
  patternPresets: PatternPreset[];
  movingAverageSettings: MovingAverageSettings;
  quickRandomMode: "free" | "blind";
  quickRandomPatternPresetId: string;
  randomTrainingPatternPresetIds: string[];
  reasonTags?: string[];
  customReasonTags: string[];
  drawingPreferences: {
    magnetMode: "normal" | "weak_magnet" | "strong_magnet";
    color: string;
    lineWidth: number;
    groupTools: Record<string, string>;
  };
  liveScanSettings?: {
    market: LiveScanMarket;
    presetIds: string[];
    minPrice: string;
    maxPrice: string;
    minVolume: string;
    sort: "turnover" | "volume" | "change";
    limit: number;
  };
  liveScanData?: LiveScanResponse | null;
  liveNavigatorResume?: {
    source: "scan" | "portfolio" | "watch";
    index: number;
    instrumentId?: string;
  };
  liveScanResume?: {
    index: number;
    instrumentId?: string;
  };
};

/**
 * The live ledger is shared by all screens, so a symbol switch must never
 * make one symbol's orders appear in another symbol.  Older builds could
 * persist the same position/order ids into several portfolios.  Remove
 * those ambiguous records instead of attributing them to an arbitrary
 * symbol; a pending order with no duplicate id is still retained.
 */
function sanitizeLivePortfolios(value: unknown): LivePortfolioRecord[] {
  if (!Array.isArray(value)) return [];
  const candidates = value.filter((item): item is LivePortfolioRecord => (
    Boolean(item)
    && typeof item === "object"
    && typeof (item as LivePortfolioRecord).instrumentId === "string"
    && Boolean((item as LivePortfolioRecord).instrumentId)
  ));
  const countIds = (items: Array<{ id?: unknown }>) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (typeof item.id !== "string" || !item.id) continue;
      counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    }
    return counts;
  };
  const positionCounts = countIds(candidates.flatMap((portfolio) => Array.isArray(portfolio.positions) ? portfolio.positions : []));
  const pendingCounts = countIds(candidates.flatMap((portfolio) => Array.isArray(portfolio.pendingOrders) ? portfolio.pendingOrders : []));
  const executionCounts = countIds(candidates.flatMap((portfolio) => Array.isArray(portfolio.executions) ? portfolio.executions : []));
  const seenPortfolios = new Set<string>();

  return candidates.flatMap((raw) => {
    const instrumentId = raw.instrumentId;
    if (seenPortfolios.has(instrumentId)) return [];
    seenPortfolios.add(instrumentId);
    const positions = (Array.isArray(raw.positions) ? raw.positions : []).filter((item): item is PositionLot => {
      const position = item as Partial<PositionLot>;
      return typeof position.id === "string"
        && position.id.length > 0
        && positionCounts.get(position.id) === 1
        && (position.side === "long" || position.side === "short")
        && (position.status === "open" || position.status === "closed")
        && Number.isFinite(position.qty) && Number(position.qty) > 0
        && Number.isFinite(position.entryPrice) && Number(position.entryPrice) > 0
        && Number.isFinite(position.entryTimestamp)
        && typeof position.entryOrderId === "string" && position.entryOrderId.length > 0
        && (position.status !== "closed" || (Number.isFinite(position.exitPrice) && Number.isFinite(position.exitTimestamp)));
    });
    const positionIds = new Set(positions.map((position) => position.id));
    const pendingOrders = (Array.isArray(raw.pendingOrders) ? raw.pendingOrders : []).filter((item): item is PendingOrder => {
      const order = item as Partial<PendingOrder>;
      return typeof order.id === "string"
        && order.id.length > 0
        && pendingCounts.get(order.id) === 1
        && (order.action === "open" || order.action === "close")
        && (order.side === "buy" || order.side === "sell")
        && Number.isFinite(order.qty) && Number(order.qty) > 0
        && Number.isFinite(order.createdAt)
        && typeof order.positionId === "string" && order.positionId.length > 0
        // A close order without its open lot is an orphan from the old bug.
        && (order.action === "open" || positionIds.has(order.positionId));
    });
    const executions = (Array.isArray(raw.executions) ? raw.executions : []).filter((item): item is Execution => {
      const execution = item as Partial<Execution>;
      return typeof execution.id === "string"
        && execution.id.length > 0
        && executionCounts.get(execution.id) === 1
        && typeof execution.orderId === "string" && execution.orderId.length > 0
        && typeof execution.positionId === "string" && positionIds.has(execution.positionId)
        && (execution.action === "open" || execution.action === "close")
        && (execution.side === "buy" || execution.side === "sell")
        && Number.isFinite(execution.qty) && Number(execution.qty) > 0
        && Number.isFinite(execution.price) && Number.isFinite(execution.timestamp)
        && Number.isFinite(execution.realizedPnl);
    });
    const decision = normalizePersistedDecision(raw.decision);
    const decisionSubmissions = cloneDecisionSubmissions(raw.decisionSubmissions);
    const hasPendingOrder = pendingOrders.length > 0;
    // Drop empty ledgers so an old zero-result row cannot reappear.  A
    // legitimate break-even closed trade is still a real trade and must be
    // kept when its ids are unique; only the duplicate/orphan records above
    // are removed by this migration.
    if (!positions.length && !hasPendingOrder && !hasDecisionContent(decision, decisionSubmissions)) return [];
    return [{
      ...raw,
      id: instrumentId,
      instrumentId,
      positions,
      pendingOrders,
      executions,
      orderRejections: Array.isArray(raw.orderRejections) ? raw.orderRejections : [],
      ...(decision ? { decision } : {}),
      ...(decisionSubmissions.length ? { decisionSubmissions } : {}),
    }];
  }).slice(0, 500);
}

function sanitizeLiveWatchlist(value: unknown): LiveWatchRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const watch = item as LiveWatchRecord;
    if (!watch.instrumentId || typeof watch.instrumentId !== "string" || seen.has(watch.instrumentId)) return [];
    if (watch.market !== "CN" && watch.market !== "US") return [];
    seen.add(watch.instrumentId);
    return [{ ...watch, id: `watch:${watch.instrumentId}` }];
  }).slice(0, 500);
}

const LAST_DRAFT_KEY = "kline-replay-lab:last-training";
const APP_SETTINGS_KEY = "kline-replay-lab:settings";
const REASON_TAGS_KEY = "kline-replay-lab:reason-tags-v1";
const CUSTOM_REASON_TAGS_KEY = "kline-replay-lab:custom-reason-tags";
const PATTERN_PRESETS_KEY = "kline-replay-lab:pattern-presets-v1";
const QUICK_RANDOM_PATTERN_KEY = "kline-replay-lab:quick-random-pattern-v1";
const RANDOM_TRAINING_PATTERN_PRESETS_KEY = "kline-replay-lab:random-training-pattern-presets-v1";
const QUICK_RANDOM_MODE_KEY = "kline-replay-lab:quick-random-mode-v1";
const MOVING_AVERAGE_SETTINGS_KEY = "kline-replay-lab:moving-average-indicators-v1";

function MovingAverageEditor({
  settings,
  onChange,
  compact = false,
}: {
  settings: MovingAverageSettings;
  onChange: (settings: MovingAverageSettings) => void;
  compact?: boolean;
}) {
  const updateGroup = (kind: MovingAverageKind, next: MovingAverageSettings[MovingAverageKind]) => {
    onChange({ ...settings, [kind]: next });
  };

  return (
    <div className={`moving-average-editor${compact ? " compact" : ""}`}>
      {(["ma", "ema"] as MovingAverageKind[]).map((kind) => {
        const group = settings[kind];
        const label = kind.toUpperCase();
        return (
          <section className={group.enabled ? "enabled" : ""} key={kind}>
            <div className="moving-average-row-head">
              <button
                type="button"
                className="indicator-switch"
                role="switch"
                aria-checked={group.enabled}
                aria-label={`${label} 指标`}
                onClick={() => updateGroup(kind, { ...group, enabled: !group.enabled })}
              ><span />{label}</button>
              <small>{kind === "ma" ? "简单移动平均" : "指数移动平均"}</small>
            </div>
            <div className="indicator-period-list" aria-label={`${label} 周期`}>
              {group.periods.map((period, index) => (
                <label key={`${kind}-${index}`}>
                  <span>{label}{index + 1}</span>
                  <input
                    type="number"
                    min={MIN_MOVING_AVERAGE_PERIOD}
                    max={MAX_MOVING_AVERAGE_PERIOD}
                    value={period}
                    aria-label={`${label} 周期 ${index + 1}`}
                    onChange={(event) => {
                      const nextPeriods = [...group.periods];
                      nextPeriods[index] = Math.min(
                        MAX_MOVING_AVERAGE_PERIOD,
                        Math.max(MIN_MOVING_AVERAGE_PERIOD, Math.round(Number(event.target.value) || 1)),
                      );
                      updateGroup(kind, { ...group, periods: nextPeriods });
                    }}
                    onBlur={() => updateGroup(kind, {
                      ...group,
                      periods: normalizeMovingAveragePeriods(group.periods, defaultMovingAverageSettings[kind].periods),
                    })}
                  />
                  <button
                    type="button"
                    aria-label={`删除 ${label} 周期 ${period}`}
                    disabled={group.periods.length === 1}
                    onClick={() => updateGroup(kind, {
                      ...group,
                      periods: group.periods.filter((_, periodIndex) => periodIndex !== index),
                    })}
                  ><X size={12} /></button>
                </label>
              ))}
              <button
                type="button"
                className="add-indicator-period"
                disabled={group.periods.length >= MAX_MOVING_AVERAGE_LINES}
                onClick={() => {
                  const last = group.periods.at(-1) ?? 5;
                  const candidate = Math.min(MAX_MOVING_AVERAGE_PERIOD, last + (last < 20 ? 5 : 10));
                  const next = group.periods.includes(candidate)
                    ? Math.min(MAX_MOVING_AVERAGE_PERIOD, candidate + 1)
                    : candidate;
                  updateGroup(kind, { ...group, periods: [...group.periods, next] });
                }}
              ><Plus size={12} />周期</button>
            </div>
          </section>
        );
      })}
      <p>周期范围 1–500；每组最多 6 条，只使用已经揭示的 K 线计算。</p>
    </div>
  );
}
const defaultPerformanceFilters: PerformanceFilters = {
  instrumentId: "all",
  market: "all",
  timeframe: "all",
  modeLabel: "all",
  patternPresetId: "all",
  status: "all",
  outcome: "all",
  dateFrom: "",
  dateTo: "",
};
const defaultLivePerformanceFilters: LivePerformanceFilters = {
  buyDateFrom: "",
  buyDateTo: "",
  market: "all",
  holdingStatus: "all",
  outcome: "all",
};
const defaultReviewSessionFilters: ReviewSessionFilters = {
  query: "",
  timeframe: "all",
  modeLabel: "all",
  status: "all",
};
const defaultDecision: Decision = {
  marketState: "",
  location: "",
  reasons: [],
  stop: "",
  target: "",
  note: "",
};

function normalizePersistedDecision(value: unknown): Decision | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<Decision>;
  return {
    marketState: typeof raw.marketState === "string" ? raw.marketState : "",
    location: typeof raw.location === "string" ? raw.location : "",
    reasons: Array.isArray(raw.reasons) ? raw.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    stop: typeof raw.stop === "string" ? raw.stop : "",
    target: typeof raw.target === "string" ? raw.target : "",
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function hasDecisionContent(value: unknown, submissions?: unknown): boolean {
  if (Array.isArray(submissions) && submissions.length > 0) return true;
  const decision = normalizePersistedDecision(value);
  return Boolean(decision && (
    decision.marketState
    || decision.location
    || decision.reasons.length
    || decision.stop
    || decision.target
    || decision.note.trim()
  ));
}

function cloneDecisionSubmissions(value: unknown): DecisionSubmission[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DecisionSubmission => (
    Boolean(item)
    && typeof item === "object"
    && typeof (item as DecisionSubmission).id === "string"
    && typeof (item as DecisionSubmission).barTimestamp === "number"
    && typeof (item as DecisionSubmission).cursor === "number"
    && typeof (item as DecisionSubmission).referencePrice === "number"
    && Boolean(normalizePersistedDecision((item as DecisionSubmission).decision))
  )).map((item) => {
    const normalized = normalizePersistedDecision(item.decision) ?? { ...defaultDecision };
    return {
      ...item,
      decision: { ...normalized, reasons: [...normalized.reasons] },
    };
  });
}

const defaultInstruments = [
  { id: "600519.SH", short: "600519", label: "贵州茅台", market: "A股", assetType: "stock" as const, timeframes: ["1d", "1w"] },
  { id: "AAPL.US", short: "AAPL", label: "Apple", market: "美股", assetType: "stock" as const, timeframes: ["1d"] },
];
const timeframes = ["1m", "5m", "1h", "1d", "1w"];
const coveragePageSize = 100;
const defaultAppSettings: AppSettings = {
  defaultInstrumentId: "600519.SH",
  defaultTimeframe: "1d",
  defaultOrderQty: 100,
  defaultSpeed: 1,
  tradingMode: "return",
  initialCapital: 100000,
  replayHistoryBars: DEFAULT_REPLAY_HISTORY_BARS,
  randomInstrumentMode: "all",
  randomMarket: "A股",
  randomTimeframeMode: "all",
  randomTimeframe: "1d",
  randomDateMode: "all",
  randomStartDate: "",
  randomEndDate: "",
  randomLength: 40,
  randomIncludeIndices: false,
  randomUsLiquidityFilter: true,
  randomUsMinAverageDailyDollarVolume: 1000000,
  patternCooldownBars: 10,
  patternScanAttempts: 12,
};
const reasonOptions = ["顺势", "关键位置", "突破回踩", "失败突破", "二次入场", "信号K确认"];

function normalizeReasonTagText(value: string) {
  const text = value.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!text) return "";
  const characters = [...text];
  const badIndexes = characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => character === "\uFFFD" || ((character.codePointAt(0) ?? 0) >= 0x80 && (character.codePointAt(0) ?? 0) <= 0x9f))
    .map(({ index }) => index);
  if (!badIndexes.length) return text;
  const firstBad = badIndexes[0];
  const lastBad = badIndexes.at(-1) ?? firstBad;
  const prefix = characters.slice(0, firstBad).join("");
  const suffix = characters.slice(lastBad + 1).join("");
  return reasonOptions.find((option) => option.startsWith(prefix) && option.endsWith(suffix)) ?? "";
}

function normalizeReasonTags(value: unknown, fallback: string[] = reasonOptions) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = source
    .filter((tag): tag is string => typeof tag === "string")
    .map(normalizeReasonTagText)
    .filter((tag, index, items) => Boolean(tag) && items.indexOf(tag) === index)
    .slice(0, 30);
  return Array.isArray(value) ? normalized : [...fallback];
}
type DrawingTool = {
  name: string;
  label: string;
  icon: typeof LineChart;
  kind?: "rectangle" | "position" | "text";
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
    id: "notes",
    label: "画笔与注释",
    icon: Brush,
    tools: [
      { name: "brush", label: "画笔", icon: Brush },
      { name: "trainingTextBox", label: "文字标记", icon: Tag, kind: "text" },
    ],
  },
];

const trainingPositionTool: DrawingTool = { name: "trainingPosition", label: "多空仓位", icon: TrendingUp, kind: "position" };
const allDrawingTools = [...drawingToolGroups.flatMap((group) => group.tools), trainingPositionTool];
const defaultDrawingTools = Object.fromEntries(drawingToolGroups.map((group) => [group.id, group.tools[0].name]));

function drawingLabel(name: string) {
  if (name === "trainingLongPosition") return "多头仓位（旧）";
  if (name === "trainingShortPosition") return "空头仓位（旧）";
  if (name === "trainingTextNote") return "文字标记（旧）";
  if (name === "trainingTextBox") return "文字标记";
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

function priceDelta(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function profitFactorLabel(value: number | null) {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(2);
}

type TrainingPnlStats = {
  closedSessionPositions: PositionLot[];
  closedTradePnls: number[];
  closedTradeReturns: number[];
  winningTrades: number;
  losingTrades: number;
  flatTrades: number;
  pnl: NonNullable<TrainingState["pnlSnapshot"]>;
  returnPct: number;
  realizedReturnPct: number;
  floatingReturnPct: number;
};

function trainingPnlStats(state: TrainingState): TrainingPnlStats {
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
  const returnPct = pnl.returnPct ?? portfolioReturnPct(closedSessionPositions, 0);
  const realizedReturnPct = portfolioReturnPct(closedSessionPositions, 0);
  const openEntryNotional = openSessionPositions.reduce(
    (sum, position) => sum + position.entryPrice * position.qty,
    0,
  );
  const floatingReturnPct = openEntryNotional > 0 ? pnl.floating / openEntryNotional * 100 : 0;
  return {
    closedSessionPositions,
    closedTradePnls,
    closedTradeReturns,
    winningTrades,
    losingTrades,
    flatTrades,
    pnl,
    returnPct,
    realizedReturnPct,
    floatingReturnPct,
  };
}

function estimatedHoldingBars(timeframe: string, entryTimestamp: number, exitTimestamp?: number) {
  if (!exitTimestamp || exitTimestamp <= entryTimestamp) return 1;
  const intervalMs: Record<string, number> = {
    "5m": 5 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
  };
  return Math.max(1, Math.round((exitTimestamp - entryTimestamp) / (intervalMs[timeframe] ?? intervalMs["1d"])));
}

function PerformanceInsightCard({
  title,
  description,
  items,
  formatResult,
  wide = false,
  emptyText = "当前筛选范围还没有可用于此项分析的数据。",
}: {
  title: string;
  description: string;
  items: PerformanceBreakdown[];
  formatResult: (value: number) => string;
  wide?: boolean;
  emptyText?: string;
}) {
  const best = items.find((item) => item.eligible);
  return (
    <article className={`performance-analysis-card${wide ? " wide" : ""}`}>
      <header>
        <div><span>{best ? "当前最优" : "样本积累中"}</span><h3>{title}</h3></div>
        <small>{description}</small>
      </header>
      {items.length ? (
        <div className="performance-analysis-list">
          {items.map((item) => (
            <div className={item === best ? "best" : ""} key={item.key}>
              <strong title={item.label}>{item.label}</strong>
              <span className={item.averageResult >= 0 ? "up" : "down"}>{formatResult(item.averageResult)} / 笔</span>
              <small>{item.samples} 笔 · 胜率 {item.winRate}% · PF {profitFactorLabel(item.profitFactor)}{item.eligible ? "" : " · 样本不足"}</small>
            </div>
          ))}
        </div>
      ) : <div className="performance-analysis-empty">{emptyText}</div>}
    </article>
  );
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
    replayHistoryBars: normalizeReplayHistoryBars(merged.replayHistoryBars),
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
    randomIncludeIndices: merged.randomIncludeIndices === true,
    randomUsLiquidityFilter: merged.randomUsLiquidityFilter !== false,
    randomUsMinAverageDailyDollarVolume: Math.max(
      0,
      Math.round(Number(merged.randomUsMinAverageDailyDollarVolume) || defaultAppSettings.randomUsMinAverageDailyDollarVolume),
    ),
    patternCooldownBars: Math.max(0, Math.min(100, Math.round(Number(merged.patternCooldownBars) || 0))),
    patternScanAttempts: Math.max(1, Math.min(50, Math.round(Number(merged.patternScanAttempts) || defaultAppSettings.patternScanAttempts))),
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
  return timeframe === "1m" || timeframe === "5m" || timeframe === "1h"
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
    decision_updated: "编辑事前决策",
    decision_deleted: "删除事前决策",
    reason_tag_updated: "编辑交易理由标签",
    reason_tag_deleted: "删除交易理由标签",
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
  const [availableInstruments, setAvailableInstruments] = useState<AvailableInstrument[]>(defaultInstruments);
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
  const [snapshotDataIndexOffset, setSnapshotDataIndexOffset] = useState(0);
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
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [movingAverageSettings, setMovingAverageSettings] = useState<MovingAverageSettings>(defaultMovingAverageSettings);
  const [movingAverageSettingsReady, setMovingAverageSettingsReady] = useState(false);
  const [quickRandomMode, setQuickRandomMode] = useState<"free" | "blind">("free");
  const [quickRandomPatternPresetId, setQuickRandomPatternPresetId] = useState("");
  const [randomTrainingPatternPresetIds, setRandomTrainingPatternPresetIds] = useState<string[]>([]);
  const [quickRandomError, setQuickRandomError] = useState("");
  const [decision, setDecision] = useState<Decision>(defaultDecision);
  const [reasonTags, setReasonTags] = useState<string[]>(reasonOptions);
  const [customReasonTags, setCustomReasonTags] = useState<string[]>([]);
  const [customReasonInput, setCustomReasonInput] = useState("");
  const [editingReasonTag, setEditingReasonTag] = useState("");
  const [editingReasonInput, setEditingReasonInput] = useState("");
  const [reasonTagActionMode, setReasonTagActionMode] = useState<"edit" | "delete" | "">("");
  const [reasonTagsReady, setReasonTagsReady] = useState(false);
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
  const [showLiveScan, setShowLiveScan] = useState(false);
  const [liveScanMarket, setLiveScanMarket] = useState<LiveScanMarket>("CN");
  const [liveScanPresetIds, setLiveScanPresetIds] = useState<string[]>([]);
  const [liveScanMinPrice, setLiveScanMinPrice] = useState("");
  const [liveScanMaxPrice, setLiveScanMaxPrice] = useState("");
  const [liveScanMinVolume, setLiveScanMinVolume] = useState("");
  const [liveScanSort, setLiveScanSort] = useState<"turnover" | "volume" | "change">("turnover");
  const [liveScanLimit, setLiveScanLimit] = useState(100);
  const [liveScanStatus, setLiveScanStatus] = useState("");
  const [liveScanError, setLiveScanError] = useState("");
  const [liveScanRunning, setLiveScanRunning] = useState(false);
  const [livePriceRefreshRunning, setLivePriceRefreshRunning] = useState(false);
  const [, setLivePriceRefreshStatus] = useState("");
  const [liveScanData, setLiveScanData] = useState<LiveScanResponse | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [liveContext, setLiveContext] = useState<LiveScanResult | null>(null);
  const [livePortfolios, setLivePortfolios] = useState<LivePortfolioRecord[]>([]);
  const [liveWatchlist, setLiveWatchlist] = useState<LiveWatchRecord[]>([]);
  const [liveScanIndex, setLiveScanIndex] = useState(0);
  const [liveNavigatorSource, setLiveNavigatorSource] = useState<LiveNavigatorSource>("scan");
  const [liveNavigatorResume, setLiveNavigatorResume] = useState<NonNullable<SyncedPreferences["liveNavigatorResume"]>>({ source: "scan", index: 0 });
  const [liveScanResume, setLiveScanResume] = useState<NonNullable<SyncedPreferences["liveScanResume"]>>({ index: 0 });
  const [liveBarOffset, setLiveBarOffset] = useState({ x: 0, y: 0 });
  const [performanceSection, setPerformanceSection] = useState<"training" | "live" | "watch">("training");
  const [taskSetupKind, setTaskSetupKind] = useState<TaskSetupKind>("configured");
  const [showRandomComplete, setShowRandomComplete] = useState(false);
  const [trashPreview, setTrashPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPatternFilters, setShowPatternFilters] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("basic");
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(defaultAppSettings);
  const [settingsError, setSettingsError] = useState("");
  const [patternPresets, setPatternPresets] = useState<PatternPreset[]>(defaultPatternPresets);
  const [patternPresetsReady, setPatternPresetsReady] = useState(false);
  const [patternPresetDrafts, setPatternPresetDrafts] = useState<PatternPreset[]>(defaultPatternPresets);
  const [selectedPatternPresetId, setSelectedPatternPresetId] = useState(defaultPatternPresets[0].id);
  const [patternScanStatus, setPatternScanStatus] = useState("");
  const [startingTraining, setStartingTraining] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TrainingTaskDraft>(defaultTrainingTaskDraft);
  const [setupInstrumentId, setSetupInstrumentId] = useState("600519.SH");
  const [setupTimeframe, setSetupTimeframe] = useState("1d");
  const [setupError, setSetupError] = useState("");
  const [ruleNotice, setRuleNotice] = useState("");
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [selectedDecisionId, setSelectedDecisionId] = useState("");
  const [decisionTarget, setDecisionTarget] = useState<CandleContextTarget | null>(null);
  const [editingDecisionId, setEditingDecisionId] = useState("");
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
  const [trashSessions, setTrashSessions] = useState<TrainingSession[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashActionId, setTrashActionId] = useState("");
  const [trashError, setTrashError] = useState("");
  const [snapshotTradeContexts, setSnapshotTradeContexts] = useState<SnapshotTradeContextMap>({});
  const [performanceFilters, setPerformanceFilters] = useState<PerformanceFilters>(defaultPerformanceFilters);
  const [livePerformanceFilters, setLivePerformanceFilters] = useState<LivePerformanceFilters>(defaultLivePerformanceFilters);
  const [reviewSessionFilters, setReviewSessionFilters] = useState<ReviewSessionFilters>(defaultReviewSessionFilters);
  const [selectedPerformanceSessionId, setSelectedPerformanceSessionId] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [chartLoadError, setChartLoadError] = useState("");
  const [startupReady, setStartupReady] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [syncedPreferencesReady, setSyncedPreferencesReady] = useState(false);
  const [syncedPreferencesRetryNonce, setSyncedPreferencesRetryNonce] = useState(0);
  const [liveStateReady, setLiveStateReady] = useState(false);
  const [liveStateLoadNonce, setLiveStateLoadNonce] = useState(0);
  const [liveStateSaveRetryNonce, setLiveStateSaveRetryNonce] = useState(0);
  const [instrumentCatalogReady, setInstrumentCatalogReady] = useState(false);
  const [trainingReady, setTrainingReady] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const restoreRequestRef = useRef<RestoreRequest | null>(null);
  const newTaskRequestRef = useRef<NewTaskRequest | null>(null);
  const saveCompletedTrainingRef = useRef(false);
  const appSettingsRef = useRef<AppSettings>(defaultAppSettings);
  const eventSequenceRef = useRef(0);
  const decisionPanelRef = useRef<HTMLElement | null>(null);
  const decisionDraftBeforeBackfillRef = useRef<Decision | null>(null);
  const marketLoadRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const liveRequestRef = useRef<LiveScanResult | null>(null);
  const livePortfoliosRef = useRef<LivePortfolioRecord[]>([]);
  const liveWatchlistRef = useRef<LiveWatchRecord[]>([]);
  const livePersistSignatureRef = useRef("");
  const liveBarDragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const startupRandomStartedRef = useRef(false);
  const syncedPreferencesLoadStartedRef = useRef(false);
  const syncedPreferencesHydratedRef = useRef(false);
  const syncedPreferencesRetryCountRef = useRef(0);
  const liveStateHydratedRef = useRef(false);
  const liveStateRetryCountRef = useRef(0);
  const liveStatePersistedRef = useRef({
    portfolios: [] as LivePortfolioRecord[],
    watchlist: [] as LiveWatchRecord[],
  });

  useEffect(() => {
    livePortfoliosRef.current = livePortfolios;
  }, [livePortfolios]);

  useEffect(() => {
    liveWatchlistRef.current = liveWatchlist;
  }, [liveWatchlist]);

  const visibleBarStartIndex = trainingTask ? taskVisibleStartCursor(trainingTask) : 0;
  const chartDataIndexOffset = snapshotDataIndexOffset + visibleBarStartIndex;
  const visibleBars = useMemo(
    () => bars.slice(visibleBarStartIndex, cursor + 1),
    [bars, cursor, visibleBarStartIndex],
  );
  const selectedCatalogInstrument = availableInstruments.find((item) => item.id === instrumentId);
  const currentAssetType = inferInstrumentAssetType(
    instrument.id,
    instrument.market,
    instrument.assetType ?? selectedCatalogInstrument?.assetType,
  );
  const currentAssetLabel = selectedCatalogInstrument
    ? instrumentAssetLabel(selectedCatalogInstrument)
    : currentAssetType === "index" ? "指数"
      : currentAssetType === "fund" ? "基金"
        : currentAssetType === "convertible-bond" ? "可转债"
          : instrument.market === "CN" ? "A股" : instrument.market;
  const tradingDisabledReason = currentAssetType === "index"
    ? "指数仅供看盘训练，不能直接模拟买卖"
    : `${marketRules.name}暂未开放模拟交易`;
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
  const selectedPatternPresetDraft = patternPresetDrafts.find((preset) => preset.id === selectedPatternPresetId)
    ?? patternPresetDrafts[0];
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
    dataIndexOffset: snapshotDataIndexOffset,
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
  }), [cashBalance, closedPositions.length, cursor, currentBar?.timestamp, dataSignature, dataSnapshotId, decision, decisionSubmissions, drawings, equity, events, executions, initialCapital, marketRules, openPnl, openPositions.length, orderQty, orderRejections, pendingOrders, positions, randomSeed, realizedPnl, snapshotDataIndexOffset, snapshotHash, totalPnl, totalReturnPct, tradingMode, trainingTask]);

  useEffect(() => {
    if (!liveStateHydratedRef.current) return;
    // During a live-symbol switch React may briefly render the previous
    // instrument's bar together with the new live context.  Never persist
    // that mixed state under the new symbol; the live ledger is restored only
    // after the requested instrument has finished loading.
    if (!liveMode || !liveContext || !currentBar || instrument.id !== liveContext.instrumentId) return;
    // Opening a result only starts an observation.  Keep the live performance
    // list focused on symbols where the user actually attempted a trade.
    const hasLiveActivity = positions.length > 0
      || pendingOrders.length > 0
      || executions.length > 0
      || hasDecisionContent(decision, decisionSubmissions);
    if (!hasLiveActivity) {
      livePersistSignatureRef.current = "";
      const cleanupTimer = window.setTimeout(() => {
        setLivePortfolios((items) => items.some((item) => item.id === liveContext.instrumentId)
          ? items.filter((item) => item.id !== liveContext.instrumentId)
          : items);
      }, 0);
      return () => window.clearTimeout(cleanupTimer);
    }
    const nextRecord: LivePortfolioRecord = {
      id: liveContext.instrumentId,
      instrumentId: liveContext.instrumentId,
      symbol: liveContext.symbol,
      name: liveContext.name,
      market: liveContext.market,
      latestTimestamp: currentBar.timestamp,
      latestClose: currentBar.close,
      scanTimestamp: liveContext.timestamp,
      presetIds: liveContext.presetIds,
      presetNames: liveContext.presetNames,
      positions,
      pendingOrders,
      executions,
      orderRejections,
      tradingMode,
      initialCapital,
      cashBalance,
      ...(hasDecisionContent(decision, decisionSubmissions)
        ? {
          decision: { ...decision, reasons: [...decision.reasons] },
          decisionSubmissions: decisionSubmissions.map((submission) => ({
            ...submission,
            decision: { ...submission.decision, reasons: [...submission.decision.reasons] },
          })),
        }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    const signature = JSON.stringify(nextRecord);
    if (signature === livePersistSignatureRef.current) return;
    livePersistSignatureRef.current = signature;
    setLivePortfolios((items) => {
      const previousIndex = items.findIndex((item) => item.id === nextRecord.id);
      const previous = previousIndex >= 0 ? items[previousIndex] : undefined;
      if (previous && JSON.stringify(previous) === signature) return items;
      // Opening a portfolio restores its ledger and reaches this effect even
      // when the user has not traded.  Replace it in place so merely viewing
      // a symbol does not reorder the navigator and make it look like index 0.
      if (previousIndex < 0) return [nextRecord, ...items].slice(0, 500);
      const next = [...items];
      next[previousIndex] = nextRecord;
      return next;
    });
  }, [cashBalance, currentBar, decision, decisionSubmissions, executions, initialCapital, instrument.id, liveContext, liveMode, orderRejections, pendingOrders, positions, tradingMode]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = liveBarDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      setLiveBarOffset({
        x: drag.offsetX + event.clientX - drag.startX,
        y: drag.offsetY + event.clientY - drag.startY,
      });
    };
    const end = (event: PointerEvent) => {
      if (liveBarDragRef.current?.pointerId === event.pointerId) liveBarDragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);
  const reviewState = reviewedSession?.state ?? trainingState;
  const reviewClosedPositions = reviewState.positions.filter((position) => position.status === "closed");
  const reviewRealizedPnl = reviewClosedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
  const reviewRealizedReturnPct = portfolioReturnPct(reviewClosedPositions, 0);
  const reviewWinningTrades = reviewClosedPositions.filter((position) => (position.realizedPnl ?? 0) > 0).length;
  const reviewLosingTrades = reviewClosedPositions.filter((position) => (position.realizedPnl ?? 0) < 0).length;
  const reviewFlatTrades = reviewClosedPositions.length - reviewWinningTrades - reviewLosingTrades;
  const reviewDecisiveTrades = reviewWinningTrades + reviewLosingTrades;
  const reviewTradeWinRate = reviewDecisiveTrades
    ? Math.round(reviewWinningTrades / reviewDecisiveTrades * 100)
    : 0;
  const reviewTotalResult = reviewState.tradingMode === "capital"
    ? reviewState.pnlSnapshot?.total ?? reviewRealizedPnl
    : reviewState.pnlSnapshot?.returnPct ?? reviewRealizedReturnPct;
  const reviewLatestSubmission = reviewState.decisionSubmissions.at(-1);
  const reviewDecision = reviewLatestSubmission?.decision ?? reviewState.decision;
  const reviewPlanScore = decisionScore(reviewDecision);
  const reviewPatternFilter = reviewState.trainingTask?.patternFilter;
  const reviewMatchedPatternNames = reviewPatternFilter?.matchedPresetIds.map((id) => {
    const selectedIndex = reviewPatternFilter.presetIds.indexOf(id);
    return reviewPatternFilter.presetNames[selectedIndex] ?? id;
  }) ?? [];
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
      dataIndexOffset: typeof state.dataIndexOffset === "number" && state.dataIndexOffset >= 0
        ? Math.floor(state.dataIndexOffset)
        : undefined,
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

  const applySyncedPreferences = useCallback((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const stored = value as Partial<SyncedPreferences>;
    if (stored.appSettings && typeof stored.appSettings === "object") {
      const nextSettings = normalizeSettings(stored.appSettings);
      appSettingsRef.current = nextSettings;
      setAppSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setSpeed(nextSettings.defaultSpeed);
      setOrderQty(nextSettings.defaultOrderQty);
      window.localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(nextSettings));
    }
    if (Array.isArray(stored.patternPresets)) {
      const nextPresets = normalizePatternPresets(stored.patternPresets);
      setPatternPresets(nextPresets);
      setPatternPresetDrafts(nextPresets);
      setSelectedPatternPresetId((selected) => (
        nextPresets.some((preset) => preset.id === selected) ? selected : nextPresets[0]?.id ?? ""
      ));
      window.localStorage.setItem(PATTERN_PRESETS_KEY, JSON.stringify(nextPresets));
      const quickPattern = typeof stored.quickRandomPatternPresetId === "string"
        && nextPresets.some((preset) => preset.id === stored.quickRandomPatternPresetId)
        ? stored.quickRandomPatternPresetId
        : "";
      setQuickRandomPatternPresetId(quickPattern);
      if (quickPattern) window.localStorage.setItem(QUICK_RANDOM_PATTERN_KEY, quickPattern);
      else window.localStorage.removeItem(QUICK_RANDOM_PATTERN_KEY);
      if (Array.isArray(stored.randomTrainingPatternPresetIds)) {
        const randomPatternIds = stored.randomTrainingPatternPresetIds.filter((id): id is string => (
          typeof id === "string" && nextPresets.some((preset) => preset.id === id)
        ));
        setRandomTrainingPatternPresetIds(randomPatternIds);
        window.localStorage.setItem(RANDOM_TRAINING_PATTERN_PRESETS_KEY, JSON.stringify(randomPatternIds));
      }
    }
    if (stored.movingAverageSettings && typeof stored.movingAverageSettings === "object") {
      const nextIndicators = normalizeMovingAverageSettings(stored.movingAverageSettings);
      setMovingAverageSettings(nextIndicators);
      window.localStorage.setItem(MOVING_AVERAGE_SETTINGS_KEY, JSON.stringify(nextIndicators));
    }
    if (stored.quickRandomMode === "free" || stored.quickRandomMode === "blind") {
      setQuickRandomMode(stored.quickRandomMode);
      window.localStorage.setItem(QUICK_RANDOM_MODE_KEY, stored.quickRandomMode);
    }
    const syncedReasonTags = Array.isArray(stored.reasonTags)
      ? normalizeReasonTags(stored.reasonTags)
      : normalizeReasonTags([
        ...reasonOptions,
        ...(Array.isArray(stored.customReasonTags) ? stored.customReasonTags : []),
      ]);
    setReasonTags(syncedReasonTags);
    const syncedCustomReasonTags = syncedReasonTags.filter((tag) => !reasonOptions.includes(tag));
    setCustomReasonTags(syncedCustomReasonTags);
    window.localStorage.setItem(REASON_TAGS_KEY, JSON.stringify(syncedReasonTags));
    window.localStorage.setItem(CUSTOM_REASON_TAGS_KEY, JSON.stringify(syncedCustomReasonTags));
    const drawingPreferences = stored.drawingPreferences;
    if (drawingPreferences && typeof drawingPreferences === "object") {
      if (["normal", "weak_magnet", "strong_magnet"].includes(drawingPreferences.magnetMode)) {
        setDrawingMagnetMode(drawingPreferences.magnetMode);
      }
      if (typeof drawingPreferences.color === "string" && /^#[0-9a-f]{6}$/i.test(drawingPreferences.color)) {
        setDrawingColor(drawingPreferences.color);
      }
      if (Number.isFinite(drawingPreferences.lineWidth)) {
        setDrawingLineWidth(Math.min(5, Math.max(1, Math.round(drawingPreferences.lineWidth))));
      }
      if (drawingPreferences.groupTools && typeof drawingPreferences.groupTools === "object") {
        setGroupDrawingTools({ ...defaultDrawingTools, ...drawingPreferences.groupTools });
      }
    }
    if (stored.liveScanSettings && typeof stored.liveScanSettings === "object") {
      const settings = stored.liveScanSettings;
      if (settings.market === "CN" || settings.market === "US") setLiveScanMarket(settings.market);
      if (Array.isArray(settings.presetIds)) setLiveScanPresetIds(settings.presetIds.filter((id): id is string => typeof id === "string"));
      if (typeof settings.minPrice === "string") setLiveScanMinPrice(settings.minPrice);
      if (typeof settings.maxPrice === "string") setLiveScanMaxPrice(settings.maxPrice);
      if (typeof settings.minVolume === "string") setLiveScanMinVolume(settings.minVolume);
      if (settings.sort === "turnover" || settings.sort === "volume" || settings.sort === "change") setLiveScanSort(settings.sort);
      if (Number.isFinite(settings.limit)) setLiveScanLimit(Math.min(500, Math.max(50, Math.round(settings.limit))));
    }
    if (stored.liveScanData && typeof stored.liveScanData === "object") setLiveScanData(stored.liveScanData);
    if (stored.liveNavigatorResume && typeof stored.liveNavigatorResume === "object") {
      const resume = stored.liveNavigatorResume;
      const source = resume.source === "scan" || resume.source === "portfolio" || resume.source === "watch"
        ? resume.source
        : "scan";
      const index = Number.isFinite(resume.index) ? Math.max(0, Math.round(resume.index)) : 0;
      const nextResume = {
        source,
        index,
        ...(typeof resume.instrumentId === "string" && resume.instrumentId ? { instrumentId: resume.instrumentId } : {}),
      } as NonNullable<SyncedPreferences["liveNavigatorResume"]>;
      setLiveNavigatorResume(nextResume);
      setLiveNavigatorSource(source);
      setLiveScanIndex(index);
    }
    if (stored.liveScanResume && typeof stored.liveScanResume === "object") {
      const resume = stored.liveScanResume;
      const index = Number.isFinite(resume.index) ? Math.max(0, Math.round(resume.index)) : 0;
      setLiveScanResume({
        index,
        ...(typeof resume.instrumentId === "string" && resume.instrumentId ? { instrumentId: resume.instrumentId } : {}),
      });
    } else if (stored.liveNavigatorResume?.source === "scan" && typeof stored.liveNavigatorResume.index === "number") {
      setLiveScanResume({
        index: Math.max(0, Math.round(stored.liveNavigatorResume.index)),
        ...(typeof stored.liveNavigatorResume.instrumentId === "string" && stored.liveNavigatorResume.instrumentId
          ? { instrumentId: stored.liveNavigatorResume.instrumentId }
          : {}),
      });
    }
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
        const stored = window.localStorage.getItem(PATTERN_PRESETS_KEY);
        const nextPresets = normalizePatternPresets(stored ? JSON.parse(stored) : defaultPatternPresets);
        setPatternPresets(nextPresets);
        setPatternPresetDrafts(nextPresets);
        setSelectedPatternPresetId(nextPresets[0]?.id ?? "");
        const storedQuickPattern = window.localStorage.getItem(QUICK_RANDOM_PATTERN_KEY) ?? "";
        setQuickRandomPatternPresetId(
          nextPresets.some((preset) => preset.id === storedQuickPattern) ? storedQuickPattern : "",
        );
        const storedRandomPatterns = JSON.parse(
          window.localStorage.getItem(RANDOM_TRAINING_PATTERN_PRESETS_KEY) ?? "[]",
        ) as unknown;
        setRandomTrainingPatternPresetIds(Array.isArray(storedRandomPatterns)
          ? storedRandomPatterns.filter((id): id is string => (
            typeof id === "string" && nextPresets.some((preset) => preset.id === id)
          ))
          : []);
        setQuickRandomMode(window.localStorage.getItem(QUICK_RANDOM_MODE_KEY) === "blind" ? "blind" : "free");
      } catch {
        window.localStorage.removeItem(PATTERN_PRESETS_KEY);
        window.localStorage.removeItem(QUICK_RANDOM_PATTERN_KEY);
        window.localStorage.removeItem(RANDOM_TRAINING_PATTERN_PRESETS_KEY);
        window.localStorage.removeItem(QUICK_RANDOM_MODE_KEY);
        const nextPresets = normalizePatternPresets(defaultPatternPresets);
        setPatternPresets(nextPresets);
        setPatternPresetDrafts(nextPresets);
      } finally {
        setPatternPresetsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedReasonTags = window.localStorage.getItem(REASON_TAGS_KEY);
        const storedCustomTags = window.localStorage.getItem(CUSTOM_REASON_TAGS_KEY);
        const legacyCustomTags = storedCustomTags ? JSON.parse(storedCustomTags) : [];
        const nextTags = normalizeReasonTags(
          storedReasonTags ? JSON.parse(storedReasonTags) : [...reasonOptions, ...(Array.isArray(legacyCustomTags) ? legacyCustomTags : [])],
        );
        setReasonTags(nextTags);
        setCustomReasonTags(nextTags.filter((tag) => !reasonOptions.includes(tag)));
      } catch {
        setReasonTags(reasonOptions);
        setCustomReasonTags([]);
        window.localStorage.removeItem(REASON_TAGS_KEY);
        window.localStorage.removeItem(CUSTOM_REASON_TAGS_KEY);
      } finally {
        setReasonTagsReady(true);
        setCustomReasonTagsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!reasonTagsReady) return;
    const nextTags = normalizeReasonTags(reasonTags);
    const nextCustomTags = nextTags.filter((tag) => !reasonOptions.includes(tag));
    window.localStorage.setItem(REASON_TAGS_KEY, JSON.stringify(nextTags));
    window.localStorage.setItem(CUSTOM_REASON_TAGS_KEY, JSON.stringify(nextCustomTags));
  }, [reasonTags, reasonTagsReady]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(MOVING_AVERAGE_SETTINGS_KEY);
        if (stored) setMovingAverageSettings(normalizeMovingAverageSettings(JSON.parse(stored)));
      } catch {
        window.localStorage.removeItem(MOVING_AVERAGE_SETTINGS_KEY);
      } finally {
        setMovingAverageSettingsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!movingAverageSettingsReady) return;
    window.localStorage.setItem(MOVING_AVERAGE_SETTINGS_KEY, JSON.stringify(movingAverageSettings));
  }, [movingAverageSettings, movingAverageSettingsReady]);

  useEffect(() => {
    if (!patternPresetsReady) return;
    window.localStorage.setItem(QUICK_RANDOM_MODE_KEY, quickRandomMode);
  }, [patternPresetsReady, quickRandomMode]);

  useEffect(() => {
    if (!patternPresetsReady) return;
    window.localStorage.setItem(
      RANDOM_TRAINING_PATTERN_PRESETS_KEY,
      JSON.stringify(randomTrainingPatternPresetIds),
    );
  }, [patternPresetsReady, randomTrainingPatternPresetIds]);

  useEffect(() => {
    if (
      !settingsReady
      || !patternPresetsReady
      || !reasonTagsReady
      || !customReasonTagsReady
      || !movingAverageSettingsReady
      || syncedPreferencesLoadStartedRef.current
    ) return;
    syncedPreferencesLoadStartedRef.current = true;
    syncedPreferencesHydratedRef.current = false;
    let cancelled = false;
    let readyTimer: number | null = null;
    let retryTimer: number | null = null;
    void fetch("/api/preferences", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("读取同步设置失败");
        const payload = await response.json() as { preferences?: unknown };
        if (cancelled) return;
        if (payload.preferences) applySyncedPreferences(payload.preferences);
        syncedPreferencesRetryCountRef.current = 0;
        syncedPreferencesHydratedRef.current = true;
        readyTimer = window.setTimeout(() => {
          if (!cancelled) setSyncedPreferencesReady(true);
        }, 0);
      })
      .catch(() => {
        if (cancelled) return;
        // Initial state is empty. Never enable persistence when the read failed,
        // otherwise an empty render can overwrite the stored preferences.
        syncedPreferencesLoadStartedRef.current = false;
        syncedPreferencesHydratedRef.current = false;
        setSyncedPreferencesReady(false);
        const retryDelay = Math.min(
          30_000,
          1_000 * (2 ** Math.min(syncedPreferencesRetryCountRef.current, 5)),
        );
        syncedPreferencesRetryCountRef.current += 1;
        retryTimer = window.setTimeout(() => {
          if (!cancelled) setSyncedPreferencesRetryNonce((nonce) => nonce + 1);
        }, retryDelay);
      });
    return () => {
      cancelled = true;
      if (readyTimer !== null) window.clearTimeout(readyTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [applySyncedPreferences, customReasonTagsReady, movingAverageSettingsReady, patternPresetsReady, reasonTagsReady, settingsReady, syncedPreferencesRetryNonce]);

  useEffect(() => {
    if (!syncedPreferencesReady || !syncedPreferencesHydratedRef.current) return;
    const timer = window.setTimeout(() => {
      const preferences: SyncedPreferences = {
        version: 1,
        appSettings,
        patternPresets,
        movingAverageSettings,
        quickRandomMode,
        quickRandomPatternPresetId,
        randomTrainingPatternPresetIds,
        reasonTags,
        customReasonTags,
        drawingPreferences: {
          magnetMode: drawingMagnetMode,
          color: drawingColor,
          lineWidth: drawingLineWidth,
          groupTools: groupDrawingTools,
        },
        liveScanSettings: {
          market: liveScanMarket,
          presetIds: liveScanPresetIds,
          minPrice: liveScanMinPrice,
          maxPrice: liveScanMaxPrice,
          minVolume: liveScanMinVolume,
          sort: liveScanSort,
          limit: liveScanLimit,
        },
        liveScanData,
        liveNavigatorResume,
        liveScanResume,
      };
      void fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      }).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    appSettings,
    customReasonTags,
    drawingColor,
    drawingLineWidth,
    drawingMagnetMode,
    groupDrawingTools,
    liveScanData,
    liveNavigatorResume,
    liveScanResume,
    liveScanLimit,
    liveScanMarket,
    liveScanMaxPrice,
    liveScanMinPrice,
    liveScanMinVolume,
    liveScanPresetIds,
    liveScanSort,
    movingAverageSettings,
    patternPresets,
    quickRandomMode,
    quickRandomPatternPresetId,
    randomTrainingPatternPresetIds,
    reasonTags,
    syncedPreferencesReady,
  ]);

  useEffect(() => {
    if (!syncedPreferencesReady) return;
    let refreshing = false;
    const refresh = () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      void fetch("/api/preferences", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const payload = await response.json() as { preferences?: unknown };
          if (payload.preferences) applySyncedPreferences(payload.preferences);
        })
        .catch(() => undefined)
        .finally(() => { refreshing = false; });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [applySyncedPreferences, syncedPreferencesReady]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    liveStateHydratedRef.current = false;
    void fetch("/api/live-state", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("读取实盘数据失败");
        const payload = await response.json() as { portfolios?: unknown; watchlist?: unknown };
        if (!Array.isArray(payload.portfolios) || !Array.isArray(payload.watchlist)) {
          throw new Error("实盘数据响应不完整");
        }
        if (cancelled) return;
        const portfolios = sanitizeLivePortfolios(payload.portfolios);
        const watchlist = sanitizeLiveWatchlist(payload.watchlist);
        livePortfoliosRef.current = portfolios;
        liveWatchlistRef.current = watchlist;
        liveStatePersistedRef.current = { portfolios, watchlist };
        setLivePortfolios(portfolios);
        setLiveWatchlist(watchlist);
        liveStateRetryCountRef.current = 0;
        liveStateHydratedRef.current = true;
        setLiveStateReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLiveStateReady(false);
        const retryDelay = Math.min(
          30_000,
          1_000 * (2 ** Math.min(liveStateRetryCountRef.current, 5)),
        );
        liveStateRetryCountRef.current += 1;
        retryTimer = window.setTimeout(() => {
          if (!cancelled) setLiveStateLoadNonce((nonce) => nonce + 1);
        }, retryDelay);
      });
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [liveStateLoadNonce]);

  useEffect(() => {
    if (!liveStateReady || !liveStateHydratedRef.current) return;
    const previous = liveStatePersistedRef.current;
    const currentPortfolios = livePortfolios.map((record) => ({ ...record }));
    const currentWatchlist = liveWatchlist.map((record) => ({ ...record }));
    const previousPortfolioMap = new Map(previous.portfolios.map((record, index) => [record.instrumentId, { record, index }]));
    const previousWatchMap = new Map(previous.watchlist.map((record, index) => [record.instrumentId, { record, index }]));
    const currentPortfolioIds = new Set(currentPortfolios.map((record) => record.instrumentId));
    const currentWatchIds = new Set(currentWatchlist.map((record) => record.instrumentId));
    const portfolioUpserts = currentPortfolios.flatMap((record, index) => {
      const previousRecord = previousPortfolioMap.get(record.instrumentId);
      if (previousRecord
        && previousRecord.index === index
        && JSON.stringify(previousRecord.record) === JSON.stringify(record)) return [];
      return [{ ...record, sortOrder: index }];
    });
    const watchlistUpserts = currentWatchlist.flatMap((record, index) => {
      const previousRecord = previousWatchMap.get(record.instrumentId);
      if (previousRecord
        && previousRecord.index === index
        && JSON.stringify(previousRecord.record) === JSON.stringify(record)) return [];
      return [{ ...record, sortOrder: index }];
    });
    const portfolioDeletes = previous.portfolios
      .filter((record) => !currentPortfolioIds.has(record.instrumentId))
      .map((record) => ({ instrumentId: record.instrumentId, updatedAt: record.updatedAt }));
    const watchlistDeletes = previous.watchlist
      .filter((record) => !currentWatchIds.has(record.instrumentId))
      .map((record) => ({ instrumentId: record.instrumentId, updatedAt: record.updatedAt }));
    if (!portfolioUpserts.length && !watchlistUpserts.length && !portfolioDeletes.length && !watchlistDeletes.length) return;

    let cancelled = false;
    let retryTimer: number | null = null;
    const timer = window.setTimeout(() => {
      void fetch("/api/live-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolioUpserts, portfolioDeletes, watchlistUpserts, watchlistDeletes }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("保存实盘数据失败");
          const result = await response.json() as { portfolioSkipped?: number; watchSkipped?: number };
          if (cancelled) return;
          if ((result.portfolioSkipped ?? 0) > 0 || (result.watchSkipped ?? 0) > 0) {
            liveStateHydratedRef.current = false;
            setLiveStateReady(false);
            setLiveStateLoadNonce((nonce) => nonce + 1);
            return;
          }
          liveStatePersistedRef.current = {
            portfolios: currentPortfolios,
            watchlist: currentWatchlist,
          };
        })
        .catch(() => {
          if (cancelled) return;
          const retryDelay = Math.min(
            30_000,
            1_000 * (2 ** Math.min(liveStateRetryCountRef.current, 5)),
          );
          liveStateRetryCountRef.current += 1;
          retryTimer = window.setTimeout(() => {
            if (!cancelled) setLiveStateSaveRetryNonce((nonce) => nonce + 1);
          }, retryDelay);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [livePortfolios, liveStateReady, liveStateSaveRetryNonce, liveWatchlist]);

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
    liveRequestRef.current = null;
    setLiveMode(false);
    setLiveContext(null);
    livePersistSignatureRef.current = "";
    setPositions([]);
    setPendingOrders([]);
    setExecutions([]);
    setOrderRejections([]);
    setDrawings([]);
    setDrawingUndoStack([]);
    setDrawingRedoStack([]);
    setClearNonce(Date.now());
    setTradingMode(appSettingsRef.current.tradingMode);
    setInitialCapital(appSettingsRef.current.initialCapital);
    setCashBalance(appSettingsRef.current.initialCapital);
    setTrashPreview(Boolean(request.preview));
    eventSequenceRef.current = 0;
    setEvents([]);
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
    const liveRequest = liveRequestRef.current;
    liveRequestRef.current = null;
    // Keep the restore/new-task precedence explicit so a newer random round
    // still invalidates an older load, while live observation can override it.
    let requestInstrumentId = restoreRequest?.instrumentId ?? newTaskRequest?.instrumentId ?? instrumentId;
    if (liveRequest) requestInstrumentId = liveRequest.instrumentId;
    const requestTimeframe = liveRequest ? "1d" : restoreRequest?.timeframe ?? newTaskRequest?.timeframe ?? timeframe;
    setLoading(true);
    setChartLoadError("");
    setTrainingReady(false);
    setPlaying(false);
    setShowRandomComplete(false);
    setDecisionTarget(null);
    setEditingDecisionId("");
    decisionDraftBeforeBackfillRef.current = null;
    saveCompletedTrainingRef.current = false;
    try {
      const requestedSnapshotId = restoreRequest?.state.dataSnapshotId
        ?? newTaskRequest?.snapshotId;
      let data: {
        instrument: Instrument;
        candles: KLineData[];
        snapshot: SnapshotMeta;
        window?: { startIndex: number; endIndex: number; barCount: number; snapshotBarCount: number; isPartial: boolean };
      };
      if (requestedSnapshotId) {
        const snapshotUrl = new URL("/api/snapshots", window.location.origin);
        snapshotUrl.searchParams.set("id", requestedSnapshotId);
        const persistedTask = restoreRequest?.state.trainingTask;
        if (persistedTask?.historyBars != null
          && Number.isFinite(persistedTask.startTimestamp)
          && Number.isFinite(persistedTask.endTimestamp)) {
          snapshotUrl.searchParams.set("startTimestamp", String(persistedTask.startTimestamp));
          snapshotUrl.searchParams.set("endTimestamp", String(persistedTask.endTimestamp));
          snapshotUrl.searchParams.set("lookbackBars", String(normalizeReplayHistoryBars(persistedTask.historyBars)));
        }
        const response = await fetch(`${snapshotUrl.pathname}${snapshotUrl.search}`, {
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
      }
      if (marketLoadRef.current.id !== requestId) return;
      const loadedDataIndexOffset = data.window?.startIndex ?? 0;
      setInstrument(data.instrument);
      setBars(data.candles);
      setSnapshotDataIndexOffset(loadedDataIndexOffset);
      setDataSnapshotId(data.snapshot.id);
      setSnapshotHash(data.snapshot.contentHash);
      const loadedMarketRules = restoreRequest?.state.marketRules
        ?? resolveMarketRules(data.instrument.market, data.instrument.id);
      setMarketRules(loadedMarketRules);
      setRuleNotice("");
      if (liveRequest) {
        setTrashPreview(false);
        const savedPortfolio = livePortfoliosRef.current.find((portfolio) => portfolio.instrumentId === liveRequest.instrumentId);
        const liveCursor = data.candles.length - 1;
        setLiveMode(true);
        setLiveContext({ ...liveRequest, timestamp: data.candles[liveCursor]?.timestamp ?? liveRequest.timestamp, close: data.candles[liveCursor]?.close ?? liveRequest.close });
        setCursor(Math.max(0, liveCursor));
        setTrainingTask(null);
        setPositions(savedPortfolio?.positions ?? []);
        setPendingOrders(savedPortfolio?.pendingOrders ?? []);
        setExecutions(savedPortfolio?.executions ?? []);
        setOrderRejections(savedPortfolio?.orderRejections ?? []);
        setDecision(savedPortfolio?.decision
          ? { ...defaultDecision, ...savedPortfolio.decision, reasons: [...savedPortfolio.decision.reasons] }
          : defaultDecision);
        setDecisionSubmissions(savedPortfolio?.decisionSubmissions?.map((submission) => ({
          ...submission,
          decision: { ...submission.decision, reasons: [...submission.decision.reasons] },
        })) ?? []);
        setSelectedDecisionId("");
        setDecisionTarget(null);
        setEditingDecisionId("");
        setOrderQty(normalizeBuyQuantity(loadedMarketRules, appSettingsRef.current.defaultOrderQty));
        setTradingMode(savedPortfolio?.tradingMode ?? appSettingsRef.current.tradingMode);
        setInitialCapital(savedPortfolio?.initialCapital ?? appSettingsRef.current.initialCapital);
        setCashBalance(savedPortfolio?.cashBalance ?? savedPortfolio?.initialCapital ?? appSettingsRef.current.initialCapital);
        setDrawings([]);
        setDrawingUndoStack([]);
        setDrawingRedoStack([]);
        setClearNonce(Date.now());
        setSessionId(createUuid());
        setRandomSeed(createUuid());
        eventSequenceRef.current = 0;
        setEvents([]);
        setSaveState("Live observation · not saved as training");
      } else if (restoreRequest) {
        const isTrashPreview = Boolean(restoreRequest.preview);
        setTrashPreview(isTrashPreview);
        setLiveMode(false);
        setLiveContext(null);
        const timestampCursor = restoreRequest.state.cursorTimestamp == null
          ? -1
          : data.candles.findIndex((bar) => bar.timestamp === restoreRequest.state.cursorTimestamp);
        const previousDataIndexOffset = restoreRequest.state.dataIndexOffset ?? 0;
        const restoredCursor = timestampCursor >= 0
          ? timestampCursor
          : restoreRequest.state.cursor + previousDataIndexOffset - loadedDataIndexOffset;
        const safeRestoredCursor = Math.max(0, Math.min(data.candles.length - 1, restoredCursor));
        setCursor(safeRestoredCursor);
        setPositions(restoreRequest.state.positions);
        setPendingOrders(restoreRequest.state.pendingOrders);
        setExecutions(restoreRequest.state.executions);
        setOrderRejections(restoreRequest.state.orderRejections);
        setDecision(restoreRequest.state.decision);
        setDecisionSubmissions(restoreRequest.state.decisionSubmissions.map((submission) => {
          const timestampIndex = data.candles.findIndex((bar) => bar.timestamp === submission.barTimestamp);
          const rebasedCursor = timestampIndex >= 0
            ? timestampIndex
            : submission.cursor + previousDataIndexOffset - loadedDataIndexOffset;
          return {
            ...submission,
            cursor: Math.max(0, Math.min(data.candles.length - 1, rebasedCursor)),
            recordedAtCursor: submission.recordedAtCursor == null
              ? undefined
              : Math.max(0, submission.recordedAtCursor + previousDataIndexOffset - loadedDataIndexOffset),
          };
        }));
        setSelectedDecisionId("");
        setDecisionTarget(null);
        setEditingDecisionId("");
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
          ? rebaseTrainingTaskToBars(restoreRequest.state.trainingTask, data.candles)
          : createLegacyTrainingTask(data.candles, safeRestoredCursor);
        setTrainingTask(isTrashPreview ? restoredTask : finishTask(restoredTask, safeRestoredCursor));
        const lastSequence = restoreRequest.state.events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
        eventSequenceRef.current = lastSequence + 1;
        setEvents(isTrashPreview
          ? restoreRequest.state.events
          : [
            ...restoreRequest.state.events,
            createTrainingEvent(lastSequence + 1, "session_restored", data.candles[safeRestoredCursor]?.timestamp, {
              snapshotId: data.snapshot.id,
              snapshotHash: data.snapshot.contentHash,
              marketRuleId: loadedMarketRules.id,
              marketRuleVersion: loadedMarketRules.version,
            }),
          ]);
        setSaveState(isTrashPreview ? "回收站查看 · 未恢复" : "已恢复保存点");
      } else {
        setTrashPreview(false);
        setLiveMode(false);
        setLiveContext(null);
        const nextSessionId = createUuid();
        const nextSeed = createUuid();
        const nextTask = resolveTrainingTask(
          {
            ...(newTaskRequest?.draft ?? defaultTrainingTaskDraft),
            historyBars: appSettingsRef.current.replayHistoryBars,
          },
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
        setEditingDecisionId("");
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
          patternFilter: nextTask.patternFilter,
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
    if (trashPreview || !trainingReady || !trainingComplete || !saveCompletedTrainingRef.current) return;
    saveCompletedTrainingRef.current = false;
    setSaveState("训练完成 · 正在保存…");
    void persistTrainingState(trainingState, "训练完成 · 已保存");
  }, [persistTrainingState, trainingComplete, trainingReady, trainingState, trashPreview]);

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
      const priceBand = liveMode
        ? null
        : order.priceBand ?? replayPriceBand(marketRules, bars, cursor, instrument.timezone, timeframe);
      const fillValidation: RuleValidation = liveMode
        ? { ok: true }
        : validateMarketFill(marketRules, order.side, bar.open, priceBand);
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
  }, [appendEvent, bars, cashBalance, cursor, instrument.timezone, liveMode, marketRules, positions, timeframe, tradingMode]);

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
      setEditingDecisionId("");
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
    if (!currentBar || qty <= 0 || (!liveMode && (cursor >= (trainingTask?.endCursor ?? bars.length - 1) || trainingComplete))) return;
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
    if (liveMode) {
      setRuleNotice("");
      setPendingOrders((items) => [...items, order]);
      appendEvent("order_queued", {
        order,
        marketRuleId: marketRules.id,
        marketRuleVersion: marketRules.version,
        tradingMode,
        initialCapital,
        liveFillRule: "next_session_open",
      }, currentBar.timestamp);
      setOrderPanelTab("pending");
      setSaveState("实盘委托已挂出，下一交易日开盘成交");
      return;
    }
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
    if (!currentBar || (!liveMode && (cursor >= (trainingTask?.endCursor ?? bars.length - 1) || trainingComplete))) return;
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
    if (liveMode) {
      setRuleNotice("");
      setPendingOrders((items) => [...items, order]);
      appendEvent("order_queued", {
        order,
        position,
        marketRuleId: marketRules.id,
        marketRuleVersion: marketRules.version,
        liveFillRule: "next_session_open",
      }, currentBar.timestamp);
      setOrderPanelTab("pending");
      setSaveState("平仓委托已挂出，下一交易日开盘成交");
      return;
    }
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
    if (liveMode) {
      const position = openPositions.find((item) => item.id === positionId);
      if (!position || pendingOrders.some((order) => order.action === "close" && order.positionId === positionId)) return;
      // A locked A-share lot cannot be sold on the current session, but it
      // can still be queued now for the next session's opening auction.
      const order: PendingOrder = {
        id: createUuid(),
        action: "close",
        side: position.side === "long" ? "sell" : "buy",
        qty: position.qty,
        createdAt: currentBar.timestamp,
        positionId,
        ruleId: marketRules.id,
        ruleVersion: marketRules.version,
        priceBand: replayPriceBand(marketRules, bars, cursor, instrument.timezone, timeframe),
      };
      setRuleNotice("");
      setPendingOrders((items) => [...items, order]);
      appendEvent("order_queued", {
        order,
        position,
        marketRuleId: marketRules.id,
        marketRuleVersion: marketRules.version,
        liveFillRule: "next_session_open",
        deferredBecause: "t_plus_one_locked",
      }, currentBar.timestamp);
      setOrderPanelTab("pending");
      setSaveState("已挂出次日开盘平仓委托，可在成交前撤单");
      return;
    }
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
    liveRequestRef.current = null;
    setLiveMode(false);
    setLiveContext(null);
    livePersistSignatureRef.current = "";
    setPositions([]);
    setPendingOrders([]);
    setExecutions([]);
    setOrderRejections([]);
    setDrawings([]);
    setDrawingUndoStack([]);
    setDrawingRedoStack([]);
    setClearNonce(Date.now());
    setTradingMode(appSettingsRef.current.tradingMode);
    setInitialCapital(appSettingsRef.current.initialCapital);
    setCashBalance(appSettingsRef.current.initialCapital);
    setTrashPreview(false);
    eventSequenceRef.current = 0;
    setEvents([]);
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

  const waitForCnLiveUpdate = async () => {
    const start = await fetch("/api/cn-maintenance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", mode: "incremental" }),
    });
    const started = await start.json() as { maintenanceTask?: { status?: string; message?: string; error?: string }; error?: string };
    if (!start.ok && !/正在运行/.test(started.error ?? "")) throw new Error(started.error ?? "A 股增量更新启动失败");
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const response = await fetch("/api/cn-maintenance", { cache: "no-store" });
      const payload = await response.json() as { maintenanceTask?: { status?: string; message?: string; error?: string }; error?: string };
      const task = payload.maintenanceTask;
      setLiveScanStatus(task?.message ?? "正在核对 A 股最新交易日……");
      if (!response.ok) throw new Error(payload.error ?? "无法读取 A 股更新进度");
      if (!task || task.status === "completed") return;
      if (task.status === "failed" || task.status === "paused") throw new Error(task.error ?? task.message ?? "A 股增量更新未完成");
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
    throw new Error("A 股增量更新等待超时，请到数据页查看任务状态");
  };

  const runUsLiveUpdate = async (instrumentIds?: string[]) => {
    const response = await fetch("/api/data-jobs/market/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        market: "US",
        mode: "update",
        ...(instrumentIds?.length ? { instrumentIds } : {}),
      }),
    });
    const payload = await response.json() as {
      run?: {
        id: string;
        status: string;
        completedSymbols: number;
        totalSymbols: number;
        completedBatches: number;
        totalBatches: number;
        insertedCount: number;
        failedSymbols: number;
        skippedSymbols: number;
      };
      error?: string;
    };
    if (!response.ok || !payload.run) throw new Error(payload.error ?? "美股最新日线批量同步失败");
    const runId = payload.run.id;
    let workerFailures = 0;
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      let worker: Response | null = null;
      let next: {
        run?: typeof payload.run;
        error?: string;
      } | null = null;
      try {
        worker = await fetch("/api/data-jobs/market/sync/worker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId }),
        });
        next = await worker.json();
      } catch (error) {
        workerFailures += 1;
        if (workerFailures >= 5) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      if (!worker || !worker.ok || !next?.run) {
        workerFailures += 1;
        if (workerFailures >= 5) throw new Error(next?.error ?? "美股最新日线批次执行失败");
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      workerFailures = 0;
      const failed = next.run.failedSymbols
        ? "，失败 " + next.run.failedSymbols.toLocaleString() + " 个"
        : "";
      setLiveScanStatus(
        "美股最新日线同步：" +
        next.run.completedSymbols.toLocaleString() + " / " +
        next.run.totalSymbols.toLocaleString() + " 个品种，写入 " +
        next.run.insertedCount.toLocaleString() + " 根" + failed,
      );
      if (["completed", "completed_with_errors", "cancelled", "paused"].includes(next.run.status)) return;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    throw new Error("美股最新日线同步等待超时，请到数据页查看任务状态");
  };

  const refreshLivePortfolioPrices = async () => {
    const portfolios = livePortfoliosRef.current;
    const watchlist = liveWatchlistRef.current;
    const tracked = [...portfolios, ...watchlist];
    if (!tracked.length) {
      setLivePriceRefreshStatus("暂无可同步的实盘标的");
      return;
    }
    setLivePriceRefreshRunning(true);
    setLivePriceRefreshStatus("正在读取最新价…");
    try {
      const pricesById = new Map<string, { timestamp: number; open: number; close: number }>();
      const errors: string[] = [];
      const usInstrumentIds = [...new Set(
        tracked.filter((item) => item.market === "US").map((item) => item.instrumentId),
      )];
      if (usInstrumentIds.length) {
        setLivePriceRefreshStatus("姝ｅ湪鏇存柊缇庤偂鏈€鏂颁氦鏄撴棩鈥︹€?");
        try {
          await runUsLiveUpdate(usInstrumentIds);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "缇庤偂鏈€鏂版棩绾挎洿鏂板け璐?");
        }
      }
      for (const market of ["CN", "US"] as LiveScanMarket[]) {
        const instrumentIds = [...new Set(tracked.filter((item) => item.market === market).map((item) => item.instrumentId))];
        if (!instrumentIds.length) continue;
        try {
          const response = await fetch("/api/live-scan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "refresh",
              market,
              instrumentIds,
            }),
          });
          if (!response.ok) {
            const failure = await response.json().catch(() => null) as { error?: unknown } | null;
            errors.push(typeof failure?.error === "string"
              ? failure.error
              : `${market === "CN" ? "A 股" : "美股"}最新价同步失败`);
            continue;
          }
          const payload = await response.json() as { prices?: Array<{ instrumentId: string; timestamp: number; open: number; close: number }> };
          for (const price of payload.prices ?? []) {
            if (Number.isFinite(price.timestamp) && Number.isFinite(price.open) && Number.isFinite(price.close)) {
              pricesById.set(price.instrumentId, {
                timestamp: Number(price.timestamp),
                open: Number(price.open),
                close: Number(price.close),
              });
            }
          }
        } catch (error) {
          errors.push(error instanceof Error
            ? error.message
            : `${market === "CN" ? "A 股" : "美股"}最新价同步失败`);
        }
      }
      if (!pricesById.size) {
        setLivePriceRefreshStatus(errors.length ? `同步失败：${errors.join("；")}` : "暂无可用的更新行情");
        return;
      }
      const syncedInstrumentIds = new Set<string>();
      const nextPortfolios = portfolios.map((portfolio) => {
        const price = pricesById.get(portfolio.instrumentId);
        if (!price) return portfolio;
        syncedInstrumentIds.add(portfolio.instrumentId);
        const isNewBar = price.timestamp > portfolio.latestTimestamp;
        let nextPositions = portfolio.positions;
        let nextPendingOrders = portfolio.pendingOrders;
        let nextExecutions = portfolio.executions;
        let nextRejections = portfolio.orderRejections;
        let nextCashBalance = portfolio.cashBalance;
        if (isNewBar && portfolio.pendingOrders.length) {
          const fills: Execution[] = [];
          const rejections: OrderRejection[] = [];
          nextPositions = [...portfolio.positions];
          nextPendingOrders = [];
          nextExecutions = [...portfolio.executions];
          nextRejections = [...portfolio.orderRejections];
          for (const order of portfolio.pendingOrders) {
            if (order.createdAt >= price.timestamp) {
              nextPendingOrders.push(order);
              continue;
            }
            if (order.action === "open") {
              const cashFlow = executionCashFlow(order.side, price.open, order.qty);
              if (portfolio.tradingMode === "capital" && cashFlow < 0 && nextCashBalance + cashFlow < -0.000001) {
                rejections.push(createOrderRejection({
                  ok: false,
                  code: "insufficient_cash_at_fill",
                  message: `下一交易日开盘需要 ${Math.abs(cashFlow).toFixed(2)}，可用资金仅 ${nextCashBalance.toFixed(2)}`,
                }, marketRules, price.timestamp, order.id));
                continue;
              }
              nextPositions.push({
                id: order.positionId,
                side: order.side === "buy" ? "long" : "short",
                qty: order.qty,
                entryPrice: price.open,
                entryTimestamp: price.timestamp,
                entryOrderId: order.id,
                status: "open",
              });
              fills.push({
                id: createUuid(), orderId: order.id, positionId: order.positionId,
                action: "open", side: order.side, qty: order.qty, price: price.open,
                timestamp: price.timestamp, realizedPnl: 0,
                ruleId: order.ruleId ?? marketRules.id,
                ruleVersion: order.ruleVersion ?? marketRules.version,
              });
              if (portfolio.tradingMode === "capital") nextCashBalance += cashFlow;
              continue;
            }
            const positionIndex = nextPositions.findIndex((position) => position.id === order.positionId && position.status === "open");
            if (positionIndex < 0) continue;
            const position = nextPositions[positionIndex];
            const realized = (price.open - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1);
            nextPositions[positionIndex] = {
              ...position,
              status: "closed",
              exitPrice: price.open,
              exitTimestamp: price.timestamp,
              exitOrderId: order.id,
              realizedPnl: realized,
            };
            fills.push({
              id: createUuid(), orderId: order.id, positionId: position.id,
              action: "close", side: order.side, qty: position.qty, price: price.open,
              timestamp: price.timestamp, realizedPnl: realized,
              ruleId: order.ruleId ?? marketRules.id,
              ruleVersion: order.ruleVersion ?? marketRules.version,
            });
            if (portfolio.tradingMode === "capital") nextCashBalance += executionCashFlow(order.side, price.open, position.qty);
          }
          nextExecutions.push(...fills);
          nextRejections.push(...rejections);
        }
        return {
          ...portfolio,
          latestTimestamp: price.timestamp,
          latestClose: price.close,
          positions: nextPositions,
          pendingOrders: nextPendingOrders,
          executions: nextExecutions,
          orderRejections: nextRejections,
          cashBalance: nextCashBalance,
          updatedAt: new Date().toISOString(),
        };
      });
      livePortfoliosRef.current = nextPortfolios;
      setLivePortfolios(nextPortfolios);
      const nextWatchlist = watchlist.map((watch) => {
        // Keep the observation baseline fixed at the original observation day.
        // Watchlist performance is not a simulated next-session trade.
        const observationClose = liveWatchObservationPrice(watch);
        const observationTimestamp = liveWatchObservationTimestamp(watch);
        const price = pricesById.get(watch.instrumentId);
        const migratedWatch = {
          ...watch,
          observationTimestamp,
          observationClose,
        };
        return price
          ? (syncedInstrumentIds.add(watch.instrumentId), { ...migratedWatch, latestTimestamp: price.timestamp, latestClose: price.close, updatedAt: new Date().toISOString() })
          : migratedWatch;
      });
      liveWatchlistRef.current = nextWatchlist;
      setLiveWatchlist(nextWatchlist);
      if (liveMode && liveContext) {
        const price = pricesById.get(liveContext.instrumentId);
        if (price && (price.timestamp !== liveContext.timestamp || price.close !== liveContext.close)) {
          const updated = { ...liveContext, timestamp: price.timestamp, close: price.close };
          setLiveContext(updated);
          liveRequestRef.current = updated;
          setLoadNonce((value) => value + 1);
        }
      }
      setLivePriceRefreshStatus(`已同步 ${syncedInstrumentIds.size} 个标的${errors.length ? `；${errors.join("；")}` : ""}`);
    } catch (error) {
      setLivePriceRefreshStatus(error instanceof Error ? `同步失败：${error.message}` : "同步失败");
    } finally {
      setLivePriceRefreshRunning(false);
    }
  };

  const startLiveScan = async (skipUpdate = false) => {
    setLiveScanRunning(true);
    setLiveScanError("");
    setLiveScanData(null);
    try {
      if (!skipUpdate) {
        setLiveScanStatus(liveScanMarket === "CN" ? "正在检查并拉取 A 股最新交易日……" : "正在检查并拉取美股最新交易日……");
        if (liveScanMarket === "CN") await waitForCnLiveUpdate();
        else await runUsLiveUpdate();
      }
      setLiveScanStatus("行情已就绪，正在本机扫描最新一根日 K……");
      const response = await fetch("/api/live-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          market: liveScanMarket,
          presetIds: liveScanPresetIds,
          presets: patternPresets,
          filters: {
            ...(liveScanMinPrice ? { minPrice: Number(liveScanMinPrice) } : {}),
            ...(liveScanMaxPrice ? { maxPrice: Number(liveScanMaxPrice) } : {}),
            ...(liveScanMinVolume ? { minAverageVolume: Number(liveScanMinVolume) } : {}),
          },
          sort: liveScanSort,
          limit: liveScanLimit,
        }),
      });
      const result = await response.json() as LiveScanResponse;
      if (!response.ok) throw new Error(result.error ?? "实盘筛选失败");
      setLiveScanData(result);
      await refreshLivePortfolioPrices();
      setLivePortfolios((items) => items.map((portfolio) => {
        const updated = result.results.find((item) => item.instrumentId === portfolio.instrumentId);
        return updated
          ? { ...portfolio, latestTimestamp: updated.timestamp, latestClose: updated.close, presetIds: updated.presetIds, presetNames: updated.presetNames, updatedAt: new Date().toISOString() }
          : portfolio;
      }));
      if (liveMode && liveContext) {
        const updated = result.results.find((item) => item.instrumentId === liveContext.instrumentId);
        if (updated) {
          setLiveContext((current) => current
            ? { ...current, presetIds: updated.presetIds, presetNames: updated.presetNames }
            : current);
        }
      }
      setLiveScanStatus(`已扫描 ${result.scannedCount.toLocaleString()} 个品种，命中 ${result.matchedCount.toLocaleString()} 个。`);
    } catch (error) {
      setLiveScanError(error instanceof Error ? error.message : "实盘筛选失败");
      setLiveScanStatus("");
    } finally {
      setLiveScanRunning(false);
    }
  };

  const getLiveNavigatorResults = (source: LiveNavigatorSource): LiveScanResult[] => {
    // Use the same render-order lists as the performance page.  The refs can
    // briefly lag a state update, which makes an opened row look like index 0
    // even when it is not the first visible row.
    if (source === "portfolio") return livePortfolios.map(livePortfolioResult);
    if (source === "watch") return liveWatchlist.map(liveWatchResult);
    return liveScanData?.results ?? [];
  };

  const openLiveScanResult = (result: LiveScanResult, index?: number, source: LiveNavigatorSource = "scan") => {
    const switchingInstrument = !liveMode || liveContext?.instrumentId !== result.instrumentId;
    if (switchingInstrument) {
      // Do not let the previous replay/live symbol remain visible while its
      // snapshot is loading. The live portfolio for the target symbol is
      // restored by loadBars from the symbol-keyed ledger.
      setPositions([]);
      setPendingOrders([]);
      setExecutions([]);
      setOrderRejections([]);
      setDrawings([]);
      setDrawingUndoStack([]);
      setDrawingRedoStack([]);
      setClearNonce((nonce) => nonce + 1);
      setTradingMode(appSettingsRef.current.tradingMode);
      setInitialCapital(appSettingsRef.current.initialCapital);
      setCashBalance(appSettingsRef.current.initialCapital);
      eventSequenceRef.current = 0;
      setEvents([]);
      setDecision(defaultDecision);
      setDecisionSubmissions([]);
      setSelectedDecisionId("");
      setDecisionTarget(null);
      setEditingDecisionId("");
      setOrderPanelTab("positions");
    }
    livePersistSignatureRef.current = "";
    setShowLiveScan(false);
    const sourceResults = getLiveNavigatorResults(source);
    // Instrument identity is authoritative.  A numeric index can come from
    // another view whose ordering has changed since the row was rendered.
    const identityIndex = sourceResults.findIndex((item) => item.instrumentId === result.instrumentId);
    const resolvedIndex = identityIndex >= 0 ? identityIndex : (index ?? -1);
    const nextIndex = sourceResults.length
      ? Math.min(sourceResults.length - 1, Math.max(0, resolvedIndex >= 0 ? resolvedIndex : 0))
      : Math.max(0, resolvedIndex >= 0 ? resolvedIndex : 0);
    setLiveNavigatorSource(source);
    setLiveScanIndex(nextIndex);
    setLiveNavigatorResume({ source, index: nextIndex, instrumentId: result.instrumentId });
    if (source === "scan") setLiveScanResume({ index: nextIndex, instrumentId: result.instrumentId });
    restoreRequestRef.current = null;
    newTaskRequestRef.current = null;
    liveRequestRef.current = result;
    setInstrumentId(result.instrumentId);
    setTimeframe("1d");
    setLiveMode(true);
    setLiveContext(result);
    setView("replay");
    setLoadNonce((value) => value + 1);
  };

  const openLivePortfolio = (portfolio: LivePortfolioRecord) => {
    const index = livePortfolios.findIndex((item) => item.instrumentId === portfolio.instrumentId);
    openLiveScanResult(livePortfolioResult(portfolio), index >= 0 ? index : undefined, "portfolio");
  };

  const reviewLivePortfolios = () => {
    const results = livePortfolios.map(livePortfolioResult);
    if (!results.length) {
      setRuleNotice("暂无可审阅的实盘观察标的");
      return;
    }
    const currentIndex = liveContext
      ? results.findIndex((result) => result.instrumentId === liveContext.instrumentId)
      : -1;
    const nextIndex = currentIndex >= 0 ? currentIndex : 0;
    openLiveScanResult(results[nextIndex], nextIndex, "portfolio");
  };

  const liveWatchExists = Boolean(liveContext && liveWatchlist.some((item) => item.instrumentId === liveContext.instrumentId));
  const addLiveWatch = () => {
    if (!liveMode || !liveContext || !currentBar) return;
    const observationPrice = Number.isFinite(currentBar.open) && currentBar.open > 0
      ? currentBar.open
      : currentBar.close;
    const nextRecord: LiveWatchRecord = {
      id: `watch:${liveContext.instrumentId}`,
      instrumentId: liveContext.instrumentId,
      symbol: liveContext.symbol,
      name: liveContext.name,
      market: liveContext.market,
      latestTimestamp: currentBar.timestamp,
      latestClose: currentBar.close,
      observationTimestamp: currentBar.timestamp,
      observationClose: observationPrice,
      scanTimestamp: liveContext.timestamp,
      presetIds: liveContext.presetIds,
      presetNames: liveContext.presetNames,
      updatedAt: new Date().toISOString(),
    };
    setLiveWatchlist((items) => [nextRecord, ...items.filter((item) => item.instrumentId !== nextRecord.instrumentId)].slice(0, 500));
    setRuleNotice("已加入实盘观望，不会计入训练或实盘交易表现");
    setSaveState("实盘观望已记录");
  };

  const removeLiveWatch = (instrumentId: string) => {
    setLiveWatchlist((items) => items.filter((item) => item.instrumentId !== instrumentId));
  };

  const moveLiveScanResult = (direction: -1 | 1) => {
    const results = getLiveNavigatorResults(liveNavigatorSource);
    if (!results.length) return;
    const activeInstrumentId = liveContext?.instrumentId
      ?? (liveNavigatorResume.source === liveNavigatorSource ? liveNavigatorResume.instrumentId : undefined);
    const savedIndex = activeInstrumentId
      ? results.findIndex((result) => result.instrumentId === activeInstrumentId)
      : -1;
    const currentIndex = savedIndex >= 0
      ? savedIndex
      : Math.min(results.length - 1, Math.max(0, liveScanIndex));
    const nextIndex = (currentIndex + direction + results.length) % results.length;
    openLiveScanResult(results[nextIndex], nextIndex, liveNavigatorSource);
  };

  const restoreLiveScan = () => {
    const results = liveScanData?.results ?? [];
    if (!results.length) {
      setLiveScanStatus("暂无可恢复的筛选结果，请先运行一次筛选");
      return;
    }
    const savedIndex = liveScanResume.instrumentId
      ? results.findIndex((result) => result.instrumentId === liveScanResume.instrumentId)
      : -1;
    const nextIndex = savedIndex >= 0
      ? savedIndex
      : Math.min(results.length - 1, Math.max(0, liveScanResume.index));
    openLiveScanResult(results[nextIndex], nextIndex, "scan");
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
    setEditingDecisionId("");
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
    setSaveState("新训练 · 尚未保存");
  };

  const saveSession = async () => {
    if (trashPreview) {
      setSaveState("回收站查看模式不会保存训练");
      return;
    }
    if (liveMode) {
      const hasContent = hasDecisionContent(decision, decisionSubmissions);
      if (liveContext && currentBar && hasContent) {
        const savedAt = new Date().toISOString();
        const nextRecord: LivePortfolioRecord = {
          id: liveContext.instrumentId,
          instrumentId: liveContext.instrumentId,
          symbol: liveContext.symbol,
          name: liveContext.name,
          market: liveContext.market,
          latestTimestamp: currentBar.timestamp,
          latestClose: currentBar.close,
          scanTimestamp: liveContext.timestamp,
          presetIds: liveContext.presetIds,
          presetNames: liveContext.presetNames,
          positions,
          pendingOrders,
          executions,
          orderRejections,
          tradingMode,
          initialCapital,
          cashBalance,
          decision: { ...decision, reasons: [...decision.reasons] },
          decisionSubmissions: decisionSubmissions.map((submission) => ({
            ...submission,
            decision: { ...submission.decision, reasons: [...submission.decision.reasons] },
          })),
          updatedAt: savedAt,
        };
        livePersistSignatureRef.current = JSON.stringify(nextRecord);
        setLivePortfolios((items) => [
          nextRecord,
          ...items.filter((item) => item.instrumentId !== nextRecord.instrumentId),
        ].slice(0, 500));
      }
      setSaveState(hasContent ? "实盘决策已保存" : "实盘观察已保存");
      return;
    }
    setSaveState("保存中…");
    const savedEvent = appendEvent("session_manually_saved");
    await persistTrainingState({
      ...trainingState,
      events: [...trainingState.events, savedEvent],
    }, "已手动保存");
  };

  const resumeSession = (session: TrainingSession, preview = false) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) throw new Error("invalid session");
      setReviewedSession(null);
      queueRestore({ ...session, state, preview });
    } catch {
      setImportStatus(preview ? "这条训练记录不完整，无法查看训练。" : "这条训练记录不完整，暂时无法恢复。");
    }
  };

  const resumeCurrentTraining = () => {
    setShowRandomComplete(false);
    const now = new Date().toISOString();
    resumeSession({
      id: sessionId,
      instrumentId,
      timeframe,
      dataSnapshotId: dataSnapshotId || undefined,
      stateJson: JSON.stringify(trainingState),
      createdAt: now,
      updatedAt: now,
    });
  };

  const deleteSession = async (session: TrainingSession) => {
    if (!window.confirm(`确定将 ${session.instrumentId} · ${session.timeframe} 的这次训练移入回收站吗？`)) return;
    const response = await fetch(`/api/sessions?id=${encodeURIComponent(session.id)}`, { method: "DELETE" });
    if (!response.ok) {
      setImportStatus("训练记录移入回收站失败。");
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
      setSaveState("原训练已移入回收站，已开始一场新的空白训练");
    }
  };

  const updateDecision = (field: keyof Decision, value: string | string[]) => {
    const nextDecision = { ...decision, [field]: value } as Decision;
    setDecision(nextDecision);
    setSaveState("决策草稿已更新");
  };

  const commitReasonTags = (value: string[]) => {
    const nextTags = normalizeReasonTags(value);
    setReasonTags(nextTags);
    setCustomReasonTags(nextTags.filter((tag) => !reasonOptions.includes(tag)));
  };

  const addCustomReasonTag = () => {
    const nextTag = customReasonInput.trim().replace(/\s+/g, " ").slice(0, 20);
    if (!nextTag) return;
    if (!reasonTags.includes(nextTag)) commitReasonTags([...reasonTags, nextTag].slice(-30));
    if (!decision.reasons.includes(nextTag)) updateDecision("reasons", [...decision.reasons, nextTag]);
    setCustomReasonInput("");
  };

  const startEditReasonTag = (tag: string) => {
    setEditingReasonTag(tag);
    setEditingReasonInput(tag);
  };

  const cancelEditReasonTag = () => {
    setEditingReasonTag("");
    setEditingReasonInput("");
  };

  const saveReasonTagEdit = () => {
    const previousTag = editingReasonTag;
    const nextTag = editingReasonInput.trim().replace(/\s+/g, " ").slice(0, 20);
    if (!previousTag || !nextTag) return;
    if (reasonTags.some((tag) => tag !== previousTag && tag === nextTag)) {
      setSaveState("标签不能为空，也不能与已有标签重名");
      return;
    }
    if (nextTag === previousTag) {
      cancelEditReasonTag();
      return;
    }
    commitReasonTags(reasonTags.map((tag) => tag === previousTag ? nextTag : tag));
    setDecision((current) => ({
      ...current,
      reasons: current.reasons.map((reason) => reason === previousTag ? nextTag : reason),
    }));
    if (decisionDraftBeforeBackfillRef.current) {
      decisionDraftBeforeBackfillRef.current = {
        ...decisionDraftBeforeBackfillRef.current,
        reasons: decisionDraftBeforeBackfillRef.current.reasons.map((reason) => reason === previousTag ? nextTag : reason),
      };
    }
    const affectedSubmissionCount = decisionSubmissions.filter((submission) => submission.decision.reasons.includes(previousTag)).length;
    setDecisionSubmissions((items) => items.map((submission) => submission.decision.reasons.includes(previousTag)
      ? {
        ...submission,
        decision: {
          ...submission.decision,
          reasons: submission.decision.reasons.map((reason) => reason === previousTag ? nextTag : reason),
        },
      }
      : submission));
    appendEvent("reason_tag_updated", {
      previousTag,
      nextTag,
      affectedSubmissionCount,
    });
    cancelEditReasonTag();
    setSaveState(`交易理由标签已改为“${nextTag}” · 已同步 ${affectedSubmissionCount} 份历史决策`);
  };

  const deleteReasonTag = (tag: string) => {
    if (!window.confirm(`确定删除交易理由标签“${tag}”吗？历史决策会保留原文字，不会被篡改。`)) return;
    commitReasonTags(reasonTags.filter((item) => item !== tag));
    setDecision((current) => ({
      ...current,
      reasons: current.reasons.filter((reason) => reason !== tag),
    }));
    if (decisionDraftBeforeBackfillRef.current) {
      decisionDraftBeforeBackfillRef.current = {
        ...decisionDraftBeforeBackfillRef.current,
        reasons: decisionDraftBeforeBackfillRef.current.reasons.filter((reason) => reason !== tag),
      };
    }
    if (editingReasonTag === tag) cancelEditReasonTag();
    appendEvent("reason_tag_deleted", { tag });
    setSaveState(`交易理由标签“${tag}”已删除 · 历史决策保留原记录`);
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
    setEditingDecisionId("");
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
    setEditingDecisionId("");
    setSaveState("已取消补写，原决策草稿已恢复");
  };

  const editDecision = useCallback((submission: DecisionSubmission) => {
    const targetBar = bars[submission.cursor] ?? bars.find((bar) => bar.timestamp === submission.barTimestamp);
    const targetCursor = targetBar ? bars.indexOf(targetBar) : submission.cursor;
    if (!targetBar || targetCursor < 0 || targetCursor > cursor) {
      setSaveState("这份决策对应的 K 线当前不可见，暂时无法编辑");
      return;
    }
    decisionDraftBeforeBackfillRef.current = {
      ...decision,
      reasons: [...decision.reasons],
    };
    setEditingDecisionId(submission.id);
    setDecision({ ...submission.decision, reasons: [...submission.decision.reasons] });
    setDecisionTarget({
      dataIndex: targetCursor,
      timestamp: targetBar.timestamp,
      referencePrice: targetBar.close,
    });
    setSelectedDecisionId("");
    setPlaying(false);
    setSaveState("正在编辑事前决策");
    requestAnimationFrame(() => decisionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [bars, cursor, decision]);

  const deleteDecision = (submission: DecisionSubmission) => {
    if (!window.confirm("确定删除这份决策吗？删除后会从盘面标记和复盘记录中移除，但删除事件仍会保留在训练审计日志中。")) return;
    setDecisionSubmissions((items) => items.filter((item) => item.id !== submission.id));
    if (editingDecisionId === submission.id) {
      if (decisionDraftBeforeBackfillRef.current) setDecision(decisionDraftBeforeBackfillRef.current);
      decisionDraftBeforeBackfillRef.current = null;
      setDecisionTarget(null);
      setEditingDecisionId("");
    }
    setSelectedDecisionId("");
    appendEvent("decision_deleted", {
      submissionId: submission.id,
      cursor: submission.cursor,
      decision: submission.decision,
      submittedAt: submission.submittedAt,
      backfilled: Boolean(submission.backfilled),
    }, submission.barTimestamp);
    setSaveState("决策已删除 · 请保存训练");
  };

  const submitDecision = () => {
    const editingSubmission = editingDecisionId
      ? decisionSubmissions.find((submission) => submission.id === editingDecisionId)
      : undefined;
    const backfillTarget = !editingSubmission && decisionTarget && decisionTarget.dataIndex <= cursor ? decisionTarget : null;
    const targetCursor = backfillTarget?.dataIndex ?? cursor;
    const targetBar = bars[targetCursor] ?? currentBar;
    if (!targetBar) return;
    if (editingSubmission) {
      const nextDecision: Decision = {
        ...decision,
        reasons: [...decision.reasons],
      };
      setDecisionSubmissions((items) => items.map((item) => item.id === editingSubmission.id
        ? { ...item, decision: nextDecision }
        : item));
      setSelectedDecisionId(editingSubmission.id);
      appendEvent("decision_updated", {
        submissionId: editingSubmission.id,
        cursor: editingSubmission.cursor,
        previousDecision: editingSubmission.decision,
        decision: nextDecision,
        backfilled: Boolean(editingSubmission.backfilled),
      }, editingSubmission.barTimestamp);
      decisionDraftBeforeBackfillRef.current = null;
      setDecisionTarget(null);
      setEditingDecisionId("");
      setSaveState("决策已更新 · 请保存训练");
      return;
    }
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
    const hadPositionDrawing = drawings.some((drawing) => drawing.name === "trainingPosition");
    const positionDrawing = [...nextDrawings].reverse().find((drawing) => (
      drawing.name === "trainingPosition" && drawing.points.length >= 3
    ));
    if (positionDrawing || hadPositionDrawing) {
      const targetValue = positionDrawing ? Number(positionDrawing.points[1]?.value) : NaN;
      const stopValue = positionDrawing ? Number(positionDrawing.points[2]?.value) : NaN;
      setDecision((current) => ({
        ...current,
        target: Number.isFinite(targetValue) ? targetValue.toFixed(instrument.pricePrecision) : "",
        stop: Number.isFinite(stopValue) ? stopValue.toFixed(instrument.pricePrecision) : "",
      }));
      setSaveState(positionDrawing ? "图表仓位目标与止损已同步" : "图表仓位已删除，目标与止损已清空");
    }
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
    const existingData = selected.extendData && typeof selected.extendData === "object"
      ? selected.extendData as Record<string, unknown>
      : {};
    updateDrawing(drawingId, {
      styles: { ...existing, text: { ...existingText, size } },
      extendData: { ...existingData, textBaseSize: size },
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
  const selectedDrawingTextSize = selectedDrawingStyles.text?.size ?? 18;
  const drawingTextSizeOptions = Array.from(new Set([
    12, 14, 16, 18, 22, 28, 36, 48,
    selectedDrawingTextSize,
  ])).sort((left, right) => left - right);
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
        .map((item) => {
          const market = item.market === "CN" ? "A股" : item.market === "US" ? "美股" : item.market;
          return {
            id: item.id,
            short: item.symbol,
            label: item.name,
            market,
            assetType: inferInstrumentAssetType(item.id, item.market, item.assetType),
            timeframes: (item.timeframes ?? []).filter((value) => timeframes.includes(value)),
          };
        })
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

  const loadTrashSessions = useCallback(async () => {
    setTrashLoading(true);
    setTrashError("");
    try {
      const response = await fetch("/api/sessions?trash=1&all=1", { cache: "no-store" });
      const data = await response.json() as { sessions?: TrainingSession[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "读取回收站失败");
      setTrashSessions(data.sessions ?? []);
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "读取回收站失败");
    } finally {
      setTrashLoading(false);
    }
  }, []);

  const inspectTrashedSession = (session: TrainingSession) => {
    setShowTrash(false);
    setShowSettings(false);
    resumeSession(session, true);
  };

  const restoreTrashedSession = async (session: TrainingSession) => {
    if (trashActionId) return;
    if (!window.confirm(`恢复 ${session.instrumentId} · ${session.timeframe} 这次训练吗？`)) return;
    setTrashActionId(session.id);
    setTrashError("");
    try {
      const response = await fetch(`/api/sessions?id=${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "恢复训练失败");
      setTrashSessions((items) => items.filter((item) => item.id !== session.id));
      void loadSessions(true);
      setShowTrash(false);
      setShowSettings(false);
      resumeSession(session);
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "恢复训练失败");
    } finally {
      setTrashActionId("");
    }
  };

  const permanentlyDeleteTrashedSession = async (session: TrainingSession) => {
    if (trashActionId) return;
    if (!window.confirm(`确定彻底删除 ${session.instrumentId} · ${session.timeframe} 吗？删除后无法恢复。`)) return;
    setTrashActionId(session.id);
    setTrashError("");
    try {
      const response = await fetch(`/api/sessions?id=${encodeURIComponent(session.id)}&permanent=1`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "彻底删除失败");
      setTrashSessions((items) => items.filter((item) => item.id !== session.id));
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "彻底删除失败");
    } finally {
      setTrashActionId("");
    }
  };

  const sessionSummaries = useMemo(() => sessions.flatMap((session) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) return [];
      const task = state.trainingTask;
      const {
        closedSessionPositions,
        closedTradePnls,
        closedTradeReturns,
        winningTrades,
        losingTrades,
        flatTrades,
        pnl,
        returnPct,
        realizedReturnPct,
        floatingReturnPct,
      } = trainingPnlStats(state);
      const progressSummary = task
        ? taskProgress(task, state.cursor)
        : { revealed: 0, total: 0, percent: 0 };
      const patternFilter = task?.patternFilter;
      const patternLabels = new Map(
        (patternFilter?.presetIds ?? []).map((id, index) => [id, patternFilter?.presetNames[index] ?? id]),
      );
      const attributedPatternIds = patternFilter?.matchedPresetIds.length
        ? patternFilter.matchedPresetIds
        : patternFilter?.presetIds ?? [];
      const attributedPatternNames = attributedPatternIds.map((id) => patternLabels.get(id) ?? id);
      const sortedDecisions = [...state.decisionSubmissions]
        .sort((left, right) => left.barTimestamp - right.barTimestamp);
      const habitTrades = closedSessionPositions.map((position) => {
        const decisionsBeforeEntry = sortedDecisions
          .filter((submission) => submission.barTimestamp <= position.entryTimestamp);
        const attributedDecision = decisionsBeforeEntry
          .filter((submission) => !submission.backfilled)
          .at(-1)
          ?? decisionsBeforeEntry.at(-1)
          ?? sortedDecisions.find((submission) => (
            submission.backfilled
            && submission.barTimestamp > position.entryTimestamp
            && (!position.exitTimestamp || submission.barTimestamp <= position.exitTimestamp)
          ));
        const plannedStop = Number(attributedDecision?.decision.stop);
        const plannedTarget = Number(attributedDecision?.decision.target);
        const plannedRisk = Math.abs((attributedDecision?.referencePrice ?? 0) - plannedStop);
        const plannedReward = Math.abs(plannedTarget - (attributedDecision?.referencePrice ?? 0));
        const riskReward = attributedDecision?.decision.stop.trim()
          && attributedDecision.decision.target.trim()
          && Number.isFinite(plannedRisk) && Number.isFinite(plannedReward) && plannedRisk > 0
          ? plannedReward / plannedRisk
          : undefined;
        return {
          pnl: position.realizedPnl ?? 0,
          returnPct: positionReturnPct(position, position.exitPrice ?? position.entryPrice),
          holdingBars: estimatedHoldingBars(session.timeframe, position.entryTimestamp, position.exitTimestamp),
          entryTimestamp: position.entryTimestamp,
          entryPrice: position.entryPrice,
          market: availableInstruments.find((item) => item.id === session.instrumentId)?.market
            ?? (/\.(SH|SZ|BJ)$/i.test(session.instrumentId) ? "A股" : "美股"),
          patterns: attributedPatternNames,
          decision: attributedDecision ? {
            marketState: attributedDecision.decision.marketState,
            location: attributedDecision.decision.location,
            reasons: attributedDecision.decision.reasons,
            score: decisionScore(attributedDecision.decision),
            hasStop: Boolean(attributedDecision.decision.stop.trim()),
            hasTarget: Boolean(attributedDecision.decision.target.trim()),
            hasNote: Boolean(attributedDecision.decision.note.trim()),
            riskReward,
            source: attributedDecision.backfilled ? "backfilled" : "pretrade",
          } : undefined,
        };
      });
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
        habitTrades,
      }];
    } catch {
      return [];
    }
  }), [availableInstruments, parseTrainingState, sessions]);

  useEffect(() => {
    if (view !== "performance" || !sessionSummaries.length) return;
    const groupedEntries = new Map<string, number[]>();
    sessionSummaries.forEach((summary) => {
      const snapshotId = summary.state.dataSnapshotId ?? summary.session.dataSnapshotId;
      if (!snapshotId || !summary.habitTrades.length) return;
      groupedEntries.set(snapshotId, [
        ...(groupedEntries.get(snapshotId) ?? []),
        ...summary.habitTrades.map((trade) => trade.entryTimestamp),
      ]);
    });
    const requestItems = [...groupedEntries.entries()].map(([snapshotId, entryTimestamps]) => ({
      snapshotId,
      entryTimestamps: [...new Set(entryTimestamps)],
    }));
    if (!requestItems.length) return;
    const controller = new AbortController();
    void fetch("/api/snapshots/analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: requestItems }),
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { contexts?: SnapshotTradeContextMap } | null) => {
        if (data?.contexts) setSnapshotTradeContexts(data.contexts);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [sessionSummaries, view]);

  const performanceSessionSummaries = useMemo(
    () => sessionSummaries.filter((summary) => summary.state.tradingMode === tradingMode),
    [sessionSummaries, tradingMode],
  );

  const performanceModeOptions = useMemo(
    () => [...new Set(performanceSessionSummaries.map((summary) => summary.modeLabel))],
    [performanceSessionSummaries],
  );

  const performanceMarketByInstrument = useMemo(
    () => new Map(availableInstruments.map((item) => [
      item.id,
      performanceMarketCode(item.market, item.id),
    ])),
    [availableInstruments],
  );

  const performanceMarketOptions = useMemo(() => {
    const markets = new Set<string>();
    performanceSessionSummaries.forEach((summary) => {
      markets.add(
        performanceMarketByInstrument.get(summary.session.instrumentId)
          ?? performanceMarketCode(undefined, summary.session.instrumentId),
      );
    });
    return [...markets].sort((left, right) => performanceMarketLabel(left).localeCompare(performanceMarketLabel(right), "zh-CN"));
  }, [performanceMarketByInstrument, performanceSessionSummaries]);

  const performancePatternOptions = useMemo(() => {
    const labels = new Map<string, string>();
    performanceSessionSummaries.forEach((summary) => {
      const filter = summary.task?.patternFilter;
      filter?.presetIds.forEach((id, index) => labels.set(id, filter.presetNames[index] ?? id));
    });
    return [...labels.entries()].map(([id, name]) => ({ id, name }));
  }, [performanceSessionSummaries]);

  const filteredSessionSummaries = useMemo(() => {
    const dateFrom = performanceFilters.dateFrom
      ? Date.parse(`${performanceFilters.dateFrom}T00:00:00`)
      : Number.NEGATIVE_INFINITY;
    const dateTo = performanceFilters.dateTo
      ? Date.parse(`${performanceFilters.dateTo}T23:59:59.999`)
      : Number.POSITIVE_INFINITY;
    return performanceSessionSummaries.filter((summary) => {
      const updatedAt = Date.parse(summary.session.updatedAt);
      const market = performanceMarketByInstrument.get(summary.session.instrumentId)
        ?? performanceMarketCode(undefined, summary.session.instrumentId);
      const totalResult = summary.state.tradingMode === "capital" ? summary.pnl.total : summary.returnPct;
      const outcomeMatches = performanceFilters.outcome === "all"
        || (performanceFilters.outcome === "profit" && totalResult > 0.000001)
        || (performanceFilters.outcome === "loss" && totalResult < -0.000001)
        || (performanceFilters.outcome === "flat" && Math.abs(totalResult) <= 0.000001);
      return (
        (performanceFilters.instrumentId === "all" || summary.session.instrumentId === performanceFilters.instrumentId)
        && (performanceFilters.market === "all" || market === performanceFilters.market)
        && (performanceFilters.timeframe === "all" || summary.session.timeframe === performanceFilters.timeframe)
        && (performanceFilters.modeLabel === "all" || summary.modeLabel === performanceFilters.modeLabel)
        && (
          performanceFilters.patternPresetId === "all"
          || (performanceFilters.patternPresetId === "none"
            ? !summary.task?.patternFilter?.presetIds.length
            : summary.task?.patternFilter?.presetIds.includes(performanceFilters.patternPresetId))
        )
        && (
          performanceFilters.status === "all"
          || (performanceFilters.status === "completed" ? summary.task?.status === "completed" : summary.task?.status !== "completed")
        )
        && outcomeMatches
        && updatedAt >= dateFrom
        && updatedAt <= dateTo
      );
    });
  }, [performanceFilters, performanceMarketByInstrument, performanceSessionSummaries]);

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

  const filteredPerformance = useMemo(
    () => summarizePerformance(filteredSessionSummaries.map(performanceRecord)),
    [filteredSessionSummaries, performanceRecord],
  );

  const livePerformanceRows = useMemo(() => livePortfolios
    .filter((portfolio) => {
      // A pending order is part of the live observation until it is filled or
      // explicitly cancelled.  Canceled orders are removed from
      // `pendingOrders`, so they naturally never enter this list.
      const hasOpenPosition = portfolio.positions.some((position) => position.status === "open");
      const hasNonFlatClosedTrade = portfolio.positions.some(
        (position) => position.status === "closed"
          && (Math.abs(position.realizedPnl ?? 0) > 0.000001
            || Math.abs((position.exitPrice ?? position.entryPrice) - position.entryPrice) > 0.000001),
      );
      return hasOpenPosition || hasNonFlatClosedTrade || portfolio.pendingOrders.length > 0;
    })
    .map((portfolio) => {
    const open = portfolio.positions.filter((position) => position.status === "open");
    const closed = portfolio.positions.filter((position) => position.status === "closed");
    const pending = portfolio.pendingOrders;
    const realized = closed.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
    const floating = open.reduce((sum, position) => sum + (portfolio.latestClose - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1), 0);
    const total = realized + floating;
     const closedReturns = closed.map((position) => positionReturnPct(position, position.exitPrice ?? position.entryPrice));
     const values = portfolio.tradingMode === "capital" ? [realized, floating, total] : [
       portfolioReturnPct(closed, portfolio.latestClose),
       open.length ? floating / open.reduce((sum, position) => sum + position.entryPrice * position.qty, 0) * 100 : 0,
       portfolioReturnPct(portfolio.positions, portfolio.latestClose),
     ];
     const winning = (portfolio.tradingMode === "capital" ? closed.map((position) => position.realizedPnl ?? 0) : closedReturns).filter((value) => value > 0).length;
     const losing = (portfolio.tradingMode === "capital" ? closed.map((position) => position.realizedPnl ?? 0) : closedReturns).filter((value) => value < 0).length;
     const flats = closed.length - winning - losing;
     const buyTimestamps = [
       ...portfolio.positions.map((position) => position.entryTimestamp),
       ...portfolio.pendingOrders
         .filter((order) => order.action === "open")
         .map((order) => order.executeAtTimestamp ?? order.createdAt),
     ].filter((timestamp): timestamp is number => Number.isFinite(timestamp));
     return {
       portfolio,
       open,
       closed,
       pending,
       buyTimestamps,
       realized: values[0],
      floating: values[1],
      total: values[2],
      winning,
      losing,
      flats,
     };
     }), [livePortfolios]);
  const filteredLivePerformanceRows = useMemo(() => {
    const dateFrom = livePerformanceFilters.buyDateFrom
      ? Date.parse(`${livePerformanceFilters.buyDateFrom}T00:00:00`)
      : Number.NEGATIVE_INFINITY;
    const dateTo = livePerformanceFilters.buyDateTo
      ? Date.parse(`${livePerformanceFilters.buyDateTo}T23:59:59.999`)
      : Number.POSITIVE_INFINITY;
    return livePerformanceRows.filter((row) => {
      const buyDateMatches = row.buyTimestamps.some((timestamp) => timestamp >= dateFrom && timestamp <= dateTo);
      const holdingStatusMatches = livePerformanceFilters.holdingStatus === "all"
        || (livePerformanceFilters.holdingStatus === "holding" && row.open.length > 0)
        || (livePerformanceFilters.holdingStatus === "pending" && row.pending.length > 0)
        || (livePerformanceFilters.holdingStatus === "closed" && row.open.length === 0 && row.pending.length === 0 && row.closed.length > 0);
      const outcomeMatches = livePerformanceFilters.outcome === "all"
        || (livePerformanceFilters.outcome === "profit" && row.total > 0.000001)
        || (livePerformanceFilters.outcome === "loss" && row.total < -0.000001)
        || (livePerformanceFilters.outcome === "flat" && Math.abs(row.total) <= 0.000001);
      return (
        (livePerformanceFilters.buyDateFrom || livePerformanceFilters.buyDateTo ? buyDateMatches : true)
        && (livePerformanceFilters.market === "all" || row.portfolio.market === livePerformanceFilters.market)
        && holdingStatusMatches
        && outcomeMatches
      );
    });
  }, [livePerformanceFilters, livePerformanceRows]);
  const livePerformanceSummary = useMemo(() => {
    const closedTrades = filteredLivePerformanceRows.reduce((sum, row) => sum + row.closed.length, 0);
    const winning = filteredLivePerformanceRows.reduce((sum, row) => sum + row.winning, 0);
    const losing = filteredLivePerformanceRows.reduce((sum, row) => sum + row.losing, 0);
    const flats = closedTrades - winning - losing;
    const decisive = winning + losing;
    return {
      instruments: filteredLivePerformanceRows.length,
      openPositions: filteredLivePerformanceRows.reduce((sum, row) => sum + row.open.length, 0),
      pendingOrders: filteredLivePerformanceRows.reduce((sum, row) => sum + row.pending.length, 0),
      closedTrades,
      winning,
      losing,
      flats,
      winRate: decisive ? Math.round(winning / decisive * 100) : 0,
      total: filteredLivePerformanceRows.reduce((sum, row) => sum + row.total, 0),
      realized: filteredLivePerformanceRows.reduce((sum, row) => sum + row.realized, 0),
      floating: filteredLivePerformanceRows.reduce((sum, row) => sum + row.floating, 0),
    };
  }, [filteredLivePerformanceRows]);
  const livePerformanceCapitalMode = filteredLivePerformanceRows.length
    ? filteredLivePerformanceRows.some((row) => row.portfolio.tradingMode === "capital")
    : livePerformanceRows.some((row) => row.portfolio.tradingMode === "capital");
  const liveWatchPerformanceRows = useMemo(() => liveWatchlist.map((watch) => {
    const observationPrice = liveWatchObservationPrice(watch);
    const pending = !liveWatchHasLaterPrice(watch);
    const change = !pending && Number.isFinite(watch.latestClose) && observationPrice > 0
      ? watch.latestClose - observationPrice
      : null;
    const returnPct = change === null ? null : change / observationPrice * 100;
    return {
      watch,
      observationPrice,
      observationTimestamp: liveWatchObservationTimestamp(watch),
      pending,
      change,
      returnPct,
    };
  }), [liveWatchlist]);
  const liveWatchPerformanceSummary = useMemo(() => {
    const pricedRows = liveWatchPerformanceRows.filter((row) => !row.pending && row.returnPct !== null);
    const pendingRows = liveWatchPerformanceRows.filter((row) => row.pending);
    const winning = pricedRows.filter((row) => row.returnPct !== null && row.returnPct > 0.000001).length;
    const losing = pricedRows.filter((row) => row.returnPct !== null && row.returnPct < -0.000001).length;
    const flats = pricedRows.length - winning - losing;
    const decisive = winning + losing;
    const total = pricedRows.length
      ? pricedRows.reduce((sum, row) => sum + (row.returnPct ?? 0), 0) / pricedRows.length
      : null;
    const totalObservationValue = pricedRows.reduce((sum, row) => sum + row.observationPrice, 0);
    const totalLatestValue = pricedRows.reduce((sum, row) => sum + row.watch.latestClose, 0);
    const totalReturn = totalObservationValue > 0
      ? (totalLatestValue - totalObservationValue) / totalObservationValue * 100
      : null;
    return {
      instruments: liveWatchPerformanceRows.length,
      priced: pricedRows.length,
      pending: pendingRows.length,
      winning,
      losing,
      flats,
      winRate: decisive ? Math.round(winning / decisive * 100) : null,
      total,
      totalReturn,
      realized: 0,
      floating: total,
    };
  }, [liveWatchPerformanceRows]);

  const liveNavigatorResults = useMemo(() => {
    if (liveNavigatorSource === "portfolio") return livePortfolios.map(livePortfolioResult);
    if (liveNavigatorSource === "watch") return liveWatchlist.map(liveWatchResult);
    return liveScanData?.results ?? [];
  }, [liveNavigatorSource, livePortfolios, liveScanData, liveWatchlist]);

  // Result ordering can change after a refresh.  Prefer the saved instrument
  // identity over the old numeric index so the floating navigator resumes on
  // the same symbol whenever it is still present in the list.  This is derived
  // during render, so restoring a result never causes an effect-driven render
  // cascade.
  const liveNavigatorDisplayIndex = useMemo(() => {
    if (!liveNavigatorResults.length) return 0;
    const activeInstrumentId = liveContext?.instrumentId
      ?? (liveNavigatorResume.source === liveNavigatorSource ? liveNavigatorResume.instrumentId : undefined);
    const savedIndex = activeInstrumentId
      ? liveNavigatorResults.findIndex((result) => result.instrumentId === activeInstrumentId)
      : -1;
    return savedIndex >= 0
      ? savedIndex
      : Math.min(liveNavigatorResults.length - 1, Math.max(0, liveScanIndex));
  }, [liveContext, liveNavigatorResults, liveNavigatorResume, liveNavigatorSource, liveScanIndex]);

  const reviewModeOptions = useMemo(
    () => [...new Set(sessionSummaries.map((summary) => summary.modeLabel))],
    [sessionSummaries],
  );
  const filteredReviewSessionSummaries = useMemo(() => {
    const query = reviewSessionFilters.query.trim().toLocaleLowerCase();
    return sessionSummaries.filter((summary) => {
      const completed = summary.task?.status === "completed";
      return (
        (!query
          || summary.session.instrumentId.toLocaleLowerCase().includes(query)
          || summary.modeLabel.toLocaleLowerCase().includes(query)
          || summary.task?.patternFilter?.presetNames.some((name) => name.toLocaleLowerCase().includes(query)))
        && (reviewSessionFilters.timeframe === "all" || summary.session.timeframe === reviewSessionFilters.timeframe)
        && (reviewSessionFilters.modeLabel === "all" || summary.modeLabel === reviewSessionFilters.modeLabel)
        && (reviewSessionFilters.status === "all"
          || (reviewSessionFilters.status === "completed" ? completed : !completed))
      );
    });
  }, [reviewSessionFilters, sessionSummaries]);
  const performanceHabitTrades = useMemo<HabitTrade[]>(() => filteredSessionSummaries.flatMap((summary) => (
    summary.habitTrades.map((trade) => {
      const snapshotId = summary.state.dataSnapshotId ?? summary.session.dataSnapshotId ?? "";
      const context = snapshotTradeContexts[snapshotId]?.[String(trade.entryTimestamp)];
      return {
        result: summary.state.tradingMode === "capital" ? trade.pnl : trade.returnPct,
        holdingBars: trade.holdingBars,
        decision: trade.decision
          ? {
              ...trade.decision,
              source: trade.decision.source === "backfilled" ? "backfilled" : "pretrade",
            }
          : undefined,
        patterns: trade.patterns,
        instrument: {
          market: trade.market,
          entryPrice: trade.entryPrice,
          ...context,
        },
      };
    })
  )), [filteredSessionSummaries, snapshotTradeContexts]);
  const performanceHabitAnalysis = useMemo(
    () => analyzePerformanceHabits(performanceHabitTrades),
    [performanceHabitTrades],
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

  const openTrash = () => {
    setTrashError("");
    setShowTrash(true);
    void loadTrashSessions();
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

  const openPatternFiltersPanel = () => {
    setPatternPresetDrafts(patternPresets.map((preset) => ({ ...preset, parameters: { ...preset.parameters } })));
    setSelectedPatternPresetId((selected) => patternPresets.some((preset) => preset.id === selected) ? selected : patternPresets[0]?.id ?? "");
    setShowPatternFilters(true);
  };

  const savePatternFilters = () => {
    const nextPresets = normalizePatternPresets(patternPresetDrafts);
    window.localStorage.setItem(PATTERN_PRESETS_KEY, JSON.stringify(nextPresets));
    setPatternPresets(nextPresets);
    setPatternPresetDrafts(nextPresets);
    if (quickRandomPatternPresetId && !nextPresets.some((preset) => preset.id === quickRandomPatternPresetId)) {
      window.localStorage.removeItem(QUICK_RANDOM_PATTERN_KEY);
      setQuickRandomPatternPresetId("");
    }
    setRandomTrainingPatternPresetIds((selectedIds) => (
      selectedIds.filter((id) => nextPresets.some((preset) => preset.id === id))
    ));
    setShowPatternFilters(false);
  };

  const updatePatternPresetDraft = (id: string, update: (preset: PatternPreset) => PatternPreset) => {
    setPatternPresetDrafts((presets) => presets.map((preset) => preset.id === id ? update(preset) : preset));
  };

  const clonePatternPreset = () => {
    const source = patternPresetDrafts.find((preset) => preset.id === selectedPatternPresetId);
    if (!source) return;
    const copy: PatternPreset = {
      ...source,
      id: `custom-${createUuid()}`,
      name: `${source.name}（自定义）`,
      builtIn: false,
      parameters: { ...source.parameters },
    };
    setPatternPresetDrafts((presets) => [...presets, copy]);
    setSelectedPatternPresetId(copy.id);
  };

  const resetPatternPresets = () => {
    const nextPresets = normalizePatternPresets(defaultPatternPresets);
    setPatternPresetDrafts(nextPresets);
    setSelectedPatternPresetId(nextPresets[0]?.id ?? "");
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
      patternPresetIds: randomTrainingPatternPresetIds,
    });
    setSetupError("");
    setShowTaskSetup(true);
  };

  const currentRandomConfig = useCallback((): RandomTrainingConfig => ({
    instrumentMode: appSettings.randomInstrumentMode,
    anchorInstrumentId: instrumentId,
    market: appSettings.randomMarket,
    timeframeMode: appSettings.randomTimeframeMode,
    anchorTimeframe: timeframe,
    fixedTimeframe: appSettings.randomTimeframe,
    dateMode: appSettings.randomDateMode,
    startDate: appSettings.randomDateMode === "range" ? appSettings.randomStartDate : undefined,
    endDate: appSettings.randomDateMode === "range" ? appSettings.randomEndDate : undefined,
    length: appSettings.randomLength,
    includeIndices: appSettings.randomIncludeIndices,
    usLiquidityFilter: appSettings.randomUsLiquidityFilter,
    usMinAverageDailyDollarVolume: appSettings.randomUsMinAverageDailyDollarVolume,
  }), [appSettings, instrumentId, timeframe]);

  const randomCandidatePairs = useCallback((config: RandomTrainingConfig = currentRandomConfig()) => {
    const allowedInstruments = availableInstruments.filter((item) =>
      isRandomInstrumentAllowed(item, config.includeIndices)
      && !(config.usLiquidityFilter !== false && isLowLiquidityUsSecurityByName(item)));
    const instrumentCandidates = config.instrumentMode === "current"
      ? allowedInstruments.filter((item) => item.id === config.anchorInstrumentId)
      : config.instrumentMode === "market"
        ? allowedInstruments.filter((item) => item.market === config.market)
        : allowedInstruments;
    const requestedTimeframes = config.timeframeMode === "current"
      ? [config.anchorTimeframe]
      : config.timeframeMode === "fixed"
        ? [config.fixedTimeframe]
        : timeframes;
    const createPairs = (instruments: AvailableInstrument[], allowedTimeframes?: string[]) => instruments.flatMap((item) =>
      item.timeframes
        .filter((candidateTimeframe) => !allowedTimeframes || allowedTimeframes.includes(candidateTimeframe))
        .map((candidateTimeframe) => ({ instrument: item, timeframe: candidateTimeframe })));
    const exactPairs = createPairs(instrumentCandidates, requestedTimeframes);
    const fallbackPairs = exactPairs.length
      ? exactPairs
      : createPairs(instrumentCandidates).length
        ? createPairs(instrumentCandidates)
        : createPairs(allowedInstruments, requestedTimeframes).length
          ? createPairs(allowedInstruments, requestedTimeframes)
          : createPairs(allowedInstruments);
    return [...fallbackPairs].sort(() => randomUint32() / 0x1_0000_0000 - 0.5);
  }, [availableInstruments, currentRandomConfig]);

  const loadPatternCandles = useCallback(async (requestInstrumentId: string, requestTimeframe: string) => {
    if (requestInstrumentId === instrumentId && requestTimeframe === timeframe && bars.length) {
      return { candles: bars as PatternCandle[], timezone: instrument.timezone };
    }
    const response = await fetch(`/api/candles?instrument=${encodeURIComponent(requestInstrumentId)}&timeframe=${encodeURIComponent(requestTimeframe)}`);
    if (!response.ok) throw new Error("读取候选 K 线失败");
    const data = await response.json() as { instrument?: Instrument; candles?: KLineData[] };
    return {
      candles: (data.candles ?? []) as PatternCandle[],
      timezone: data.instrument?.timezone ?? "Asia/Shanghai",
    };
  }, [bars, instrument.timezone, instrumentId, timeframe]);

  const findCandidatePatternMatch = useCallback(async (
    requestInstrumentId: string,
    requestTimeframe: string,
    requestMarket: string,
    draft: TrainingTaskDraft,
    applyRandomDateRange: boolean,
    randomConfig: RandomTrainingConfig = currentRandomConfig(),
  ): Promise<PatternMatch | null> => {
    const selectedPresets = patternPresets.filter((preset) => draft.patternPresetIds?.includes(preset.id));
    if (!selectedPresets.length) return null;
    const loaded = await loadPatternCandles(requestInstrumentId, requestTimeframe);
    const requestedLength = draft.length > 0 ? draft.length : applyRandomDateRange ? randomConfig.length : 0;
    const maximumIndex = Math.max(0, loaded.candles.length - 1 - Math.max(1, requestedLength));
    const matches = findPatternMatches(loaded.candles, selectedPresets, {
      cooldownBars: appSettings.patternCooldownBars,
      maximumIndex,
    }).filter((match) => {
      if (match.index < 40) return false;
      if (applyRandomDateRange && randomConfig.dateMode === "range") {
        const date = tradingDate(match.timestamp, loaded.timezone);
        if ((randomConfig.startDate && date < randomConfig.startDate)
          || (randomConfig.endDate && date > randomConfig.endDate)) return false;
      }
      if (applyRandomDateRange && isUsMarket(requestMarket) && randomConfig.usLiquidityFilter !== false) {
        return trailingAverageDailyDollarVolume(
          loaded.candles,
          match.index,
          loaded.timezone,
          requestTimeframe,
        ) >= (randomConfig.usMinAverageDailyDollarVolume ?? 1000000);
      }
      return true;
    });
    return randomItem(matches) ?? null;
  }, [appSettings.patternCooldownBars, currentRandomConfig, loadPatternCandles, patternPresets]);

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

  const resolveRandomRequest = useCallback(async (
    draft: TrainingTaskDraft,
    randomConfig: RandomTrainingConfig = currentRandomConfig(),
  ) => {
    const pairs = randomCandidatePairs(randomConfig);
    const requestedLength = draft.length > 0 ? draft.length : randomConfig.length;
    const attemptLimit = Math.min(pairs.length, Math.max(24, appSettings.patternScanAttempts));
    for (let index = 0; index < attemptLimit; index += 1) {
      const pair = pairs[index];
      try {
        const loaded = await loadPatternCandles(pair.instrument.id, pair.timeframe);
        const eligibleStarts = randomEligibleStartIndices(
          loaded.candles,
          loaded.timezone,
          pair.timeframe,
          requestedLength,
          randomConfig,
          pair.instrument.market,
        );
        const selectedStart = randomItem(eligibleStarts);
        if (selectedStart == null) continue;
        return {
          instrumentId: pair.instrument.id,
          timeframe: pair.timeframe,
          draft: {
            ...draft,
            startMode: "bar" as const,
            startBar: selectedStart + 1,
            length: requestedLength,
            randomRun: true,
            randomConfig,
          },
        };
      } catch {
        // Skip unavailable or incomplete local partitions and keep looking.
      }
    }
    return null;
  }, [appSettings.patternScanAttempts, currentRandomConfig, loadPatternCandles, randomCandidatePairs]);

  const resolvePatternRandomRequest = useCallback(async (
    draft: TrainingTaskDraft,
    randomConfig: RandomTrainingConfig = currentRandomConfig(),
  ) => {
    const pairs = randomCandidatePairs(randomConfig);
    const attemptLimit = Math.min(pairs.length, appSettings.patternScanAttempts);
    for (let index = 0; index < attemptLimit; index += 1) {
      const pair = pairs[index];
      setPatternScanStatus(`正在检查候选 ${index + 1}/${attemptLimit}：${pair.instrument.short} · ${pair.timeframe}`);
      try {
        const match = await findCandidatePatternMatch(pair.instrument.id, pair.timeframe, pair.instrument.market, draft, true, randomConfig);
        if (!match) continue;
        const selectedPresets = patternPresets.filter((preset) => draft.patternPresetIds?.includes(preset.id));
        return {
          instrumentId: pair.instrument.id,
          timeframe: pair.timeframe,
          draft: {
            ...draft,
            startMode: "bar" as const,
            startBar: match.index + 1,
            length: draft.length > 0 ? draft.length : randomConfig.length,
            randomRun: true,
            randomConfig,
            patternPresetNames: selectedPresets.map((preset) => preset.name),
            patternMatchedPresetIds: match.presetIds,
            patternMatchTimestamp: match.timestamp,
          },
        };
      } catch {
        // A single unavailable partition should not cancel the whole random search.
      }
    }
    return null;
  }, [appSettings.patternScanAttempts, currentRandomConfig, findCandidatePatternMatch, patternPresets, randomCandidatePairs]);

  const startConfiguredTraining = async () => {
    let requestInstrumentId = setupInstrumentId;
    let requestTimeframe = setupTimeframe;
    let requestSnapshotId: string | undefined;
    let draft = { ...taskDraft };

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
    } else if (draft.startMode === "date" && !draft.startDate && !draft.patternPresetIds?.length) {
      setSetupError("请填写训练开始日期。");
      return;
    }

    const selectedPatternIds = draft.mode === "range" || draft.mode === "mistake"
      ? []
      : (draft.patternPresetIds ?? []).filter((id) => patternPresets.some((preset) => preset.id === id));
    draft = { ...draft, patternPresetIds: selectedPatternIds };
    const randomConfig = taskSetupKind === "random" ? currentRandomConfig() : undefined;
    setStartingTraining(true);
    setPatternScanStatus("");
    setSetupError("");
    try {
      if (selectedPatternIds.length && taskSetupKind === "random") {
        const request = await resolvePatternRandomRequest(draft, randomConfig);
        if (!request) {
          setSetupError(`在前 ${appSettings.patternScanAttempts} 个候选数据集中没有找到符合条件的历史位置。可放宽参数、增加扫描候选数或减少同时启用的条件。`);
          return;
        }
        requestInstrumentId = request.instrumentId;
        requestTimeframe = request.timeframe;
        draft = request.draft;
      } else if (selectedPatternIds.length) {
        setPatternScanStatus(`正在扫描 ${requestInstrumentId} · ${requestTimeframe} 的历史形态…`);
        const requestMarket = availableInstruments.find((item) => item.id === requestInstrumentId)?.market ?? instrument.market;
        const match = await findCandidatePatternMatch(requestInstrumentId, requestTimeframe, requestMarket, draft, false);
        if (!match) {
          setSetupError("当前品种和周期没有找到符合所选形态的可训练历史位置。请调整形态或参数。");
          return;
        }
        const selectedPresets = patternPresets.filter((preset) => selectedPatternIds.includes(preset.id));
        draft = {
          ...draft,
          startMode: "bar",
          startBar: match.index + 1,
          patternPresetNames: selectedPresets.map((preset) => preset.name),
          patternMatchedPresetIds: match.presetIds,
          patternMatchTimestamp: match.timestamp,
        };
      } else if (draft.startMode === "random" && draft.mode !== "range" && draft.mode !== "mistake") {
        const request = await resolveRandomRequest(draft, randomConfig);
        if (!request) {
          setSetupError("没有找到满足历史范围和流动性门槛的训练片段，请降低美股成交额门槛或扩大随机范围。");
          return;
        }
        requestInstrumentId = request.instrumentId;
        requestTimeframe = request.timeframe;
        draft = request.draft;
      }
      launchTraining(requestInstrumentId, requestTimeframe, draft, requestSnapshotId);
    } finally {
      setStartingTraining(false);
      setPatternScanStatus("");
    }
  };

  const updateQuickRandomPattern = (presetId: string) => {
    const nextPresetId = patternPresets.some((preset) => preset.id === presetId) ? presetId : "";
    setQuickRandomPatternPresetId(nextPresetId);
    setQuickRandomError("");
    if (nextPresetId) window.localStorage.setItem(QUICK_RANDOM_PATTERN_KEY, nextPresetId);
    else window.localStorage.removeItem(QUICK_RANDOM_PATTERN_KEY);
  };

  const toggleTaskPatternPreset = (presetId: string, selected: boolean) => {
    setTaskDraft((draft) => {
      const nextIds = selected
        ? (draft.patternPresetIds ?? []).filter((id) => id !== presetId)
        : [...(draft.patternPresetIds ?? []), presetId];
      if (taskSetupKind === "random") setRandomTrainingPatternPresetIds(nextIds);
      return { ...draft, patternPresetIds: nextIds };
    });
  };

  const startQuickRandomTraining = async () => {
    if (startingTraining) return;
    const blind = quickRandomMode === "blind";
    const randomConfig = currentRandomConfig();
    const selectedPatternIds = patternPresets.some((preset) => preset.id === quickRandomPatternPresetId)
      ? [quickRandomPatternPresetId]
      : [];
    const draft: TrainingTaskDraft = {
      ...defaultTrainingTaskDraft,
      mode: quickRandomMode,
      startMode: "random",
      length: appSettings.randomLength,
      hideInstrument: blind,
      hideDate: blind,
      hidePrice: blind,
      randomRun: true,
      patternPresetIds: selectedPatternIds,
    };
    setStartingTraining(true);
    setQuickRandomError("");
    setPatternScanStatus("");
    if (selectedPatternIds.length) setMobileToolbarOpen(true);
    try {
      const request = selectedPatternIds.length
        ? await resolvePatternRandomRequest(draft, randomConfig)
        : await resolveRandomRequest(draft, randomConfig);
      if (!request) {
        setQuickRandomError(selectedPatternIds.length
          ? `没有找到“${patternPresets.find((preset) => preset.id === quickRandomPatternPresetId)?.name ?? "所选形态"}”的可训练历史位置，请换一个形态或调整形态参数。`
          : "没有找到满足历史范围和流动性门槛的训练片段，请调整随机训练规则。");
        setMobileToolbarOpen(true);
        return;
      }
      setMobileToolbarOpen(false);
      launchTraining(request.instrumentId, request.timeframe, request.draft);
    } finally {
      setStartingTraining(false);
      setPatternScanStatus("");
    }
  };

  const continueRandomTraining = async () => {
    const completedTask = trainingTask;
    if (!completedTask?.randomRun) return;
    const randomConfig = completedTask.randomConfig ?? currentRandomConfig();
    const draft: TrainingTaskDraft = {
      ...defaultTrainingTaskDraft,
      mode: completedTask.mode,
      startMode: "random",
      length: completedTask.requestedLength ?? randomConfig.length,
      hideInstrument: completedTask.hideInstrument,
      hideDate: completedTask.hideDate,
      hidePrice: completedTask.hidePrice,
      randomRun: true,
      patternPresetIds: completedTask.patternFilter?.presetIds,
      randomConfig,
    };
    const request = draft.patternPresetIds?.length
      ? await resolvePatternRandomRequest(draft, randomConfig)
      : await resolveRandomRequest(draft, randomConfig);
    if (!request) {
      setShowRandomComplete(false);
      openRandomTraining();
      setSetupError("没有找到新的形态命中位置，请调整形态参数后再试。");
      return;
    }
    launchTraining(request.instrumentId, request.timeframe, request.draft);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (view === "database") loadCoverage();
      if (view === "review" || view === "performance") loadSessions(true);
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
    let cancelled = false;
    void resolveRandomRequest({
        ...defaultTrainingTaskDraft,
        mode: "free",
        startMode: "random",
        length: appSettingsRef.current.randomLength,
        randomRun: true,
      })
      .then((request) => {
        if (cancelled) return;
        if (!request) {
          setChartLoadError("没有找到满足随机规则的训练片段，请在设置中调整市场范围或美股流动性门槛。");
          setStartupReady(true);
          return;
        }
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
      });
    return () => { cancelled = true; };
  }, [instrumentCatalogReady, resolveRandomRequest, settingsReady]);

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportStatus("正在校验…");
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const headers = lines[0].split(",").map((item) => item.trim().toLowerCase());
      const genericBars = lines.slice(1).filter(Boolean).map((line) => {
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
      const fxParsed = dataMarket === "FX" ? parseDukascopyCsv(text, { timestampTimeZone: "UTC" }) : null;
      const barsToImport = dataMarket === "FX"
        ? aggregateM1To5m(fxParsed?.candles ?? []).map((bar) => ({ ...bar }))
        : genericBars;
      if (!barsToImport.length) throw new Error("CSV 没有可导入的有效 K 线");
      const customId = `CUSTOM.${dataMarket}.${file.name.replace(/\.[^.]+$/, "").toUpperCase()}`;
      const timezone = dataMarket === "CN"
        ? "Asia/Shanghai"
        : dataMarket === "US"
          ? "America/New_York"
          : "UTC";
      const importTimeframe = dataMarket === "FX" ? "5m" : "1d";
      let imported = 0;
      for (let offset = 0; offset < barsToImport.length; offset += 4000) {
      const response = await fetch("/api/candles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instrument: { id: customId, symbol: customId, name: file.name, market: dataMarket, timezone },
          timeframe: importTimeframe,
          adjustmentType: "none",
          bars: barsToImport.slice(offset, offset + 4000),
        }),
      });
        const result = await response.json() as { imported?: number; error?: string };
        imported += Number(result.imported ?? 0);
      if (!response.ok) throw new Error(result.error ?? "导入失败");
      setImportStatus(`已导入 ${result.imported} 根日 K`);
      }
      setImportStatus(`宸插鍏?${imported} ${importTimeframe} K`);
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
        <button className={`rail-bottom pattern-entry ${showPatternFilters ? "active" : ""}`} aria-label="形态筛选" onClick={openPatternFiltersPanel}>
          <ListFilter size={20} /><span>形态</span>
        </button>
        <button className={`rail-bottom settings-entry ${showSettings ? "active" : ""}`} aria-label="设置" onClick={() => openSettingsPanel()}>
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
                <span className="market-pill">{currentAssetLabel}</span>
              </>
            )}
            <span className="rule-pill">{trainingTask ? trainingModeLabels[trainingTask.mode] : "自由训练"}</span>
            <span className="rule-pill">{tradingMode === "capital" ? "资金账户" : "收益率"}</span>
            {trashPreview && <span className="rule-pill read-only">回收站查看 · 未恢复</span>}
            {!marketRules.tradingEnabled && <span className="rule-pill read-only">只看盘</span>}
            {trainingTask?.patternFilter && (
              <span className="rule-pill" title={`命中：${trainingTask.patternFilter.matchedPresetIds.join("、")}`}>
                形态 · {trainingTask.patternFilter.presetNames.join(" / ")}
              </span>
            )}
            <div className="timeframes" aria-label="周期">
              {timeframes.map((item) => (
                <button key={item} className={timeframe === item ? "active" : ""} onClick={() => startFreshTraining(instrumentId, item)}>{item}</button>
              ))}
            </div>
            <div className="indicator-toolbar">
              <button
                type="button"
                className={indicatorMenuOpen ? "active" : ""}
                aria-label="主图指标设置"
                aria-expanded={indicatorMenuOpen}
                onClick={() => setIndicatorMenuOpen((open) => !open)}
              >
                <LineChart size={15} />
                <span>指标</span>
                <small>{(["ma", "ema"] as MovingAverageKind[])
                  .filter((kind) => movingAverageSettings[kind].enabled)
                  .map((kind) => `${kind.toUpperCase()} ${movingAverageSettings[kind].periods.join("/")}`)
                  .join(" · ") || "未启用"}</small>
                <ChevronDown size={13} />
              </button>
              {indicatorMenuOpen && (
                <div className="indicator-popover" role="dialog" aria-label="MA 和 EMA 指标设置">
                  <header>
                    <div><strong>主图指标</strong><span>曲线叠加在 K 线上</span></div>
                    <button type="button" aria-label="关闭指标设置" onClick={() => setIndicatorMenuOpen(false)}><X size={15} /></button>
                  </header>
                  <MovingAverageEditor settings={movingAverageSettings} onChange={setMovingAverageSettings} />
                </div>
              )}
            </div>
          </div>
          <div className="top-actions">
            <span className={`save-state ${saveState.includes("已") ? "saved" : ""}`}>{saveState}</span>
            <button className="ghost-button live-scan-button" onClick={() => {
              setLiveScanError("");
              setShowLiveScan(true);
            }}><Activity size={16} />实盘筛选</button>
            <button className="ghost-button" onClick={openRandomTraining}><Shuffle size={16} />随机训练</button>
            <button className="ghost-button" onClick={openTaskSetup}><Play size={16} />新建 Replay 训练</button>
            <button className="primary-button" disabled={trashPreview} onClick={saveSession}><Save size={16} />保存训练</button>
          </div>
          <div className="mobile-quick-actions" aria-label="训练快捷操作">
            <button type="button" aria-label="实盘筛选" title="实盘筛选" onClick={() => {
              setLiveScanError("");
              setShowLiveScan(true);
            }}><Activity size={15} /></button>
            <button
              type="button"
              aria-label={startingTraining ? "正在筛选随机训练" : "立即开始随机训练"}
              title={startingTraining ? "正在筛选随机训练" : "立即开始随机训练"}
              disabled={startingTraining}
              onClick={() => void startQuickRandomTraining()}
            >{startingTraining ? <Activity size={15} /> : <Shuffle size={15} />}</button>
            <button type="button" aria-label="新建 Replay 训练" title="新建 Replay 训练" onClick={openTaskSetup}><Play size={15} /></button>
            <button type="button" className="save" disabled={trashPreview} aria-label="保存训练" title="保存训练" onClick={saveSession}><Save size={15} /></button>
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
              <div className="mobile-indicator-settings">
                <strong><LineChart size={13} />主图指标</strong>
                <MovingAverageEditor compact settings={movingAverageSettings} onChange={setMovingAverageSettings} />
              </div>
              <div className="mobile-random-mode" aria-label="随机训练方式">
                <span>随机方式</span>
                <button className={quickRandomMode === "free" ? "active" : ""} onClick={() => setQuickRandomMode("free")}>普通</button>
                <button className={quickRandomMode === "blind" ? "active" : ""} onClick={() => setQuickRandomMode("blind")}>盲测</button>
                <button onClick={() => { setMobileToolbarOpen(false); openSettingsPanel("training"); }}>规则</button>
              </div>
              <label className="mobile-random-pattern">
                <span>随机形态</span>
                <select
                  value={quickRandomPatternPresetId}
                  aria-label="一键随机训练形态"
                  onChange={(event) => updateQuickRandomPattern(event.target.value)}
                >
                  <option value="">不限形态</option>
                  {patternPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                <small>会记住本机选择，一键随机时自动寻找该形态。</small>
              </label>
              {startingTraining && patternScanStatus && <div className="mobile-random-status"><Activity size={12} />{patternScanStatus}</div>}
              {quickRandomError && <div className="mobile-random-error">{quickRandomError}</div>}
            </div>
          )}
        </header>

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
                  <div className="settings-rule">
                    <span>图表左侧历史 K 线</span>
                    <label>新训练显示根数
                      <input
                        type="number"
                        min={MIN_REPLAY_HISTORY_BARS}
                        max={MAX_REPLAY_HISTORY_BARS}
                        step="1"
                        value={settingsDraft.replayHistoryBars}
                        onChange={(event) => setSettingsDraft((draft) => ({
                          ...draft,
                          replayHistoryBars: Number(event.target.value),
                        }))}
                        onBlur={() => setSettingsDraft((draft) => ({
                          ...draft,
                          replayHistoryBars: normalizeReplayHistoryBars(draft.replayHistoryBars),
                        }))}
                      />
                    </label>
                    <small>每次新训练开始时，显示起点左侧最近多少根 K 线；最少 100、最多 5000。训练推进后，新揭示的 K 线会继续追加，已保存训练不会随设置变化。</small>
                  </div>
                  <div className="settings-rule trash-settings-rule">
                    <div className="settings-row-action">
                      <div>
                        <span>训练回收站</span>
                        <strong>已删除训练</strong>
                        <small>删除的训练会暂存在这里，可以恢复；彻底删除后将无法找回。</small>
                      </div>
                      <button className="ghost-button trash-entry-button" onClick={openTrash} type="button">
                        <Trash2 size={15} />打开回收站
                      </button>
                    </div>
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
                    <div className="task-start-options" aria-label="随机训练指数范围">
                      <button
                        className={!settingsDraft.randomIncludeIndices ? "active" : ""}
                        onClick={() => setSettingsDraft((draft) => ({ ...draft, randomIncludeIndices: false }))}
                      >仅可交易品种</button>
                      <button
                        className={settingsDraft.randomIncludeIndices ? "active" : ""}
                        onClick={() => setSettingsDraft((draft) => ({ ...draft, randomIncludeIndices: true }))}
                      >纳入指数（只看盘）</button>
                    </div>
                    <small>默认排除指数、基金、可转债等当前未开放交易的 A 股品种；纳入指数后，抽到指数的训练局只提供看盘、标记和决策功能。</small>
                    <div className="task-start-options" aria-label="美股流动性过滤">
                      <button
                        className={settingsDraft.randomUsLiquidityFilter ? "active" : ""}
                        onClick={() => setSettingsDraft((draft) => ({ ...draft, randomUsLiquidityFilter: true }))}
                      >过滤低流动性美股</button>
                      <button
                        className={!settingsDraft.randomUsLiquidityFilter ? "active" : ""}
                        onClick={() => setSettingsDraft((draft) => ({ ...draft, randomUsLiquidityFilter: false }))}
                      >不过滤</button>
                    </div>
                    {settingsDraft.randomUsLiquidityFilter && (
                      <label>最低 20 日平均成交额（美元）
                        <input
                          type="number"
                          min="0"
                          step="100000"
                          value={settingsDraft.randomUsMinAverageDailyDollarVolume}
                          onChange={(event) => setSettingsDraft((draft) => ({
                            ...draft,
                            randomUsMinAverageDailyDollarVolume: Math.max(0, Number(event.target.value)),
                          }))}
                        />
                      </label>
                    )}
                    <small>默认门槛为 100 万美元。按训练起点之前 20 个交易日计算，只影响随机选样；不会删除已下载行情或不可变快照。</small>
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

                  <div className="settings-rule">
                    <span>形态筛选扫描</span>
                    <div className="task-form-row pattern-scan-settings">
                      <label>相邻命中冷却 K 线数
                        <input type="number" min="0" max="100" value={settingsDraft.patternCooldownBars} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, patternCooldownBars: Math.max(0, Number(event.target.value)) }))} />
                      </label>
                      <label>随机训练最多检查候选数
                        <input type="number" min="1" max="50" value={settingsDraft.patternScanAttempts} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, patternScanAttempts: Math.max(1, Number(event.target.value)) }))} />
                      </label>
                    </div>
                    <small>冷却用于去掉同一段走势里的重复命中；候选数越大，稀有形态越容易找到，但开始训练前等待会更久。具体形态阈值在左侧“形态”中管理。</small>
                  </div>
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

        {showTrash && (
          <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowTrash(false);
          }}>
            <section className="task-modal trash-modal" role="dialog" aria-modal="true" aria-labelledby="trash-modal-title">
              <div className="task-modal-head">
                <div>
                  <span>RECYCLE BIN</span>
                  <h2 id="trash-modal-title">训练回收站</h2>
                  <p>删除的训练记录会保留在这里，可直接查看训练；恢复后可继续训练。</p>
                </div>
                <button aria-label="关闭回收站" onClick={() => setShowTrash(false)}><X size={19} /></button>
              </div>

              {trashLoading ? (
                <div className="empty-state">正在读取回收站…</div>
              ) : trashSessions.length ? (
                <div className="trash-session-list">
                  {trashSessions.map((session) => {
                    let state: TrainingState | null = null;
                    try {
                      state = parseTrainingState(JSON.parse(session.stateJson));
                    } catch {
                      state = null;
                    }
                    const task = state?.trainingTask;
                    const stats = state ? trainingPnlStats(state) : null;
                    const progressSummary = state && task ? taskProgress(task, state.cursor) : null;
                    const modeLabel = task
                      ? task.randomRun ? task.mode === "blind" ? "随机盲测" : "随机训练" : trainingModeLabels[task.mode]
                      : "旧版自由训练";
                    const totalResult = stats && state?.tradingMode === "capital" ? stats.pnl.total : stats?.returnPct ?? 0;
                    const realizedResult = stats && state?.tradingMode === "capital" ? stats.pnl.realized : stats?.realizedReturnPct ?? 0;
                    const floatingResult = stats && state?.tradingMode === "capital" ? stats.pnl.floating : stats?.floatingReturnPct ?? 0;
                    return (
                      <div className="trash-session-row" key={session.id}>
                        <div className="trash-session-main">
                          <div className="session-title">
                            <strong>{session.instrumentId} · {session.timeframe}</strong>
                            <span className={task?.status === "completed" ? "session-status completed" : "session-status"}>
                              {task?.status === "completed" ? "已完成" : "可继续"}
                            </span>
                          </div>
                          <span>{modeLabel}{progressSummary ? ` · 进度 ${progressSummary.revealed}/${progressSummary.total}` : ""}</span>
                          {stats && state && (
                            <div className="trash-session-metrics">
                              <span className={totalResult >= 0 ? "up" : "down"}>
                                <small>{state.tradingMode === "capital" ? "总盈亏" : "总收益率"}</small>
                                <strong>{state.tradingMode === "capital" ? money(totalResult) : percent(totalResult)}</strong>
                              </span>
                              <span className={realizedResult >= 0 ? "up" : "down"}>
                                <small>{state.tradingMode === "capital" ? "已实现" : "已实现收益率"}</small>
                                <strong>{state.tradingMode === "capital" ? money(realizedResult) : percent(realizedResult)}</strong>
                              </span>
                              <span className={floatingResult >= 0 ? "up" : "down"}>
                                <small>{state.tradingMode === "capital" ? "浮动" : "浮动收益率"}</small>
                                <strong>{state.tradingMode === "capital" ? money(floatingResult) : percent(floatingResult)}</strong>
                              </span>
                              <span>
                                <small>平仓笔数</small>
                                <strong>{stats.closedSessionPositions.length}</strong>
                              </span>
                              <span>
                                <small>胜 / 负 / 平</small>
                                <strong>{stats.winningTrades} / {stats.losingTrades} / {stats.flatTrades}</strong>
                              </span>
                            </div>
                          )}
                          <small>移入时间 {new Date(session.deletedAt ?? session.updatedAt).toLocaleString("zh-CN")}</small>
                        </div>
                        <div className="trash-session-actions">
                          <button className="review-session" disabled={Boolean(trashActionId)} onClick={() => inspectTrashedSession(session)}>
                            <BookOpenCheck size={14} />查看训练
                          </button>
                          <button className="resume-session" disabled={Boolean(trashActionId)} onClick={() => void restoreTrashedSession(session)}>
                            <RotateCcw size={14} />恢复训练
                          </button>
                          <button className="delete-session" disabled={Boolean(trashActionId)} onClick={() => void permanentlyDeleteTrashedSession(session)}>
                            <Trash2 size={14} />彻底删除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">回收站还是空的。训练列表中的删除操作会把记录移到这里。</div>
              )}
              {trashError && <div className="task-error">{trashError}</div>}
              <div className="task-modal-actions">
                <button className="ghost-button" onClick={() => setShowTrash(false)}>关闭</button>
              </div>
            </section>
          </div>
        )}

        {showPatternFilters && (
          <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowPatternFilters(false);
          }}>
            <section className="task-modal pattern-filter-modal" role="dialog" aria-modal="true" aria-labelledby="pattern-filter-title">
              <div className="task-modal-head">
                <div>
                  <span>PATTERN FILTERS</span>
                  <h2 id="pattern-filter-title">形态筛选</h2>
                  <p>管理历史 K 线的布尔筛选预设；预设内部条件全部满足才算命中。</p>
                </div>
                <button aria-label="关闭形态筛选" onClick={() => setShowPatternFilters(false)}><X size={19} /></button>
              </div>

              <div className="pattern-filter-layout">
                <aside className="pattern-preset-list" aria-label="形态预设">
                  {patternPresetDrafts.map((preset) => (
                    <button
                      key={preset.id}
                      className={selectedPatternPresetDraft?.id === preset.id ? "active" : ""}
                      onClick={() => setSelectedPatternPresetId(preset.id)}
                    >
                      <strong>{preset.name}</strong>
                      <span>{preset.builtIn ? "内置" : "自定义"}</span>
                    </button>
                  ))}
                </aside>

                {selectedPatternPresetDraft && (
                  <div className="pattern-preset-editor">
                    <div className="pattern-editor-head">
                      <div>
                        <strong>{selectedPatternPresetDraft.name}</strong>
                        <span>{selectedPatternPresetDraft.description}</span>
                      </div>
                      <button className="ghost-button" onClick={clonePatternPreset}>复制为自定义</button>
                    </div>

                    <label>预设名称
                      <input
                        value={selectedPatternPresetDraft.name}
                        disabled={selectedPatternPresetDraft.builtIn}
                        onChange={(event) => updatePatternPresetDraft(selectedPatternPresetDraft.id, (preset) => ({ ...preset, name: event.target.value }))}
                      />
                    </label>
                    <label>说明
                      <textarea
                        value={selectedPatternPresetDraft.description}
                        disabled={selectedPatternPresetDraft.builtIn}
                        onChange={(event) => updatePatternPresetDraft(selectedPatternPresetDraft.id, (preset) => ({ ...preset, description: event.target.value }))}
                      />
                    </label>

                    <div className="pattern-parameter-grid">
                      {patternParameterDefinitions[selectedPatternPresetDraft.kind].map((definition) => (
                        <label key={definition.key}>{definition.label}
                          <span className="pattern-number-input">
                            <input
                              type="number"
                              min={definition.min}
                              max={definition.max}
                              step={definition.step}
                              value={selectedPatternPresetDraft.parameters[definition.key]}
                              onChange={(event) => updatePatternPresetDraft(selectedPatternPresetDraft.id, (preset) => ({
                                ...preset,
                                parameters: { ...preset.parameters, [definition.key]: Number(event.target.value) },
                              }))}
                            />
                            {definition.suffix && <small>{definition.suffix}</small>}
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="pattern-logic-note">
                      <ListChecks size={17} />
                      <span>本预设参数之间使用 AND；训练时勾选多个预设使用 OR。检测只读取命中 K 线及之前的数据，不读取未来。</span>
                    </div>

                    {!selectedPatternPresetDraft.builtIn && (
                      <button className="delete-pattern-preset" onClick={() => {
                        setPatternPresetDrafts((presets) => presets.filter((preset) => preset.id !== selectedPatternPresetDraft.id));
                        setSelectedPatternPresetId(patternPresetDrafts.find((preset) => preset.id !== selectedPatternPresetDraft.id)?.id ?? "");
                      }}><Trash2 size={14} />删除这个自定义预设</button>
                    )}
                  </div>
                )}
              </div>

              <div className="task-modal-actions pattern-modal-actions">
                <button className="ghost-button" onClick={resetPatternPresets}><RotateCcw size={15} />恢复内置默认值</button>
                <span />
                <button className="ghost-button" onClick={() => setShowPatternFilters(false)}>取消</button>
                <button className="primary-button" onClick={savePatternFilters}><Save size={16} />保存形态预设</button>
              </div>
            </section>
          </div>
        )}

        {showLiveScan && (
          <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !liveScanRunning) setShowLiveScan(false);
          }}>
            <section className="task-modal live-scan-modal" role="dialog" aria-modal="true" aria-labelledby="live-scan-title">
              <div className="task-modal-head">
                <div>
                  <span>LIVE MARKET SCREENER</span>
                  <h2 id="live-scan-title">实盘筛选</h2>
                  <p>只判断所选市场最近一个已收盘交易日；缺少当日数据时先自动增量更新。</p>
                </div>
                <button aria-label="关闭实盘筛选" disabled={liveScanRunning} onClick={() => setShowLiveScan(false)}><X size={19} /></button>
              </div>

              <div className="live-scan-market" role="group" aria-label="筛选市场">
                {(["CN", "US"] as LiveScanMarket[]).map((market) => (
                  <button key={market} className={liveScanMarket === market ? "active" : ""} onClick={() => {
                    setLiveScanMarket(market);
                    setLiveScanData(null);
                    setLiveScanError("");
                  }}>{market === "CN" ? "A 股" : "美股"}<small>{market === "CN" ? "Tushare 增量" : "Alpaca SIP/IEX"}</small></button>
                ))}
              </div>

              <fieldset className="task-pattern-filter">
                <legend>当日形态（可选，多个条件任一命中）</legend>
                <div className="task-pattern-head">
                  <span>{liveScanPresetIds.length ? `已选择 ${liveScanPresetIds.length} 个形态` : "不选择形态时仅使用价格和流动性条件"}</span>
                  {liveScanPresetIds.length > 0 && <button type="button" onClick={() => setLiveScanPresetIds([])}>清除形态</button>}
                </div>
                <div className="task-pattern-options">
                  {patternPresets.map((preset) => {
                    const selected = liveScanPresetIds.includes(preset.id);
                    return <button type="button" key={preset.id} className={selected ? "active" : ""} title={preset.description} onClick={() => {
                      setLiveScanPresetIds((ids) => selected ? ids.filter((id) => id !== preset.id) : [...ids, preset.id]);
                    }}>{selected ? "✓ " : "+ "}{preset.name}</button>;
                  })}
                </div>
              </fieldset>

              <div className="live-scan-filter-grid">
                <label>最低收盘价<input type="number" min="0" step="0.01" placeholder="不限" value={liveScanMinPrice} onChange={(event) => setLiveScanMinPrice(event.target.value)} /></label>
                <label>最高收盘价<input type="number" min="0" step="0.01" placeholder="不限" value={liveScanMaxPrice} onChange={(event) => setLiveScanMaxPrice(event.target.value)} /></label>
                <label>20 日平均成交量<input type="number" min="0" step="1000" placeholder="不限" value={liveScanMinVolume} onChange={(event) => setLiveScanMinVolume(event.target.value)} /></label>
                <label>排序<select value={liveScanSort} onChange={(event) => setLiveScanSort(event.target.value as typeof liveScanSort)}><option value="turnover">平均成交额从高到低</option><option value="volume">平均成交量从高到低</option><option value="change">当日涨幅从高到低</option></select></label>
                <label>最多显示<select value={liveScanLimit} onChange={(event) => setLiveScanLimit(Number(event.target.value))}><option value={50}>50 个</option><option value={100}>100 个</option><option value={200}>200 个</option><option value={500}>500 个</option></select></label>
              </div>

              {liveScanStatus && <div className="pattern-scan-status"><Activity size={14} />{liveScanStatus}</div>}
              {liveScanError && <div className="task-error">
                <strong>{liveScanError}</strong>
                <button type="button" onClick={() => void startLiveScan(true)}>使用本地现有最新数据筛选</button>
              </div>}

              {liveScanData && (
                <div className="live-scan-results">
                  <header>
                    <div><strong>筛选结果</strong><span>行情日期 {new Date(liveScanData.latestTimestamp).toLocaleDateString("zh-CN")} · 命中 {liveScanData.matchedCount.toLocaleString()} 个</span></div>
                    <small>点击一行打开该标的最新日线</small>
                  </header>
                  <div className="live-scan-result-list">
                    {liveScanData.results.length ? liveScanData.results.map((result, resultIndex) => (
                      <button type="button" key={result.instrumentId} onClick={() => openLiveScanResult(result, resultIndex)}>
                        <span><strong>{result.symbol}</strong><small>{result.name}</small></span>
                        <span>{result.presetNames.join("、") || "基础条件"}</span>
                        <span className={result.changePct >= 0 ? "up" : "down"}>{result.changePct >= 0 ? "+" : ""}{result.changePct.toFixed(2)}%</span>
                        <span>{result.close.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                        <span>{result.averageVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </button>
                    )) : <div className="live-scan-empty">当前条件没有命中品种，请减少形态或放宽价格、成交量条件。</div>}
                  </div>
                </div>
              )}

              <div className="task-modal-actions">
                <button className="ghost-button" disabled={liveScanRunning} onClick={() => setShowLiveScan(false)}>关闭</button>
                <button className="ghost-button" disabled={liveScanRunning || !liveScanData?.results.length} title="恢复上次筛选结果和浮动导航位置" onClick={restoreLiveScan}><RotateCcw size={15} />恢复筛选</button>
                <button className="primary-button" disabled={liveScanRunning} onClick={() => void startLiveScan(false)}><Activity size={16} />{liveScanRunning ? "正在更新并筛选…" : "更新数据并开始筛选"}</button>
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
                      {" · "}
                      {appSettings.randomIncludeIndices ? "纳入指数（只看盘）" : "仅可交易品种"}
                    </span>
                  </div>
                  <button onClick={() => {
                    setShowTaskSetup(false);
                    openSettingsPanel("training");
                  }}>调整规则</button>
                </div>
              )}

              {taskDraft.mode !== "range" && taskDraft.mode !== "mistake" && (
                <fieldset className="task-pattern-filter">
                  <legend>形态筛选（可选）</legend>
                  <div className="task-pattern-head">
                    <span>{taskDraft.patternPresetIds?.length
                      ? `已选择 ${taskDraft.patternPresetIds.length} 个预设，任意一个命中即可`
                      : "不选择时沿用普通起点或完全随机抽样"}</span>
                    <button type="button" onClick={() => {
                      setShowTaskSetup(false);
                      openPatternFiltersPanel();
                    }}>管理预设</button>
                  </div>
                  <div className="task-pattern-options">
                    {patternPresets.map((preset) => {
                      const selected = taskDraft.patternPresetIds?.includes(preset.id) ?? false;
                      return (
                        <button
                          type="button"
                          key={preset.id}
                          className={selected ? "active" : ""}
                          title={preset.description}
                          onClick={() => toggleTaskPatternPreset(preset.id, selected)}
                        >{selected ? "✓ " : "+ "}{preset.name}</button>
                      );
                    })}
                  </div>
                  {taskDraft.patternPresetIds?.length ? (
                    <small>{taskSetupKind === "random"
                      ? "开始时会按训练设置的品种、周期和日期范围检查历史候选，命中后从该 K 线开始。"
                      : "开始时会扫描所选品种与周期，并从一个符合形态的历史 K 线开始。"}</small>
                  ) : null}
                </fieldset>
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
              {patternScanStatus && <div className="pattern-scan-status"><Activity size={14} />{patternScanStatus}</div>}
              <div className="task-modal-actions">
                <button className="ghost-button" onClick={() => setShowTaskSetup(false)}>取消</button>
                <button className="primary-button" disabled={startingTraining} onClick={() => void startConfiguredTraining()}><Play size={16} />{startingTraining ? "正在筛选…" : taskSetupKind === "random" ? "开始随机训练" : "开始训练"}</button>
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
              <p>{trainingTask.mode === "blind" ? "盲测答案现在已经解锁。" : "已到达本局设定的 K 线边界。"} 所有持仓已按最后一根收盘价自动平仓并保存，可以继续训练或抽取下一局。</p>
              <div className="random-complete-stats">
                <div><span>{tradingMode === "capital" ? "账户总盈亏" : "总收益率"}</span><strong className={totalPnl >= 0 ? "up" : "down"}>{tradingMode === "capital" ? money(totalPnl) : percent(totalReturnPct)}</strong></div>
                <div><span>{tradingMode === "capital" ? "账户权益" : "已实现收益率"}</span><strong>{tradingMode === "capital" ? money(equity) : percent(realizedReturnPct)}</strong></div>
                <div><span>本局进度</span><strong>{currentTaskProgress.revealed}/{currentTaskProgress.total}</strong></div>
              </div>
              <div className="random-complete-actions">
                <button className="resume-session" onClick={resumeCurrentTraining}><RotateCcw size={16} />继续训练</button>
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
                  <form className="drawing-text-editor" aria-label="文字标记输入" onSubmit={(event) => {
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
                    <button type="button" aria-label="取消文字标记" onClick={() => setDrawingTextOpen(false)}><X size={15} /></button>
                    <small>输入后按 Enter，再在图表上拖出文字区域；选中后可移动、缩放和改字。</small>
                  </form>
                )}

                {selectedDrawing && (
                  <div className={`drawing-property-bar ${selectedDrawing.name === "trainingTextBox" ? "text-box-properties" : ""}`} aria-label="绘图属性">
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
                    <label className="drawing-color-control" title={selectedDrawing.name === "trainingTextBox" ? "文字颜色" : "线条颜色"}>
                      <input
                        type="color"
                        value={selectedDrawingInputColor}
                        aria-label={selectedDrawing.name === "trainingTextBox" ? "文字颜色" : "线条颜色"}
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
                      dataIndexOffset={chartDataIndexOffset}
                      symbol={trainingTask?.hideInstrument ? "BLIND" : instrument.symbol}
                      timezone={instrument.timezone}
                      timeframe={timeframe}
                      pricePrecision={instrument.pricePrecision}
                      movingAverageSettings={movingAverageSettings}
                      drawingRequest={drawingRequest}
                      clearNonce={clearNonce}
                      tradeMarkers={tradeMarkers}
                      decisionMarkers={decisionMarkers}
                      drawings={drawings}
                      selectedDrawingId={selectedDrawingId}
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
                      <div className="decision-chart-actions">
                        <button type="button" className="ghost-button" onClick={() => editDecision(selectedDecision)}><Pencil size={14} />编辑</button>
                        <button type="button" className="danger-button" onClick={() => deleteDecision(selectedDecision)}><Trash2 size={14} />删除</button>
                      </div>
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
                    title={!marketRules.tradingEnabled ? tradingDisabledReason : !marketRules.allowShort ? `${marketRules.name}禁止卖出开仓` : ""}
                    onClick={() => queueOpenOrder("sell")}
                  ><TrendingDown size={16} /><span className="desktop-order-label">{!marketRules.tradingEnabled ? currentAssetType === "index" ? "指数不可交易" : "暂不可交易" : marketRules.allowShort ? "卖出开仓" : "A股禁做空"}</span><span className="mobile-order-label">{!marketRules.tradingEnabled ? "不可交易" : marketRules.allowShort ? "卖出" : "禁做空"}</span></button>
                  <button
                    className="buy-button"
                    disabled={trainingComplete || !marketRules.tradingEnabled}
                    title={!marketRules.tradingEnabled ? tradingDisabledReason : ""}
                    onClick={() => queueOpenOrder("buy")}
                  ><TrendingUp size={16} /><span className="desktop-order-label">{marketRules.tradingEnabled ? "买入开仓" : currentAssetType === "index" ? "指数不可交易" : "暂不可交易"}</span><span className="mobile-order-label">{marketRules.tradingEnabled ? "买入" : "不可交易"}</span></button>
                  <button className="flat-button" disabled={trainingComplete || !openPositions.some((position) => !pendingOrders.some((order) => order.action === "close" && order.positionId === position.id))} onClick={queueCloseAll}>
                    <CircleStop size={16} /><span className="desktop-order-label">{openPositions.length && !closablePositions.length ? "次日开盘全平" : "全部平仓"}</span><span className="mobile-order-label">{openPositions.length && !closablePositions.length ? "次日全平" : "全平"}</span>
                  </button>
                  {liveMode && (
                    <button className={`live-watch-button${liveWatchExists ? " active" : ""}`} disabled={liveWatchExists || !currentBar} onClick={addLiveWatch} title="加入实盘观望，不计入实盘交易表现">
                      <Eye size={16} /><span className="desktop-order-label">{liveWatchExists ? "已观望" : "观望"}</span><span className="mobile-order-label">{liveWatchExists ? "已观望" : "观望"}</span>
                    </button>
                  )}
                </div>
                <div className={`pending-note ${ruleNotice || !marketRules.tradingEnabled ? "rule-warning" : ""} ${ruleNotice || pendingOrders.length || !marketRules.tradingEnabled ? "has-message" : ""}`}>
                  {ruleNotice || (!marketRules.tradingEnabled
                    ? tradingDisabledReason
                    : pendingOrders.length
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
                <div><span>{editingDecisionId ? "编辑事前决策" : decisionTarget ? "补写事前决策" : "事前决策卡"}</span><strong>{planScore}%</strong></div>
                <p>{editingDecisionId ? "修改后会替换原记录，并保留原 K 线绑定" : decisionTarget ? "仅补充记录，不回退行情，也不改变持仓" : "先写计划，再揭示下一根"}</p>
              </div>
              {decisionTarget && (
                <div className="decision-backfill-target">
                  <div>
                    <span>{editingDecisionId ? "正在编辑" : "正在补写"}</span>
                    <strong>{trainingTask?.hideDate ? `K线 #${decisionTarget.dataIndex + 1}` : formatDate(decisionTarget.timestamp, timeframe)}</strong>
                    <small>{trainingTask?.hidePrice ? "参考价已隐藏" : `参考价 ${decisionTarget.referencePrice.toFixed(instrument.pricePrecision)}`}</small>
                  </div>
                  <button type="button" onClick={cancelDecisionBackfill}>取消</button>
                </div>
              )}
              <label>市场状态
                <select value={decision.marketState} onChange={(event) => updateDecision("marketState", event.target.value)}>
                  <option value="">请选择市场状态</option><option>趋势</option><option>宽通道</option><option>震荡区间</option><option>突破模式</option><option>反转尝试</option>
                </select>
              </label>
              <label>当前位置
                <select value={decision.location} onChange={(event) => updateDecision("location", event.target.value)}>
                  <option value="">请选择当前位置</option><option>回调位置</option><option>区间上沿</option><option>区间中部</option><option>区间下沿</option><option>关键突破位</option>
                </select>
              </label>
              <fieldset>
                <legend>
                  <span>交易理由 <small>至少 2 个</small></span>
                  <span className="reason-tag-management" aria-label="交易理由标签管理">
                    <button
                      type="button"
                      className={reasonTagActionMode === "edit" ? "active" : ""}
                      aria-label="编辑交易理由标签"
                      aria-pressed={reasonTagActionMode === "edit"}
                      title="编辑标签：再点击一个标签"
                      onClick={() => {
                        setReasonTagActionMode((mode) => mode === "edit" ? "" : "edit");
                        setEditingReasonTag("");
                        setEditingReasonInput("");
                      }}
                    ><Pencil size={12} /></button>
                    <button
                      type="button"
                      className={reasonTagActionMode === "delete" ? "active danger" : ""}
                      aria-label="删除交易理由标签"
                      aria-pressed={reasonTagActionMode === "delete"}
                      title="删除标签：再点击标签右上角的 X"
                      onClick={() => {
                        setReasonTagActionMode((mode) => mode === "delete" ? "" : "delete");
                        setEditingReasonTag("");
                        setEditingReasonInput("");
                      }}
                    ><Trash2 size={12} /></button>
                  </span>
                </legend>
                <div className="reason-chips">
                  {reasonTags.map((reason) => {
                    const selected = decision.reasons.includes(reason);
                    if (editingReasonTag === reason) {
                      return (
                        <form className="reason-tag-editor" key={reason} onSubmit={(event) => {
                          event.preventDefault();
                          saveReasonTagEdit();
                        }}>
                          <input
                            aria-label={`编辑交易理由标签 ${reason}`}
                            maxLength={20}
                            autoFocus
                            value={editingReasonInput}
                            onChange={(event) => setEditingReasonInput(event.target.value)}
                          />
                          <button type="submit" aria-label="保存交易理由标签" title="保存"><Save size={12} /></button>
                          <button type="button" aria-label="取消编辑交易理由标签" title="取消" onClick={cancelEditReasonTag}><X size={12} /></button>
                        </form>
                      );
                    }
                    return (
                      <span className={`reason-chip-wrap${reasonTagActionMode === "delete" ? " delete-mode" : ""}`} key={reason}>
                        <button
                          type="button"
                          className={selected ? "selected" : ""}
                          onClick={() => {
                            if (reasonTagActionMode === "edit") {
                              startEditReasonTag(reason);
                              return;
                            }
                            if (reasonTagActionMode === "delete") return;
                            updateDecision(
                              "reasons",
                              selected ? decision.reasons.filter((item) => item !== reason) : [...decision.reasons, reason],
                            );
                          }}
                        >{selected ? "✓ " : "+ "}{reason}</button>
                        {reasonTagActionMode === "delete" && (
                          <button
                            type="button"
                            className="reason-chip-delete"
                            aria-label={`删除交易理由标签 ${reason}`}
                            title="删除标签"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteReasonTag(reason);
                            }}
                          ><X size={10} /></button>
                        )}
                      </span>
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
                <div className="decision-price-level"><span>失效 / 止损</span><strong>{trainingTask?.hidePrice ? "已隐藏" : decision.stop || "图表取点"}</strong></div>
                <div className="decision-price-level"><span>第一目标</span><strong>{trainingTask?.hidePrice ? "已隐藏" : decision.target || "图表取点"}</strong></div>
                <button
                  type="button"
                  className={`decision-position-draw${drawings.some((drawing) => drawing.name === "trainingPosition") ? " active" : ""}`}
                  onClick={() => beginDrawing(trainingPositionTool)}
                ><TrendingUp size={14} /> 在图表绘制止损 / 目标</button>
              </div>
              <label>计划说明
                <textarea placeholder="我在等待什么？什么情况放弃？" value={decision.note} onChange={(event) => updateDecision("note", event.target.value)} />
              </label>
              <div className="discipline-card">
                <Sparkles size={18} />
                <div><strong>{decision.reasons.length >= 2 ? "条件已成形" : "再找一个独立理由"}</strong><span>评分关注过程，不用结果倒推理由</span></div>
              </div>
              <div className="submitted-plan-count">已提交 <strong>{decisionSubmissions.length}</strong> 份计划 · 右键或长按历史 K 线可补写</div>
              <button className="commit-plan" disabled={trainingComplete && !decisionTarget} onClick={submitDecision}><ListChecks size={17} />{editingDecisionId ? "保存编辑" : decisionTarget ? "保存补写决策" : trainingComplete ? "训练已结束" : "提交决策并揭示下一根"}</button>
            </aside>
          </div>
        )}

        {view === "replay" && liveMode && liveNavigatorResults.length ? (
          <div
            className="live-scan-navigator"
            style={{ transform: `translate(calc(-50% + ${liveBarOffset.x}px), ${liveBarOffset.y}px)` }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              liveBarDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: liveBarOffset.x,
                offsetY: liveBarOffset.y,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerUp={(event) => {
              if (liveBarDragRef.current?.pointerId === event.pointerId) liveBarDragRef.current = null;
            }}
            role="region"
            aria-label="实盘筛选结果导航"
          >
            <button type="button" aria-label="上一个筛选结果" title="上一个" onPointerDown={(event) => event.stopPropagation()} onClick={() => moveLiveScanResult(-1)}><ChevronLeft size={16} /></button>
            <div className="live-scan-navigator-label">
              <span>{liveNavigatorSource === "portfolio" ? "实盘观察" : liveNavigatorSource === "watch" ? "实盘观望" : "实盘筛选"}</span>
              <strong>{liveContext?.symbol ?? "--"}</strong>
              <small>{liveNavigatorDisplayIndex + 1} / {liveNavigatorResults.length}</small>
            </div>
            <button type="button" aria-label="下一个筛选结果" title="下一个" onPointerDown={(event) => event.stopPropagation()} onClick={() => moveLiveScanResult(1)}><ChevronRight size={16} /></button>
            <button
              type="button"
              className="live-scan-navigator-exit"
              aria-label="退出实盘观察"
              title="退出实盘观察"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                liveRequestRef.current = null;
                setLiveMode(false);
                setLiveContext(null);
                startFreshTraining(instrumentId, timeframe);
              }}
            ><X size={14} /></button>
          </div>
        ) : null}

        {view === "performance" && (
          <section className="content-page performance-page">
            <div className="page-heading">
              <div>
                <span>PERFORMANCE</span>
                <h1>训练表现</h1>
                <p>默认分析全部已保存训练；需要比较特定习惯时，再从上方筛选训练集。</p>
              </div>
            </div>

            <div className="performance-view-tabs" role="tablist" aria-label="表现视图">
              <button type="button" role="tab" aria-selected={performanceSection === "training"} className={performanceSection === "training" ? "active" : ""} onClick={() => setPerformanceSection("training")}>训练表现</button>
              <button type="button" role="tab" aria-selected={performanceSection === "live"} className={performanceSection === "live" ? "active" : ""} onClick={() => setPerformanceSection("live")}>实盘表现 <span>{filteredLivePerformanceRows.length}</span></button>
              <button type="button" role="tab" aria-selected={performanceSection === "watch"} className={performanceSection === "watch" ? "active" : ""} onClick={() => setPerformanceSection("watch")}>实盘观望 <span>{liveWatchlist.length}</span></button>
            </div>

            {performanceSection === "live" ? (
              <section className="live-performance-panel">
                <div className="performance-section-head">
                  <div><span className="section-label">LIVE PERFORMANCE</span><h2>实盘观察</h2></div>
                  <div className="live-performance-actions">
                    <small>实盘筛选标的不会进入训练表现；待成交不计入收益/胜率，撤单不保留。</small>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={livePriceRefreshRunning || (!livePortfolios.length && !liveWatchlist.length)}
                      onClick={() => void refreshLivePortfolioPrices()}
                    >
                      <RotateCcw size={13} />{livePriceRefreshRunning ? "同步中…" : "同步最新价"}
                    </button>
                  </div>
                </div>
                <div className="performance-overview live-performance-overview">
                  <div className="performance-hero"><span>实盘观察收益</span><strong className={livePerformanceSummary.total >= 0 ? "up" : "down"}>{livePerformanceCapitalMode ? money(livePerformanceSummary.total) : percent(livePerformanceSummary.total)}</strong><small>{livePerformanceSummary.instruments} 个品种，{livePerformanceSummary.openPositions} 个持仓，{livePerformanceSummary.pendingOrders} 笔待成交，{livePerformanceSummary.closedTrades} 笔已平仓</small></div>
                  <div className="performance-metric"><span>观察品种</span><strong>{livePerformanceSummary.instruments}</strong><small>来自实盘筛选结果；待成交也会保留</small></div>
                  <div className="performance-metric"><span>按成交的胜率</span><strong>{livePerformanceSummary.winRate}%</strong><small>{livePerformanceSummary.winning} 胜 / {livePerformanceSummary.losing} 负 / {livePerformanceSummary.flats} 平局</small></div>
                  <div className="performance-metric"><span>已实现收益</span><strong className={livePerformanceSummary.realized >= 0 ? "up" : "down"}>{livePerformanceCapitalMode ? money(livePerformanceSummary.realized) : percent(livePerformanceSummary.realized)}</strong><small>已平仓交易合计</small></div>
                  <div className="performance-metric"><span>浮动收益</span><strong className={livePerformanceSummary.floating >= 0 ? "up" : "down"}>{livePerformanceCapitalMode ? money(livePerformanceSummary.floating) : percent(livePerformanceSummary.floating)}</strong><small>按最新价重算</small></div>
                  <div className="performance-metric"><span>数据同步</span><strong>{filteredLivePerformanceRows.length ? "已同步" : "--"}</strong><small>不影响训练统计</small></div>
                </div>
                <article className="performance-filter-card live-performance-filter-card">
                  <div className="performance-section-head">
                    <div>
                      <span className="section-label">FILTER</span>
                      <h2>筛选实盘表现</h2>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => setLivePerformanceFilters(defaultLivePerformanceFilters)}>清除筛选</button>
                  </div>
                  <div className="performance-filters live-performance-filters">
                    <label>买入日期从
                      <input type="date" value={livePerformanceFilters.buyDateFrom} onChange={(event) => setLivePerformanceFilters((filters) => ({ ...filters, buyDateFrom: event.target.value }))} />
                    </label>
                    <label>买入日期至
                      <input type="date" value={livePerformanceFilters.buyDateTo} onChange={(event) => setLivePerformanceFilters((filters) => ({ ...filters, buyDateTo: event.target.value }))} />
                    </label>
                    <label>市场
                      <select value={livePerformanceFilters.market} onChange={(event) => setLivePerformanceFilters((filters) => ({ ...filters, market: event.target.value as LivePerformanceFilters["market"] }))}>
                        <option value="all">全部市场</option>
                        <option value="CN">A股</option>
                        <option value="US">美股</option>
                      </select>
                    </label>
                    <label>持有状态
                      <select value={livePerformanceFilters.holdingStatus} onChange={(event) => setLivePerformanceFilters((filters) => ({ ...filters, holdingStatus: event.target.value as LivePerformanceFilters["holdingStatus"] }))}>
                        <option value="all">全部状态</option>
                        <option value="holding">持仓中</option>
                        <option value="pending">待成交</option>
                        <option value="closed">已平仓</option>
                      </select>
                    </label>
                    <label>盈亏
                      <select value={livePerformanceFilters.outcome} onChange={(event) => setLivePerformanceFilters((filters) => ({ ...filters, outcome: event.target.value as LivePerformanceFilters["outcome"] }))}>
                        <option value="all">全部盈亏</option>
                        <option value="profit">盈利</option>
                        <option value="loss">亏损</option>
                        <option value="flat">持平/无盈亏</option>
                      </select>
                    </label>
                  </div>
                  <small className="live-performance-filter-hint">买入日期按持仓开仓时间或待成交买入订单时间匹配；筛选结果会同步更新上方统计。</small>
                </article>
                <div className="performance-sessions live-performance-sessions">
                  <div className="performance-section-head"><div><span className="section-label">WATCHLIST</span><h2>实盘观察标的</h2></div><div className="live-performance-actions"><small>点击打开标的，继续观察或交易</small><button type="button" className="ghost-button live-review-button" disabled={!livePortfolios.length} onClick={reviewLivePortfolios}><BookOpenCheck size={13} />审阅</button></div></div>
                  {filteredLivePerformanceRows.length ? (
                    <div className="live-performance-list">
                      {filteredLivePerformanceRows.map((row) => {
                        const capital = row.portfolio.tradingMode === "capital";
                        const buyTimestamp = row.buyTimestamps.length ? Math.min(...row.buyTimestamps) : null;
                        return (
                          <div className="live-performance-row" key={row.portfolio.id}>
                            <span className="live-performance-instrument"><strong>{row.portfolio.symbol}</strong><small>{row.portfolio.name}</small></span>
                            <span><strong>{row.portfolio.market === "CN" ? "A股" : "美股"}</strong><small>{new Date(row.portfolio.latestTimestamp).toLocaleDateString("zh-CN")}</small></span>
                            <span><strong>{row.open.length} 个持仓</strong><small>{buyTimestamp === null ? "暂无买入日期" : `买入 ${new Date(buyTimestamp).toLocaleDateString("zh-CN")} · `}{row.pending.length} 笔待成交 · {row.closed.length} 笔已平</small></span>
                            <span className="live-performance-result"><strong className={row.total >= 0 ? "up" : "down"}>{capital ? money(row.total) : percent(row.total)}</strong><small>已实现 {capital ? money(row.realized) : percent(row.realized)} · 浮动 {capital ? money(row.floating) : percent(row.floating)}</small></span>
                            <button type="button" className="ghost-button" onClick={() => openLivePortfolio(row.portfolio)}><BarChart3 size={14} />打开实盘</button>
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="empty-state">{livePerformanceRows.length ? "当前筛选条件下没有匹配的实盘表现。" : "还没有实盘订单或持仓。已撤单的委托不会出现在这里。"}</div>}
                </div>
              </section>
            ) : performanceSection === "watch" ? (
              <section className="live-performance-panel">
                <div className="performance-section-head">
                  <div><span className="section-label">LIVE WATCH</span><h2>实盘观望</h2></div>
                  <small>观望记录不会进入实盘交易表现或训练表现；以加入观望当日开盘价为基准，持续计算到最新价</small>
                </div>
                <div className="performance-overview live-performance-overview live-watch-performance-overview">
                  <div className="performance-hero"><span>观望收益率</span><strong className={liveWatchPerformanceSummary.total === null || liveWatchPerformanceSummary.total >= 0 ? "up" : "down"}>{liveWatchPerformanceSummary.total === null ? "--" : percent(liveWatchPerformanceSummary.total)}</strong><small>{liveWatchPerformanceSummary.instruments} 个品种，{liveWatchPerformanceSummary.winning} 个上涨，{liveWatchPerformanceSummary.losing} 个下跌，{liveWatchPerformanceSummary.flats} 个持平，{liveWatchPerformanceSummary.pending} 个待计算</small></div>
                  <div className="performance-metric"><span>观望品种</span><strong>{liveWatchPerformanceSummary.instruments}</strong><small>按加入观望当日开盘价记录</small></div>
                  <div className="performance-metric"><span>价格胜率</span><strong>{liveWatchPerformanceSummary.winRate === null ? "--" : `${liveWatchPerformanceSummary.winRate}%`}</strong><small>{liveWatchPerformanceSummary.winning} 上涨 / {liveWatchPerformanceSummary.losing} 下跌 / {liveWatchPerformanceSummary.flats} 持平</small></div>
                  <div className="performance-metric"><span>浮动收益率</span><strong className={liveWatchPerformanceSummary.floating === null || liveWatchPerformanceSummary.floating >= 0 ? "up" : "down"}>{liveWatchPerformanceSummary.floating === null ? "--" : percent(liveWatchPerformanceSummary.floating)}</strong><small>按观望当日开盘价计算，等权平均</small></div>
                  <div className="performance-metric"><span>总收益率</span><strong className={liveWatchPerformanceSummary.totalReturn === null || liveWatchPerformanceSummary.totalReturn >= 0 ? "up" : "down"}>{liveWatchPerformanceSummary.totalReturn === null ? "--" : percent(liveWatchPerformanceSummary.totalReturn)}</strong><small>当前总价 ÷ 观望日开盘总价 − 1</small></div>
                  <div className="performance-metric"><span>已实现收益</span><strong>--</strong><small>观望不产生买卖成交</small></div>
                  <div className="performance-metric"><span>数据同步</span><strong>{liveWatchPerformanceSummary.instruments ? "已同步" : "--"}</strong><small>{liveWatchPerformanceSummary.priced}/{liveWatchPerformanceSummary.instruments} 个已完成观望收益计算</small></div>
                </div>
                <div className="performance-sessions live-performance-sessions">
                  <div className="performance-section-head"><div><span className="section-label">WATCHLIST</span><h2>观望列表</h2></div><button type="button" className="ghost-button" disabled={livePriceRefreshRunning || !liveWatchlist.length} onClick={() => void refreshLivePortfolioPrices()}><RotateCcw size={13} />同步最新价</button></div>
                  {liveWatchlist.length ? (
                    <div className="live-performance-list">
                      {liveWatchPerformanceRows.map((row) => {
                        const { watch, observationTimestamp, observationPrice, pending, change, returnPct } = row;
                        const result = liveWatchResult(watch);
                        const index = liveWatchlist.findIndex((item) => item.instrumentId === watch.instrumentId);
                        return (
                          <div className="live-performance-row live-watch-row" key={watch.id}>
                            <span className="live-performance-instrument"><strong>{watch.symbol}</strong><small>{watch.name}</small></span>
                            <span><strong>{watch.market === "CN" ? "A股" : "美股"}</strong><small>{new Date(watch.latestTimestamp).toLocaleDateString("zh-CN")}</small></span>
                            <span><strong>{watch.latestClose.toFixed(4)}</strong><small>最新价 · 观望日开盘基准 {observationPrice.toFixed(4)} · {new Date(observationTimestamp).toLocaleDateString("zh-CN")}</small></span>
                            <span className="live-performance-result"><strong className={returnPct === null || returnPct >= 0 ? "up" : "down"}>{pending ? "待计算" : returnPct === null ? "--" : percent(returnPct)}</strong><small>{pending ? "观望日行情尚未产生后续价格" : change === null ? "观望基准价不可用" : `开盘基准 ${observationPrice.toFixed(4)} · 价格变动 ${priceDelta(change)} · ${watch.presetNames.length ? watch.presetNames.join(" · ") : "未设置形态"}`}</small></span>
                            <span className="live-watch-row-actions"><button type="button" className="ghost-button" onClick={() => openLiveScanResult(result, index >= 0 ? index : undefined, "watch")}><BarChart3 size={14} />打开</button><button type="button" className="row-action danger" onClick={() => removeLiveWatch(watch.instrumentId)}>移除</button></span>
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="empty-state">还没有实盘观望记录。在实盘浏览中点击“观望”即可加入。</div>}
                </div>
              </section>
            ) : (
              <>
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
                <label>市场
                  <select value={performanceFilters.market} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, market: event.target.value }))}>
                    <option value="all">全部市场</option>
                    {performanceMarketOptions.map((value) => <option key={value} value={value}>{performanceMarketLabel(value)}</option>)}
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
                <label>形态筛选
                  <select value={performanceFilters.patternPresetId} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, patternPresetId: event.target.value }))}>
                    <option value="all">全部训练</option>
                    <option value="none">未使用形态筛选</option>
                    {performancePatternOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
                <label>状态
                  <select value={performanceFilters.status} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, status: event.target.value as PerformanceFilters["status"] }))}>
                    <option value="all">全部状态</option>
                    <option value="completed">已完成</option>
                    <option value="active">可继续</option>
                  </select>
                </label>
                <label>盈亏
                  <select value={performanceFilters.outcome} onChange={(event) => setPerformanceFilters((filters) => ({ ...filters, outcome: event.target.value as PerformanceFilters["outcome"] }))}>
                    <option value="all">全部盈亏</option>
                    <option value="profit">盈利</option>
                    <option value="loss">亏损</option>
                    <option value="flat">持平</option>
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
                <span className="section-label">当前训练集</span>
                <h2>{filteredPerformance.sessions} 场训练的表现</h2>
              </div>
              <small>默认展示全部已保存训练；指标和分析会随上方筛选条件即时更新。</small>
            </div>
            <div className="performance-overview">
              <div className="performance-hero">
                <span>{performanceUsesCapital ? "累计总盈亏" : "训练收益率合计"}</span>
                <strong className={filteredPerformance.totalPnl >= 0 ? "up" : "down"}>{formatPerformanceValue(filteredPerformance.totalPnl)}</strong>
                <small>{performanceUsesCapital
                  ? `已实现 ${money(filteredPerformance.realizedPnl)} · 浮动 ${money(filteredPerformance.floatingPnl)}`
                  : `已实现收益率合计 ${percent(filteredPerformance.realizedPnl)} · 浮动收益率合计 ${percent(filteredPerformance.floatingPnl)}`}</small>
              </div>
              <div className="performance-metric">
                <span>训练场次</span>
                <strong>{filteredPerformance.sessions}</strong>
                <small>{filteredPerformance.completedSessions} 场完成 · 完成率 {filteredPerformance.completionRate}%</small>
              </div>
              <div className="performance-metric">
                <span>按交易胜率</span>
                <strong>{filteredPerformance.winRate}%</strong>
                <small>{filteredPerformance.closedTrades} 笔：{filteredPerformance.winningTrades} 胜 / {filteredPerformance.losingTrades} 负 / {filteredPerformance.flatTrades} 平 · 平局不计入胜率</small>
              </div>
              <div className="performance-metric">
                <span>按训练胜率</span>
                <strong>{filteredPerformance.sessionWinRate}%</strong>
                <small>{filteredPerformance.winningSessions} 胜 / {filteredPerformance.losingSessions} 负 / {filteredPerformance.flatSessions} 平 · 平局不计入胜率</small>
              </div>
              <div className="performance-metric">
                <span>{performanceUsesCapital ? "平均每场盈亏" : "平均每场收益率"}</span>
                <strong className={filteredPerformance.averagePnl >= 0 ? "up" : "down"}>{formatPerformanceValue(filteredPerformance.averagePnl)}</strong>
                <small>最大回撤 {formatPerformanceValue(-filteredPerformance.maxDrawdown)}</small>
              </div>
              <div className="performance-metric">
                <span>Profit Factor</span>
                <strong>{profitFactorLabel(filteredPerformance.profitFactor)}</strong>
                <small>计划完整度 {filteredPerformance.averagePlanScore}% · {filteredPerformance.planCount} 份计划</small>
              </div>
            </div>

            <section className="performance-analysis">
              <div className="performance-section-head">
                <div><span className="section-label">习惯优势分析</span><h2>什么组合最适合你</h2></div>
                <small>按每笔已平仓交易的平均{performanceUsesCapital ? "盈亏" : "收益率"}排序；至少 2 笔才标为当前最优。严格事前计划优先，旧版补写计划作为兼容样本并单独标明。</small>
              </div>
              <div className="performance-analysis-grid">
                <PerformanceInsightCard title="最优持仓时长" description="按持有的约略 K 线根数分组" items={performanceHabitAnalysis.holdingPeriods} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优市场状态" description="来自事前决策卡的市场状态" items={performanceHabitAnalysis.marketStates} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优当前位置" description="来自事前决策卡的入场位置" items={performanceHabitAnalysis.locations} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优交易理由" description="每个理由标签独立统计" items={performanceHabitAnalysis.reasons} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优计划习惯" description="完整度及止损、目标、说明填写习惯" items={performanceHabitAnalysis.planTraits} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优交易形态" description="使用实际命中的训练形态" items={performanceHabitAnalysis.patterns} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优价格区间" description="按每笔交易的实际开仓价格分组，并区分 A 股与美股币种" items={performanceHabitAnalysis.priceRanges} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优平均成交量区间" description="按开仓前 20 个交易日的日均成交股数分组" items={performanceHabitAnalysis.volumeRanges} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard title="最优平均成交额区间" description="按开仓前 20 个交易日的日均成交额分组" items={performanceHabitAnalysis.turnoverRanges} formatResult={formatPerformanceValue} />
                <PerformanceInsightCard
                  title="最优市值区间"
                  description="按开仓时可获得的证券市值资料分组"
                  items={performanceHabitAnalysis.marketCapRanges}
                  formatResult={formatPerformanceValue}
                  emptyText="当前 K 线和证券目录没有提供流通股本或市值，接入基础资料后会自动参与统计。"
                />
                <PerformanceInsightCard title="最优习惯组合" description={`形态 + 市场状态 + 位置 + 理由；已归因 ${performanceHabitAnalysis.attributedTrades} 笔（严格事前 ${performanceHabitAnalysis.pretradeAttributedTrades}，补写兼容 ${performanceHabitAnalysis.backfilledAttributedTrades}）`} items={performanceHabitAnalysis.combinations} formatResult={formatPerformanceValue} wide />
              </div>
            </section>

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
                    <span>训练</span><span>模式 / 区间</span><span>状态</span><span>{performanceUsesCapital ? "总盈亏" : "总收益率"}</span><span>保存时间</span><span>操作</span>
                  </div>
                  {filteredSessionSummaries.map((summary) => (
                    <div
                      className={`performance-session-row ${selectedPerformanceSession?.session.id === summary.session.id ? "selected" : ""}`}
                      key={summary.session.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`选择训练 ${summary.session.instrumentId} ${summary.session.timeframe}`}
                      onClick={() => setSelectedPerformanceSessionId(summary.session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedPerformanceSessionId(summary.session.id);
                        }
                      }}
                    >
                      <span><strong>{summary.session.instrumentId}</strong><small>{summary.session.timeframe}</small></span>
                      <span><strong>{summary.modeLabel}</strong><small>{summary.rangeLabel}{summary.task?.patternFilter ? ` · 形态：${summary.task.patternFilter.presetNames.join("、") || summary.task.patternFilter.presetIds.join("、")}` : ""}</small></span>
                      <span className={summary.task?.status === "completed" ? "session-status completed" : "session-status"}>{summary.task?.status === "completed" ? "已完成" : "可继续"}</span>
                      <span className="performance-session-result">
                        <strong className={(summary.state.tradingMode === "capital" ? summary.pnl.total : summary.returnPct) >= 0 ? "up" : "down"}>{summary.state.tradingMode === "capital" ? money(summary.pnl.total) : percent(summary.returnPct)}</strong>
                        <small>{summary.closedTradePnls.length} 笔已平仓 · {summary.winningTrades}胜/{summary.losingTrades}负/{summary.flatTrades}平</small>
                      </span>
                      <time>{new Date(summary.session.updatedAt).toLocaleString("zh-CN")}</time>
                      <span className="performance-row-actions">
                        <button
                          className="review-session"
                          onClick={(event) => {
                            event.stopPropagation();
                            inspectSession(summary.session, true);
                          }}
                        ><BookOpenCheck size={14} />查看复盘</button>
                        <button
                          className="resume-session"
                          onClick={(event) => {
                            event.stopPropagation();
                            resumeSession(summary.session);
                          }}
                        ><RotateCcw size={14} />继续训练</button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">没有符合当前筛选条件的训练，可以清除筛选后重新选择。</div>
              )}

            </article>
              </>
            )}
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
                // Keep live-observation marks in sync when the database page
                // finishes an import, incremental update, or repair.
                void refreshLivePortfolioPrices();
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
              <div className="metric-card"><span>本场按交易胜率</span><strong>{reviewTradeWinRate}%</strong><small>{reviewWinningTrades} 胜 / {reviewLosingTrades} 负 / {reviewFlatTrades} 平 · 平局不计入胜率分母</small></div>
              <div className="metric-card"><span>已提交计划</span><strong>{reviewState.decisionSubmissions.length}</strong><small>每次提交均绑定原始K线</small></div>
              <div className="metric-card"><span>本场训练结果</span><strong className={reviewTotalResult >= 0 ? "up" : "down"}>{reviewState.tradingMode === "capital" ? money(reviewTotalResult) : percent(reviewTotalResult)}</strong><small>{reviewTotalResult > 0 ? "本场计为训练胜" : reviewTotalResult < 0 ? "本场计为训练负" : "本场计为训练平"} · {reviewState.executions.length} 笔成交</small></div>
            </div>
            <div className="review-columns">
              <div className="review-module-stack">
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
                <div className="evidence-row"><span>形态筛选</span><strong>{reviewPatternFilter
                  ? `选择：${reviewPatternFilter.presetNames.join("、") || reviewPatternFilter.presetIds.join("、")}；本局命中：${reviewMatchedPatternNames.join("、") || "未记录"}`
                  : "未使用形态筛选"}</strong></div>
                <div className="evidence-row"><span>任务状态</span><strong>{reviewState.trainingTask?.status === "completed" ? "已完成" : "进行中"}</strong></div>
                <div className="evidence-row"><span>市场规则</span><strong>{reviewState.marketRules ? `${reviewState.marketRules.name} · ${reviewState.marketRules.version}` : "旧训练未锁定规则版本"}</strong></div>
                <div className="evidence-row"><span>交易账户</span><strong>{reviewState.tradingMode === "capital" ? `资金账户 · 初始 ${reviewState.initialCapital.toFixed(2)} · 现金 ${reviewState.cashBalance.toFixed(2)}` : "收益率模式 · 不限制本金"}</strong></div>
                <div className="evidence-row"><span>规则拒单</span><strong>{reviewState.orderRejections.length}</strong></div>
                <div className="review-note"><span>计划说明</span><p>{reviewDecision.note || "未填写"}</p></div>
              </article>
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
              </div>
              <div className="review-module-stack">
              <article className="history-card">
                <div className="history-card-head">
                  <div>
                    <div className="section-label">可恢复训练</div>
                    <strong>{filteredReviewSessionSummaries.length} / {sessionSummaries.length} 场</strong>
                  </div>
                  <button
                    className="history-filter-reset"
                    onClick={() => setReviewSessionFilters(defaultReviewSessionFilters)}
                    disabled={Object.entries(reviewSessionFilters).every(([key, value]) => value === defaultReviewSessionFilters[key as keyof ReviewSessionFilters])}
                  >清除筛选</button>
                </div>
                <div className="review-session-filters">
                  <label className="review-session-search">
                    <span>搜索</span>
                    <input
                      value={reviewSessionFilters.query}
                      onChange={(event) => setReviewSessionFilters((filters) => ({ ...filters, query: event.target.value }))}
                      placeholder="代码、模式或形态"
                    />
                  </label>
                  <label>
                    <span>周期</span>
                    <select value={reviewSessionFilters.timeframe} onChange={(event) => setReviewSessionFilters((filters) => ({ ...filters, timeframe: event.target.value }))}>
                      <option value="all">全部周期</option>
                      {timeframes.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>模式</span>
                    <select value={reviewSessionFilters.modeLabel} onChange={(event) => setReviewSessionFilters((filters) => ({ ...filters, modeLabel: event.target.value }))}>
                      <option value="all">全部模式</option>
                      {reviewModeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>状态</span>
                    <select value={reviewSessionFilters.status} onChange={(event) => setReviewSessionFilters((filters) => ({ ...filters, status: event.target.value as ReviewSessionFilters["status"] }))}>
                      <option value="all">全部状态</option>
                      <option value="completed">已完成</option>
                      <option value="active">可继续</option>
                    </select>
                  </label>
                </div>
                <div className="review-session-scroll" tabIndex={0} aria-label="全部可恢复训练，可滚动浏览">
                {filteredReviewSessionSummaries.length ? filteredReviewSessionSummaries.map((summary) => (
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
                        {summary.task?.patternFilter && <span>形态：{summary.task.patternFilter.presetNames.join("、") || summary.task.patternFilter.presetIds.join("、")}</span>}
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
                      <button className="delete-session" aria-label={`将 ${summary.session.instrumentId} 训练移入回收站`} onClick={() => deleteSession(summary.session)}>
                        <Trash2 size={13} />移入回收站
                      </button>
                    </div>
                  </div>
                )) : <div className="empty-state">{sessionSummaries.length ? "没有符合当前筛选条件的训练。" : "这里还没有保存记录。点击“保存训练”，或完成一场有结束边界的训练后，才会出现在这里。"}</div>}
                </div>
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
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
