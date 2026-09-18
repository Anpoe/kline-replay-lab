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
  Search,
  Settings2,
  Shuffle,
  Star,
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
  type PriceSelectionMode,
  type ProtectionLine,
  type ProtectionPriceKind,
  type TradeMarker,
} from "./KLineReplayChart";
import { dataMarkets, marketRuleCode, marketSelectionLabel, type DataMarket } from "../lib/dataMarkets";
import {
  deriveProtectionLines,
  resetConsumedStopDraftAfterFlatten,
  resetConsumedStopDraftAfterOpenFills,
} from "../lib/tradeProtection";
import {
  configuredDefaultOrderQuantity,
  configuredDefaultOrderQuantityForRequest,
  defaultAppSettings,
  normalizeSettings,
  timeframes,
  tradingModeForInstrument,
  type AppSettings,
  type PositionSizeMode,
  type SettingsTab,
} from "../features/settings/settingsContracts";
import { persistSettingsSave } from "../features/settings/settingsController";
import {
  createPreferencesGateway,
  createSettingsStorageGateway,
  defaultReasonTags as reasonOptions,
  normalizeReasonTags,
} from "../features/settings/settingsGateway";
import { SettingsPanel } from "../features/settings/components/SettingsPanel";
import { PersonalSopRecommendations } from "../features/sop/components/PersonalSopRecommendations";
import { evaluateDisciplineGate } from "../features/sop/sopController";
import { DataSourceManager } from "../features/market-data/components/DataSourceManager";
import { createMarketDataGateway } from "../features/market-data/marketDataGateway";
import type { CorporateActionEvent, CorporateActionMarker } from "../lib/corporateActions";
import {
  CASH_DIVIDEND_INCOME_EVENT_TYPE,
  cashDividendCreditsForBar,
  cashDividendIncomeFromEvents,
  corporateActionMarkersForBars,
} from "../lib/corporateActions";
import {
  adjustmentLabel,
  defaultAdjustmentTypeForInstrument,
  defaultAdjustmentTypeForMarket,
} from "../lib/marketAdjustments";
import {
  buildReviewSessionSummariesInBatches,
  filterReviewSessions,
  hasMeaningfulTrainingActivity,
  REVIEW_SESSION_SUMMARY_BATCH_SIZE,
} from "../features/review/reviewController";
import {
  defaultReviewSessionFilters,
  type ReviewSessionFilters,
} from "../features/review/reviewContracts";
import { createReviewGateway } from "../features/review/reviewGateway";
import { ReviewPanel } from "../features/review/components/ReviewPanel";
import { ReviewChartPreview } from "../features/review/components/ReviewChartPreview";
import { SessionHistoryPanel, type AuditEventItem, type SessionHistoryItem } from "../features/review/components/SessionHistoryPanel";
import {
  buildLiveScanRequest,
  normalizeLiveScanError,
  normalizeLiveScanLimit,
  selectLiveNavigatorIndex,
} from "../features/live/liveScanController";
import { shouldRefreshLivePricesAfterAutoUpdate } from "../features/live/liveAutoRefresh";
import { createLiveGateway } from "../features/live/liveGateway";
import type { LiveScanMarket, LiveScanResponse, LiveScanResult, LiveScanSort } from "../features/live/liveScanContracts";
import { LiveScanPanel } from "../features/live/components/LiveScanPanel";
import { ProviderSettingsPanel } from "../features/market-data/components/ProviderSettingsPanel";
import {
  aggregateCandles as aggregateFxCandles,
  aggregateM1To5m,
  bucketStartTimestamp,
  type FxTimeframe,
} from "../lib/fx/dukascopyAggregation";
import { parseDukascopyCsv } from "../lib/fx/dukascopyCsv";
import {
  aggregateCandlesToTimeframe,
  canAggregateTimeframe,
  timeframeBucketKey,
  type SupportedTimeframe,
} from "../lib/timeframeAggregation";
import {
  availableTimeframesForInstrument,
  resolveAvailableTimeframe,
} from "../lib/timeframeAvailability";
import { TIMEFRAME_IDS, timeframeLabel, timeframeLookbackMs, timeframeMinutes } from "../lib/timeframeCatalog";
import { visibleTimeframeViewBars } from "../lib/timeframeView";
import {
  CN_A_MAINBOARD_RULES_V1,
  buyQuantityStep,
  createPriceBand,
  describeBuyQuantity,
  findNextTradingSessionIndex,
  minimumBuyQuantity,
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
  createLegacyTrainingTask,
  defaultTrainingTaskDraft,
  finishTask,
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
  advanceReplayCursor,
  createReplayTradingSessionPredicate,
  firstReplaySkippedBarIndex,
  isReplayOrderDueAtBar,
} from "../lib/replayTradingSession";
import {
  markTrainingAutosaveSaved,
  observeTrainingAutosave,
  resetTrainingAutosaveGate,
  type TrainingAutosaveGate,
} from "../lib/trainingAutosave";
import {
  analyzePerformanceHabits,
  summarizePerformance,
  type HabitTrade,
  type PerformanceBreakdown,
  type PerformanceRecord,
} from "../lib/performance";
import {
  deriveSopInstrumentContext,
  generatePersonalSopRecommendations,
  evaluatePersonalSopManagement,
  holdingBarsAtCursor,
  personalSopTemplateScopes,
  recommendationToPersonalSopRule,
  summarizePersonalSopScopes,
  type PersonalSopRecommendation,
} from "../lib/performanceSop";
import {
  createDefaultPatternCondition,
  defaultPatternPresets,
  findPatternMatches,
  isPatternPresetAvailable,
  normalizePatternPresets,
  patternConditionDefinitions,
  patternParameterDefinitions,
  visiblePatternPresets,
  type PatternCandle,
  type PatternCondition,
  type PatternConditionKind,
  type PatternMatch,
  type PatternPreset,
} from "../lib/patternFilters";
import {
  applyHiddenBuiltInPatternPresetIds,
  hiddenBuiltInPatternPresetIds,
  PATTERN_PRESET_RESTORE_ACTION,
} from "../lib/patternPresetPersistence";
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
import { findStrongestTrainingWindowOverlap } from "../lib/randomTrainingOverlap";
import { createUuid } from "../lib/uuid";
import {
  accountEquity,
  accountMarketValue,
  availableCash as calculateAvailableCash,
  executionCashFlow,
  portfolioReturnPct,
  positionReturnPct,
  type TradingMode,
} from "../lib/tradingAccount";
import {
  DEFAULT_EXECUTION_COST_PROFILE,
  EXECUTION_ENGINE_VERSION,
  estimatedBuyCashRequired,
  executionFee,
  executionPrice,
  executionPriceFromQuote,
  executeBarStep,
  normalizeExecutionCostProfile,
  type ExecutionCostProfile,
  type ExecutionReason,
  type OrderType,
} from "../lib/executionEngine";
import { resolveLivePendingOrderPrice } from "../lib/liveOrderExecution";
import {
  accountNotional,
  isMarginEconomics,
  marginAccountSnapshot,
  markToMarketPnl,
  pipValueInAccount,
  requiredMargin,
  type InstrumentEconomics,
} from "../lib/fxTrading";
import {
  calculateDeterministicReviewMetrics,
  type DeterministicReviewMetrics,
} from "../lib/reviewMetrics";
import { calculateRiskSizedQuantity, inferRiskSizingSide } from "../lib/riskSizing";
import {
  evaluateOpeningGap,
  nextOpeningGapMode,
  type OpeningGapMode,
  type OpeningGapUnit,
} from "../lib/openingGapFilter";

/*
 * Legacy compatibility contracts intentionally remain documented at the shell boundary while
 * their reads/writes live in feature gateways: kline-replay-lab:last-training,
 * MOVING_AVERAGE_SETTINGS_KEY, REASON_TAGS_KEY, CUSTOM_REASON_TAGS_KEY,
 * QUICK_RANDOM_PATTERN_KEY, RANDOM_TRAINING_PATTERN_PRESETS_KEY.
 * normalizeReasonTagText is implemented by the settings gateway. The gateway transport preserves
 * fetch("/api/live-state") and fetch("/api/candles?instruments=1", { cache: "no-store" }) contracts.
 */

type View = "replay" | "performance" | "database" | "review";
type WatchlistSource = "watchlist" | "recent" | "scan";

const WATCHLIST_COLLAPSED_STORAGE_KEY = "kline-training:watchlist-collapsed";
const WATCHLIST_RECENT_STORAGE_KEY = "kline-training:watchlist-recent";

type Instrument = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  timezone: string;
  pricePrecision: number;
  assetType?: InstrumentAssetType;
  marketCap?: number;
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
type LiveWatchMarket = LiveScanMarket | "FX" | "GOLD";

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

function randomScopeIncludesMarket(
  mode: AppSettings["randomInstrumentMode"],
  selectedMarket: string,
  currentMarket: string,
  targetMarket: "CN" | "US",
) {
  if (mode === "all") return true;
  const scopedMarket = mode === "market" ? selectedMarket : currentMarket;
  return marketRuleCode(scopedMarket).toUpperCase() === targetMarket;
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
    const isDefaultQuery = !normalized || normalized === selectedText.toLowerCase();
    const filtered = isDefaultQuery
      ? instruments
      : instruments.filter((item) => [item.id, item.short, item.label].some((value) => value.toLowerCase().includes(normalized)));
    const result = filtered.slice(0, 40);
    if (selected && isDefaultQuery) {
      return [selected, ...result.filter((item) => item.id !== selected.id)].slice(0, 40);
    }
    return result;
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
type PositionSide = "long" | "short";
type OrderAction = "open" | "close";
type SopDisciplineMetadata = {
  kind: "personal-sop";
  ruleId: string;
  ruleVersion: string;
  violation: "entry-mismatch" | "holding-limit";
};
type PendingOrder = {
  id: string;
  action: OrderAction;
  side: "buy" | "sell";
  qty: number;
  createdAt: number;
  positionId: string;
  decisionSubmissionId?: string;
  ruleId?: string;
  ruleVersion?: string;
  priceBand?: PriceBand | null;
  reservedCash?: number;
  executeAtTimestamp?: number;
  orderType?: OrderType;
  triggerPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  engineVersion?: string;
  reason?: ExecutionReason;
  originalQty?: number;
  filledQty?: number;
  sizingMode?: PositionSizeMode;
  riskPercent?: number;
  riskBudget?: number;
  reservedMargin?: number;
  instrumentEconomics?: InstrumentEconomics;
  discipline?: SopDisciplineMetadata;
};
type PositionLot = {
  id: string;
  side: PositionSide;
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  entryOrderId: string;
  decisionSubmissionId?: string;
  entryOrderType?: OrderType;
  entryIntrabar?: boolean;
  status: "open" | "closed";
  exitPrice?: number;
  exitTimestamp?: number;
  exitOrderId?: string;
  realizedPnl?: number;
  grossRealizedPnl?: number;
  entryFee?: number;
  exitFee?: number;
  totalFees?: number;
  stopLoss?: number;
  takeProfit?: number;
  initialRisk?: number;
  exitReason?: ExecutionReason;
  intrabarAmbiguous?: boolean;
  engineVersion?: string;
  sizingMode?: PositionSizeMode;
  riskPercent?: number;
  riskBudget?: number;
  marginUsed?: number;
  instrumentEconomics?: InstrumentEconomics;
  discipline?: SopDisciplineMetadata;
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
  decisionSubmissionId?: string;
  realizedPnl: number;
  grossRealizedPnl?: number;
  rawPrice?: number;
  quotePrice?: number;
  quoteSide?: "bid" | "ask" | "mid";
  fee?: number;
  priceImpactCost?: number;
  orderType?: OrderType;
  triggerPrice?: number;
  reason?: ExecutionReason;
  intrabarAmbiguous?: boolean;
  partial?: boolean;
  remainingQty?: number;
  notionalValue?: number;
  marginImpact?: number;
  accountCurrency?: string;
  engineVersion?: string;
  ruleId?: string;
  ruleVersion?: string;
  discipline?: SopDisciplineMetadata;
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
  autoGenerated?: boolean;
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
  market: LiveWatchMarket;
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

// The live ledger predates conditional entry orders and its persisted table
// cannot grow new columns during this phase. Keep the order fields in the
// existing JSON price-band slot at the API boundary, then restore the normal
// PendingOrder shape as soon as data returns to the workbench.
const LIVE_ORDER_METADATA_KEY = "__klineOrderMetadata";
type LiveOrderMetadata = Pick<PendingOrder, "orderType" | "triggerPrice" | "stopLoss" | "takeProfit">;

function normalizeLiveOrderMetadata(value: unknown): LiveOrderMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<LiveOrderMetadata>;
  const metadata: LiveOrderMetadata = {};
  if (candidate.orderType === "market" || candidate.orderType === "limit" || candidate.orderType === "stop") {
    metadata.orderType = candidate.orderType;
  }
  for (const key of ["triggerPrice", "stopLoss", "takeProfit"] as const) {
    const numberValue = Number(candidate[key]);
    if (Number.isFinite(numberValue) && numberValue > 0) metadata[key] = numberValue;
  }
  return Object.keys(metadata).length ? metadata : null;
}

function restoreLivePendingOrder(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const order = value as PendingOrder;
  if (!order.priceBand || typeof order.priceBand !== "object") return order;
  const storedBand = order.priceBand as PriceBand & Record<string, unknown>;
  const metadata = normalizeLiveOrderMetadata(storedBand[LIVE_ORDER_METADATA_KEY]);
  if (!metadata) return order;
  const band = { ...storedBand };
  delete band[LIVE_ORDER_METADATA_KEY];
  const hasPriceBand = ["referenceClose", "lower", "upper", "ratio"]
    .every((key) => Number.isFinite(Number(band[key])));
  return {
    ...order,
    ...metadata,
    priceBand: hasPriceBand ? band as PriceBand : null,
  };
}

function serializeLivePendingOrder(order: PendingOrder): PendingOrder {
  const metadata = normalizeLiveOrderMetadata({
    orderType: order.orderType,
    triggerPrice: order.triggerPrice,
    stopLoss: order.stopLoss,
    takeProfit: order.takeProfit,
  });
  if (!metadata) return order;
  const currentBand = order.priceBand && typeof order.priceBand === "object"
    ? order.priceBand as PriceBand & Record<string, unknown>
    : {};
  return {
    ...order,
    priceBand: {
      ...currentBand,
      [LIVE_ORDER_METADATA_KEY]: metadata,
    } as unknown as PriceBand,
  };
}

function serializeLivePortfolio(record: LivePortfolioRecord): LivePortfolioRecord {
  return {
    ...record,
    pendingOrders: record.pendingOrders.map(serializeLivePendingOrder),
  };
}

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
    market: watch.market as LiveScanMarket,
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
  version: 10;
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
  orderType?: OrderType;
  orderTriggerPrice?: string;
  orderStopLoss?: string;
  orderTakeProfit?: string;
  positionSizeMode: PositionSizeMode;
  riskPercent: number;
  drawings: PersistedDrawing[];
  events: TrainingEvent[];
  marketRules?: MarketRuleProfile;
  trainingTask?: TrainingTask;
  tradingMode: TradingMode;
  initialCapital: number;
  cashBalance: number;
  executionProfile: ExecutionCostProfile;
  executionEngineVersion: string;
  reviewMetrics?: DeterministicReviewMetrics;
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

type ReviewChartSnapshot = {
  sessionId: string;
  snapshotId: string;
  instrument: Instrument;
  candles: KLineData[];
  dataIndexOffset: number;
};

type ReviewChartLoadState = {
  requestKey: string;
  snapshot: ReviewChartSnapshot | null;
  error: string;
};

function compareTrainingSessionsByCreatedAt(left: TrainingSession, right: TrainingSession) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
  const safeRight = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
  return safeRight - safeLeft || right.id.localeCompare(left.id);
}

function compareTrainingSessionSummariesByCreatedAt(
  left: TrainingSessionSummary,
  right: TrainingSessionSummary,
) {
  return compareTrainingSessionsByCreatedAt(left.session, right.session);
}
type DuplicateMarketWarning = {
  session: TrainingSession;
  state: TrainingState;
  overlapBars: number;
  currentBarCount: number;
  overlapRatio: number;
};
type RestorePreviewKind = "trash" | "duplicate";
type DuplicateTrainingPreview = {
  session: TrainingSession;
  state: TrainingState;
  returnSession: TrainingSession;
};
type RestoreRequest = {
  id: string;
  instrumentId: string;
  timeframe: string;
  state: TrainingState;
  updatedAt?: string;
  preview?: boolean;
  previewKind?: RestorePreviewKind;
  evidenceTimestamp?: number;
};
type NewTaskRequest = {
  instrumentId: string;
  timeframe: string;
  draft: TrainingTaskDraft;
  snapshotId?: string;
};
type LatestWatchRequest = {
  instrumentId: string;
  timeframe: string;
};
type MistakeSource = {
  session: TrainingSession;
  state: TrainingState;
  count: number;
  targetCursor: number;
  label: string;
};
type TaskSetupKind = "configured" | "random";
type PerformanceFilters = {
  instrumentId: string;
  market: string;
  timeframe: string;
  accountingMode: "all" | TradingMode;
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
type SyncedPreferences = {
  version: 1;
  appSettings: AppSettings;
  patternPresets: PatternPreset[];
  patternPresetAction?: "restore-defaults";
  movingAverageSettings: MovingAverageSettings;
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
    minChangePct: string;
    maxChangePct: string;
    excludeLimitUp?: boolean;
    sort: LiveScanSort;
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
    const pendingOrders = (Array.isArray(raw.pendingOrders) ? raw.pendingOrders : [])
      .map(restoreLivePendingOrder)
      .filter((item): item is PendingOrder => {
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
    if (watch.market !== "CN" && watch.market !== "US" && watch.market !== "FX" && watch.market !== "GOLD") return [];
    seen.add(watch.instrumentId);
    return [{ ...watch, id: `watch:${watch.instrumentId}` }];
  }).slice(0, 500);
}

function sanitizeRecentLiveResults(value: unknown): LiveScanResult[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<LiveScanResult>;
    if (typeof candidate.instrumentId !== "string" || !candidate.instrumentId || seen.has(candidate.instrumentId)) return [];
    const market = typeof candidate.market === "string" ? candidate.market : "";
    if (!["CN", "US", "FX", "GOLD"].includes(market)) return [];
    seen.add(candidate.instrumentId);
    return [{
      instrumentId: candidate.instrumentId,
      symbol: typeof candidate.symbol === "string" && candidate.symbol ? candidate.symbol : candidate.instrumentId,
      name: typeof candidate.name === "string" && candidate.name ? candidate.name : candidate.instrumentId,
      // FX/GOLD entries are read-only latest-history views. The recent list
      // shares the live result shape so it can render without a second list
      // component; the click handler routes those markets back to history.
      market: market as LiveScanMarket,
      timestamp: Number.isFinite(candidate.timestamp) ? Number(candidate.timestamp) : 0,
      close: Number.isFinite(candidate.close) ? Number(candidate.close) : 0,
      changePct: Number.isFinite(candidate.changePct) ? Number(candidate.changePct) : 0,
      volume: Number.isFinite(candidate.volume) ? Number(candidate.volume) : 0,
      turnover: Number.isFinite(candidate.turnover) ? Number(candidate.turnover) : 0,
      averageVolume: Number.isFinite(candidate.averageVolume) ? Number(candidate.averageVolume) : 0,
      averageTurnover: Number.isFinite(candidate.averageTurnover) ? Number(candidate.averageTurnover) : 0,
      presetIds: Array.isArray(candidate.presetIds) ? candidate.presetIds.filter((id): id is string => typeof id === "string") : [],
      presetNames: Array.isArray(candidate.presetNames) ? candidate.presetNames.filter((name): name is string => typeof name === "string") : [],
    } satisfies LiveScanResult];
  }).slice(0, 50);
}

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
  accountingMode: "all",
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

function latestEntryDecisionId(submissions: DecisionSubmission[], timestamp: number) {
  return submissions
    .filter((submission) => (
      !submission.autoGenerated
      && !submission.backfilled
      && submission.barTimestamp <= timestamp
    ))
    .sort((left, right) => left.barTimestamp - right.barTimestamp || String(left.submittedAt ?? "").localeCompare(String(right.submittedAt ?? "")))
    .at(-1)?.id;
}

function backfillCandidatePositions(
  positions: PositionLot[],
  submissions: DecisionSubmission[],
  targetTimestamp: number,
  currentTimestamp: number,
) {
  const nextDecisionTimestamp = submissions
    .filter((submission) => !submission.autoGenerated && submission.barTimestamp > targetTimestamp)
    .sort((left, right) => left.barTimestamp - right.barTimestamp)
    .at(0)?.barTimestamp;
  return positions
    .filter((position) => (
      position.entryTimestamp >= targetTimestamp
      && position.entryTimestamp <= currentTimestamp
      && (nextDecisionTimestamp == null || position.entryTimestamp < nextDecisionTimestamp)
      && !position.decisionSubmissionId
    ))
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp || left.id.localeCompare(right.id));
}

const defaultInstruments = [
  { id: "600519.SH", short: "600519", label: "贵州茅台", market: "A股", assetType: "stock" as const, timeframes: ["1d", "1w"] },
  { id: "AAPL.US", short: "AAPL", label: "Apple", market: "美股", assetType: "stock" as const, timeframes: ["1d"] },
];

function normalizeAvailableInstrument(item: Instrument & { timeframes?: string[] }): AvailableInstrument | null {
  const availableTimeframes = (item.timeframes ?? []).filter((value) => TIMEFRAME_IDS.includes(value as typeof TIMEFRAME_IDS[number]));
  if (!availableTimeframes.length) return null;
  return {
    id: item.id,
    short: item.symbol,
    label: item.name,
    market: marketSelectionLabel(item.market) || item.market,
    assetType: inferInstrumentAssetType(item.id, item.market, item.assetType),
    timeframes: availableTimeframes,
  };
}

const coveragePageSize = 100;
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
    label: "画笔",
    icon: Brush,
    tools: [{ name: "brush", label: "画笔", icon: Brush }],
  },
  {
    id: "text",
    label: "文字标记",
    icon: Tag,
    tools: [{ name: "trainingTextBox", label: "文字标记", icon: Tag, kind: "text" }],
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

function profitFactorLabel(value: number | null, infinite = false) {
  if (infinite) return "∞";
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(2);
}

function orderTypeLabel(value: OrderType | undefined) {
  if (value === "limit") return "限价单（Limit Order）";
  if (value === "stop") return "突破单（Stop Order）";
  return "市价";
}

function exitReasonLabel(value: ExecutionReason | undefined) {
  if (value === "stop_loss") return "止损";
  if (value === "take_profit") return "止盈";
  if (value === "training_end") return "训练结束";
  if (value === "session_end") return "交易时段结束";
  if (value === "liquidation") return "保证金强平";
  return "手动平仓";
}

function DecisionLinkedTradeSummary({
  positions,
  tradingMode,
  marginInstrument,
  dateLabel,
  priceLabel,
  onEvidence,
  compact = false,
}: {
  positions: PositionLot[];
  tradingMode: TradingMode;
  marginInstrument: boolean;
  dateLabel: (timestamp: number) => string;
  priceLabel: (price: number | undefined) => string;
  onEvidence: (timestamp: number, label: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`decision-linked-trades${compact ? " compact" : ""}`}>
      <div className="decision-linked-trades-head">
        <span>关联交易</span>
        <strong>{positions.length ? `${positions.length} 笔` : "尚未关联"}</strong>
      </div>
      {positions.length ? (
        <div className="decision-linked-trade-list">
          {positions.map((position) => {
            const closed = position.status === "closed";
            const result = closed
              ? tradingMode === "capital"
                ? money(position.realizedPnl ?? 0)
                : percent(positionReturnPct(position, position.exitPrice ?? position.entryPrice))
              : "持仓中";
            const quantity = marginInstrument ? `${position.qty.toFixed(2)} 手` : `数量 ${position.qty}`;
            return (
              <div className="decision-linked-trade" key={position.id}>
                <div className="decision-linked-trade-head">
                  <strong>交易 #{position.id.slice(0, 8)} · <span className={position.side === "long" ? "side-long" : "side-short"}>{position.side === "long" ? "多 / 买" : "空 / 卖"}</span> · {quantity}</strong>
                  <strong className={closed ? ((position.realizedPnl ?? 0) >= 0 ? "up" : "down") : ""}>{result}</strong>
                </div>
                <div className="decision-linked-trade-evidence">
                  <button type="button" className="evidence-link" onClick={() => onEvidence(position.entryTimestamp, "入场")} aria-label={`跳到交易 ${position.id.slice(0, 8)} 的入场 K 线`}>
                    入场 {dateLabel(position.entryTimestamp)} · {priceLabel(position.entryPrice)}
                  </button>
                  {position.exitTimestamp ? (
                    <>
                      <span>→</span>
                      <button type="button" className="evidence-link" onClick={() => onEvidence(position.exitTimestamp as number, "出场")} aria-label={`跳到交易 ${position.id.slice(0, 8)} 的出场 K 线`}>
                        出场 {dateLabel(position.exitTimestamp)} · {priceLabel(position.exitPrice)}
                      </button>
                    </>
                  ) : <span className="decision-linked-trade-open">· 尚未平仓</span>}
                </div>
                {closed && <small>{exitReasonLabel(position.exitReason)}{position.intrabarAmbiguous ? " · 同根冲突" : ""}</small>}
              </div>
            );
          })}
        </div>
      ) : (
        <small className="decision-linked-trades-empty">这张计划目前没有明确关联的交易。</small>
      )}
      {positions.length > 0 && <small className="decision-linked-trades-hint">点击入场 / 出场时间可跳回对应 K 线</small>}
    </div>
  );
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

type TrainingSessionHabitTrade = {
  pnl: number;
  returnPct: number;
  holdingBars: number;
  entryTimestamp: number;
  exitTimestamp?: number;
  entryPrice: number;
  market: string;
  patterns: string[];
  decision?: HabitTrade["decision"];
};

type TrainingSessionSummary = {
  session: TrainingSession;
  state: TrainingState;
  hasMeaningfulActivity: boolean;
  task?: TrainingTask;
  pnl: TrainingPnlStats["pnl"];
  returnPct: number;
  progressSummary: { revealed: number; total: number; percent: number };
  modeLabel: string;
  rangeLabel: string;
  closedTradePnls: number[];
  closedTradeReturns: number[];
  winningTrades: number;
  losingTrades: number;
  flatTrades: number;
  realizedReturnPct: number;
  floatingReturnPct: number;
  planScores: number[];
  habitTrades: TrainingSessionHabitTrade[];
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
  const entryNotional = (position: PositionLot) => accountNotional(
    position.entryPrice,
    position.qty,
    position.instrumentEconomics ?? state.marketRules?.instrumentEconomics,
  ) ?? position.entryPrice * position.qty;
  const openEntryNotional = openSessionPositions.reduce(
    (sum, position) => sum + entryNotional(position),
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
  const intervalMs = timeframeLookbackMs(timeframe) ?? timeframeLookbackMs("1d")!;
  return Math.max(1, Math.round((exitTimestamp - entryTimestamp) / intervalMs));
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

function randomUint32() {
  const values = new Uint32Array(1);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
}

function randomItem<T>(items: T[]) {
  if (!items.length) return undefined;
  return items[randomUint32() % items.length];
}

function formatDate(timestamp: number, timeframe: string) {
  const date = new Date(timestamp);
  return (timeframeMinutes(timeframe) ?? 24 * 60) < 24 * 60
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
    decision_changed: "编辑决策草稿",
    replay_advanced: "推进K线",
    replay_rewound: "回看上一根",
    order_queued: "提交委托",
    order_queued_for_next_session: "预约次日开盘平仓",
    order_cancelled: "撤销委托",
    orders_filled: "订单成交",
    [CASH_DIVIDEND_INCOME_EVENT_TYPE]: "分红收入计入模拟账户",
    drawings_changed: "更新图表标记",
    playback_toggled: "切换自动播放",
    playback_speed_changed: "调整播放速度",
    order_quantity_changed: "调整下单数量",
    order_rejected: "市场规则拒单",
    orders_rejected: "成交阶段拒单",
    sop_entry_blocked: "个人 SOP 拦截开仓",
    sop_holding_limit_warning: "个人 SOP 持仓超限提示",
    sop_auto_close_queued: "个人 SOP 自动预约平仓",
    positions_settled_at_training_end: "训练结束自动平仓",
    positions_settled_at_replay_session_end: "交易时段结束自动平仓",
    training_completed: "训练自动结束",
    training_revealed: "解除盲测并继续观察",
  };
  return labels[type] ?? type;
}

const nonMutatingTrainingEventTypes = new Set([
  "replay_advanced",
  "replay_rewound",
  "playback_toggled",
  "playback_speed_changed",
]);

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
  if (timeframe === "1w" || timeframe === "1mo") return null;
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

const ignoreProtectionPriceSelect = () => undefined;
const rejectProtectionLineMove = () => false;
const ignoreCandleContextMenu = () => undefined;
const ignoreDrawingsChange = () => undefined;
const ignoreDrawingSelect = () => undefined;

function clonePatternPresetValue(preset: PatternPreset): PatternPreset {
  return {
    ...preset,
    parameters: { ...preset.parameters },
    ...(preset.conditions
      ? { conditions: preset.conditions.map((condition) => ({ ...condition, parameters: { ...condition.parameters } })) }
      : {}),
  };
}

export function TrainingWorkbench() {
  const settingsGateway = useMemo(
    () => createSettingsStorageGateway(
      typeof window === "undefined"
        ? {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          }
        : window.localStorage,
    ),
    [],
  );
  const preferencesGateway = useMemo(
    () => createPreferencesGateway((input, init) => fetch(input, init)),
    [],
  );
  const reviewGateway = useMemo(
    () => createReviewGateway((input, init) => fetch(input, init)),
    [],
  );
  const liveGateway = useMemo(
    () => createLiveGateway((input, init) => fetch(input, init)),
    [],
  );
  const marketDataGateway = useMemo(
    () => createMarketDataGateway((input, init) => fetch(input, init)),
    [],
  );
  const [view, setView] = useState<View>("replay");
  const [watchlistCollapsed, setWatchlistCollapsed] = useState(true);
  const [watchlistSource, setWatchlistSource] = useState<WatchlistSource>("watchlist");
  const [recentLiveResults, setRecentLiveResults] = useState<LiveScanResult[]>([]);
  const [watchlistPreferencesReady, setWatchlistPreferencesReady] = useState(false);
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
  const [corporateActions, setCorporateActions] = useState<CorporateActionEvent[]>([]);
  const [corporateActionsForInstrumentId, setCorporateActionsForInstrumentId] = useState("");
  const [selectedCorporateActionId, setSelectedCorporateActionId] = useState("");
  const [chartTimeframe, setChartTimeframe] = useState("1d");
  const [chartBars, setChartBars] = useState<KLineData[]>([]);
  const [chartViewLoading, setChartViewLoading] = useState(false);
  const [chartViewError, setChartViewError] = useState("");
  const [chartViewSnapshotId, setChartViewSnapshotId] = useState("");
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
  const [positionSizeMode, setPositionSizeMode] = useState<PositionSizeMode>(defaultAppSettings.positionSizeMode);
  const [riskPercent, setRiskPercent] = useState(defaultAppSettings.riskPercent);
  const [orderType, setOrderType] = useState<OrderType>(defaultAppSettings.orderType);
  const [openingGapMode, setOpeningGapMode] = useState<OpeningGapMode>(defaultAppSettings.openingGapMode);
  const [openingGapUnit, setOpeningGapUnit] = useState<OpeningGapUnit>(defaultAppSettings.openingGapUnit);
  const [openingGapThreshold, setOpeningGapThreshold] = useState(defaultAppSettings.openingGapThreshold);
  const [orderTriggerPrice, setOrderTriggerPrice] = useState("");
  const [orderStopLoss, setOrderStopLoss] = useState("");
  const [orderTakeProfit, setOrderTakeProfit] = useState("");
  const [protectionPriceSelection, setProtectionPriceSelection] = useState<PriceSelectionMode | null>(null);
  const [orderPanelTab, setOrderPanelTab] = useState<"positions" | "pending" | "history">("positions");
  const [hoveredClosedPositionId, setHoveredClosedPositionId] = useState<string | null>(null);
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
  const [executionProfile, setExecutionProfile] = useState<ExecutionCostProfile>(defaultAppSettings.executionProfile);
  const [trainingTask, setTrainingTask] = useState<TrainingTask | null>(null);
  const [showTaskSetup, setShowTaskSetup] = useState(false);
  const [showLiveScan, setShowLiveScan] = useState(false);
  const [liveScanMarket, setLiveScanMarket] = useState<LiveScanMarket>("CN");
  const [liveScanPresetIds, setLiveScanPresetIds] = useState<string[]>([]);
  const [liveScanMinPrice, setLiveScanMinPrice] = useState("");
  const [liveScanMaxPrice, setLiveScanMaxPrice] = useState("");
  const [liveScanMinVolume, setLiveScanMinVolume] = useState("");
  const [liveScanMinChangePct, setLiveScanMinChangePct] = useState("");
  const [liveScanMaxChangePct, setLiveScanMaxChangePct] = useState("");
  const [liveScanExcludeLimitUp, setLiveScanExcludeLimitUp] = useState(false);
  const [liveScanSort, setLiveScanSort] = useState<LiveScanSort>("turnover");
  const [liveScanLimit, setLiveScanLimit] = useState(100);
  const [liveScanStatus, setLiveScanStatus] = useState("");
  const [liveScanError, setLiveScanError] = useState("");
  const [liveScanRunning, setLiveScanRunning] = useState(false);
  const [livePriceRefreshRunning, setLivePriceRefreshRunning] = useState(false);
  const [, setLivePriceRefreshStatus] = useState("");
  const [liveScanData, setLiveScanData] = useState<LiveScanResponse | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [liveContext, setLiveContext] = useState<LiveScanResult | null>(null);
  const [liveEntryFromCoverage, setLiveEntryFromCoverage] = useState(false);
  const [latestWatchMode, setLatestWatchMode] = useState(false);
  const [livePortfolios, setLivePortfolios] = useState<LivePortfolioRecord[]>([]);
  const [liveWatchlist, setLiveWatchlist] = useState<LiveWatchRecord[]>([]);
  const [liveScanIndex, setLiveScanIndex] = useState(0);
  const [liveNavigatorSource, setLiveNavigatorSource] = useState<LiveNavigatorSource>("scan");
  const [liveNavigatorResume, setLiveNavigatorResume] = useState<NonNullable<SyncedPreferences["liveNavigatorResume"]>>({ source: "scan", index: 0 });
  const [liveScanResume, setLiveScanResume] = useState<NonNullable<SyncedPreferences["liveScanResume"]>>({ index: 0 });
  const [liveBarOffset, setLiveBarOffset] = useState({ x: 0, y: 0 });
  const [trainingNavigatorSessions, setTrainingNavigatorSessions] = useState<TrainingSession[]>([]);
  const [trainingNavigatorIndex, setTrainingNavigatorIndex] = useState(0);
  const [trainingNavigatorActive, setTrainingNavigatorActive] = useState(false);
  const [trainingNavigatorOffset, setTrainingNavigatorOffset] = useState({ x: 0, y: 0 });
  const [performanceSection, setPerformanceSection] = useState<"training" | "sop" | "live" | "watch">("training");
  const [taskSetupKind, setTaskSetupKind] = useState<TaskSetupKind>("configured");
  const [showRandomComplete, setShowRandomComplete] = useState(false);
  const [trashPreview, setTrashPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPatternFilters, setShowPatternFilters] = useState(false);
  const [patternConditionPickerOpen, setPatternConditionPickerOpen] = useState(false);
  const [patternConditionSearch, setPatternConditionSearch] = useState("");
  const [patternConditionGroup, setPatternConditionGroup] = useState("全部");
  const [patternEditorError, setPatternEditorError] = useState("");
  const [patternDiscardPromptOpen, setPatternDiscardPromptOpen] = useState(false);
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
  const [backfillAssociation, setBackfillAssociation] = useState<"associate" | "none">("associate");
  const [editingDecisionId, setEditingDecisionId] = useState("");
  const [reviewedSession, setReviewedSession] = useState<{ session: TrainingSession; state: TrainingState } | null>(null);
  const [reviewChartLoadState, setReviewChartLoadState] = useState<ReviewChartLoadState | null>(null);
  const [duplicateMarketWarning, setDuplicateMarketWarning] = useState<DuplicateMarketWarning | null>(null);
  const [duplicateTrainingPreview, setDuplicateTrainingPreview] = useState<DuplicateTrainingPreview | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [coveragePage, setCoveragePage] = useState(1);
  const [coverageTotal, setCoverageTotal] = useState(0);
  const [coverageSummary, setCoverageSummary] = useState({ barCount: 0, timeframeCount: 0, hasNonSampleData: false });
  const [coverageSearch, setCoverageSearch] = useState("");
  const [coverageQuery, setCoverageQuery] = useState("");
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [selectedCoverageKeys, setSelectedCoverageKeys] = useState<string[]>([]);
  const [dataMarket, setDataMarket] = useState<DataMarket>("CN");
  const activeDataMarketRef = useRef(dataMarket);
  const coverageLoadRef = useRef(0);
  useEffect(() => { activeDataMarketRef.current = dataMarket; }, [dataMarket]);
  const [sessionSummaries, setSessionSummaries] = useState<TrainingSessionSummary[]>([]);
  const [trashSessions, setTrashSessions] = useState<TrainingSession[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashActionId, setTrashActionId] = useState("");
  const [trashError, setTrashError] = useState("");
  const [emptySessionCleanupRunning, setEmptySessionCleanupRunning] = useState(false);
  const [snapshotTradeContexts, setSnapshotTradeContexts] = useState<SnapshotTradeContextMap>({});
  const [performanceFilters, setPerformanceFilters] = useState<PerformanceFilters>(defaultPerformanceFilters);
  const [performanceHeroDisplayMode, setPerformanceHeroDisplayMode] = useState<"return" | "amount">("return");
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
  const timeframeViewLoadRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const sessionSummaryLoadRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const sessionSummariesReadyRef = useRef(false);
  const liveRequestRef = useRef<LiveScanResult | null>(null);
  const liveRequestTimeframeRef = useRef<string | null>(null);
  const latestWatchRequestRef = useRef<LatestWatchRequest | null>(null);
  const livePortfoliosRef = useRef<LivePortfolioRecord[]>([]);
  const liveWatchlistRef = useRef<LiveWatchRecord[]>([]);
  const livePriceRefreshRunningRef = useRef(false);
  const livePriceRefreshRef = useRef<((options?: { ensureMarketData?: boolean }) => Promise<void>) | null>(null);
  const liveAutoUpdateFinishedAtRef = useRef<string | null | undefined>(undefined);
  const livePersistSignatureRef = useRef("");
  const liveBarDragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const trainingBarDragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const startupRandomStartedRef = useRef(false);
  const startupRandomCancelledRef = useRef(false);
  const syncedPreferencesLoadStartedRef = useRef(false);
  const syncedPreferencesHydratedRef = useRef(false);
  const syncedPreferencesRetryCountRef = useRef(0);
  const patternPresetSaveRevisionRef = useRef(0);
  const patternPresetsDirtyRef = useRef(false);
  const patternPresetRestoreRequestedRef = useRef(false);
  const patternFilterModalRef = useRef<HTMLElement | null>(null);
  const patternPresetListRef = useRef<HTMLElement | null>(null);
  const patternConditionPickerRef = useRef<HTMLDivElement | null>(null);
  const liveStateHydratedRef = useRef(false);
  const liveStateRetryCountRef = useRef(0);
  const liveStatePersistedRef = useRef({
    portfolios: [] as LivePortfolioRecord[],
    watchlist: [] as LiveWatchRecord[],
  });
  const trainingAutosaveGateRef = useRef<TrainingAutosaveGate>(resetTrainingAutosaveGate());
  const trainingAutosaveTimerRef = useRef<number | null>(null);

  const preemptStartupRandom = useCallback(() => {
    startupRandomStartedRef.current = true;
    startupRandomCancelledRef.current = true;
    setStartupReady(true);
  }, []);

  const rememberOrderEntryPreference = (update: Partial<Pick<AppSettings, "orderType" | "positionSizeMode" | "riskPercent" | "openingGapMode" | "openingGapUnit" | "openingGapThreshold">>) => {
    const nextSettings = normalizeSettings({ ...appSettingsRef.current, ...update });
    appSettingsRef.current = nextSettings;
    setAppSettings(nextSettings);
    setSettingsDraft((draft) => normalizeSettings({ ...draft, ...update }));
    settingsGateway.saveAppSettings(nextSettings);
  };

  useEffect(() => {
    livePortfoliosRef.current = livePortfolios;
  }, [livePortfolios]);

  useEffect(() => {
    liveWatchlistRef.current = liveWatchlist;
  }, [liveWatchlist]);

  useEffect(() => {
    let active = true;
    try {
      const storedCollapsed = window.localStorage.getItem(WATCHLIST_COLLAPSED_STORAGE_KEY);
      const storedRecent = window.localStorage.getItem(WATCHLIST_RECENT_STORAGE_KEY);
      const restoredRecent = storedRecent ? sanitizeRecentLiveResults(JSON.parse(storedRecent)) : [];
      window.setTimeout(() => {
        if (!active) return;
        if (storedCollapsed === "expanded") setWatchlistCollapsed(false);
        if (storedCollapsed === "collapsed") setWatchlistCollapsed(true);
        if (restoredRecent.length) setRecentLiveResults(restoredRecent);
        setWatchlistPreferencesReady(true);
      }, 0);
    } catch {
      // Local preferences are optional; keep the default collapsed list.
      window.setTimeout(() => {
        if (active) setWatchlistPreferencesReady(true);
      }, 0);
    } finally {
      // State restoration is deferred by one tick to avoid a synchronous
      // effect update during hydration.
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!watchlistPreferencesReady) return;
    try {
      window.localStorage.setItem(
        WATCHLIST_COLLAPSED_STORAGE_KEY,
        watchlistCollapsed ? "collapsed" : "expanded",
      );
    } catch {
      // A private or restricted browser context may reject local storage.
    }
  }, [watchlistCollapsed, watchlistPreferencesReady]);

  useEffect(() => {
    if (!watchlistPreferencesReady) return;
    try {
      window.localStorage.setItem(WATCHLIST_RECENT_STORAGE_KEY, JSON.stringify(recentLiveResults));
    } catch {
      // Recent browsing is a convenience and does not block the chart.
    }
  }, [recentLiveResults, watchlistPreferencesReady]);

  const visibleBarStartIndex = trainingTask ? taskVisibleStartCursor(trainingTask) : 0;
  const chartDataIndexOffset = snapshotDataIndexOffset + visibleBarStartIndex;
  const visibleBars = useMemo(
    () => bars.slice(visibleBarStartIndex, cursor + 1),
    [bars, cursor, visibleBarStartIndex],
  );
  const selectedCatalogInstrument = availableInstruments.find((item) => item.id === instrumentId);
  const currentAvailableTimeframes = useMemo(
    () => availableTimeframesForInstrument(availableInstruments, instrumentId, timeframes),
    [availableInstruments, instrumentId],
  );
  const setupAvailableTimeframes = useMemo(
    () => availableTimeframesForInstrument(availableInstruments, setupInstrumentId, timeframes),
    [availableInstruments, setupInstrumentId],
  );
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
  const showingCanonicalChart = chartTimeframe === timeframe;
  const renderedChartBars = useMemo(() => {
    if (showingCanonicalChart) return visibleBars;
    if (!currentBar) return [];
    const canBuildPartialBar = canAggregateTimeframe(timeframe, chartTimeframe);
    const viewStartTimestamp = bars[visibleBarStartIndex]?.timestamp ?? Number.NEGATIVE_INFINITY;
    const visible = visibleTimeframeViewBars(
      chartBars,
      currentBar.timestamp,
      canBuildPartialBar,
    ).filter((bar) => bar.timestamp >= viewStartTimestamp);
    if (!canBuildPartialBar) return visible;

    const isFxInstrument = instrument.market.toUpperCase() === "FX" || /\.FX$/i.test(instrument.id);
    const currentTargetBucket = isFxInstrument
      ? String(bucketStartTimestamp(currentBar.timestamp, chartTimeframe as FxTimeframe, {
          timeZone: instrument.timezone,
          sessionStartHour: 17,
          sessionStartMinute: 0,
          weekStartsOn: 0,
        }))
      : timeframeBucketKey(currentBar.timestamp, chartTimeframe as SupportedTimeframe, instrument.timezone);
    const sourceCandles = bars.slice(visibleBarStartIndex, cursor + 1)
      .filter((bar) => {
        const bucket = isFxInstrument
          ? String(bucketStartTimestamp(bar.timestamp, chartTimeframe as FxTimeframe, {
              timeZone: instrument.timezone,
              sessionStartHour: 17,
              sessionStartMinute: 0,
              weekStartsOn: 0,
            }))
          : timeframeBucketKey(bar.timestamp, chartTimeframe as SupportedTimeframe, instrument.timezone);
        return bucket === currentTargetBucket;
      })
      .map((bar) => ({
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume ?? null,
      turnover: null,
    }));
    const partialCandles = isFxInstrument
      ? aggregateFxCandles(sourceCandles, chartTimeframe as FxTimeframe, {
          timeZone: instrument.timezone,
          sessionStartHour: 17,
          sessionStartMinute: 0,
          weekStartsOn: 0,
        })
      : aggregateCandlesToTimeframe(sourceCandles, chartTimeframe as SupportedTimeframe, instrument.timezone);
    if (!partialCandles.length) return visible;
    return [
      ...visible.filter((bar) => {
        const bucket = isFxInstrument
          ? String(bucketStartTimestamp(bar.timestamp, chartTimeframe as FxTimeframe, {
              timeZone: instrument.timezone,
              sessionStartHour: 17,
              sessionStartMinute: 0,
              weekStartsOn: 0,
            }))
          : timeframeBucketKey(bar.timestamp, chartTimeframe as SupportedTimeframe, instrument.timezone);
        return bucket !== currentTargetBucket;
      }),
      ...partialCandles,
    ] as KLineData[];
  }, [
    bars,
    chartBars,
    chartTimeframe,
    cursor,
    currentBar,
    instrument.id,
    instrument.market,
    instrument.timezone,
    showingCanonicalChart,
    timeframe,
    visibleBarStartIndex,
    visibleBars,
  ]);
  const selectedPatternPresetDraft = patternPresetDrafts.find((preset) => preset.id === selectedPatternPresetId)
    ?? patternPresetDrafts[0];
  const patternPresetDraftsDirty = useMemo(
    () => JSON.stringify(patternPresetDrafts) !== JSON.stringify(patternPresets),
    [patternPresetDrafts, patternPresets],
  );
  const availablePatternPresets = useMemo(
    () => visiblePatternPresets(patternPresets),
    [patternPresets],
  );
  const availablePatternPresetDrafts = useMemo(
    () => visiblePatternPresets(patternPresetDrafts),
    [patternPresetDrafts],
  );
  const filteredPatternConditionDefinitions = useMemo(() => {
    const search = patternConditionSearch.trim().toLowerCase();
    return patternConditionDefinitions.filter((definition) => (
      (patternConditionGroup === "全部" || definition.group === patternConditionGroup)
      && (!search || `${definition.label}${definition.description}`.toLowerCase().includes(search))
    ));
  }, [patternConditionGroup, patternConditionSearch]);

  useEffect(() => {
    if (!showPatternFilters) return;
    patternPresetListRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [showPatternFilters]);

  useEffect(() => {
    if (!showPatternFilters || !selectedPatternPresetId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const list = patternPresetListRef.current;
      const selected = list?.querySelector<HTMLElement>(
        `[data-pattern-preset-id="${CSS.escape(selectedPatternPresetId)}"]`,
      );
      if (!list || !selected) return;
      const listRect = list.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      if (selectedRect.left < listRect.left || selectedRect.right > listRect.right) {
        selected.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPatternPresetId, showPatternFilters]);

  useEffect(() => {
    if (!patternConditionPickerOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      patternConditionPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [patternConditionPickerOpen]);
  const hideTaskInstrument = trainingTask?.status === "active" && trainingTask.hideInstrument;
  const hideTaskDate = trainingTask?.status === "active" && trainingTask.hideDate;
  const hideTaskPrice = trainingTask?.status === "active" && trainingTask.hidePrice;
  const corporateActionMarkers = useMemo<CorporateActionMarker[]>(() => corporateActionMarkersForBars(
    corporateActionsForInstrumentId === instrument.id ? corporateActions : [],
    renderedChartBars,
    chartTimeframe,
    instrument.timezone,
    currentBar?.timestamp ?? null,
    Boolean(hideTaskInstrument || hideTaskDate || hideTaskPrice),
  ), [
    corporateActions,
    corporateActionsForInstrumentId,
    currentBar?.timestamp,
    chartTimeframe,
    hideTaskDate,
    hideTaskInstrument,
    hideTaskPrice,
    instrument.id,
    instrument.timezone,
    renderedChartBars,
  ]);
  const selectedCorporateAction = corporateActionMarkers.find((action) => action.id === selectedCorporateActionId) ?? null;
  const trainingDateLabel = (timestamp: number) => {
    if (!hideTaskDate) return formatDate(timestamp, timeframe);
    const index = bars.findIndex((bar) => bar.timestamp === timestamp);
    return index >= 0 ? `K线 #${index + 1}` : "日期已隐藏";
  };
  const trainingPriceLabel = (price: number | undefined) => (
    hideTaskPrice ? "•••" : price?.toFixed(instrument.pricePrecision) ?? "--"
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
  const instrumentEconomics = marketRules.instrumentEconomics;
  const marginInstrument = isMarginEconomics(instrumentEconomics);
  const goldInstrument = marketRuleCode(instrument.market) === "GOLD" || /\.GOLD$/i.test(instrument.id);
  const marginContractUnit = goldInstrument ? "盎司" : instrumentEconomics?.baseCurrency ?? "基础币";
  const marginPipLabel = goldInstrument ? "每点" : "每 Pip";
  const reservedMarginTotal = pendingOrders.reduce(
    (sum, order) => sum + Math.max(0, Number(order.reservedMargin ?? 0)),
    0,
  );
  const currentMarginAccount = currentBar && marginInstrument
    ? marginAccountSnapshot({
      balance: cashBalance,
      positions: openPositions,
      sourcePrice: currentBar.close,
      spreadBps: executionProfile.spreadBps,
      reservedMargin: reservedMarginTotal,
      economics: instrumentEconomics!,
    })
    : null;
  const oneLotPipValue = currentBar && marginInstrument
    ? pipValueInAccount(currentBar.close, 1, instrumentEconomics)
    : null;
  const openPnl = currentBar
    ? openPositions.reduce((sum, position) => (
      sum + (marginInstrument
        ? markToMarketPnl(position, currentBar.close, executionProfile.spreadBps)
        : (currentBar.close - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1))
      - (position.entryFee ?? 0)
    ), 0)
    : 0;
  const realizedPnl = closedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
  const dividendIncome = cashDividendIncomeFromEvents(events);
  const totalPnl = realizedPnl + openPnl + dividendIncome;
  const currentPrice = currentBar?.close ?? 0;
  const entryNotional = (position: PositionLot) => accountNotional(
    position.entryPrice,
    position.qty,
    position.instrumentEconomics ?? instrumentEconomics,
  ) ?? position.entryPrice * position.qty;
  const openEntryNotional = openPositions.reduce((sum, position) => sum + entryNotional(position), 0);
  const totalEntryNotional = positions.reduce((sum, position) => sum + entryNotional(position), 0);
  const floatingReturnPct = openEntryNotional > 0 ? openPnl / openEntryNotional * 100 : 0;
  const closedEntryNotional = closedPositions.reduce((sum, position) => sum + entryNotional(position), 0);
  const realizedReturnPct = closedEntryNotional > 0 ? realizedPnl / closedEntryNotional * 100 : 0;
  const totalReturnPct = totalEntryNotional > 0 ? totalPnl / totalEntryNotional * 100 : 0;
  const availableBuyingPower = currentMarginAccount?.availableMargin
    ?? calculateAvailableCash(cashBalance, pendingOrders);
  const marketValue = marginInstrument
    ? openPositions.reduce((sum, position) => sum + (accountNotional(
      currentPrice,
      position.qty,
      position.instrumentEconomics ?? instrumentEconomics,
    ) ?? 0), 0)
    : accountMarketValue(positions, currentPrice);
  const equity = currentMarginAccount?.equity ?? accountEquity(cashBalance, positions, currentPrice);
  // Risk sizing is intentionally based on account balance, not floating
  // equity.  An open trade must not increase the next order's risk budget.
  // Return mode has no cash ledger, so its starting capital plus realized P/L
  // is the closest equivalent balance.
  const riskBalance = tradingMode === "capital"
    ? Math.max(0, cashBalance)
    : Math.max(0, initialCapital + realizedPnl);
  const effectiveOrderStop = (() => {
    const entered = Number(orderStopLoss);
    if (Number.isFinite(entered) && entered > 0) return entered;
    const planned = Number(decision.stop);
    return Number.isFinite(planned) && planned > 0 ? planned : undefined;
  })();
  const effectiveOrderTarget = (() => {
    const entered = Number(orderTakeProfit);
    if (Number.isFinite(entered) && entered > 0) return entered;
    const planned = Number(decision.target);
    return Number.isFinite(planned) && planned > 0 ? planned : undefined;
  })();
  const riskSizingFor = (side: "buy" | "sell", entryRawPrice: number, stopLoss: number) => (
    calculateRiskSizedQuantity({
      side,
      equity: riskBalance,
      riskPercent,
      entryRawPrice,
      entryPriceBasis: orderType === "market" ? "source" : "quote",
      stopLoss,
      minimumQuantity: minimumBuyQuantity(marketRules),
      quantityStep: buyQuantityStep(marketRules),
      availableCash: tradingMode === "capital" && side === "buy" && !marginInstrument
        ? availableBuyingPower
        : undefined,
      availableMargin: tradingMode === "capital" && marginInstrument ? availableBuyingPower : undefined,
      profile: executionProfile,
      instrumentEconomics,
    })
  );
  const riskSizingPreview = (() => {
    if (positionSizeMode !== "risk-percent" || !currentBar || !effectiveOrderStop) return null;
    const expectedEntry = orderType === "market"
      ? currentBar.close
      : Number(orderTriggerPrice) || currentBar.close;
    const side = inferRiskSizingSide(expectedEntry, effectiveOrderStop);
    return side ? riskSizingFor(side, expectedEntry, effectiveOrderStop) : null;
  })();
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
  const protectionLines = useMemo<ProtectionLine[]>(() => {
    if (!currentBar || liveMode) return [];
    return deriveProtectionLines({
      currentTimestamp: currentBar.timestamp,
      openingGapPreviousClose: currentBar.close,
      openingGapMode,
      openingGapUnit,
      openingGapThreshold,
      draftTriggerPrice: orderType === "market" ? undefined : Number(orderTriggerPrice),
      draftTriggerOrderType: orderType === "market" ? undefined : orderType,
      draftStopLoss: effectiveOrderStop,
      draftTakeProfit: effectiveOrderTarget,
      positions,
      hoveredClosedPositionId,
      movable: trainingTask?.status !== "completed",
    });
  }, [currentBar, effectiveOrderStop, effectiveOrderTarget, hoveredClosedPositionId, liveMode, openingGapMode, openingGapThreshold, openingGapUnit, orderTriggerPrice, orderType, positions, trainingTask?.status]);
  const currentTaskProgress = trainingTask
    ? taskProgress(trainingTask, cursor)
    : { revealed: 0, total: 0, percent: 0 };
  const progress = trainingTask
    ? currentTaskProgress.percent
    : bars.length > 1 ? (cursor / (bars.length - 1)) * 100 : 0;
  const trainingComplete = trainingTask?.status === "completed";
  const playbackDisabled = loading || trainingComplete;
  const rewindLocked = Boolean(trainingTask?.randomRun);
  const reviewLocked = Boolean(
    hideTaskInstrument || hideTaskDate || hideTaskPrice,
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
  const activeDecisionSubmission = editingDecisionId
    ? decisionSubmissions.find((submission) => submission.id === editingDecisionId)
    : selectedDecision;
  const linkedDecisionPositions = useMemo(() => (
    activeDecisionSubmission
      ? positions
        .filter((position) => position.decisionSubmissionId === activeDecisionSubmission.id)
        .sort((left, right) => left.entryTimestamp - right.entryTimestamp)
      : []
  ), [activeDecisionSubmission, positions]);
  const backfillCandidates = useMemo(() => (
    decisionTarget && !editingDecisionId && currentBar
      ? backfillCandidatePositions(
        positions,
        decisionSubmissions,
        decisionTarget.timestamp,
        currentBar.timestamp,
      )
      : []
  ), [currentBar, decisionSubmissions, decisionTarget, editingDecisionId, positions]);

  const dataSignature = useMemo(() => bars.length
    ? `${bars.length}:${bars[0].timestamp}:${bars[bars.length - 1].timestamp}`
    : "", [bars]);
  const currentReviewMetrics = useMemo(() => calculateDeterministicReviewMetrics({
    bars: bars.slice(0, cursor + 1),
    positions,
    initialCapital,
    spreadBps: executionProfile.spreadBps,
  }), [bars, cursor, executionProfile.spreadBps, initialCapital, positions]);
  /* The persisted snapshot intentionally retains the exact state objects frozen by this render. */
  /* eslint-disable react-hooks/preserve-manual-memoization */
  const trainingState = useMemo<TrainingState>(() => ({
    version: 10,
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
    orderType,
    orderTriggerPrice: orderTriggerPrice || undefined,
    orderStopLoss: orderStopLoss || undefined,
    orderTakeProfit: orderTakeProfit || undefined,
    positionSizeMode,
    riskPercent,
    drawings,
    events,
    marketRules,
    trainingTask: trainingTask ?? undefined,
    tradingMode,
    initialCapital,
    cashBalance,
    executionProfile,
    executionEngineVersion: EXECUTION_ENGINE_VERSION,
    reviewMetrics: currentReviewMetrics,
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
  }), [cashBalance, closedPositions.length, currentReviewMetrics, cursor, currentBar?.timestamp, dataSignature, dataSnapshotId, decision, decisionSubmissions, drawings, equity, events, executionProfile, executions, initialCapital, marketRules, openPnl, openPositions.length, orderQty, orderStopLoss, orderTakeProfit, orderTriggerPrice, orderType, orderRejections, pendingOrders, positionSizeMode, positions, randomSeed, realizedPnl, riskPercent, snapshotDataIndexOffset, snapshotHash, totalPnl, totalReturnPct, tradingMode, trainingTask]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  // Cursor movement, playback, speed and derived review metrics are intentionally
  // excluded. They are navigation state, not a user's training edit.
  const trainingMutationSignature = useMemo(() => JSON.stringify({
    positions,
    pendingOrders,
    executions,
    orderRejections,
    decision,
    decisionSubmissions,
    orderQty,
    orderType,
    orderTriggerPrice,
    orderStopLoss,
    orderTakeProfit,
    positionSizeMode,
    riskPercent,
    drawings,
    marketRules,
    trainingTask,
    tradingMode,
    initialCapital,
    cashBalance,
    dividendIncome,
    executionProfile,
  }), [cashBalance, decision, decisionSubmissions, dividendIncome, drawings, executionProfile, executions, initialCapital, marketRules, orderQty, orderStopLoss, orderTakeProfit, orderTriggerPrice, orderType, orderRejections, pendingOrders, positionSizeMode, positions, riskPercent, tradingMode, trainingTask]);

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
      if (drag && event.pointerId === drag.pointerId) {
        setLiveBarOffset({
          x: drag.offsetX + event.clientX - drag.startX,
          y: drag.offsetY + event.clientY - drag.startY,
        });
        return;
      }
      const trainingDrag = trainingBarDragRef.current;
      if (trainingDrag && event.pointerId === trainingDrag.pointerId) {
        setTrainingNavigatorOffset({
          x: trainingDrag.offsetX + event.clientX - trainingDrag.startX,
          y: trainingDrag.offsetY + event.clientY - trainingDrag.startY,
        });
      }
    };
    const end = (event: PointerEvent) => {
      if (liveBarDragRef.current?.pointerId === event.pointerId) liveBarDragRef.current = null;
      if (trainingBarDragRef.current?.pointerId === event.pointerId) trainingBarDragRef.current = null;
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
  const reviewMetrics = reviewState.reviewMetrics;
  const reviewClosedPositions = reviewState.positions.filter((position) => position.status === "closed");
  const reviewRealizedPnl = reviewClosedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
  const reviewDividendIncome = cashDividendIncomeFromEvents(reviewState.events);
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
  const reviewPlanScore = decisionScore(reviewState.decisionSubmissions.at(-1)?.decision ?? reviewState.decision);
  const reviewTitle = reviewedSession
    ? `${reviewedSession.session.instrumentId} · ${timeframeLabel(reviewedSession.session.timeframe)}`
    : `${instrumentId} · ${timeframeLabel(timeframe)} · 当前训练`;
  const reviewDecisionById = useMemo(
    () => new Map(reviewState.decisionSubmissions.map((submission) => [submission.id, submission])),
    [reviewState.decisionSubmissions],
  );
  const reviewChartSnapshotId = reviewedSession?.state.dataSnapshotId ?? reviewedSession?.session.dataSnapshotId ?? "";
  const reviewChartRequestKey = reviewedSession ? `${reviewedSession.session.id}:${reviewChartSnapshotId}` : "";
  const reviewChartStateForSession = reviewChartLoadState?.requestKey === reviewChartRequestKey
    ? reviewChartLoadState
    : null;
  const reviewPreviewSnapshot = reviewedSession
    && reviewChartStateForSession?.snapshot?.sessionId === reviewedSession.session.id
    ? reviewChartStateForSession.snapshot
    : null;
  const reviewChartLoading = Boolean(reviewedSession && reviewChartSnapshotId && !reviewChartStateForSession);
  const reviewChartError = reviewedSession && !reviewChartSnapshotId
    ? "这条旧训练没有绑定行情快照，暂时无法预览 K 线。"
    : reviewChartStateForSession?.error ?? "";
  const reviewPreviewBars = useMemo(() => {
    const sourceBars = reviewedSession ? reviewPreviewSnapshot?.candles ?? [] : visibleBars;
    if (!reviewedSession || !sourceBars.length) return sourceBars;

    let cursorIndex = reviewedSession.state.cursorTimestamp == null
      ? -1
      : sourceBars.findIndex((bar) => bar.timestamp === reviewedSession.state.cursorTimestamp);
    if (cursorIndex < 0 && reviewPreviewSnapshot) {
      const absoluteCursor = reviewedSession.state.cursor + (reviewedSession.state.dataIndexOffset ?? 0);
      cursorIndex = absoluteCursor - reviewPreviewSnapshot.dataIndexOffset;
    }
    return cursorIndex >= 0 ? sourceBars.slice(0, Math.min(sourceBars.length, cursorIndex + 1)) : sourceBars;
  }, [reviewPreviewSnapshot, reviewedSession, visibleBars]);
  const reviewPreviewInstrument = reviewedSession
    ? reviewPreviewSnapshot?.instrument ?? {
        ...instrument,
        id: reviewedSession.session.instrumentId,
        symbol: reviewedSession.session.instrumentId,
        name: reviewedSession.session.instrumentId,
      }
    : instrument;
  const reviewPreviewTimeframe = reviewedSession?.session.timeframe ?? timeframe;
  const reviewPreviewDataIndexOffset = reviewedSession
    ? reviewPreviewSnapshot?.dataIndexOffset ?? 0
    : chartDataIndexOffset;
  const reviewPreviewCorporateActionMarkers = reviewedSession ? [] : corporateActionMarkers;
  const reviewPreviewTradeMarkers = useMemo<TradeMarker[]>(() => {
    const previewLastBar = reviewPreviewBars.at(-1);
    return reviewState.positions
      .filter((position) => !previewLastBar || position.entryTimestamp <= previewLastBar.timestamp)
      .map((position) => {
        const exitIsVisible = position.exitTimestamp != null
          && (!previewLastBar || position.exitTimestamp <= previewLastBar.timestamp);
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
      });
  }, [reviewPreviewBars, reviewState.positions]);
  const reviewPreviewDecisionMarkers = useMemo<DecisionMarker[]>(() => {
    const previewLastBar = reviewPreviewBars.at(-1);
    if (!previewLastBar) return [];
    return reviewState.decisionSubmissions
      .filter((submission) => submission.barTimestamp <= previewLastBar.timestamp)
      .map((submission, index) => ({
        id: submission.id,
        timestamp: submission.barTimestamp,
        price: reviewPreviewBars.find((bar) => bar.timestamp === submission.barTimestamp)?.high
          ?? submission.referencePrice,
        label: `计划 ${index + 1}`,
      }));
  }, [reviewPreviewBars, reviewState.decisionSubmissions]);

  const parseTrainingState = useCallback((value: unknown): TrainingState | null => {
    if (!value || typeof value !== "object") return null;
    const state = value as Partial<TrainingState>;
    if (!Number.isFinite(state.cursor) || !Array.isArray(state.positions) || !Array.isArray(state.pendingOrders)) return null;
    return {
      version: 10,
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
      orderType: state.orderType === "market" || state.orderType === "limit" || state.orderType === "stop"
        ? state.orderType
        : undefined,
      orderTriggerPrice: typeof state.orderTriggerPrice === "string" ? state.orderTriggerPrice : undefined,
      orderStopLoss: typeof state.orderStopLoss === "string" ? state.orderStopLoss : undefined,
      orderTakeProfit: typeof state.orderTakeProfit === "string" ? state.orderTakeProfit : undefined,
      positionSizeMode: state.positionSizeMode === "risk-percent" ? "risk-percent" : "fixed",
      riskPercent: typeof state.riskPercent === "number" && state.riskPercent > 0
        ? Math.min(100, state.riskPercent)
        : defaultAppSettings.riskPercent,
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
      executionProfile: normalizeExecutionCostProfile(state.executionProfile),
      executionEngineVersion: typeof state.executionEngineVersion === "string"
        ? state.executionEngineVersion
        : "legacy-next-open-v0",
      reviewMetrics: state.reviewMetrics
        && typeof state.reviewMetrics === "object"
        && typeof state.reviewMetrics.version === "string"
        && Array.isArray(state.reviewMetrics.trades)
        && typeof state.reviewMetrics.expectancy === "number"
        ? {
            ...state.reviewMetrics,
            profitFactorInfinite: state.reviewMetrics.profitFactorInfinite === true
              || (state.reviewMetrics.profitFactor == null
                && state.reviewMetrics.closedTrades > 0
                && state.reviewMetrics.averageWin > 0
                && state.reviewMetrics.averageLoss === 0),
          }
        : undefined,
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

  const buildSyncedPreferences = useCallback((
    nextSettings: AppSettings,
    patternPresetOverride?: PatternPreset[],
    options?: { allowPatternPresetRestore?: boolean },
  ): SyncedPreferences => {
    const candidatePresets = patternPresetOverride ?? patternPresets;
    const hiddenPresetIds = options?.allowPatternPresetRestore
      ? []
      : settingsGateway.loadHiddenPatternPresetIds();
    const persistedPatternPresets = applyHiddenBuiltInPatternPresetIds(candidatePresets, hiddenPresetIds);
    return {
      version: 1,
      appSettings: nextSettings,
      patternPresets: persistedPatternPresets,
      ...(options?.allowPatternPresetRestore ? { patternPresetAction: PATTERN_PRESET_RESTORE_ACTION } : {}),
      movingAverageSettings,
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
        minChangePct: liveScanMinChangePct,
        maxChangePct: liveScanMaxChangePct,
        excludeLimitUp: liveScanExcludeLimitUp,
        sort: liveScanSort,
        limit: liveScanLimit,
      },
      liveScanData,
      liveNavigatorResume,
      liveScanResume,
    };
  }, [
    customReasonTags,
    drawingColor,
    drawingLineWidth,
    drawingMagnetMode,
    groupDrawingTools,
    liveNavigatorResume,
    liveScanData,
    liveScanLimit,
    liveScanMarket,
    liveScanMaxPrice,
    liveScanMinPrice,
    liveScanMinVolume,
    liveScanMinChangePct,
    liveScanMaxChangePct,
    liveScanExcludeLimitUp,
    liveScanPresetIds,
    liveScanResume,
    liveScanSort,
    movingAverageSettings,
    patternPresets,
    reasonTags,
    settingsGateway,
  ]);

  const applySyncedPreferences = useCallback((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const stored = value as Partial<SyncedPreferences>;
    const preserveLocalPatternPresets = patternPresetsDirtyRef.current;
    const localHiddenPatternPresetIds = settingsGateway.loadHiddenPatternPresetIds();
    const candidatePatternPresets = preserveLocalPatternPresets
      ? patternPresets
      : Array.isArray(stored.patternPresets)
      ? normalizePatternPresets(stored.patternPresets)
      : patternPresets;
    const syncedPatternPresets = applyHiddenBuiltInPatternPresetIds(candidatePatternPresets, localHiddenPatternPresetIds);
    const syncedHiddenPatternPresetIds = hiddenBuiltInPatternPresetIds(syncedPatternPresets);
    if (syncedHiddenPatternPresetIds.length) {
      settingsGateway.saveHiddenPatternPresetIds(syncedHiddenPatternPresetIds);
    }
    const syncedAvailablePatternPresets = visiblePatternPresets(syncedPatternPresets);
    const localRandomPreferences = settingsGateway.loadPatternPreferences();
    if (stored.appSettings && typeof stored.appSettings === "object") {
      const nextSettings = normalizeSettings(stored.appSettings);
      appSettingsRef.current = nextSettings;
      setAppSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setSpeed(nextSettings.defaultSpeed);
      setOrderQty(configuredDefaultOrderQuantity(nextSettings, instrument.market, instrument.id, marketRules));
      setOrderType(nextSettings.orderType);
      setOpeningGapMode(nextSettings.openingGapMode);
      setOpeningGapUnit(nextSettings.openingGapUnit);
      setOpeningGapThreshold(nextSettings.openingGapThreshold);
      settingsGateway.saveAppSettings(nextSettings);
    }
    if (preserveLocalPatternPresets || Array.isArray(stored.patternPresets)) {
      const nextPresets = syncedPatternPresets;
      const availablePatternPresets = syncedAvailablePatternPresets;
      setPatternPresets(nextPresets);
      setPatternPresetDrafts(nextPresets.map(clonePatternPresetValue));
      setSelectedPatternPresetId((selected) => (
        availablePatternPresets.some((preset) => preset.id === selected) ? selected : availablePatternPresets[0]?.id ?? ""
      ));
      const quickPattern = localRandomPreferences.quickRandomPatternPresetId
        && availablePatternPresets.some((preset) => preset.id === localRandomPreferences.quickRandomPatternPresetId)
        ? localRandomPreferences.quickRandomPatternPresetId
        : "";
      setQuickRandomPatternPresetId(quickPattern);
      const randomPatternIds = localRandomPreferences.randomTrainingPatternPresetIds.filter((id) => (
        availablePatternPresets.some((preset) => preset.id === id)
      ));
      setRandomTrainingPatternPresetIds(randomPatternIds);
    }
    if (stored.movingAverageSettings && typeof stored.movingAverageSettings === "object") {
      const nextIndicators = normalizeMovingAverageSettings(stored.movingAverageSettings);
      setMovingAverageSettings(nextIndicators);
      settingsGateway.saveMovingAverageSettings(nextIndicators);
    }
    setQuickRandomMode(localRandomPreferences.quickRandomMode);
    const syncedReasonTags = Array.isArray(stored.reasonTags)
      ? normalizeReasonTags(stored.reasonTags)
      : normalizeReasonTags([
        ...reasonOptions,
        ...(Array.isArray(stored.customReasonTags) ? stored.customReasonTags : []),
      ]);
    setReasonTags(syncedReasonTags);
    const syncedCustomReasonTags = syncedReasonTags.filter((tag) => !reasonOptions.includes(tag));
    setCustomReasonTags(syncedCustomReasonTags);
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
      if (Array.isArray(settings.presetIds)) setLiveScanPresetIds(settings.presetIds.filter((id): id is string => (
        typeof id === "string" && syncedAvailablePatternPresets.some((preset) => preset.id === id)
      )));
      if (typeof settings.minPrice === "string") setLiveScanMinPrice(settings.minPrice);
      if (typeof settings.maxPrice === "string") setLiveScanMaxPrice(settings.maxPrice);
      if (typeof settings.minVolume === "string") setLiveScanMinVolume(settings.minVolume);
      if (typeof settings.minChangePct === "string") setLiveScanMinChangePct(settings.minChangePct);
      if (typeof settings.maxChangePct === "string") setLiveScanMaxChangePct(settings.maxChangePct);
      if (typeof settings.excludeLimitUp === "boolean") setLiveScanExcludeLimitUp(settings.excludeLimitUp);
      if (settings.sort === "turnover" || settings.sort === "volume" || settings.sort === "change") setLiveScanSort(settings.sort);
      if (Number.isFinite(settings.limit)) setLiveScanLimit(normalizeLiveScanLimit(settings.limit));
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
  }, [instrument.id, instrument.market, marketRules, patternPresets, settingsGateway]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSettings = settingsGateway.loadAppSettings().settings;
      appSettingsRef.current = nextSettings;
      setAppSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setSpeed(nextSettings.defaultSpeed);
      setOrderType(nextSettings.orderType);
      setOpeningGapMode(nextSettings.openingGapMode);
      setOpeningGapUnit(nextSettings.openingGapUnit);
      setOpeningGapThreshold(nextSettings.openingGapThreshold);
      // The initial render is the CN seed screen; the market load below
      // replaces this with the selected instrument's configured quantity.
      setOrderQty(nextSettings.defaultOrderQtyByMarket.CN);
      setSettingsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settingsGateway]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = settingsGateway.loadPatternPreferences();
      const defaults = applyHiddenBuiltInPatternPresetIds(
        normalizePatternPresets(defaultPatternPresets),
        settingsGateway.loadHiddenPatternPresetIds(),
      );
      setPatternPresets(defaults);
      setPatternPresetDrafts(defaults.map(clonePatternPresetValue));
      setSelectedPatternPresetId(visiblePatternPresets(defaults)[0]?.id ?? "");
      setQuickRandomPatternPresetId(stored.quickRandomPatternPresetId);
      setRandomTrainingPatternPresetIds(stored.randomTrainingPatternPresetIds);
      setQuickRandomMode(stored.quickRandomMode);
      setPatternPresetsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settingsGateway]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReasonTags([...reasonOptions]);
      setCustomReasonTags([]);
      setReasonTagsReady(true);
      setCustomReasonTagsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMovingAverageSettings(settingsGateway.loadMovingAverageSettings());
      setMovingAverageSettingsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settingsGateway]);

  useEffect(() => {
    if (!movingAverageSettingsReady) return;
    settingsGateway.saveMovingAverageSettings(movingAverageSettings);
  }, [movingAverageSettings, movingAverageSettingsReady, settingsGateway]);

  useEffect(() => {
    if (!patternPresetsReady) return;
    settingsGateway.saveQuickRandomMode(quickRandomMode);
  }, [patternPresetsReady, quickRandomMode, settingsGateway]);

  useEffect(() => {
    if (!patternPresetsReady) return;
    settingsGateway.saveRandomTrainingPatternPresets(randomTrainingPatternPresetIds);
  }, [patternPresetsReady, randomTrainingPatternPresetIds, settingsGateway]);

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
    let retryTimer: number | null = null;
    void preferencesGateway.load()
      .then((preferences) => {
        if (cancelled) return;
        const stored = preferences && typeof preferences === "object" && !Array.isArray(preferences)
          ? { ...(preferences as Record<string, unknown>) }
          : {};
        // Older builds kept these two preference groups in browser
        // localStorage. Read them once when the local D1 record has no value,
        // then the normal synced preference save writes the migrated result to
        // the local database. Random-training controls are intentionally kept
        // browser-local and are restored by the local settings effect.
        const legacyPatterns = !Array.isArray(stored.patternPresets)
          ? settingsGateway.loadPatternPreferences()
          : null;
        if (legacyPatterns) {
          if (!Array.isArray(stored.patternPresets)) stored.patternPresets = legacyPatterns.patternPresets;
        }
        if (!Array.isArray(stored.reasonTags) && !Array.isArray(stored.customReasonTags)) {
          const legacyReasons = settingsGateway.loadReasonTagPreferences();
          stored.reasonTags = legacyReasons.reasonTags;
          stored.customReasonTags = legacyReasons.customReasonTags;
        }
        applySyncedPreferences(stored);
        syncedPreferencesRetryCountRef.current = 0;
        syncedPreferencesHydratedRef.current = true;
        setSyncedPreferencesReady(true);
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
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (!syncedPreferencesHydratedRef.current) syncedPreferencesLoadStartedRef.current = false;
    };
  }, [applySyncedPreferences, customReasonTagsReady, movingAverageSettingsReady, patternPresetsReady, preferencesGateway, reasonTagsReady, settingsGateway, settingsReady, syncedPreferencesRetryNonce]);

  useEffect(() => {
    if (!syncedPreferencesReady || !syncedPreferencesHydratedRef.current) return;
    const timer = window.setTimeout(() => {
      const saveRevision = patternPresetSaveRevisionRef.current;
      const trackingPatternSave = patternPresetsDirtyRef.current;
      const allowPatternPresetRestore = trackingPatternSave && patternPresetRestoreRequestedRef.current;
      const preferences = buildSyncedPreferences(
        appSettingsRef.current,
        undefined,
        { allowPatternPresetRestore },
      );
      void preferencesGateway.save(preferences)
        .then(() => {
          if (trackingPatternSave && patternPresetSaveRevisionRef.current === saveRevision) {
            patternPresetsDirtyRef.current = false;
            settingsGateway.saveHiddenPatternPresetIds(hiddenBuiltInPatternPresetIds(preferences.patternPresets));
            if (allowPatternPresetRestore) patternPresetRestoreRequestedRef.current = false;
          }
          settingsGateway.removeLegacyCustomPatternPresets();
          settingsGateway.removeLegacyReasonTagPreferences();
        })
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    appSettings,
    buildSyncedPreferences,
    preferencesGateway,
    settingsGateway,
    syncedPreferencesReady,
  ]);

  useEffect(() => {
    if (!syncedPreferencesReady) return;
    let refreshing = false;
    const refresh = () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      void preferencesGateway.load()
        .then((preferences) => {
          if (preferences) applySyncedPreferences(preferences);
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
  }, [applySyncedPreferences, preferencesGateway, syncedPreferencesReady]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    liveStateHydratedRef.current = false;
    void liveGateway.loadState()
      .then((payload) => {
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
  }, [liveGateway, liveStateLoadNonce]);

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
      return [{ ...serializeLivePortfolio(record), sortOrder: index }];
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
      void liveGateway.saveState({ portfolioUpserts, portfolioDeletes, watchlistUpserts, watchlistDeletes })
        .then((result) => {
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
  }, [liveGateway, livePortfolios, liveStateReady, liveStateSaveRetryNonce, liveWatchlist]);

  useEffect(() => () => marketLoadRef.current.controller?.abort(), []);

  useEffect(() => {
    if (instrument.market.toUpperCase() !== "CN" || !/^\d{6}\.(SH|SZ|BJ)$/.test(instrument.id)) return;
    const controller = new AbortController();
    void marketDataGateway.loadCorporateActions<{
      corporateActions?: { enabled?: boolean } | null;
      events?: CorporateActionEvent[];
    }>(instrument.id, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setCorporateActionsForInstrumentId(instrument.id);
      setSelectedCorporateActionId("");
      if (data.corporateActions?.enabled !== true) {
        setCorporateActions([]);
        return;
      }
      setCorporateActions(Array.isArray(data.events) ? data.events : []);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setCorporateActionsForInstrumentId(instrument.id);
        setCorporateActions([]);
      }
    });
    return () => controller.abort();
  }, [instrument.id, instrument.market, marketDataGateway]);

  useEffect(() => {
    if (!reviewedSession) return;

    const snapshotId = reviewedSession.state.dataSnapshotId ?? reviewedSession.session.dataSnapshotId;
    if (!snapshotId) return;

    const controller = new AbortController();
    const requestKey = `${reviewedSession.session.id}:${snapshotId}`;
    const task = reviewedSession.state.trainingTask;
    const hasTaskRange = Boolean(
      task
      && Number.isFinite(task.startTimestamp)
      && Number.isFinite(task.endTimestamp),
    );
    const options = hasTaskRange
      ? {
          startTimestamp: task!.startTimestamp,
          endTimestamp: task!.endTimestamp,
          lookbackBars: normalizeReplayHistoryBars(task!.historyBars),
        }
      : reviewedSession.state.cursorTimestamp != null
        ? {
            startTimestamp: reviewedSession.state.cursorTimestamp,
            endTimestamp: reviewedSession.state.cursorTimestamp,
            lookbackBars: 240,
          }
        : {};
    void reviewGateway.loadSnapshot<{
      instrument: Instrument;
      candles: KLineData[];
      window?: { startIndex: number };
    }>(snapshotId, options, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setReviewChartLoadState({
          requestKey,
          snapshot: {
            sessionId: reviewedSession.session.id,
            snapshotId,
            instrument: data.instrument,
            candles: data.candles,
            dataIndexOffset: data.window?.startIndex ?? 0,
          },
          error: "",
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setReviewChartLoadState({
          requestKey,
          snapshot: null,
          error: error instanceof Error ? error.message : "训练行情预览加载失败",
        });
      });

    return () => controller.abort();
  }, [reviewGateway, reviewedSession]);

  const appendEvent = useCallback((
    type: string,
    payload: Record<string, unknown> = {},
    barTimestamp = currentBar?.timestamp,
  ) => {
    const sequence = eventSequenceRef.current + 1;
    eventSequenceRef.current = sequence;
    const event = createTrainingEvent(sequence, type, barTimestamp, payload);
    setEvents((items) => [...items, event]);
    if (!nonMutatingTrainingEventTypes.has(type)) setSaveState("有未保存更改");
    return event;
  }, [currentBar?.timestamp]);

  const queueRestore = useCallback((request: RestoreRequest) => {
    preemptStartupRandom();
    liveRequestRef.current = null;
    liveRequestTimeframeRef.current = null;
    latestWatchRequestRef.current = null;
    setLiveMode(false);
    setLiveContext(null);
    setLiveEntryFromCoverage(false);
    setLatestWatchMode(false);
    livePersistSignatureRef.current = "";
    setPositions([]);
    setPendingOrders([]);
    setExecutions([]);
    setOrderRejections([]);
    setOrderType(appSettingsRef.current.orderType);
    setOrderTriggerPrice("");
    setOrderStopLoss("");
    setOrderTakeProfit("");
    setDrawings([]);
    setDrawingUndoStack([]);
    setDrawingRedoStack([]);
    setClearNonce(Date.now());
    setTradingMode(tradingModeForInstrument(appSettingsRef.current.tradingMode, undefined, request.instrumentId));
    setInitialCapital(appSettingsRef.current.initialCapital);
    setCashBalance(appSettingsRef.current.initialCapital);
    setExecutionProfile(appSettingsRef.current.executionProfile);
    setPositionSizeMode(appSettingsRef.current.positionSizeMode);
    setRiskPercent(appSettingsRef.current.riskPercent);
    setProtectionPriceSelection(null);
    setTrashPreview(Boolean(request.preview));
    eventSequenceRef.current = 0;
    setEvents([]);
    restoreRequestRef.current = request;
    newTaskRequestRef.current = null;
    setInstrumentId(request.instrumentId);
    setTimeframe(request.timeframe);
    setView("replay");
    setLoadNonce((value) => value + 1);
  }, [preemptStartupRandom]);

  const loadBars = useCallback(async () => {
    if (!startupReady) return;
    if (trainingAutosaveTimerRef.current !== null) {
      window.clearTimeout(trainingAutosaveTimerRef.current);
      trainingAutosaveTimerRef.current = null;
    }
    trainingAutosaveGateRef.current = resetTrainingAutosaveGate();
    marketLoadRef.current.controller?.abort();
    timeframeViewLoadRef.current.controller?.abort();
    timeframeViewLoadRef.current = {
      id: timeframeViewLoadRef.current.id + 1,
      controller: null,
    };
    setChartViewLoading(false);
    const requestId = marketLoadRef.current.id + 1;
    const controller = new AbortController();
    marketLoadRef.current = { id: requestId, controller };
    const restoreRequest = restoreRequestRef.current;
    restoreRequestRef.current = null;
    const newTaskRequest = newTaskRequestRef.current;
    newTaskRequestRef.current = null;
    const liveRequest = liveRequestRef.current;
    liveRequestRef.current = null;
    const latestWatchRequest = latestWatchRequestRef.current;
    latestWatchRequestRef.current = null;
    // Keep the restore/new-task precedence explicit so a newer random round
    // still invalidates an older load, while live observation can override it.
    let requestInstrumentId = latestWatchRequest?.instrumentId
      ?? restoreRequest?.instrumentId
      ?? newTaskRequest?.instrumentId
      ?? instrumentId;
    if (liveRequest) requestInstrumentId = liveRequest.instrumentId;
    const requestTimeframe = latestWatchRequest?.timeframe ?? (liveRequest
      ? liveRequestTimeframeRef.current ?? "1d"
      : restoreRequest?.timeframe ?? newTaskRequest?.timeframe ?? timeframe);
    setLoading(true);
    setChartLoadError("");
    setTrainingReady(false);
    setPlaying(false);
    setShowRandomComplete(false);
    setDuplicateMarketWarning(null);
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
        selection?: { startCursor: number; endCursor: number; sourceStartIndex: number; sourceEndIndex: number; sourceBarCount: number; truncated?: boolean };
      };
      if (requestedSnapshotId) {
        const persistedTask = restoreRequest?.state.trainingTask;
        data = await reviewGateway.loadSnapshot<typeof data>(
          requestedSnapshotId,
          persistedTask?.historyBars != null
            && Number.isFinite(persistedTask.startTimestamp)
            && Number.isFinite(persistedTask.endTimestamp)
            ? {
                startTimestamp: persistedTask.startTimestamp,
                endTimestamp: persistedTask.endTimestamp,
                lookbackBars: normalizeReplayHistoryBars(persistedTask.historyBars),
              }
            : {},
          controller.signal,
        );
      } else {
        // New Replay tasks only need the configured history context and training
        // span. Keeping intraday snapshots bounded prevents multi-million-bar
        // FX datasets from exhausting the browser or the development worker.
        data = await marketDataGateway.createSnapshot<typeof data>({
            instrumentId: requestInstrumentId,
            timeframe: requestTimeframe,
            adjustmentType: defaultAdjustmentTypeForInstrument(requestInstrumentId),
            replayWindow: newTaskRequest && !latestWatchRequest ? {
              mode: newTaskRequest.draft.mode,
              startMode: newTaskRequest.draft.startMode,
              startDate: newTaskRequest.draft.startDate,
              startBar: newTaskRequest.draft.startBar,
              endDate: newTaskRequest.draft.endDate,
              length: newTaskRequest.draft.length,
              historyBars: appSettingsRef.current.replayHistoryBars,
            } : undefined,
          }, controller.signal);
      }
      if (marketLoadRef.current.id !== requestId) return;
      const loadedDataIndexOffset = data.window?.startIndex ?? 0;
      setInstrument(data.instrument);
      setBars(data.candles);
      setChartTimeframe(requestTimeframe);
      setChartBars(data.candles);
      setChartViewError("");
      setChartViewSnapshotId("");
      setSnapshotDataIndexOffset(loadedDataIndexOffset);
      setDataSnapshotId(data.snapshot.id);
      setSnapshotHash(data.snapshot.contentHash);
      const restoredMarketRules = restoreRequest?.state.marketRules;
      const loadedMarketRules = restoredMarketRules?.id === "generic-cash"
        && (
          data.instrument.market === "FX"
          || data.instrument.market === "GOLD"
          || data.instrument.id.endsWith(".FX")
          || data.instrument.id.endsWith(".GOLD")
        )
        ? resolveMarketRules(data.instrument.market, data.instrument.id, appSettingsRef.current.fxAccountConfig)
        : restoredMarketRules ?? resolveMarketRules(
          data.instrument.market,
          data.instrument.id,
          appSettingsRef.current.fxAccountConfig,
        );
      setMarketRules(loadedMarketRules);
      setRuleNotice("");
      if (liveRequest) {
        setTrashPreview(false);
        const savedPortfolio = livePortfoliosRef.current.find((portfolio) => portfolio.instrumentId === liveRequest.instrumentId);
        const liveCursor = data.candles.length - 1;
        setLiveMode(true);
        setLiveContext({ ...liveRequest, timestamp: data.candles[liveCursor]?.timestamp ?? liveRequest.timestamp, close: data.candles[liveCursor]?.close ?? liveRequest.close });
        setLatestWatchMode(false);
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
        setOrderQty(configuredDefaultOrderQuantity(
          appSettingsRef.current,
          data.instrument.market,
          data.instrument.id,
          loadedMarketRules,
        ));
        setOrderType(appSettingsRef.current.orderType);
        setOrderTriggerPrice("");
        setOrderStopLoss("");
        setOrderTakeProfit("");
        setTradingMode(tradingModeForInstrument(
          savedPortfolio?.tradingMode ?? appSettingsRef.current.tradingMode,
          data.instrument.market,
          data.instrument.id,
        ));
        setInitialCapital(savedPortfolio?.initialCapital ?? appSettingsRef.current.initialCapital);
        setCashBalance(savedPortfolio?.cashBalance ?? savedPortfolio?.initialCapital ?? appSettingsRef.current.initialCapital);
        setExecutionProfile(DEFAULT_EXECUTION_COST_PROFILE);
        setPositionSizeMode("fixed");
        setRiskPercent(appSettingsRef.current.riskPercent);
        setProtectionPriceSelection(null);
        setDrawings([]);
        setDrawingUndoStack([]);
        setDrawingRedoStack([]);
        setClearNonce(Date.now());
        setSessionId(createUuid());
        setRandomSeed(createUuid());
        eventSequenceRef.current = 0;
        setEvents([]);
        setSaveState("Live observation · not saved as training");
      } else if (latestWatchRequest) {
        setTrashPreview(false);
        setLiveMode(false);
        setLiveContext(null);
        setLiveEntryFromCoverage(false);
        setLatestWatchMode(true);
        const latestCursor = Math.max(0, data.candles.length - 1);
        setCursor(latestCursor);
        setTrainingTask(null);
        setPositions([]);
        setPendingOrders([]);
        setExecutions([]);
        setOrderRejections([]);
        setDecision(defaultDecision);
        setDecisionSubmissions([]);
        setSelectedDecisionId("");
        setDecisionTarget(null);
        setEditingDecisionId("");
        setOrderQty(configuredDefaultOrderQuantity(
          appSettingsRef.current,
          data.instrument.market,
          data.instrument.id,
          loadedMarketRules,
        ));
        const nextTradingMode = tradingModeForInstrument(
          appSettingsRef.current.tradingMode,
          data.instrument.market,
          data.instrument.id,
        );
        setTradingMode(nextTradingMode);
        setInitialCapital(appSettingsRef.current.initialCapital);
        setCashBalance(appSettingsRef.current.initialCapital);
        setExecutionProfile(appSettingsRef.current.executionProfile);
        setPositionSizeMode(appSettingsRef.current.positionSizeMode);
        setRiskPercent(appSettingsRef.current.riskPercent);
        setProtectionPriceSelection(null);
        setDrawings([]);
        setDrawingUndoStack([]);
        setDrawingRedoStack([]);
        setClearNonce(Date.now());
        setSessionId(createUuid());
        setRandomSeed(createUuid());
        eventSequenceRef.current = 0;
        setEvents([]);
        setSaveState("最新行情 · 仅看盘");
      } else if (restoreRequest) {
        const isTrashPreview = Boolean(restoreRequest.preview);
        const previewSaveLabel = restoreRequest.previewKind === "duplicate"
          ? "重复训练预览 · 未恢复"
          : "回收站查看 · 未恢复";
        setTrashPreview(isTrashPreview);
        setLiveMode(false);
        setLiveContext(null);
        setLatestWatchMode(false);
        const evidenceCursor = restoreRequest.evidenceTimestamp == null
          ? -1
          : data.candles.findIndex((bar) => bar.timestamp === restoreRequest.evidenceTimestamp);
        const timestampCursor = restoreRequest.evidenceTimestamp != null
          ? evidenceCursor
          : restoreRequest.state.cursorTimestamp == null
            ? -1
            : data.candles.findIndex((bar) => bar.timestamp === restoreRequest.state.cursorTimestamp);
        const evidenceMissing = restoreRequest.evidenceTimestamp != null && evidenceCursor < 0;
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
        setOrderType(restoreRequest.state.orderType ?? appSettingsRef.current.orderType);
        setOpeningGapMode(appSettingsRef.current.openingGapMode);
        setOpeningGapUnit(appSettingsRef.current.openingGapUnit);
        setOpeningGapThreshold(appSettingsRef.current.openingGapThreshold);
        setOrderTriggerPrice(restoreRequest.state.orderTriggerPrice ?? "");
        setOrderStopLoss(restoreRequest.state.orderStopLoss ?? "");
        setOrderTakeProfit(restoreRequest.state.orderTakeProfit ?? "");
        setPositionSizeMode(restoreRequest.state.positionSizeMode);
        setRiskPercent(restoreRequest.state.riskPercent);
        setTradingMode(tradingModeForInstrument(
          restoreRequest.state.tradingMode,
          data.instrument.market,
          data.instrument.id,
        ));
        setInitialCapital(restoreRequest.state.initialCapital);
        setCashBalance(restoreRequest.state.cashBalance);
        setExecutionProfile(restoreRequest.state.executionProfile);
        setProtectionPriceSelection(null);
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
        setSaveState(isTrashPreview
          ? previewSaveLabel
          : evidenceMissing
            ? "证据 K 线不在原始快照中，已保留训练当前位置"
            : restoreRequest.evidenceTimestamp != null ? "已跳到证据 K 线" : "已恢复保存点");
      } else {
        setTrashPreview(false);
        setLiveMode(false);
        setLiveContext(null);
        setLatestWatchMode(false);
        setLiveEntryFromCoverage(false);
        const nextSessionId = createUuid();
        const nextSeed = createUuid();
        const boundedDraft = newTaskRequest?.draft && data.selection && newTaskRequest.draft.mode !== "range"
          ? {
              ...newTaskRequest.draft,
              startMode: "bar" as const,
              startBar: data.selection.startCursor + 1,
            }
          : newTaskRequest?.draft;
        const nextTask = resolveTrainingTask(
          {
            ...(boundedDraft ?? defaultTrainingTaskDraft),
            historyBars: appSettingsRef.current.replayHistoryBars,
          },
          data.candles,
          data.instrument.timezone,
          nextSeed,
        );
        setCursor(nextTask.startCursor);
        setTrainingTask(nextTask);
        if (nextTask.randomRun) {
          const currentWindowTimestamps = data.candles
            .slice(nextTask.startCursor, nextTask.endCursor + 1)
            .map((bar) => bar.timestamp);
          void reviewGateway.loadSessions<TrainingSession>(true, controller.signal)
            .then((sessions) => {
              const candidates = sessions.flatMap((savedSession) => {
                if (savedSession.id === nextSessionId
                  || savedSession.instrumentId !== requestInstrumentId
                  || savedSession.timeframe !== requestTimeframe) return [];
                try {
                  const savedState = parseTrainingState(JSON.parse(savedSession.stateJson));
                  const savedTask = savedState?.trainingTask;
                  if (!savedState || !savedTask) return [];
                  return [{
                    value: { session: savedSession, state: savedState },
                    startTimestamp: savedTask.startTimestamp,
                    endTimestamp: savedTask.endTimestamp,
                  }];
                } catch {
                  return [];
                }
              });
              return findStrongestTrainingWindowOverlap(currentWindowTimestamps, candidates);
            })
            .then((match) => {
              if (marketLoadRef.current.id !== requestId) return;
              setDuplicateMarketWarning(match ? { ...match.value, ...match } : null);
            })
            .catch(() => undefined);
        }
        saveCompletedTrainingRef.current = nextTask.status === "completed";
        setPositions([]);
        setPendingOrders([]);
        setExecutions([]);
        setOrderRejections([]);
        setOrderType(appSettingsRef.current.orderType);
        setOrderTriggerPrice("");
        setOrderStopLoss("");
        setOrderTakeProfit("");
        setDecision(defaultDecision);
        setDecisionSubmissions([]);
        setSelectedDecisionId("");
        setDecisionTarget(null);
        setEditingDecisionId("");
        setOrderQty(configuredDefaultOrderQuantity(
          appSettingsRef.current,
          data.instrument.market,
          data.instrument.id,
          loadedMarketRules,
        ));
        setPositionSizeMode(appSettingsRef.current.positionSizeMode);
        setRiskPercent(appSettingsRef.current.riskPercent);
        const nextTradingMode = tradingModeForInstrument(
          appSettingsRef.current.tradingMode,
          data.instrument.market,
          data.instrument.id,
        );
        setTradingMode(nextTradingMode);
        setInitialCapital(appSettingsRef.current.initialCapital);
        setCashBalance(appSettingsRef.current.initialCapital);
        setExecutionProfile(appSettingsRef.current.executionProfile);
        setProtectionPriceSelection(null);
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
          tradingMode: nextTradingMode,
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
  }, [instrumentId, marketDataGateway, parseTrainingState, reviewGateway, startupReady, timeframe]);

  useEffect(() => {
    const timer = window.setTimeout(loadBars, 0);
    return () => window.clearTimeout(timer);
  }, [loadBars, loadNonce]);

  useEffect(() => () => {
    timeframeViewLoadRef.current.controller?.abort();
  }, []);

  const loadTimeframeView = useCallback(async (nextTimeframe: string) => {
    if (nextTimeframe === chartTimeframe) return;
    timeframeViewLoadRef.current.controller?.abort();
    if (nextTimeframe === timeframe) {
      timeframeViewLoadRef.current = {
        id: timeframeViewLoadRef.current.id + 1,
        controller: null,
      };
      setChartTimeframe(timeframe);
      setChartBars(bars);
      setChartViewSnapshotId("");
      setChartViewError("");
      setChartViewLoading(false);
      return;
    }
    if (!dataSnapshotId) {
      setChartViewError("当前状态没有可复用的来源快照，暂时不能切换观察周期。");
      return;
    }

    setProtectionPriceSelection(null);
    setDrawingRequest(null);
    setDrawingGroupOpen("");
    setDrawingTextOpen(false);
    setDrawingObjectsOpen(false);
    setSelectedDrawingId("");
    const requestId = timeframeViewLoadRef.current.id + 1;
    const controller = new AbortController();
    timeframeViewLoadRef.current = { id: requestId, controller };
    setChartViewLoading(true);
    setChartViewError("");
    try {
      const data = await marketDataGateway.createSnapshot<{
        candles: KLineData[];
        snapshot: SnapshotMeta;
      }>({
        instrumentId,
        timeframe: nextTimeframe,
        adjustmentType: defaultAdjustmentTypeForInstrument(instrumentId, instrument.market),
        timeframeView: {
          sourceSnapshotId: dataSnapshotId,
          sourceTimeframe: timeframe,
        },
      }, controller.signal);
      if (timeframeViewLoadRef.current.id !== requestId) return;
      setChartBars(data.candles);
      setChartTimeframe(nextTimeframe);
      setChartViewSnapshotId(data.snapshot.id);
      setChartViewError("");
    } catch (error) {
      if (controller.signal.aborted || timeframeViewLoadRef.current.id !== requestId) return;
      setChartViewError(error instanceof Error ? error.message : "观察周期加载失败");
    } finally {
      if (timeframeViewLoadRef.current.id === requestId) {
        timeframeViewLoadRef.current.controller = null;
        setChartViewLoading(false);
      }
    }
  }, [
    bars,
    chartTimeframe,
    dataSnapshotId,
    instrument.market,
    instrumentId,
    marketDataGateway,
    timeframe,
  ]);

  const persistTrainingState = useCallback(async (
    state: TrainingState,
    successMessage: string,
  ) => {
    const savedAt = new Date().toISOString();
    const stateJson = JSON.stringify(state);
    const cachedSessionFields = {
      instrumentId,
      timeframe,
      dataSnapshotId: dataSnapshotId || undefined,
      stateJson,
      updatedAt: savedAt,
    };
    settingsGateway.saveLastDraft({
      id: sessionId,
      instrumentId,
      timeframe,
      state,
      updatedAt: savedAt,
    });
    // The local list only patches transport fields above; its derived PnL and
    // habit-trade summary must be rebuilt before the next history view.
    sessionSummaryLoadRef.current.controller?.abort();
    sessionSummaryLoadRef.current = {
      id: sessionSummaryLoadRef.current.id + 1,
      controller: null,
    };
    sessionSummariesReadyRef.current = false;
    // The floating training navigator keeps its own session list. Keep that
    // list in sync immediately, otherwise switching away and back can restore
    // the stale state captured when the navigator was opened.
    setTrainingNavigatorSessions((items) => {
      let changed = false;
      const next = items.map((item) => {
        if (item.id !== sessionId) return item;
        changed = true;
        return { ...item, ...cachedSessionFields };
      });
      return changed ? next : items;
    });
    setSessionSummaries((items) => {
      let changed = false;
      const next = items.map((summary) => {
        if (summary.session.id !== sessionId) return summary;
        changed = true;
        return { ...summary, session: { ...summary.session, ...cachedSessionFields } };
      });
      return changed ? next : items;
    });
    try {
      await reviewGateway.saveSession({ id: sessionId, instrumentId, timeframe, dataSnapshotId, state });
      setSaveState(successMessage);
      return true;
    } catch {
      setSaveState("浏览器保存点已写入 · 数据库保存失败");
      return false;
    }
  }, [dataSnapshotId, instrumentId, reviewGateway, sessionId, settingsGateway, timeframe]);

  useEffect(() => {
    if (trashPreview || !trainingReady || !trainingComplete || !saveCompletedTrainingRef.current) return;
    saveCompletedTrainingRef.current = false;
    trainingAutosaveGateRef.current = markTrainingAutosaveSaved(
      trainingAutosaveGateRef.current,
      trainingMutationSignature,
    );
    setSaveState("训练完成 · 正在保存…");
    void persistTrainingState(trainingState, "训练完成 · 已保存");
  }, [persistTrainingState, trainingComplete, trainingMutationSignature, trainingReady, trainingState, trashPreview]);

  useEffect(() => {
    if (trashPreview || liveMode || latestWatchMode || !trainingReady) {
      if (trainingAutosaveTimerRef.current !== null) {
        window.clearTimeout(trainingAutosaveTimerRef.current);
        trainingAutosaveTimerRef.current = null;
      }
      trainingAutosaveGateRef.current = resetTrainingAutosaveGate();
      return;
    }
    const observation = observeTrainingAutosave(
      trainingAutosaveGateRef.current,
      trainingMutationSignature,
    );
    trainingAutosaveGateRef.current = observation.gate;
    if (!observation.shouldSave) return;
    if (trainingAutosaveTimerRef.current !== null) window.clearTimeout(trainingAutosaveTimerRef.current);
    const signatureToSave = trainingMutationSignature;
    const stateToSave = trainingState;
    const timer = window.setTimeout(() => {
      trainingAutosaveTimerRef.current = null;
      setSaveState("自动保存中…");
      void persistTrainingState(stateToSave, "已自动保存").then((saved) => {
        if (saved) {
          trainingAutosaveGateRef.current = markTrainingAutosaveSaved(
            trainingAutosaveGateRef.current,
            signatureToSave,
          );
        }
      });
    }, 650);
    trainingAutosaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (trainingAutosaveTimerRef.current === timer) trainingAutosaveTimerRef.current = null;
    };
  }, [latestWatchMode, liveMode, persistTrainingState, trainingMutationSignature, trainingReady, trainingState, trashPreview]);

  const executeOrders = useCallback((
    orders: PendingOrder[],
    bar: KLineData,
    barIndex: number,
    basePositions = positions,
    baseCashBalance = cashBalance,
  ) => {
    const priceBand = liveMode
      ? null
      : replayPriceBand(
        marketRules,
        bars,
        Math.max(0, barIndex - 1),
        instrument.timezone,
        timeframe,
      );
    const validateEnginePrice = (side: "buy" | "sell", rawPrice: number, allowSessionCloseGap = false) => {
      if (liveMode) return { ok: true as const };
      if (allowSessionCloseGap) return { ok: true as const };
      const validation = validateMarketFill(marketRules, side, rawPrice, priceBand);
      return validation.ok
        ? { ok: true as const }
        : {
          ok: false as const,
          code: validation.code ?? "market_rule_rejected",
          message: validation.message ?? "委托不符合当前市场规则",
        };
    };
    const validateOpeningGap = (order: PendingOrder) => {
      if (liveMode || openingGapMode === "off" || order.action !== "open" || order.side !== "buy") {
        return { ok: true as const };
      }
      const previousClose = bars[barIndex - 1]?.close;
      if (previousClose == null) return { ok: true as const };
      const gap = evaluateOpeningGap(previousClose, bar.open, {
        mode: openingGapMode,
        unit: openingGapUnit,
        threshold: openingGapThreshold,
      });
      if (!gap.blocked) return { ok: true as const };
      const direction = openingGapMode === "high" ? "高开" : "低开";
      const actualGap = openingGapUnit === "percent"
        ? `${Math.abs(gap.gapPercent).toFixed(2)}%`
        : Math.abs(gap.gapPrice).toFixed(instrument.pricePrecision);
      const threshold = openingGapUnit === "percent"
        ? `${openingGapThreshold}%`
        : openingGapThreshold.toFixed(instrument.pricePrecision);
      return {
        ok: false as const,
        code: "opening_gap_blocked",
        message: `${direction}${actualGap}，达到不买阈值 ${threshold}，已跳过买入开仓`,
      };
    };
    const result = executeBarStep({
      orders,
      positions: basePositions,
      bar,
      profile: liveMode ? DEFAULT_EXECUTION_COST_PROFILE : executionProfile,
      cashBalance: baseCashBalance,
      capitalMode: tradingMode === "capital",
      instrumentEconomics: liveMode ? undefined : marketRules.instrumentEconomics,
      skipProtectiveExits: orders.length > 0 && orders.every((order) => order.reason === "session_end"),
      validateFill: (order, rawPrice) => {
        const openingGapValidation = validateOpeningGap(order);
        return openingGapValidation.ok
          ? validateEnginePrice(order.side, rawPrice, order.reason === "session_end")
          : openingGapValidation;
      },
      validateProtectiveFill: (position, side, rawPrice) => {
        if (liveMode) return { ok: true };
        const closeValidation = validateCloseOrder(marketRules, position, bar.timestamp, instrument.timezone);
        if (!closeValidation.ok) return {
          ok: false,
          code: closeValidation.code ?? "market_rule_rejected",
          message: closeValidation.message ?? "保护单暂不符合当前市场规则",
        };
        return validateEnginePrice(side, rawPrice);
      },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const basePositionById = new Map(basePositions.map((position) => [position.id, position]));
    const nextPositions: PositionLot[] = result.positions.map((position) => {
      const entryOrder = orderById.get(position.entryOrderId);
      const exitOrder = position.exitOrderId ? orderById.get(position.exitOrderId) : undefined;
      return {
        ...position,
        decisionSubmissionId: position.decisionSubmissionId ?? entryOrder?.decisionSubmissionId,
        discipline: position.discipline ?? exitOrder?.discipline,
      };
    });
    const stopDraftAfterOpenFills = resetConsumedStopDraftAfterOpenFills({
      orders,
      fills: result.fills,
      orderStopLoss,
      decisionStop: decision.stop,
    });
    const stopDraftAfterExecution = resetConsumedStopDraftAfterFlatten({
      previousPositions: basePositions,
      nextPositions,
      orderStopLoss: stopDraftAfterOpenFills.orderStopLoss,
      decisionStop: stopDraftAfterOpenFills.decisionStop,
    });
    if (stopDraftAfterExecution.orderStopLoss !== orderStopLoss) {
      setOrderStopLoss((current) => current === orderStopLoss
        ? stopDraftAfterExecution.orderStopLoss
        : current);
    }
    if (stopDraftAfterExecution.decisionStop !== decision.stop) {
      setDecision((current) => current.stop === decision.stop
        ? { ...current, stop: stopDraftAfterExecution.decisionStop }
        : current);
    }
    const nextPositionById = new Map(nextPositions.map((position) => [position.id, position]));
    const fills: Execution[] = result.fills.map((fill) => {
      const order = orderById.get(fill.orderId);
      const relatedPosition = nextPositionById.get(fill.positionId) ?? basePositionById.get(fill.positionId);
      return {
        ...fill,
        decisionSubmissionId: order?.decisionSubmissionId ?? relatedPosition?.decisionSubmissionId,
        ruleId: order?.ruleId ?? marketRules.id,
        ruleVersion: order?.ruleVersion ?? marketRules.version,
        discipline: order?.discipline ?? relatedPosition?.discipline,
      };
    });
    const rejections: OrderRejection[] = result.rejections.map((rejection) => ({
      id: createUuid(),
      orderId: rejection.orderId,
      code: rejection.code,
      message: rejection.message,
      timestamp: bar.timestamp,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
    }));

    setPositions(nextPositions);
    if (tradingMode === "capital") setCashBalance(result.cashBalance);
    if (fills.length) {
      setExecutions((items) => [...items, ...fills]);
      appendEvent("orders_filled", {
        fills,
        engineVersion: EXECUTION_ENGINE_VERSION,
        executionProfile: liveMode ? DEFAULT_EXECUTION_COST_PROFILE : executionProfile,
        marketRuleId: marketRules.id,
        marketRuleVersion: marketRules.version,
        tradingMode,
        cashBalance: result.cashBalance,
      }, bar.timestamp);
    }
    if (rejections.length) {
      setOrderRejections((items) => [...items, ...rejections]);
      setRuleNotice(rejections.map((rejection) => rejection.message).join("；"));
      appendEvent("orders_rejected", { rejections }, bar.timestamp);
    }
    if (result.liquidation) {
      const before = result.liquidation.marginBefore;
      setRuleNotice(
        `保证金水平 ${before.marginLevelPct?.toFixed(1) ?? "--"}% 已触及强平线 ${before.stopOutLevelPct.toFixed(1)}%，全部持仓已强制平仓`,
      );
      appendEvent("margin_liquidation", {
        checkPrice: result.liquidation.checkPrice,
        marginBefore: result.liquidation.marginBefore,
        marginAfter: result.liquidation.marginAfter,
        cancelledOrderIds: result.liquidation.cancelledOrderIds,
        liquidationFillIds: fills.filter((fill) => fill.reason === "liquidation").map((fill) => fill.id),
        engineVersion: EXECUTION_ENGINE_VERSION,
      }, bar.timestamp);
    }
    return { ...result, positions: nextPositions, fills, rejections };
  }, [appendEvent, bars, cashBalance, decision.stop, executionProfile, instrument.pricePrecision, instrument.timezone, liveMode, marketRules, openingGapMode, openingGapThreshold, openingGapUnit, orderStopLoss, positions, timeframe, tradingMode]);

  const settleTrainingAtBar = useCallback((
    basePositions: PositionLot[],
    baseCashBalance: number,
    bar: KLineData,
    cancelledOrders: PendingOrder[],
  ) => {
    const positionsToClose = basePositions.filter((position) => position.status === "open");
    const settlementOrders: PendingOrder[] = positionsToClose.map((position) => ({
      id: createUuid(),
      action: "close",
      side: position.side === "long" ? "sell" : "buy",
      qty: position.qty,
      createdAt: bar.timestamp,
      positionId: position.id,
      decisionSubmissionId: position.decisionSubmissionId,
      orderType: "market",
      reason: "training_end",
      engineVersion: EXECUTION_ENGINE_VERSION,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
    }));
    const settlement = executeBarStep({
      orders: settlementOrders,
      positions: basePositions,
      bar: { timestamp: bar.timestamp, open: bar.close, high: bar.close, low: bar.close, close: bar.close },
      profile: executionProfile,
      cashBalance: baseCashBalance,
      capitalMode: tradingMode === "capital",
      instrumentEconomics: marketRules.instrumentEconomics,
    });
    const settledPositions = settlement.positions;
    const settlementFills: Execution[] = settlement.fills.map((fill) => ({
      ...fill,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
    }));
    const settledCashBalance = settlement.cashBalance;

    setPositions(settledPositions);
    setPendingOrders([]);
    if (settlementFills.length) setExecutions((items) => [...items, ...settlementFills]);
    if (tradingMode === "capital") setCashBalance(settledCashBalance);
    appendEvent("positions_settled_at_training_end", {
      price: bar.close,
      timestamp: bar.timestamp,
      closedPositionIds: positionsToClose.map((position) => position.id),
      executionIds: settlementFills.map((fill) => fill.id),
      engineVersion: EXECUTION_ENGINE_VERSION,
      executionProfile,
      cancelledOrderIds: cancelledOrders.map((order) => order.id),
      tradingMode,
      cashBalance: settledCashBalance,
    }, bar.timestamp);
  }, [appendEvent, executionProfile, marketRules.id, marketRules.instrumentEconomics, marketRules.version, tradingMode]);

  const revealMany = useCallback((count: number) => {
    const endCursor = trainingTask?.endCursor ?? bars.length - 1;
    if (cursor >= endCursor || trainingTask?.status === "completed") {
      setPlaying(false);
      return;
    }
    const replayTradingSession = appSettingsRef.current.replayTradingSession;
    const nextCursor = advanceReplayCursor({
      bars,
      cursor,
      requestedCount: count,
      endCursor,
      session: replayTradingSession,
      timeframe,
      timezone: instrument.timezone,
      randomRun: trainingTask?.randomRun,
      liveMode,
      scheduledOrderTimestamps: pendingOrders
        .filter((order) => order.executeAtTimestamp != null)
        .map((order) => Number(order.executeAtTimestamp)),
    });
    const sessionOptions = {
      session: replayTradingSession,
      timeframe,
      timezone: instrument.timezone,
      randomRun: trainingTask?.randomRun,
      liveMode,
    };
    const isWithinReplaySession = createReplayTradingSessionPredicate(sessionOptions);
    const firstSkippedBarIndex = replayTradingSession.enabled
      ? firstReplaySkippedBarIndex({
          bars,
          cursor,
          destination: nextCursor,
          ...sessionOptions,
        })
      : null;
    let simulatedPositions = positions;
    let simulatedCashBalance = cashBalance;
    let remainingOrders = pendingOrders;
    const consumedOrderIds: string[] = [];
    const creditedDividendEventIds = new Set<string>();
    events.forEach((event) => {
      if (event.type !== CASH_DIVIDEND_INCOME_EVENT_TYPE) return;
      const eventId = event.payload.eventId;
      if (typeof eventId === "string" && eventId) creditedDividendEventIds.add(eventId);
    });
    for (let barIndex = cursor + 1; barIndex <= nextCursor; barIndex += 1) {
      const executionBar = bars[barIndex];
      const isSkippedBar = isWithinReplaySession != null && !isWithinReplaySession(executionBar.timestamp);
      const isWeekendSkippedBar = isSkippedBar && !replayTradingSession.enabled;
      if (barIndex === firstSkippedBarIndex) {
        const positionsToClose = simulatedPositions.filter((position) => position.status === "open");
        if (positionsToClose.length) {
          const sessionCloseOrders: PendingOrder[] = positionsToClose.map((position) => ({
            id: `session-close:${position.id}:${executionBar.timestamp}`,
            action: "close",
            side: position.side === "long" ? "sell" : "buy",
            qty: position.qty,
            createdAt: executionBar.timestamp,
            positionId: position.id,
            decisionSubmissionId: position.decisionSubmissionId,
            orderType: "market",
            reason: "session_end",
            engineVersion: EXECUTION_ENGINE_VERSION,
            ruleId: marketRules.id,
            ruleVersion: marketRules.version,
            instrumentEconomics: position.instrumentEconomics,
          }));
          const sessionCloseResult = executeOrders(
            sessionCloseOrders,
            {
              timestamp: executionBar.timestamp,
              open: executionBar.open,
              high: executionBar.open,
              low: executionBar.open,
              close: executionBar.open,
            },
            barIndex,
            simulatedPositions,
            simulatedCashBalance,
          );
          simulatedPositions = sessionCloseResult.positions;
          simulatedCashBalance = sessionCloseResult.cashBalance;
          consumedOrderIds.push(...sessionCloseResult.consumedOrderIds);
          const closedPositionIds = new Set(
            sessionCloseResult.fills
              .filter((fill) => fill.action === "close" && fill.reason === "session_end")
              .map((fill) => fill.positionId),
          );
          if (closedPositionIds.size) {
            const cancelledCloseOrderIds = remainingOrders
              .filter((order) => order.action === "close" && closedPositionIds.has(order.positionId))
              .map((order) => order.id);
            consumedOrderIds.push(...cancelledCloseOrderIds);
            remainingOrders = remainingOrders.filter((order) => !cancelledCloseOrderIds.includes(order.id));
            setRuleNotice(`交易时段结束，已按 ${executionBar.open} 自动平仓 ${closedPositionIds.size} 笔持仓`);
            appendEvent("positions_settled_at_replay_session_end", {
              timestamp: executionBar.timestamp,
              closedPositionIds: [...closedPositionIds],
              executionIds: sessionCloseResult.fills.map((fill) => fill.id),
              cancelledOrderIds: cancelledCloseOrderIds,
              engineVersion: EXECUTION_ENGINE_VERSION,
              executionProfile,
              tradingMode,
              cashBalance: simulatedCashBalance,
            }, executionBar.timestamp);
          }
        }
      }
      const dividendCredits = !liveMode
        && !isWeekendSkippedBar
        && corporateActionsForInstrumentId === instrument.id
        ? cashDividendCreditsForBar(
          corporateActions,
          simulatedPositions,
          executionBar.timestamp,
          creditedDividendEventIds,
        )
        : [];
      const dueOrders = remainingOrders.filter((order) => isReplayOrderDueAtBar(order, executionBar.timestamp));
      const futureOrders = remainingOrders.filter((order) => !isReplayOrderDueAtBar(order, executionBar.timestamp));
      const executableOrders = isSkippedBar
        ? isWeekendSkippedBar ? [] : dueOrders.filter((order) => order.action === "close")
        : dueOrders;
      const deferredOrders = isSkippedBar
        ? isWeekendSkippedBar ? dueOrders : dueOrders.filter((order) => order.action === "open")
        : [];
      if (isWeekendSkippedBar) {
        // Weekend candles are revealed for chart continuity, but they have no
        // executable market or protective orders and do not settle positions.
        remainingOrders = [...futureOrders, ...deferredOrders];
      } else {
        const executionResult = executeOrders(
          executableOrders,
          executionBar,
          barIndex,
          simulatedPositions,
          simulatedCashBalance,
        );
        simulatedPositions = executionResult.positions;
        simulatedCashBalance = executionResult.cashBalance;
        remainingOrders = [...futureOrders, ...deferredOrders, ...executionResult.remainingOrders];
        consumedOrderIds.push(...executionResult.consumedOrderIds);
      }
      if (dividendCredits.length) {
        const dividendAmount = dividendCredits.reduce((sum, credit) => sum + credit.amount, 0);
        if (tradingMode === "capital") simulatedCashBalance += dividendAmount;
        dividendCredits.forEach((credit) => {
          creditedDividendEventIds.add(credit.eventId);
          appendEvent(CASH_DIVIDEND_INCOME_EVENT_TYPE, {
            eventId: credit.eventId,
            instrumentId: credit.instrumentId,
            exDate: credit.date,
            cashPer10: credit.cashPer10,
            eligibleQuantity: credit.quantity,
            amount: credit.amount,
            cashBalance: simulatedCashBalance,
          }, executionBar.timestamp);
        });
      }

      const activePersonalSopRule = appSettingsRef.current.personalSopCheckEnabled
        ? appSettingsRef.current.activePersonalSopRule
        : null;
      if (
        activePersonalSopRule
        && barIndex < endCursor
      ) {
        simulatedPositions
          .filter((position) => position.status === "open")
          .forEach((position) => {
            const holdingBars = holdingBarsAtCursor(bars, barIndex, position.entryTimestamp);
            const management = evaluatePersonalSopManagement(activePersonalSopRule, holdingBars);
            if (!management.overMax) return;
            if (remainingOrders.some((order) => order.action === "close" && order.positionId === position.id)) return;

            const discipline = {
              kind: "personal-sop" as const,
              ruleId: activePersonalSopRule.id,
              ruleVersion: activePersonalSopRule.version,
              violation: "holding-limit" as const,
            };
            const shouldAutoClose = appSettingsRef.current.strictModeEnabled
              && appSettingsRef.current.personalSopAutoCloseEnabled;
            if (!shouldAutoClose) {
              setRuleNotice(`持仓 ${holdingBars} 根 K 线，已超过个人 SOP 上限 ${activePersonalSopRule.management.holdingBarsMax} 根`);
              appendEvent("sop_holding_limit_warning", {
                positionId: position.id,
                holdingBars,
                maxHoldingBars: activePersonalSopRule.management.holdingBarsMax,
                ruleId: activePersonalSopRule.id,
                ruleVersion: activePersonalSopRule.version,
                autoCloseEnabled: false,
              }, executionBar.timestamp);
              return;
            }

            const closeValidation = validateCloseOrder(marketRules, position, executionBar.timestamp, instrument.timezone);
            let executeAtTimestamp: number | undefined;
            if (!closeValidation.ok) {
              if (closeValidation.code !== "t_plus_one_locked") {
                setRuleNotice(closeValidation.message ?? "个人 SOP 自动平仓未通过当前市场规则");
                appendEvent("sop_holding_limit_warning", {
                  positionId: position.id,
                  holdingBars,
                  maxHoldingBars: activePersonalSopRule.management.holdingBarsMax,
                  ruleId: activePersonalSopRule.id,
                  ruleVersion: activePersonalSopRule.version,
                  autoCloseEnabled: true,
                  blockedBy: closeValidation.code ?? "market_rule_rejected",
                }, executionBar.timestamp);
                return;
              }
              const targetIndex = findNextTradingSessionIndex(bars, barIndex, instrument.timezone);
              const taskEndCursor = trainingTask?.endCursor ?? bars.length - 1;
              if (targetIndex < 0 || targetIndex > taskEndCursor) {
                setRuleNotice("个人 SOP 已超出持仓上限，但训练结束前没有可用的下一交易日平仓 K 线");
                appendEvent("sop_holding_limit_warning", {
                  positionId: position.id,
                  holdingBars,
                  maxHoldingBars: activePersonalSopRule.management.holdingBarsMax,
                  ruleId: activePersonalSopRule.id,
                  ruleVersion: activePersonalSopRule.version,
                  autoCloseEnabled: true,
                  blockedBy: "no_next_trading_session",
                }, executionBar.timestamp);
                return;
              }
              executeAtTimestamp = bars[targetIndex].timestamp;
            }
            const order: PendingOrder = {
              id: createUuid(),
              action: "close",
              side: position.side === "long" ? "sell" : "buy",
              qty: position.qty,
              createdAt: executionBar.timestamp,
              positionId: position.id,
              decisionSubmissionId: position.decisionSubmissionId,
              ruleId: marketRules.id,
              ruleVersion: marketRules.version,
              priceBand: replayPriceBand(marketRules, bars, barIndex, instrument.timezone, timeframe),
              ...(executeAtTimestamp == null ? {} : { executeAtTimestamp }),
              orderType: "market",
              engineVersion: EXECUTION_ENGINE_VERSION,
              discipline,
            };
            remainingOrders = [...remainingOrders, order];
            setRuleNotice(executeAtTimestamp == null
              ? `个人 SOP 已超出持仓上限，已预约下一根 K 线平仓`
              : `个人 SOP 已超出持仓上限，已预约下一交易日平仓`);
            appendEvent("sop_auto_close_queued", {
              order,
              positionId: position.id,
              holdingBars,
              maxHoldingBars: activePersonalSopRule.management.holdingBarsMax,
              ruleId: activePersonalSopRule.id,
              ruleVersion: activePersonalSopRule.version,
              ...(executeAtTimestamp == null ? {} : { executeAtTimestamp }),
            }, executionBar.timestamp);
          });
      }
    }
    if (tradingMode === "capital") setCashBalance(simulatedCashBalance);
    setPendingOrders(remainingOrders);
    setCursor(nextCursor);
    appendEvent("replay_advanced", {
      fromCursor: cursor,
      toCursor: nextCursor,
      requestedCount: count,
      executedOrderIds: consumedOrderIds,
      remainingOrderIds: remainingOrders.map((order) => order.id),
      engineVersion: EXECUTION_ENGINE_VERSION,
    }, bars[nextCursor]?.timestamp);
    if (trainingTask && nextCursor >= trainingTask.endCursor) {
      settleTrainingAtBar(
        simulatedPositions,
        simulatedCashBalance,
        bars[nextCursor],
        remainingOrders,
      );
      const completedTask = finishTask(trainingTask, nextCursor);
      setTrainingTask(completedTask);
      // The completion banner is now the source of truth. Clear transient
      // order notices such as a prior T+1 reservation so they cannot remain
      // visible beside an empty pending-order list after settlement.
      setRuleNotice("");
      setPlaying(false);
      if (completedTask.randomRun) setShowRandomComplete(true);
      saveCompletedTrainingRef.current = true;
      appendEvent("training_completed", {
        trainingMode: completedTask.mode,
        startCursor: completedTask.startCursor,
        endCursor: completedTask.endCursor,
      }, bars[nextCursor]?.timestamp);
    }
  }, [appendEvent, bars, cashBalance, corporateActions, corporateActionsForInstrumentId, cursor, events, executeOrders, executionProfile, instrument.id, instrument.timezone, liveMode, marketRules, pendingOrders, positions, settleTrainingAtBar, timeframe, tradingMode, trainingTask]);

  const revealNext = useCallback(() => revealMany(1), [revealMany]);
  const revealPrevious = () => {
    if (rewindLocked) return;
    const nextCursor = Math.max(trainingTask?.startCursor ?? 0, cursor - 1);
    if (nextCursor === cursor) return;
    if (decisionTarget && decisionTarget.dataIndex > nextCursor) {
      if (decisionDraftBeforeBackfillRef.current) setDecision(decisionDraftBeforeBackfillRef.current);
      decisionDraftBeforeBackfillRef.current = null;
      setDecisionTarget(null);
      setBackfillAssociation("associate");
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

  const protectionPriceText = (price: number) => {
    const tick = Math.max(Number(marketRules.priceTick) || 0, 10 ** -instrument.pricePrecision);
    const rounded = Math.round(price / tick) * tick;
    return rounded.toFixed(instrument.pricePrecision);
  };

  const ensureProtectiveDecisionCard = (
    stopLoss?: number,
    takeProfit?: number,
    reason = "protective_levels_attached_to_order",
  ): string | undefined => {
    if (!currentBar || (stopLoss == null && takeProfit == null)) return undefined;
    const stop = stopLoss == null ? decision.stop : protectionPriceText(stopLoss);
    const target = takeProfit == null ? decision.target : protectionPriceText(takeProfit);
    const linkedDecision: Decision = {
      ...decision,
      stop,
      target,
      reasons: [...decision.reasons],
    };
    setDecision(linkedDecision);
    const matchingManual = decisionSubmissions.some((submission) => (
      !submission.autoGenerated
      && submission.barTimestamp === currentBar.timestamp
      && submission.decision.stop === stop
      && submission.decision.target === target
    ));
    const matchingManualSubmission = decisionSubmissions.find((submission) => (
      !submission.autoGenerated
      && submission.barTimestamp === currentBar.timestamp
      && submission.decision.stop === stop
      && submission.decision.target === target
    ));
    if (matchingManual) return matchingManualSubmission?.id;
    const existingAuto = decisionSubmissions.find((submission) => (
      submission.autoGenerated && submission.barTimestamp === currentBar.timestamp
    ));
    if (existingAuto && JSON.stringify(existingAuto.decision) === JSON.stringify(linkedDecision)) return existingAuto.id;
    const submission: DecisionSubmission = {
      id: existingAuto?.id ?? createUuid(),
      barTimestamp: currentBar.timestamp,
      cursor,
      referencePrice: currentBar.close,
      decision: linkedDecision,
      submittedAt: new Date().toISOString(),
      autoGenerated: true,
    };
    setDecisionSubmissions((items) => {
      const manualAlreadyExists = items.some((item) => (
        !item.autoGenerated
        && item.barTimestamp === currentBar.timestamp
        && item.decision.stop === stop
        && item.decision.target === target
      ));
      if (manualAlreadyExists) return items;
      const autoIndex = items.findIndex((item) => (
        item.autoGenerated && item.barTimestamp === currentBar.timestamp
      ));
      if (autoIndex < 0) return [...items, submission];
      return items.map((item, index) => index === autoIndex ? submission : item);
    });
    appendEvent("decision_auto_submitted", {
      submissionId: submission.id,
      cursor,
      referencePrice: currentBar.close,
      decision: linkedDecision,
      reason,
      updated: Boolean(existingAuto),
    }, currentBar.timestamp);
    return submission.id;
  };

  const applyDraftProtectionPrice = (kind: PriceSelectionMode, rawPrice: number) => {
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) return false;
    const value = protectionPriceText(rawPrice);
    if (kind === "stop-loss") {
      setOrderStopLoss(value);
      setDecision((current) => ({ ...current, stop: value }));
    } else if (kind === "take-profit") {
      setOrderTakeProfit(value);
      setDecision((current) => ({ ...current, target: value }));
    } else {
      setOrderTriggerPrice(value);
    }
    setProtectionPriceSelection(null);
    setRuleNotice("");
    if (kind === "stop-loss" || kind === "take-profit") {
      ensureProtectiveDecisionCard(
        kind === "stop-loss" ? Number(value) : undefined,
        kind === "take-profit" ? Number(value) : undefined,
        "protective_level_selected_on_chart",
      );
      appendEvent("protective_level_selected", { kind, price: Number(value), source: "chart" });
    } else {
      appendEvent("entry_trigger_selected", { price: Number(value), source: "chart" });
    }
    return true;
  };

  const clearDraftProtectionPrice = (kind: ProtectionPriceKind) => {
    if (kind === "stop-loss") {
      setOrderStopLoss("");
      setDecision((current) => ({ ...current, stop: "" }));
    } else {
      setOrderTakeProfit("");
      setDecision((current) => ({ ...current, target: "" }));
    }
    if (protectionPriceSelection === kind) setProtectionPriceSelection(null);
    appendEvent("protective_level_cleared", { kind });
  };

  const moveProtectionLine = (line: ProtectionLine, rawPrice: number) => {
    if (line.kind === "opening-gap-threshold") return false;
    if (line.source === "draft") return applyDraftProtectionPrice(line.kind, rawPrice);
    if (!currentBar || !line.positionId || trainingComplete) return false;
    const position = openPositions.find((item) => item.id === line.positionId);
    if (!position) return false;
    const value = Number(protectionPriceText(rawPrice));
    const previous = line.kind === "stop-loss" ? position.stopLoss : position.takeProfit;
    if (line.kind === "stop-loss") {
      const onRiskSide = position.side === "long" ? value < currentBar.close : value > currentBar.close;
      const tightensRisk = previous == null
        || (position.side === "long" ? value >= previous : value <= previous);
      if (!onRiskSide || !tightensRisk) {
        setRuleNotice(position.side === "long"
          ? "多头移动止损只能上移，且必须低于当前价"
          : "空头移动止损只能下移，且必须高于当前价");
        return false;
      }
    } else {
      const onProfitSide = position.side === "long" ? value > currentBar.close : value < currentBar.close;
      if (!onProfitSide) {
        setRuleNotice(position.side === "long" ? "多头止盈必须高于当前价" : "空头止盈必须低于当前价");
        return false;
      }
    }
    setPositions((items) => items.map((item) => item.id === position.id
      ? { ...item, [line.kind === "stop-loss" ? "stopLoss" : "takeProfit"]: value }
      : item));
    setRuleNotice("");
    appendEvent(line.kind === "stop-loss" ? "trailing_stop_moved" : "take_profit_moved", {
      positionId: position.id,
      previousPrice: previous,
      nextPrice: value,
      side: position.side,
      initialRisk: position.initialRisk,
    }, currentBar.timestamp);
    setSaveState(line.kind === "stop-loss" ? "移动止损已更新 · 将自动保存" : "止盈已更新 · 将自动保存");
    return true;
  };

  const queueOpenOrder = (side: "buy" | "sell") => {
    let qty = orderQty;
    if (!currentBar || qty <= 0 || (!liveMode && (cursor >= (trainingTask?.endCursor ?? bars.length - 1) || trainingComplete))) return;
    const selectedOrderType: OrderType = orderType;
    const triggerPrice = selectedOrderType === "market" ? undefined : Number(orderTriggerPrice);
    if (selectedOrderType !== "market" && (!Number.isFinite(triggerPrice) || Number(triggerPrice) <= 0)) {
      rejectOrderAttempt({
        ok: false,
        code: "invalid_trigger_price",
        message: `${orderTypeLabel(selectedOrderType)}触发价必须大于 0`,
      }, { action: "open", side, qty, orderType: selectedOrderType });
      return;
    }
    const decisionStop = Number(decision.stop);
    const decisionTargetPrice = Number(decision.target);
    const enteredStop = Number(orderStopLoss);
    const enteredTarget = Number(orderTakeProfit);
    const stopLoss = Number.isFinite(enteredStop) && enteredStop > 0
      ? enteredStop
      : Number.isFinite(decisionStop) && decisionStop > 0 ? decisionStop : undefined;
    const takeProfit = Number.isFinite(enteredTarget) && enteredTarget > 0
      ? enteredTarget
      : Number.isFinite(decisionTargetPrice) && decisionTargetPrice > 0 ? decisionTargetPrice : undefined;
    const expectedEntry = triggerPrice ?? currentBar.close;
    const invalidStop = stopLoss != null && (side === "buy" ? stopLoss >= expectedEntry : stopLoss <= expectedEntry);
    const invalidTarget = takeProfit != null && (side === "buy" ? takeProfit <= expectedEntry : takeProfit >= expectedEntry);
    if (invalidStop || invalidTarget) {
      rejectOrderAttempt({
        ok: false,
        code: "invalid_protective_level",
        message: side === "buy"
          ? "多头止损应低于预计入场价，止盈应高于预计入场价"
          : "空头止损应高于预计入场价，止盈应低于预计入场价",
      }, { action: "open", side, qty, stopLoss, takeProfit, expectedEntry });
      return;
    }
    const riskSizing = !liveMode && positionSizeMode === "risk-percent"
      ? stopLoss == null ? null : riskSizingFor(side, expectedEntry, stopLoss)
      : null;
    if (!liveMode && positionSizeMode === "risk-percent") {
      if (stopLoss == null) {
        rejectOrderAttempt({
          ok: false,
          code: "risk_sizing_requires_stop",
          message: "风险百分比仓位必须先在图表选择止损价",
        }, { action: "open", side, riskPercent });
        return;
      }
      if (!riskSizing || riskSizing.quantity <= 0) {
        rejectOrderAttempt({
          ok: false,
          code: "risk_budget_too_small",
          message: "当前风险预算不足以满足最小下单数量，或止损方向无效",
        }, { action: "open", side, riskPercent, stopLoss, expectedEntry });
        return;
      }
      qty = riskSizing.quantity;
    }
    const patternFilter = trainingTask?.patternFilter;
    const currentPatternNames = patternFilter?.matchedPresetIds.length
      ? patternFilter.matchedPresetIds.map((id) => {
          const index = patternFilter.presetIds.indexOf(id);
          return patternFilter.presetNames[index] ?? id;
        })
      : patternFilter?.presetNames ?? [];
    const plannedRisk = stopLoss == null ? 0 : Math.abs(expectedEntry - stopLoss);
    const plannedReward = takeProfit == null ? 0 : Math.abs(takeProfit - expectedEntry);
    const sopInstrument = deriveSopInstrumentContext(
      bars,
      cursor,
      instrument.timezone,
      timeframe,
      { market: instrument.market, entryPrice: expectedEntry, marketCap: instrument.marketCap },
    );
    const disciplineGate = evaluateDisciplineGate({
      strictModeEnabled: appSettingsRef.current.strictModeEnabled,
      requirePretradePlan: appSettingsRef.current.requirePretradePlan,
      requiredPretradeFields: appSettingsRef.current.requiredPretradeFields,
      sopCheckEnabled: appSettingsRef.current.sopCheckEnabled,
      personalSopCheckEnabled: appSettingsRef.current.personalSopCheckEnabled,
      activePersonalSopRule: appSettingsRef.current.activePersonalSopRule,
      scope: {
        market: performanceMarketCode(instrument.market, instrument.id),
        timeframe,
        instrumentId: instrument.id,
      },
      decision: {
        ...decision,
        score: decisionScore(decision),
      },
      patterns: currentPatternNames,
      instrument: sopInstrument,
      riskReward: plannedRisk > 0 && plannedReward > 0 ? plannedReward / plannedRisk : undefined,
    });
    if (!disciplineGate.allowed) {
      const blockedMessage = disciplineGate.checks
        .filter((check) => check.status === "blocked")
        .map((check) => check.message)
        .join("；");
      setRuleNotice(blockedMessage || "当前开仓未通过交易纪律检查");
      setSaveState("交易纪律已拦截开仓");
      appendEvent("sop_entry_blocked", {
        checks: disciplineGate.checks,
        scope: { market: instrument.market, instrumentId: instrument.id, timeframe },
        side,
        expectedEntry,
      }, currentBar.timestamp);
      return;
    }
    const disciplineWarning = disciplineGate.checks
      .filter((check) => check.status === "warning")
      .map((check) => check.message)
      .join("；");
    const validation = validateOpenOrder(marketRules, side, qty);
    if (!validation.ok) {
      rejectOrderAttempt(validation, { action: "open", side, qty });
      return;
    }
    const activeExecutionProfile = liveMode ? DEFAULT_EXECUTION_COST_PROFILE : executionProfile;
    const orderEconomics = liveMode ? undefined : marketRules.instrumentEconomics;
    const marginMode = isMarginEconomics(orderEconomics);
    const expectedExecutionPrice = marginMode && selectedOrderType !== "market"
      ? executionPriceFromQuote(side, expectedEntry, activeExecutionProfile)
      : executionPrice(side, expectedEntry, activeExecutionProfile, orderEconomics);
    const entryFee = executionFee(expectedExecutionPrice, qty, activeExecutionProfile, orderEconomics);
    const requiredOrderMargin = requiredMargin(expectedExecutionPrice, qty, orderEconomics);
    if (marginMode && (requiredOrderMargin == null || !Number.isFinite(entryFee))) {
      rejectOrderAttempt({
        ok: false,
        code: "currency_conversion_unavailable",
        message: "账户币种与交易品种无法自动换算，请在设置中填写报价币到账户币的换算率",
      }, { action: "open", side, qty, accountCurrency: orderEconomics?.accountCurrency });
      return;
    }
    const reservedMargin = marginMode ? Number(requiredOrderMargin) + entryFee : 0;
    const reservedCash = !marginMode && side === "buy"
      ? estimatedBuyCashRequired(expectedEntry, qty, activeExecutionProfile, orderEconomics)
      : 0;
    const requiredBuyingPower = marginMode ? reservedMargin : reservedCash;
    if (tradingMode === "capital" && requiredBuyingPower > availableBuyingPower + 0.000001) {
      rejectOrderAttempt({
        ok: false,
        code: marginMode ? "insufficient_margin" : "insufficient_cash",
        message: marginMode
          ? `预计需要保证金及费用 ${requiredBuyingPower.toFixed(2)}，当前可用保证金仅 ${availableBuyingPower.toFixed(2)}`
          : `预计需要 ${requiredBuyingPower.toFixed(2)}，当前可用资金仅 ${availableBuyingPower.toFixed(2)}`,
      }, { action: "open", side, qty, availableBuyingPower });
      return;
    }
    const protectiveDecisionId = !liveMode
      ? ensureProtectiveDecisionCard(stopLoss, takeProfit)
      : undefined;
    const decisionSubmissionId = protectiveDecisionId
      ?? latestEntryDecisionId(decisionSubmissions, currentBar.timestamp);
    const priceBand = replayPriceBand(marketRules, bars, cursor, instrument.timezone, timeframe);
    const order: PendingOrder = {
      id: createUuid(),
      action: "open",
      side,
      qty,
      originalQty: qty,
      filledQty: 0,
      createdAt: currentBar.timestamp,
      positionId: createUuid(),
      decisionSubmissionId,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
      priceBand,
      reservedCash,
      reservedMargin: reservedMargin || undefined,
      instrumentEconomics: orderEconomics,
      orderType: selectedOrderType,
      triggerPrice,
      stopLoss,
      takeProfit,
      sizingMode: liveMode ? "fixed" : positionSizeMode,
      riskPercent: riskSizing?.riskBudget ? riskPercent : undefined,
      riskBudget: riskSizing?.riskBudget,
      engineVersion: EXECUTION_ENGINE_VERSION,
    };
    if (liveMode) {
      setRuleNotice(disciplineWarning);
      setPendingOrders((items) => [...items, order]);
      appendEvent("order_queued", {
        order,
        marketRuleId: marketRules.id,
        marketRuleVersion: marketRules.version,
        tradingMode,
        initialCapital,
        engineVersion: EXECUTION_ENGINE_VERSION,
        executionProfile: activeExecutionProfile,
        liveFillRule: "next_session_open",
      }, currentBar.timestamp);
      setOrderPanelTab("pending");
      setSaveState(selectedOrderType === "market"
        ? "实盘市价委托已挂出，下一交易日开盘成交"
        : `实盘${orderTypeLabel(selectedOrderType)}已挂出，下一交易日开盘价满足条件时成交`);
      return;
    }
    setPendingOrders((items) => [...items, order]);
    setRuleNotice(disciplineWarning);
    appendEvent("order_queued", {
      order,
      marketRuleId: marketRules.id,
      marketRuleVersion: marketRules.version,
      tradingMode,
      initialCapital,
      engineVersion: EXECUTION_ENGINE_VERSION,
      executionProfile: activeExecutionProfile,
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
      decisionSubmissionId: position.decisionSubmissionId,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
      priceBand,
      orderType: "market",
      engineVersion: EXECUTION_ENGINE_VERSION,
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
        decisionSubmissionId: position.decisionSubmissionId,
        ruleId: marketRules.id,
        ruleVersion: marketRules.version,
        priceBand: replayPriceBand(marketRules, bars, cursor, instrument.timezone, timeframe),
        orderType: "market",
        engineVersion: EXECUTION_ENGINE_VERSION,
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
      decisionSubmissionId: position.decisionSubmissionId,
      ruleId: marketRules.id,
      ruleVersion: marketRules.version,
      executeAtTimestamp: targetBar.timestamp,
      orderType: "market",
      engineVersion: EXECUTION_ENGINE_VERSION,
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

  const startFreshTraining = (
    nextInstrumentId: string,
    nextTimeframe: string,
    options: { latestWatch?: boolean } = {},
  ) => {
    preemptStartupRandom();
    const targetMarket = availableInstruments.find((item) => item.id === nextInstrumentId)?.market
      ?? (/\.FX$/i.test(nextInstrumentId) ? "FX" : undefined);
    setDuplicateTrainingPreview(null);
    liveRequestRef.current = null;
    liveRequestTimeframeRef.current = null;
    latestWatchRequestRef.current = options.latestWatch
      ? { instrumentId: nextInstrumentId, timeframe: nextTimeframe }
      : null;
    setTrainingNavigatorActive(false);
    setLiveMode(false);
    setLiveContext(null);
    setLiveEntryFromCoverage(false);
    setLatestWatchMode(Boolean(options.latestWatch));
    livePersistSignatureRef.current = "";
    setPositions([]);
    setPendingOrders([]);
    setExecutions([]);
    setOrderRejections([]);
    setOrderType(appSettingsRef.current.orderType);
    setOrderTriggerPrice("");
    setOrderStopLoss("");
    setOrderTakeProfit("");
    setDrawings([]);
    setDrawingUndoStack([]);
    setDrawingRedoStack([]);
    setClearNonce((nonce) => nonce + 1);
    setTradingMode(tradingModeForInstrument(appSettingsRef.current.tradingMode, targetMarket, nextInstrumentId));
    setInitialCapital(appSettingsRef.current.initialCapital);
    setCashBalance(appSettingsRef.current.initialCapital);
    setExecutionProfile(appSettingsRef.current.executionProfile);
    setOrderQty(configuredDefaultOrderQuantityForRequest(appSettingsRef.current, targetMarket, nextInstrumentId));
    setPositionSizeMode(appSettingsRef.current.positionSizeMode);
    setRiskPercent(appSettingsRef.current.riskPercent);
    setProtectionPriceSelection(null);
    setTrashPreview(false);
    eventSequenceRef.current = 0;
    setEvents([]);
    restoreRequestRef.current = null;
    newTaskRequestRef.current = options.latestWatch ? null : {
      instrumentId: nextInstrumentId,
      timeframe: nextTimeframe,
      draft: defaultTrainingTaskDraft,
    };
    setInstrumentId(nextInstrumentId);
    setTimeframe(nextTimeframe);
    setLoadNonce((value) => value + 1);
  };

  const handleTimeframeChange = (nextTimeframe: string) => {
    if (!currentAvailableTimeframes.includes(nextTimeframe)) return;
    if (dataSnapshotId) {
      void loadTimeframeView(nextTimeframe);
      return;
    }
    startFreshTraining(instrumentId, nextTimeframe);
  };

  const waitForCnLiveUpdate = async () => {
    try {
      await marketDataGateway.cnMaintenanceAction("start", "incremental");
    } catch (error) {
      if (!/正在运行/.test(error instanceof Error ? error.message : "")) throw error;
    }
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const payload = await marketDataGateway.loadCnMaintenanceTask<{
        maintenanceTask?: { status?: string; message?: string; error?: string };
        error?: string;
      }>();
      const task = payload.maintenanceTask;
      setLiveScanStatus(task?.message ?? "正在核对 A 股最新交易日……");
      if (!task || task.status === "completed") return;
      if (task.status === "failed" || task.status === "paused") throw new Error(task.error ?? task.message ?? "A 股增量更新未完成");
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
    throw new Error("A 股增量更新等待超时，请到数据页查看任务状态");
  };

  const runUsLiveUpdate = async (instrumentIds?: string[]) => {
    const payload = await marketDataGateway.startMarketSync<{
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
    }>("US", "update", instrumentIds);
    if (!payload.run) throw new Error(payload.error ?? "美股最新日线批量同步失败");
    const runId = payload.run.id;
    let workerFailures = 0;
    type LiveSyncWorkerPayload = {
      run?: typeof payload.run;
      error?: string;
    };
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      let next: LiveSyncWorkerPayload | null = null;
      try {
        next = await marketDataGateway.marketSyncWorker<LiveSyncWorkerPayload>(runId);
      } catch (error) {
        workerFailures += 1;
        if (workerFailures >= 5) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      if (!next?.run) {
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

  const refreshLivePortfolioPrices = async (options: { ensureMarketData?: boolean } = {}) => {
    if (livePriceRefreshRunningRef.current) return;
    const portfolios = livePortfoliosRef.current;
    const watchlist = liveWatchlistRef.current;
    const tracked = [...portfolios, ...watchlist];
    if (!tracked.length) {
      setLivePriceRefreshStatus("暂无可同步的实盘标的");
      return;
    }
    livePriceRefreshRunningRef.current = true;
    setLivePriceRefreshRunning(true);
    setLivePriceRefreshStatus("正在读取最新价…");
    try {
      const pricesById = new Map<string, {
        timestamp: number;
        open: number;
        close: number;
        realtime: boolean;
        dailyBarClosed: boolean;
        quoteTimestamp?: number;
      }>();
      const errors: string[] = [];
      const usInstrumentIds = [...new Set(
        tracked.filter((item) => item.market === "US").map((item) => item.instrumentId),
      )];
      if (options.ensureMarketData !== false && usInstrumentIds.length) {
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
          const payload = await liveGateway.refreshPrices(market, instrumentIds);
          for (const price of payload.prices ?? []) {
            if (Number.isFinite(price.timestamp) && Number.isFinite(price.open) && Number.isFinite(price.close)) {
              pricesById.set(price.instrumentId, {
                timestamp: Number(price.timestamp),
                open: Number(price.open),
                close: Number(price.close),
                realtime: price.realtime === true,
                dailyBarClosed: price.dailyBarClosed === true,
                ...(Number.isFinite(Number(price.quoteTimestamp))
                  ? { quoteTimestamp: Number(price.quoteTimestamp) }
                  : {}),
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
        const isNewBar = (!price.realtime || price.dailyBarClosed) && price.timestamp > portfolio.latestTimestamp;
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
            const fillPrice = resolveLivePendingOrderPrice(order, price);
            if (fillPrice == null) {
              nextPendingOrders.push(order);
              continue;
            }
            if (order.action === "open") {
              const cashFlow = executionCashFlow(order.side, fillPrice, order.qty);
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
                entryPrice: fillPrice,
                entryTimestamp: price.timestamp,
                entryOrderId: order.id,
                decisionSubmissionId: order.decisionSubmissionId,
                status: "open",
              });
              fills.push({
                id: createUuid(), orderId: order.id, positionId: order.positionId,
                action: "open", side: order.side, qty: order.qty, price: fillPrice,
                timestamp: price.timestamp, decisionSubmissionId: order.decisionSubmissionId, realizedPnl: 0,
                ruleId: order.ruleId ?? marketRules.id,
                ruleVersion: order.ruleVersion ?? marketRules.version,
              });
              if (portfolio.tradingMode === "capital") nextCashBalance += cashFlow;
              continue;
            }
            const positionIndex = nextPositions.findIndex((position) => position.id === order.positionId && position.status === "open");
            if (positionIndex < 0) continue;
            const position = nextPositions[positionIndex];
            const realized = (fillPrice - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1);
            nextPositions[positionIndex] = {
              ...position,
              status: "closed",
              exitPrice: fillPrice,
              exitTimestamp: price.timestamp,
              exitOrderId: order.id,
              realizedPnl: realized,
            };
            fills.push({
              id: createUuid(), orderId: order.id, positionId: position.id,
              action: "close", side: order.side, qty: position.qty, price: fillPrice,
              decisionSubmissionId: position.decisionSubmissionId,
              timestamp: price.timestamp, realizedPnl: realized,
              ruleId: order.ruleId ?? marketRules.id,
              ruleVersion: order.ruleVersion ?? marketRules.version,
            });
            if (portfolio.tradingMode === "capital") nextCashBalance += executionCashFlow(order.side, fillPrice, position.qty);
          }
          nextExecutions.push(...fills);
          nextRejections.push(...rejections);
        }
        const nextTimestamp = price.realtime && !price.dailyBarClosed ? portfolio.latestTimestamp : price.timestamp;
        const priceChanged = nextTimestamp !== portfolio.latestTimestamp || price.close !== portfolio.latestClose;
        const tradeStateChanged = nextPositions !== portfolio.positions
          && (
            nextPendingOrders.length !== portfolio.pendingOrders.length
            || nextExecutions.length !== portfolio.executions.length
            || nextRejections.length !== portfolio.orderRejections.length
          );
        if (!priceChanged && !tradeStateChanged) return portfolio;
        return {
          ...portfolio,
          latestTimestamp: nextTimestamp,
          latestClose: price.close,
          positions: nextPositions,
          pendingOrders: nextPendingOrders,
          executions: nextExecutions,
          orderRejections: nextRejections,
          cashBalance: nextCashBalance,
          updatedAt: new Date().toISOString(),
        };
      });
      if (nextPortfolios.some((portfolio, index) => portfolio !== portfolios[index])) {
        livePortfoliosRef.current = nextPortfolios;
        setLivePortfolios(nextPortfolios);
      }
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
        const observationChanged = observationTimestamp !== watch.observationTimestamp
          || observationClose !== watch.observationClose;
        if (!price) return observationChanged ? { ...migratedWatch, updatedAt: new Date().toISOString() } : watch;
        syncedInstrumentIds.add(watch.instrumentId);
        const nextTimestamp = price.realtime && !price.dailyBarClosed ? watch.latestTimestamp : price.timestamp;
        const priceChanged = nextTimestamp !== watch.latestTimestamp || price.close !== watch.latestClose;
        if (!observationChanged && !priceChanged) return watch;
        return {
          ...migratedWatch,
          latestTimestamp: nextTimestamp,
          latestClose: price.close,
          updatedAt: new Date().toISOString(),
        };
      });
      if (nextWatchlist.some((watch, index) => watch !== watchlist[index])) {
        liveWatchlistRef.current = nextWatchlist;
        setLiveWatchlist(nextWatchlist);
      }
      if (liveMode && liveContext) {
        const price = pricesById.get(liveContext.instrumentId);
        const nextTimestamp = price?.realtime && !price.dailyBarClosed ? liveContext.timestamp : price?.timestamp;
        if (price && (nextTimestamp !== liveContext.timestamp || price.close !== liveContext.close)) {
          const updated = { ...liveContext, timestamp: nextTimestamp ?? liveContext.timestamp, close: price.close };
          setLiveContext(updated);
          liveRequestRef.current = updated;
          setLoadNonce((value) => value + 1);
        }
      }
      setLivePriceRefreshStatus(`已同步 ${syncedInstrumentIds.size} 个标的${errors.length ? `；${errors.join("；")}` : ""}`);
    } catch (error) {
      setLivePriceRefreshStatus(error instanceof Error ? `同步失败：${error.message}` : "同步失败");
    } finally {
      livePriceRefreshRunningRef.current = false;
      setLivePriceRefreshRunning(false);
    }
  };

  useEffect(() => {
    livePriceRefreshRef.current = refreshLivePortfolioPrices;
  });

  useEffect(() => {
    const livePerformanceVisible = view === "performance"
      && (performanceSection === "live" || performanceSection === "watch");
    if (!livePerformanceVisible || !liveStateReady || !liveStateHydratedRef.current) return;

    let cancelled = false;
    let checking = false;
    const refreshFromStoredMarketData = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void livePriceRefreshRef.current?.({ ensureMarketData: false });
    };
    const checkAutoUpdate = async () => {
      if (cancelled || checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const payload = await marketDataGateway.loadAutoUpdateStatus<{
          settings?: { lastFinishedAt?: unknown; lastStatus?: unknown };
        }>();
        if (cancelled) return;
        const settings = payload.settings;
        const previousFinishedAt = liveAutoUpdateFinishedAtRef.current;
        const nextFinishedAt = typeof settings?.lastFinishedAt === "string" && settings.lastFinishedAt
          ? settings.lastFinishedAt
          : null;
        if (shouldRefreshLivePricesAfterAutoUpdate(previousFinishedAt, settings)) {
          refreshFromStoredMarketData();
        }
        liveAutoUpdateFinishedAtRef.current = nextFinishedAt;
      } catch {
        // The next focus or interval check can recover when the web service is ready.
      } finally {
        checking = false;
      }
    };

    // Hydration only restores the persisted ledger. Read the latest already
    // synchronized candles immediately when the live performance page opens.
    refreshFromStoredMarketData();
    void checkAutoUpdate();
    const timer = window.setInterval(() => void checkAutoUpdate(), 30_000);
    const onFocus = () => {
      refreshFromStoredMarketData();
      void checkAutoUpdate();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [liveStateReady, marketDataGateway, performanceSection, view]);

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
      const request = buildLiveScanRequest({
        market: liveScanMarket,
        presetIds: liveScanPresetIds,
        presets: visiblePatternPresets(patternPresets),
        minPrice: liveScanMinPrice,
        maxPrice: liveScanMaxPrice,
        minVolume: liveScanMinVolume,
        minChangePct: liveScanMinChangePct,
        maxChangePct: liveScanMaxChangePct,
        excludeLimitUp: liveScanExcludeLimitUp,
        sort: liveScanSort,
        limit: liveScanLimit,
      });
      const result = await liveGateway.scan(request);
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
      setLiveScanError(normalizeLiveScanError(error));
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
    if (source === "watch") return liveWatchlist
      .filter((watch) => watch.market === "CN" || watch.market === "US")
      .map(liveWatchResult);
    const results = liveScanData?.results ?? [];
    if (liveMode && liveContext && !results.some((result) => result.instrumentId === liveContext.instrumentId)) {
      return [liveContext];
    }
    return results;
  };

  const rememberRecentLiveResult = (result: LiveScanResult) => {
    setRecentLiveResults((items) => [
      result,
      ...items.filter((item) => item.instrumentId !== result.instrumentId),
    ].slice(0, 50));
  };

  const rememberRecentInstrument = (item: AvailableInstrument) => {
    const market = performanceMarketCode(item.market, item.id);
    rememberRecentLiveResult({
      instrumentId: item.id,
      symbol: item.short,
      name: item.label,
      market: market as LiveScanMarket,
      timestamp: 0,
      close: 0,
      changePct: 0,
      volume: 0,
      turnover: 0,
      averageVolume: 0,
      averageTurnover: 0,
      presetIds: [],
      presetNames: [],
    });
  };

  const openLiveScanResult = (
    result: LiveScanResult,
    index?: number,
    source: LiveNavigatorSource = "scan",
    targetTimeframe = "1d",
    fromCoverage = false,
  ) => {
    preemptStartupRandom();
    rememberRecentLiveResult(result);
    liveRequestTimeframeRef.current = targetTimeframe;
    latestWatchRequestRef.current = null;
    setLiveEntryFromCoverage(fromCoverage);
    setLatestWatchMode(false);
    const switchingInstrument = !liveMode || liveContext?.instrumentId !== result.instrumentId;
    if (switchingInstrument) {
      // Do not let the previous replay/live symbol remain visible while its
      // snapshot is loading. The live portfolio for the target symbol is
      // restored by loadBars from the symbol-keyed ledger.
      setPositions([]);
      setPendingOrders([]);
      setExecutions([]);
      setOrderRejections([]);
      setOrderType("market");
      setOrderTriggerPrice("");
      setOrderStopLoss("");
      setOrderTakeProfit("");
      setDrawings([]);
      setDrawingUndoStack([]);
      setDrawingRedoStack([]);
      setClearNonce((nonce) => nonce + 1);
      setTradingMode(tradingModeForInstrument(appSettingsRef.current.tradingMode, result.market, result.instrumentId));
      setInitialCapital(appSettingsRef.current.initialCapital);
      setCashBalance(appSettingsRef.current.initialCapital);
      setExecutionProfile(DEFAULT_EXECUTION_COST_PROFILE);
      setOrderQty(configuredDefaultOrderQuantityForRequest(appSettingsRef.current, result.market, result.instrumentId));
      setPositionSizeMode("fixed");
      setRiskPercent(appSettingsRef.current.riskPercent);
      setProtectionPriceSelection(null);
      eventSequenceRef.current = 0;
      setEvents([]);
      setDecision(defaultDecision);
      setDecisionSubmissions([]);
      setSelectedDecisionId("");
      setDecisionTarget(null);
      setEditingDecisionId("");
      setOrderPanelTab("positions");
    }
    setTrainingNavigatorActive(false);
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
    setTimeframe(targetTimeframe);
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

  const toggleLiveWatchFromNavigator = () => {
    if (!liveMode || !liveContext || !currentBar) return;
    if (liveWatchExists) {
      removeLiveWatch(liveContext.instrumentId);
      setRuleNotice("已从自选移除，不会计入训练或实盘交易表现");
      setSaveState("自选已更新");
      return;
    }
    addLiveWatch();
  };

  const toggleLiveWatchFromCoverage = (item: Coverage) => {
    const marketCode = performanceMarketCode(item.market, item.id);
    if (marketCode !== "CN" && marketCode !== "US" && marketCode !== "FX" && marketCode !== "GOLD") {
      setImportStatus("当前市场暂不支持加入自选");
      return;
    }
    const market = marketCode as LiveWatchMarket;
    const existing = liveWatchlist.find((watch) => watch.instrumentId === item.id);
    if (existing) {
      removeLiveWatch(item.id);
      setImportStatus(`已将 ${item.symbol} 移出自选`);
      return;
    }
    const latest = liveScanData?.results.find((result) => result.instrumentId === item.id);
    const currentPrice = item.id === instrument.id && currentBar ? currentBar.close : undefined;
    const latestClose = latest?.close ?? currentPrice ?? 0;
    const latestTimestamp = latest?.timestamp ?? item.lastTimestamp;
    const nextRecord: LiveWatchRecord = {
      id: `watch:${item.id}`,
      instrumentId: item.id,
      symbol: item.symbol,
      name: item.name,
      market,
      latestTimestamp,
      latestClose,
      ...(latestClose > 0 ? { observationTimestamp: latestTimestamp, observationClose: latestClose } : {}),
      scanTimestamp: latestTimestamp,
      presetIds: latest?.presetIds ?? [],
      presetNames: latest?.presetNames ?? [],
      updatedAt: new Date().toISOString(),
    };
    setLiveWatchlist((items) => [nextRecord, ...items.filter((watch) => watch.instrumentId !== item.id)].slice(0, 500));
    setImportStatus(`已将 ${item.symbol} 加入自选`);
  };

  const openCoverageWatch = (item: Coverage) => {
    const marketCode = performanceMarketCode(item.market, item.id);
    const targetTimeframe = TIMEFRAME_IDS.includes(item.timeframe as typeof TIMEFRAME_IDS[number])
      ? item.timeframe
      : "1d";
    if (marketCode !== "CN" && marketCode !== "US") {
      rememberRecentInstrument({ id: item.id, short: item.symbol, label: item.name, market: item.market, assetType: "other", timeframes: [targetTimeframe] });
      startFreshTraining(item.id, targetTimeframe, { latestWatch: true });
      return;
    }
    const latest = liveScanData?.results.find((result) => result.instrumentId === item.id);
    const latestIndex = liveScanData?.results.findIndex((result) => result.instrumentId === item.id) ?? -1;
    openLiveScanResult({
      instrumentId: item.id,
      symbol: item.symbol,
      name: item.name,
      market: marketCode as LiveScanMarket,
      timestamp: latest?.timestamp ?? item.lastTimestamp,
      close: latest?.close ?? 0,
      changePct: latest?.changePct ?? 0,
      volume: latest?.volume ?? 0,
      turnover: latest?.turnover ?? 0,
      averageVolume: latest?.averageVolume ?? 0,
      averageTurnover: latest?.averageTurnover ?? 0,
      presetIds: latest?.presetIds ?? [],
      presetNames: latest?.presetNames ?? [],
    }, latestIndex >= 0 ? latestIndex : 0, "scan", targetTimeframe, true);
  };

  const openInstrumentWatch = (nextInstrumentId: string) => {
    const selected = availableInstruments.find((item) => item.id === nextInstrumentId);
    if (!selected) return;
    const nextAvailableTimeframes = availableTimeframesForInstrument(
      availableInstruments,
      nextInstrumentId,
      timeframes,
    );
    const targetTimeframe = resolveAvailableTimeframe(nextAvailableTimeframes, "1d");
    const marketCode = performanceMarketCode(selected.market, selected.id);
    if (marketCode !== "CN" && marketCode !== "US") {
      rememberRecentInstrument(selected);
      startFreshTraining(nextInstrumentId, targetTimeframe, { latestWatch: true });
      return;
    }
    const latest = liveScanData?.results.find((result) => result.instrumentId === nextInstrumentId);
    const latestIndex = liveScanData?.results.findIndex((result) => result.instrumentId === nextInstrumentId) ?? -1;
    openLiveScanResult({
      instrumentId: selected.id,
      symbol: selected.short,
      name: selected.label,
      market: marketCode as LiveScanMarket,
      timestamp: latest?.timestamp ?? 0,
      close: latest?.close ?? 0,
      changePct: latest?.changePct ?? 0,
      volume: latest?.volume ?? 0,
      turnover: latest?.turnover ?? 0,
      averageVolume: latest?.averageVolume ?? 0,
      averageTurnover: latest?.averageTurnover ?? 0,
      presetIds: latest?.presetIds ?? [],
      presetNames: latest?.presetNames ?? [],
    }, latestIndex >= 0 ? latestIndex : 0, "scan", targetTimeframe, true);
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
    const nextIndex = selectLiveNavigatorIndex(results, liveScanResume.instrumentId, liveScanResume.index);
    openLiveScanResult(results[nextIndex], nextIndex, "scan");
  };

  const resetTraining = () => {
    if (rewindLocked || latestWatchMode) return;
    saveCompletedTrainingRef.current = false;
    setShowRandomComplete(false);
    setTrainingNavigatorActive(false);
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
    setOrderType(appSettingsRef.current.orderType);
    setOrderTriggerPrice("");
    setOrderStopLoss("");
    setOrderTakeProfit("");
    setRuleNotice("");
    setDecision(defaultDecision);
    setDecisionSubmissions([]);
    setSelectedDecisionId("");
    setDecisionTarget(null);
    setEditingDecisionId("");
    decisionDraftBeforeBackfillRef.current = null;
    setOrderQty(configuredDefaultOrderQuantity(appSettingsRef.current, instrument.market, instrument.id, marketRules));
    setPositionSizeMode(appSettingsRef.current.positionSizeMode);
    setRiskPercent(appSettingsRef.current.riskPercent);
    setCashBalance(initialCapital);
    setExecutionProfile(appSettingsRef.current.executionProfile);
    setProtectionPriceSelection(null);
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
      setSaveState(duplicateTrainingPreview ? "重复训练预览不会保存训练" : "回收站查看模式不会保存训练");
      return;
    }
    if (latestWatchMode) {
      setSaveState("仅看盘模式不会保存训练");
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
    trainingAutosaveGateRef.current = markTrainingAutosaveSaved(
      trainingAutosaveGateRef.current,
      trainingMutationSignature,
    );
    await persistTrainingState({
      ...trainingState,
      events: [...trainingState.events, savedEvent],
    }, "已手动保存");
  };

  const resumeSession = (
    session: TrainingSession,
    preview = false,
    navigatorSessions?: TrainingSession[],
    previewKind?: RestorePreviewKind,
  ) => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) throw new Error("invalid session");
      const resolvedPreviewKind = preview ? previewKind ?? "trash" : undefined;
      if (resolvedPreviewKind !== "duplicate") setDuplicateTrainingPreview(null);
      if (preview || !navigatorSessions?.length) {
        setTrainingNavigatorActive(false);
      } else {
        const sessions = navigatorSessions.some((item) => item.id === session.id)
          ? navigatorSessions
          : [session, ...navigatorSessions];
        setTrainingNavigatorSessions(sessions);
        setTrainingNavigatorIndex(Math.max(0, sessions.findIndex((item) => item.id === session.id)));
        setTrainingNavigatorActive(sessions.length > 1);
      }
      setReviewedSession(null);
      queueRestore({ ...session, state, preview, previewKind: resolvedPreviewKind });
    } catch {
      setImportStatus(preview ? "这条训练记录不完整，无法查看训练。" : "这条训练记录不完整，暂时无法恢复。");
    }
  };

  const returnFromDuplicateTrainingPreview = () => {
    const returnSession = duplicateTrainingPreview?.returnSession;
    setDuplicateTrainingPreview(null);
    setReviewedSession(null);
    if (!returnSession) return;
    resumeSession(returnSession, false);
  };

  const moveTrainingSession = (direction: -1 | 1) => {
    if (!trainingNavigatorSessions.length) return;
    const nextIndex = (trainingNavigatorIndex + direction + trainingNavigatorSessions.length) % trainingNavigatorSessions.length;
    const nextSession = trainingNavigatorSessions[nextIndex];
    if (!nextSession) return;
    resumeSession(nextSession, false, trainingNavigatorSessions);
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
    if (!window.confirm(`确定将 ${session.instrumentId} · ${timeframeLabel(session.timeframe)} 的这次训练移入回收站吗？`)) return;
    const removedIndex = sessionSummaries.findIndex((item) => item.session.id === session.id);
    const removedSummary = removedIndex >= 0 ? sessionSummaries[removedIndex] : undefined;
    setSessionSummaries((items) => items.filter((item) => item.session.id !== session.id));
    try {
      await reviewGateway.deleteSession(session.id);
    } catch {
      if (removedSummary) {
        setSessionSummaries((items) => {
          if (items.some((item) => item.session.id === session.id)) return items;
          const restored = [...items];
          restored.splice(Math.min(removedIndex, restored.length), 0, removedSummary);
          return restored;
        });
      }
      setImportStatus("训练记录移入回收站失败。");
      return;
    }
    if (reviewedSession?.session.id === session.id) setReviewedSession(null);
    const localDraft = settingsGateway.loadLastDraft<{ id?: string }>();
    if (localDraft?.id === session.id) settingsGateway.removeLastDraft();
    if (session.id === sessionId) {
      resetTraining();
      setSaveState("原训练已移入回收站，已开始一场新的空白训练");
    }
  };

  const deleteEmptyTrainingSessions = async (summaries: TrainingSessionSummary[]) => {
    if (emptySessionCleanupRunning) return;
    const candidates = summaries.filter((summary) => !summary.hasMeaningfulActivity);
    if (!candidates.length) return;
    if (!window.confirm(`确定将当前筛选中的 ${candidates.length} 场没有操作和决策的训练移入回收站吗？这些训练只看过 K 线，没有画图、填写决策、下单或其他训练操作；移入后仍可在回收站恢复。`)) return;

    const candidateIds = new Set(candidates.map((summary) => summary.session.id));
    setEmptySessionCleanupRunning(true);
    setSessionSummaries((items) => items.filter((summary) => !candidateIds.has(summary.session.id)));
    const deletedIds = new Set<string>();
    const failedSummaries: TrainingSessionSummary[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      setSaveState(`正在清理无操作训练（${index + 1}/${candidates.length}）…`);
      try {
        await reviewGateway.deleteSession(candidate.session.id);
        deletedIds.add(candidate.session.id);
      } catch {
        failedSummaries.push(candidate);
      }
    }

    if (failedSummaries.length) {
      setSessionSummaries((items) => (
        [...items, ...failedSummaries].sort((left, right) => compareTrainingSessionSummariesByCreatedAt(left, right))
      ));
      setSaveState(`已清理 ${deletedIds.size} 场，另有 ${failedSummaries.length} 场未能移入回收站，请稍后重试。`);
    } else {
      setSaveState(`已将 ${deletedIds.size} 场没有操作和决策的训练移入回收站。`);
    }

    setTrainingNavigatorSessions((items) => items.filter((item) => !deletedIds.has(item.id)));
    if (reviewedSession && deletedIds.has(reviewedSession.session.id)) setReviewedSession(null);
    const localDraft = settingsGateway.loadLastDraft<{ id?: string }>();
    if (localDraft?.id && deletedIds.has(localDraft.id)) settingsGateway.removeLastDraft();
    if (deletedIds.has(sessionId)) {
      resetTraining();
      setSaveState(failedSummaries.length
        ? `原训练已移入回收站；已清理 ${deletedIds.size} 场，另有 ${failedSummaries.length} 场失败。`
        : "原训练已移入回收站，已开始一场新的空白训练");
    }
    setEmptySessionCleanupRunning(false);
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
    setBackfillAssociation("associate");
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
    setBackfillAssociation("associate");
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
      setBackfillAssociation("associate");
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
    setSaveState("决策已删除 · 将自动保存");
  };

  const submitDecision = () => {
    if (latestWatchMode) {
      setSaveState("仅看盘模式不会记录训练决策");
      return;
    }
    const editingSubmission = editingDecisionId
      ? decisionSubmissions.find((submission) => submission.id === editingDecisionId)
      : undefined;
    const backfillTarget = !editingSubmission && decisionTarget && decisionTarget.dataIndex <= cursor ? decisionTarget : null;
    const targetCursor = backfillTarget?.dataIndex ?? cursor;
    const targetBar = bars[targetCursor] ?? currentBar;
    if (!targetBar) return;
    if (!hasDecisionContent(decision)) {
      if (editingSubmission || backfillTarget) {
        setSaveState("决策内容为空 · 未保存");
        return;
      }
      setSaveState("未填写决策 · 仅揭示下一根");
      revealNext();
      return;
    }
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
      setBackfillAssociation("associate");
      setEditingDecisionId("");
      setSaveState("决策已更新 · 将自动保存");
      return;
    }
    const autoSubmission = !backfillTarget
      ? decisionSubmissions.find((item) => item.autoGenerated && item.barTimestamp === targetBar.timestamp)
      : undefined;
    const submission: DecisionSubmission = {
      id: autoSubmission?.id ?? createUuid(),
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
    const associatedBackfillPositionIds = backfillTarget && backfillAssociation === "associate"
      ? backfillCandidates.map((position) => position.id)
      : [];
    setDecisionSubmissions((items) => autoSubmission
      ? items.map((item) => item.id === autoSubmission.id ? submission : item)
      : [...items, submission]);
    if (associatedBackfillPositionIds.length) {
      const associatedIds = new Set(associatedBackfillPositionIds);
      setPositions((items) => items.map((position) => associatedIds.has(position.id)
        ? { ...position, decisionSubmissionId: submission.id }
        : position));
      setExecutions((items) => items.map((execution) => associatedIds.has(execution.positionId)
        ? { ...execution, decisionSubmissionId: submission.id }
        : execution));
    }
    setSelectedDecisionId(submission.id);
    appendEvent("decision_submitted", {
      submissionId: submission.id,
      cursor: targetCursor,
      referencePrice: targetBar.close,
      decision: submission.decision,
      backfilled: Boolean(backfillTarget),
      recordedAtCursor: backfillTarget ? cursor : undefined,
      replacedAutoGenerated: Boolean(autoSubmission),
      associatedPositionIds: associatedBackfillPositionIds,
    }, targetBar.timestamp);
    if (backfillTarget) {
      if (decisionDraftBeforeBackfillRef.current) setDecision(decisionDraftBeforeBackfillRef.current);
      decisionDraftBeforeBackfillRef.current = null;
      setDecisionTarget(null);
      setBackfillAssociation("associate");
      setSaveState(trainingComplete ? "补写决策已加入 · 将自动保存" : "补写决策已保存 · 回放位置未改变");
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

  const openDuplicateTrainingPreview = (duplicateMarketWarning: DuplicateMarketWarning) => {
    const now = new Date().toISOString();
    const returnSession: TrainingSession = {
      id: sessionId,
      instrumentId,
      timeframe,
      dataSnapshotId: dataSnapshotId || undefined,
      stateJson: JSON.stringify(trainingState),
      createdAt: now,
      updatedAt: now,
    };
    setDuplicateTrainingPreview({
      session: duplicateMarketWarning.session,
      state: duplicateMarketWarning.state,
      returnSession,
    });
    setReviewSessionFilters(defaultReviewSessionFilters);
    resumeSession(duplicateMarketWarning.session, true, undefined, "duplicate");
  };

  const openReviewEvidence = (timestamp: number, label: string) => {
    if (!Number.isFinite(timestamp)) return;
    if (reviewedSession) {
      const session = reviewedSession.session;
      setReviewedSession(null);
      queueRestore({
        ...session,
        state: { ...reviewedSession.state, cursorTimestamp: timestamp },
        preview: true,
        previewKind: duplicateTrainingPreview ? "duplicate" : "trash",
        evidenceTimestamp: timestamp,
      });
      return;
    }
    const targetCursor = bars.findIndex((bar) => bar.timestamp === timestamp);
    if (targetCursor < 0) {
      setSaveState("这条证据不在当前行情窗口中");
      return;
    }
    setPlaying(false);
    setSelectedDecisionId("");
    setCursor(targetCursor);
    setView("replay");
    setSaveState(`已跳到${label} K 线`);
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
      if (positionDrawing && (Number.isFinite(stopValue) || Number.isFinite(targetValue))) {
        ensureProtectiveDecisionCard(
          Number.isFinite(stopValue) ? stopValue : undefined,
          Number.isFinite(targetValue) ? targetValue : undefined,
          "protective_levels_drawn_on_chart",
        );
      }
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
    const requestId = ++coverageLoadRef.current;
    setCoverageLoading(true);
    try {
      const data = await marketDataGateway.loadCoverage<{
        coverage: Coverage[];
        total: number;
        summary: { barCount: number; timeframeCount: number; hasNonSampleData?: boolean };
      }>(coveragePage, coveragePageSize, coverageQuery, dataMarket);
      if (requestId !== coverageLoadRef.current || activeDataMarketRef.current !== dataMarket) return;
      setCoverage(data.coverage);
      setSelectedCoverageKeys([]);
      setCoverageTotal(data.total);
      setCoverageSummary({
        barCount: Number(data.summary.barCount ?? 0),
        timeframeCount: Number(data.summary.timeframeCount ?? 0),
        hasNonSampleData: Boolean(data.summary.hasNonSampleData),
      });
    } catch {
      // The database page keeps its current rows while the data service recovers.
    } finally {
      if (requestId === coverageLoadRef.current && activeDataMarketRef.current === dataMarket) setCoverageLoading(false);
    }
  }, [coveragePage, coverageQuery, dataMarket, marketDataGateway]);

  const deleteSelectedCoverage = async () => {
    const selected = coverage.filter((item) => selectedCoverageKeys.includes(coverageKey(item)));
    if (!selected.length) return;
    const localCount = new Set(
      selected.filter((item) => item.source.startsWith("baostock") || item.source.startsWith("tdx-official") || item.source.startsWith("local-zip")).map((item) => item.id),
    ).size;
    const explanation = localCount
      ? `\n\n其中包含 ${localCount} 个本机 A 股品种。本机周线/月线由日线生成，删除任一周期会同时删除该品种的日线和聚合周期。`
      : "";
    if (!window.confirm(`确定删除选中的 ${selected.length} 条数据记录？训练快照会保留，但当前行情库数据将被删除。${explanation}`)) return;
    setCoverageLoading(true);
    try {
      const result = await marketDataGateway.deleteCoverage<{
        deletedRows?: number;
        deletedLocalInstruments?: number;
        error?: string;
      }>(selected.map((item) => ({
        id: item.id,
        timeframe: item.timeframe,
        adjustmentType: item.adjustmentType,
        source: item.source,
      })));
      setImportStatus(`删除完成：数据库 K 线 ${Number(result.deletedRows ?? 0).toLocaleString()} 根，本机 A 股品种 ${Number(result.deletedLocalInstruments ?? 0).toLocaleString()} 个。训练快照未受影响。`);
      setSelectedCoverageKeys([]);
      await Promise.all([loadCoverage(), loadInstrumentCatalog()]);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "删除失败");
    } finally {
      setCoverageLoading(false);
    }
  };

  const instrumentCatalogLoadRef = useRef(0);
  const loadInstrumentCatalog = useCallback(async () => {
    const requestId = ++instrumentCatalogLoadRef.current;
    // The local data service can answer before its full catalog has finished
    // indexing.  Do not replace the seed catalog with that transient subset;
    // retry until A-share data is visible, then only keep a seed market when a
    // complete response still does not contain that market.
    const retryDelays = [0, 500, 1000, 2000, 4000];
    let catalog: AvailableInstrument[] = [];
    let clearedMarkets = new Set<string>();
    try {
      const readCatalogTaskStatus = async () => {
        try {
          const data = await marketDataGateway.loadCatalogTask<{ catalogTask?: { status?: string } }>();
          return data.catalogTask?.status ?? null;
        } catch {
          return null;
        }
      };
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        if (retryDelays[attempt] > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelays[attempt]));
        }
        try {
          const data = await marketDataGateway.loadInstrumentCatalog<{ instruments?: Array<Instrument & { timeframes?: string[] }>; clearedMarkets?: string[] }>();
          const instruments = (data.instruments ?? [])
            .map(normalizeAvailableInstrument)
            .filter((item): item is AvailableInstrument => item !== null);
          catalog = instruments;
          clearedMarkets = new Set(data.clearedMarkets ?? []);
          const catalogTaskStatus = await readCatalogTaskStatus();
          const catalogIndexing = catalogTaskStatus != null
            && !["completed", "failed", "cancelled"].includes(catalogTaskStatus);
          if ((catalog.some((item) => marketRuleCode(item.market) === "CN") || clearedMarkets.size > 0) && !catalogIndexing) break;
        } catch {
          // The next attempt covers a data service that is still starting.
        }
      }

      const loadedMarkets = new Set(catalog.map((item) => marketRuleCode(item.market)));
      const fallbackMarkets = defaultInstruments.filter((item) => !loadedMarkets.has(marketRuleCode(item.market)) && !clearedMarkets.has(marketRuleCode(item.market)));
      const merged = [...fallbackMarkets, ...catalog];
      if (requestId === instrumentCatalogLoadRef.current) setAvailableInstruments(merged);
    } finally {
      if (requestId === instrumentCatalogLoadRef.current) setInstrumentCatalogReady(true);
    }
  }, [marketDataGateway]);

  const loadTrashSessions = useCallback(async () => {
    setTrashLoading(true);
    setTrashError("");
    try {
      const sessions = await reviewGateway.loadTrashSessions<TrainingSession>();
      setTrashSessions(sessions.sort(compareTrainingSessionsByCreatedAt));
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "读取回收站失败");
    } finally {
      setTrashLoading(false);
    }
  }, [reviewGateway]);

  const inspectTrashedSession = (session: TrainingSession) => {
    setShowTrash(false);
    setShowSettings(false);
    resumeSession(session, true);
  };

  const restoreTrashedSession = async (session: TrainingSession) => {
    if (trashActionId) return;
    if (!window.confirm(`恢复 ${session.instrumentId} · ${timeframeLabel(session.timeframe)} 这次训练吗？`)) return;
    setTrashActionId(session.id);
    setTrashError("");
    try {
      await reviewGateway.restoreSession(session.id);
      setTrashSessions((items) => items.filter((item) => item.id !== session.id));
      void loadSessions(true, true);
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
    if (!window.confirm(`确定彻底删除 ${session.instrumentId} · ${timeframeLabel(session.timeframe)} 吗？删除后无法恢复。`)) return;
    setTrashActionId(session.id);
    setTrashError("");
    try {
      await reviewGateway.deleteSession(session.id, true);
      setTrashSessions((items) => items.filter((item) => item.id !== session.id));
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "彻底删除失败");
    } finally {
      setTrashActionId("");
    }
  };

  const buildSessionSummary = useCallback((session: TrainingSession): TrainingSessionSummary | null => {
    try {
      const state = parseTrainingState(JSON.parse(session.stateJson));
      if (!state) return null;
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
      const decisionsById = new Map(state.decisionSubmissions.map((submission) => [submission.id, submission]));
      const sortedDecisions = [...state.decisionSubmissions]
        .sort((left, right) => left.barTimestamp - right.barTimestamp);
      const habitTrades: TrainingSessionHabitTrade[] = closedSessionPositions.map((position) => {
        const decisionsBeforeEntry = sortedDecisions
          .filter((submission) => submission.barTimestamp <= position.entryTimestamp);
        const explicitlyLinkedDecision = position.decisionSubmissionId
          ? decisionsById.get(position.decisionSubmissionId)
          : undefined;
        const attributedDecision = explicitlyLinkedDecision
          ?? decisionsBeforeEntry
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
            exitTimestamp: position.exitTimestamp,
            entryPrice: position.entryPrice,
          market: performanceMarketLabel(
            /\.FX$/i.test(session.instrumentId)
              ? "FX"
              : /\.(SH|SZ|BJ)$/i.test(session.instrumentId) ? "CN" : "US",
          ),
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
      const summary: TrainingSessionSummary = {
        session,
        state,
        hasMeaningfulActivity: hasMeaningfulTrainingActivity({
          positions: state.positions,
          pendingOrders: state.pendingOrders,
          executions: state.executions,
          orderRejections: state.orderRejections,
          drawings: state.drawings,
          events: state.events,
          hasDecisionContent: hasDecisionContent(state.decision, state.decisionSubmissions),
        }),
        task,
        pnl,
        returnPct,
        progressSummary,
        modeLabel: task
          ? task.randomRun
            ? task.mode === "blind" ? "随机盲测" : "随机训练"
            : trainingModeLabels[task.mode]
          : "自由训练",
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
      };
      return summary;
    } catch {
      return null;
    }
  }, [parseTrainingState]);

  const loadSessions = useCallback(async (includeAll = false, force = false) => {
    if (!force && sessionSummariesReadyRef.current) return;
    sessionSummaryLoadRef.current.controller?.abort();
    const requestId = sessionSummaryLoadRef.current.id + 1;
    const controller = new AbortController();
    sessionSummaryLoadRef.current = { id: requestId, controller };
    try {
      const sessions = await reviewGateway.loadSessions<TrainingSession>(includeAll, controller.signal);
      const result = await buildReviewSessionSummariesInBatches(
        [...sessions].sort(compareTrainingSessionsByCreatedAt),
        buildSessionSummary,
        {
          batchSize: REVIEW_SESSION_SUMMARY_BATCH_SIZE,
          shouldCancel: () => controller.signal.aborted,
        },
      );
      if (controller.signal.aborted || result.status !== "completed" || sessionSummaryLoadRef.current.id !== requestId) return;
      setSessionSummaries(result.summaries);
      sessionSummariesReadyRef.current = true;
    } catch {
      if (!controller.signal.aborted) {
        // Review data is optional for the replay shell; retain the current list on a transient failure.
      }
    } finally {
      if (sessionSummaryLoadRef.current.id === requestId) {
        sessionSummaryLoadRef.current.controller = null;
      }
    }
  }, [buildSessionSummary, reviewGateway]);

  const needsSnapshotTradeContexts = view === "performance"
    && (performanceSection === "training" || performanceSection === "sop");
  useEffect(() => {
    if (!needsSnapshotTradeContexts || !sessionSummaries.length) return;
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
    void reviewGateway.loadSnapshotAnalysis<{ contexts?: SnapshotTradeContextMap }>(requestItems, controller.signal)
      .then((data) => {
        if (data?.contexts) setSnapshotTradeContexts(data.contexts);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [needsSnapshotTradeContexts, reviewGateway, sessionSummaries]);

  const performanceSessionSummaries = useMemo(
    () => view === "performance" ? sessionSummaries : [],
    [sessionSummaries, view],
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
        && (performanceFilters.accountingMode === "all" || summary.state.tradingMode === performanceFilters.accountingMode)
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
    }).sort(compareTrainingSessionSummariesByCreatedAt);
  }, [performanceFilters, performanceMarketByInstrument, performanceSessionSummaries]);

  const performanceUsesCapital = performanceFilters.accountingMode === "capital";

  const performanceRecord = useCallback((summary: typeof sessionSummaries[number]): PerformanceRecord => {
    return {
      totalPnl: performanceUsesCapital ? summary.pnl.total : summary.returnPct,
      realizedPnl: performanceUsesCapital ? summary.pnl.realized : summary.realizedReturnPct,
      floatingPnl: performanceUsesCapital ? summary.pnl.floating : summary.floatingReturnPct,
      status: summary.task?.status === "completed" ? "completed" : "active",
      closedTradePnls: performanceUsesCapital ? summary.closedTradePnls : summary.closedTradeReturns,
      planScores: summary.planScores,
      updatedAt: summary.session.updatedAt,
    };
  }, [performanceUsesCapital]);

  const filteredPerformance = useMemo(
    () => summarizePerformance(filteredSessionSummaries.map(performanceRecord)),
    [filteredSessionSummaries, performanceRecord],
  );
  const filteredPerformanceTotals = useMemo(() => filteredSessionSummaries.reduce((totals, summary) => ({
    totalPnl: totals.totalPnl + summary.pnl.total,
    realizedPnl: totals.realizedPnl + summary.pnl.realized,
    floatingPnl: totals.floatingPnl + summary.pnl.floating,
    totalReturnPct: totals.totalReturnPct + summary.returnPct,
    realizedReturnPct: totals.realizedReturnPct + summary.realizedReturnPct,
    floatingReturnPct: totals.floatingReturnPct + summary.floatingReturnPct,
  }), {
    totalPnl: 0,
    realizedPnl: 0,
    floatingPnl: 0,
    totalReturnPct: 0,
    realizedReturnPct: 0,
    floatingReturnPct: 0,
  }), [filteredSessionSummaries]);

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
    if (liveNavigatorSource === "watch") return liveWatchlist
      .filter((watch) => watch.market === "CN" || watch.market === "US")
      .map(liveWatchResult);
    const results = liveScanData?.results ?? [];
    // A symbol opened from the data coverage table may not belong to the
    // latest scanner result. Keep a one-item navigator so the user can still
    // see and exit the current watch view without inheriting another scan.
    if (liveMode && liveContext && !results.some((result) => result.instrumentId === liveContext.instrumentId)) {
      return [liveContext];
    }
    return results;
  }, [liveContext, liveMode, liveNavigatorSource, livePortfolios, liveScanData, liveWatchlist]);

  const watchlistDisplayResults = useMemo<LiveScanResult[]>(() => {
    if (watchlistSource === "scan") return liveScanData?.results ?? [];
    if (watchlistSource === "recent") return recentLiveResults;
    return liveWatchlist.map((watch) => {
      const baseline = liveWatchObservationPrice(watch);
      const changePct = baseline > 0 && Number.isFinite(watch.latestClose)
        ? (watch.latestClose - baseline) / baseline * 100
        : 0;
      return {
        ...liveWatchResult(watch),
        changePct,
      };
    });
  }, [liveScanData, liveWatchlist, recentLiveResults, watchlistSource]);

  // Result ordering can change after a refresh.  Prefer the saved instrument
  // identity over the old numeric index so the floating navigator resumes on
  // the same symbol whenever it is still present in the list.  This is derived
  // during render, so restoring a result never causes an effect-driven render
  // cascade.
  const liveNavigatorDisplayIndex = useMemo(() => {
    const activeInstrumentId = liveContext?.instrumentId
      ?? (liveNavigatorResume.source === liveNavigatorSource ? liveNavigatorResume.instrumentId : undefined);
    return selectLiveNavigatorIndex(liveNavigatorResults, activeInstrumentId, liveScanIndex);
  }, [liveContext, liveNavigatorResults, liveNavigatorResume, liveNavigatorSource, liveScanIndex]);

  const reviewModeOptions = useMemo(
    () => [...new Set(sessionSummaries.map((summary) => summary.modeLabel))],
    [sessionSummaries],
  );
  const filteredReviewSessionSummaries = useMemo(() => {
    return filterReviewSessions(
      sessionSummaries.map((summary) => ({
        ...summary,
        instrumentId: summary.session.instrumentId,
        timeframe: summary.session.timeframe,
        completed: summary.task?.status === "completed",
        hasPlan: summary.state.decisionSubmissions.length > 0,
        patternNames: summary.task?.patternFilter?.presetNames ?? [],
      })),
      reviewSessionFilters,
    ).sort(compareTrainingSessionSummariesByCreatedAt);
  }, [reviewSessionFilters, sessionSummaries]);
  const emptyReviewSessionSummaries = useMemo(
    () => filteredReviewSessionSummaries.filter((summary) => !summary.hasMeaningfulActivity),
    [filteredReviewSessionSummaries],
  );
  const performanceHabitTrades = useMemo<HabitTrade[]>(() => filteredSessionSummaries.flatMap((summary) => (
    summary.habitTrades.map((trade) => {
      const snapshotId = summary.state.dataSnapshotId ?? summary.session.dataSnapshotId ?? "";
      const context = snapshotTradeContexts[snapshotId]?.[String(trade.entryTimestamp)];
      return {
        result: performanceUsesCapital ? trade.pnl : trade.returnPct,
        holdingBars: trade.holdingBars,
        closedTimestamp: trade.exitTimestamp ?? trade.entryTimestamp,
        scope: {
          market: performanceMarketCode(trade.market, summary.session.instrumentId),
          timeframe: summary.session.timeframe,
          instrumentId: summary.session.instrumentId,
        },
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
  )), [filteredSessionSummaries, performanceUsesCapital, snapshotTradeContexts]);
  const performanceHabitAnalysis = useMemo(
    () => analyzePerformanceHabits(performanceHabitTrades),
    [performanceHabitTrades],
  );
  const personalSopTrades = useMemo<HabitTrade[]>(() => {
    if (view !== "performance" || performanceSection !== "sop") return [];
    return sessionSummaries.flatMap((summary) => (
      summary.habitTrades.map((trade) => {
        const snapshotId = summary.state.dataSnapshotId ?? summary.session.dataSnapshotId ?? "";
        const context = snapshotTradeContexts[snapshotId]?.[String(trade.entryTimestamp)];
        return {
          result: trade.returnPct,
          holdingBars: trade.holdingBars,
          closedTimestamp: trade.exitTimestamp ?? trade.entryTimestamp,
          scope: {
            market: performanceMarketCode(trade.market, summary.session.instrumentId),
            timeframe: summary.session.timeframe,
            instrumentId: summary.session.instrumentId,
          },
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
    ));
  }, [performanceSection, sessionSummaries, snapshotTradeContexts, view]);
  const personalSopRecommendations = useMemo<PersonalSopRecommendation[]>(() => (
    personalSopTemplateScopes.flatMap((scope) => generatePersonalSopRecommendations(personalSopTrades, { scope, limit: 3 }))
  ), [personalSopTrades]);
  const personalSopScopeSummaries = useMemo(
    () => summarizePersonalSopScopes(personalSopTrades, personalSopTemplateScopes),
    [personalSopTrades],
  );

  const applyPersonalSopRule = (recommendation: PersonalSopRecommendation) => {
    const nextSettings = normalizeSettings({
      ...appSettingsRef.current,
      activePersonalSopRule: recommendationToPersonalSopRule(recommendation),
    });
    appSettingsRef.current = nextSettings;
    setAppSettings(nextSettings);
    setSettingsDraft(nextSettings);
    settingsGateway.saveAppSettings(nextSettings);
    setRuleNotice(`已采用个人 SOP：${recommendation.title} · ${recommendation.stats.samples} 笔样本`);
  };
  const selectedPerformanceSession = filteredSessionSummaries.find(
    (summary) => summary.session.id === selectedPerformanceSessionId,
  );
  const formatPerformanceValue = (value: number) => performanceUsesCapital ? money(value) : percent(value);
  const performanceHeroUsesAmount = performanceHeroDisplayMode === "amount";
  const performanceHeroValue = performanceHeroUsesAmount
    ? filteredPerformanceTotals.totalPnl
    : filteredPerformanceTotals.totalReturnPct;
  const reviewHeroTone: "up" | "down" = reviewRealizedPnl >= 0 ? "up" : "down";
  const reviewResultTone: "up" | "down" = reviewTotalResult >= 0 ? "up" : "down";
  const reviewHistoryItems = useMemo<SessionHistoryItem[]>(() => filteredReviewSessionSummaries.map((summary) => ({
    id: summary.session.id,
    instrumentId: summary.session.instrumentId,
    timeframe: summary.session.timeframe,
    completed: summary.task?.status === "completed",
    modeLabel: summary.modeLabel,
    rangeLabel: summary.rangeLabel,
    patternLabel: summary.task?.patternFilter
      ? summary.task.patternFilter.presetNames.join("、") || summary.task.patternFilter.presetIds.join("、")
      : undefined,
    progressLabel: summary.task ? `${summary.progressSummary.revealed}/${summary.progressSummary.total}` : undefined,
    tradingMode: summary.state.tradingMode,
    totalValue: summary.state.tradingMode === "capital" ? money(summary.pnl.total) : percent(summary.returnPct),
    realizedValue: summary.state.tradingMode === "capital" ? money(summary.pnl.realized) : percent(summary.realizedReturnPct),
    floatingValue: summary.state.tradingMode === "capital" ? money(summary.pnl.floating) : percent(summary.floatingReturnPct),
    totalTone: (summary.state.tradingMode === "capital" ? summary.pnl.total : summary.returnPct) >= 0 ? "up" : "down",
    openPositions: summary.pnl.openPositions,
    closedPositions: summary.pnl.closedPositions,
    winningTrades: summary.winningTrades,
    losingTrades: summary.losingTrades,
    flatTrades: summary.flatTrades,
    createdAtLabel: new Date(summary.session.createdAt).toLocaleString("zh-CN"),
    selected: reviewedSession?.session.id === summary.session.id,
  })), [filteredReviewSessionSummaries, reviewedSession]);
  const reviewAuditEvents = useMemo<AuditEventItem[]>(() => [...reviewState.events]
    .reverse()
    .slice(0, 80)
    .map((event) => ({
      id: event.id,
      sequence: event.sequence,
      label: eventLabel(event.type),
      occurredAtLabel: `${new Date(event.occurredAt).toLocaleString("zh-CN")}${event.barTimestamp ? ` · K线 ${formatDate(event.barTimestamp, reviewedSession?.session.timeframe ?? timeframe)}` : ""}`,
    })), [reviewState.events, reviewedSession, timeframe]);
  const reviewPanelSummary = {
    heroLabel: reviewState.tradingMode === "capital" ? "本次已实现盈亏" : "本次已实现收益率",
    heroValue: reviewState.tradingMode === "capital" ? money(reviewRealizedPnl) : percent(reviewRealizedReturnPct),
    heroTone: reviewHeroTone,
    heroMeta: `${reviewClosedPositions.length} 笔已平仓 · ${reviewState.executions.length} 笔成交 · 分红收入 ${money(reviewDividendIncome)} · 最近计划完整度 ${reviewPlanScore}%`,
    tradeWinRate: reviewTradeWinRate,
    tradeMeta: `${reviewWinningTrades} 胜 / ${reviewLosingTrades} 负 / ${reviewFlatTrades} 平 · 平局不计入胜率分母`,
    submittedPlans: reviewState.decisionSubmissions.length,
    resultValue: reviewState.tradingMode === "capital" ? money(reviewTotalResult) : percent(reviewTotalResult),
    resultTone: reviewResultTone,
    resultMeta: `${reviewTotalResult > 0 ? "本场计为训练胜" : reviewTotalResult < 0 ? "本场计为训练负" : "本场计为训练平"} · ${reviewState.executions.length} 笔成交`,
  };

  const mistakeSources = useMemo<MistakeSource[]>(() => {
    if (!showTaskSetup || (taskDraft.mode as string) !== "mistake") return [];
    return sessionSummaries.flatMap(({ session, state }) => {
    try {
      const weakPlans = state.decisionSubmissions.filter((submission) => decisionScore(submission.decision) < 80);
      const count = weakPlans.length + state.orderRejections.length;
      if (!count) return [];
      const targetCursor = weakPlans.at(-1)?.cursor ?? state.cursor;
      return [{
        session,
        state,
        count,
        targetCursor,
        label: `${session.instrumentId} · ${timeframeLabel(session.timeframe)} · ${count} 个错题点 · ${new Date(session.updatedAt).toLocaleDateString("zh-CN")}`,
      }];
    } catch {
      return [];
    }
    });
  }, [sessionSummaries, showTaskSetup, taskDraft.mode]);

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

  const saveSettings = async () => {
    const previousSettings = appSettingsRef.current;
    setSettingsError("");
    const result = await persistSettingsSave(settingsDraft, {
      write: (nextSettings) => {
        appSettingsRef.current = nextSettings;
        return preferencesGateway.save(buildSyncedPreferences(nextSettings));
      },
    });
    if (!result.ok) {
      appSettingsRef.current = previousSettings;
      setSettingsError(result.error);
      return;
    }
    const nextSettings = result.settings;
    settingsGateway.saveAppSettings(nextSettings);
    settingsGateway.removeLegacyCustomPatternPresets();
    settingsGateway.removeLegacyReasonTagPreferences();
    appSettingsRef.current = nextSettings;
    setAppSettings(nextSettings);
    setSettingsDraft(nextSettings);
    setSpeed(nextSettings.defaultSpeed);
    setOrderQty(configuredDefaultOrderQuantity(nextSettings, instrument.market, instrument.id, marketRules));
    setShowSettings(false);
  };

  const openPatternFiltersPanel = () => {
    const drafts = patternPresets.map(clonePatternPresetValue);
    const available = visiblePatternPresets(drafts);
    setPatternPresetDrafts(drafts);
    setSelectedPatternPresetId((selected) => available.some((preset) => preset.id === selected) ? selected : available[0]?.id ?? "");
    setPatternConditionPickerOpen(false);
    setPatternConditionSearch("");
    setPatternConditionGroup("全部");
    setPatternEditorError("");
    setPatternDiscardPromptOpen(false);
    setShowPatternFilters(true);
  };

  const finishClosePatternFilters = useCallback(() => {
    setShowPatternFilters(false);
    setPatternConditionPickerOpen(false);
    setPatternConditionSearch("");
    setPatternConditionGroup("全部");
    setPatternEditorError("");
    setPatternDiscardPromptOpen(false);
  }, []);

  const requestClosePatternFilters = useCallback(() => {
    if (patternPresetDraftsDirty) {
      setPatternDiscardPromptOpen(true);
      window.requestAnimationFrame(() => patternFilterModalRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
      return;
    }
    finishClosePatternFilters();
  }, [finishClosePatternFilters, patternPresetDraftsDirty]);

  const discardPatternFilterDrafts = useCallback(() => {
    patternPresetRestoreRequestedRef.current = false;
    setPatternPresetDrafts(patternPresets.map(clonePatternPresetValue));
    finishClosePatternFilters();
  }, [finishClosePatternFilters, patternPresets]);

  const selectPatternPreset = (presetId: string) => {
    setSelectedPatternPresetId(presetId);
    setPatternConditionPickerOpen(false);
    setPatternConditionSearch("");
    setPatternEditorError("");
  };

  useEffect(() => {
    if (!showPatternFilters) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (patternConditionPickerOpen) {
        setPatternConditionPickerOpen(false);
        return;
      }
      requestClosePatternFilters();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [patternConditionPickerOpen, patternPresetDraftsDirty, requestClosePatternFilters, showPatternFilters]);

  const savePatternFilters = () => {
    const invalidPreset = patternPresetDrafts.find((preset) => (
      isPatternPresetAvailable(preset) && preset.kind === "custom" && !(preset.conditions?.length)
    ));
    if (invalidPreset) {
      setSelectedPatternPresetId(invalidPreset.id);
      setPatternEditorError("自定义形态至少需要添加一条筛选条件。请先添加条件，或删除这个空预设。");
      return;
    }
    const nextPresets = normalizePatternPresets(patternPresetDrafts);
    const available = visiblePatternPresets(nextPresets);
    const restorePatternPresetDefaults = patternPresetRestoreRequestedRef.current;
    const nextHiddenPatternPresetIds = hiddenBuiltInPatternPresetIds(nextPresets);
    const saveRevision = patternPresetSaveRevisionRef.current + 1;
    patternPresetSaveRevisionRef.current = saveRevision;
    patternPresetsDirtyRef.current = true;
    if (nextHiddenPatternPresetIds.length) {
      settingsGateway.saveHiddenPatternPresetIds(nextHiddenPatternPresetIds);
    }
    setPatternPresets(nextPresets);
    setPatternPresetDrafts(nextPresets.map(clonePatternPresetValue));
    setSelectedPatternPresetId((selected) => available.some((preset) => preset.id === selected) ? selected : available[0]?.id ?? "");
    if (quickRandomPatternPresetId && !available.some((preset) => preset.id === quickRandomPatternPresetId)) {
      settingsGateway.saveQuickRandomPattern("");
      setQuickRandomPatternPresetId("");
    }
    setRandomTrainingPatternPresetIds((selectedIds) => (
      selectedIds.filter((id) => available.some((preset) => preset.id === id))
    ));
    setLiveScanPresetIds((selectedIds) => selectedIds.filter((id) => available.some((preset) => preset.id === id)));
    setPatternEditorError("");
    setPatternDiscardPromptOpen(false);
    setShowPatternFilters(false);
    if (syncedPreferencesReady && syncedPreferencesHydratedRef.current) {
      const preferences = buildSyncedPreferences(
        appSettingsRef.current,
        nextPresets,
        { allowPatternPresetRestore: restorePatternPresetDefaults },
      );
      void preferencesGateway.save(preferences)
        .then(() => {
          if (patternPresetSaveRevisionRef.current === saveRevision) {
            patternPresetsDirtyRef.current = false;
            settingsGateway.saveHiddenPatternPresetIds(hiddenBuiltInPatternPresetIds(preferences.patternPresets));
            if (restorePatternPresetDefaults) patternPresetRestoreRequestedRef.current = false;
          }
          settingsGateway.removeLegacyCustomPatternPresets();
          settingsGateway.removeLegacyReasonTagPreferences();
        })
        .catch(() => {
          setSaveState("形态预设已更新，但同步保存失败，将自动重试");
        });
    }
  };

  const updatePatternPresetDraft = (id: string, update: (preset: PatternPreset) => PatternPreset) => {
    setPatternPresetDrafts((presets) => presets.map((preset) => preset.id === id ? update(preset) : preset));
    setPatternEditorError("");
  };

  const createCustomPatternPreset = () => {
    const copy: PatternPreset = {
      id: `custom-${createUuid()}`,
      kind: "custom",
      name: "自定义形态",
      description: "用多条简短条件组合而成的形态。",
      builtIn: false,
      parameters: {},
      conditions: [],
    };
    setPatternPresetDrafts((presets) => [...presets, copy]);
    setSelectedPatternPresetId(copy.id);
    setPatternConditionPickerOpen(false);
    setPatternEditorError("");
  };

  const addPatternCondition = (kind: PatternConditionKind) => {
    const source = patternPresetDrafts.find((preset) => preset.id === selectedPatternPresetId);
    if (!source || source.kind !== "custom") return;
    const condition = createDefaultPatternCondition(kind, `condition-${createUuid()}`);
    updatePatternPresetDraft(source.id, (preset) => ({
      ...preset,
      conditions: [...(preset.conditions ?? []), condition],
    }));
    setPatternConditionPickerOpen(false);
    setPatternConditionSearch("");
  };

  const updatePatternCondition = (
    presetId: string,
    conditionId: string,
    update: (condition: PatternCondition) => PatternCondition,
  ) => {
    updatePatternPresetDraft(presetId, (preset) => ({
      ...preset,
      conditions: (preset.conditions ?? []).map((condition) => condition.id === conditionId ? update(condition) : condition),
    }));
  };

  const removePatternCondition = (presetId: string, conditionId: string) => {
    updatePatternPresetDraft(presetId, (preset) => ({
      ...preset,
      conditions: (preset.conditions ?? []).filter((condition) => condition.id !== conditionId),
    }));
  };

  const clonePatternPreset = () => {
    const source = patternPresetDrafts.find((preset) => preset.id === selectedPatternPresetId);
    if (!source) return;
    const copy: PatternPreset = {
      ...clonePatternPresetValue(source),
      id: `custom-${createUuid()}`,
      name: `${source.name}（自定义）`,
      builtIn: false,
      enabled: true,
    };
    setPatternPresetDrafts((presets) => [...presets, copy]);
    setSelectedPatternPresetId(copy.id);
    setPatternEditorError("");
  };

  const removeSelectedPatternPreset = () => {
    const source = patternPresetDrafts.find((preset) => preset.id === selectedPatternPresetId);
    if (!source) return;
    const nextDrafts = source.builtIn
      ? patternPresetDrafts.map((preset) => preset.id === source.id ? { ...preset, enabled: false } : preset)
      : patternPresetDrafts.filter((preset) => preset.id !== source.id);
    const nextAvailable = visiblePatternPresets(nextDrafts);
    setPatternPresetDrafts(nextDrafts);
    setSelectedPatternPresetId(nextAvailable[0]?.id ?? "");
    setPatternConditionPickerOpen(false);
    setPatternEditorError("");
  };

  const resetPatternPresets = () => {
    const nextPresets = normalizePatternPresets(defaultPatternPresets);
    patternPresetRestoreRequestedRef.current = true;
    setPatternPresetDrafts(nextPresets.map(clonePatternPresetValue));
    setSelectedPatternPresetId(nextPresets[0]?.id ?? "");
    setPatternConditionPickerOpen(false);
    setPatternConditionSearch("");
    setPatternConditionGroup("全部");
    setPatternEditorError("");
  };

  const openTaskSetup = () => {
    setTaskSetupKind("configured");
    const nextInstrumentId = availableInstruments.some((item) => item.id === appSettings.defaultInstrumentId)
      ? appSettings.defaultInstrumentId
      : availableInstruments[0]?.id ?? appSettings.defaultInstrumentId;
    const nextAvailableTimeframes = availableTimeframesForInstrument(
      availableInstruments,
      nextInstrumentId,
      TIMEFRAME_IDS,
    );
    setSetupInstrumentId(nextInstrumentId);
    setSetupTimeframe(resolveAvailableTimeframe(nextAvailableTimeframes, appSettings.defaultTimeframe));
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
        ? allowedInstruments.filter((item) => marketRuleCode(item.market) === marketRuleCode(config.market))
        : allowedInstruments;
    const requestedTimeframes = config.timeframeMode === "current"
      ? [config.anchorTimeframe]
      : config.timeframeMode === "fixed"
        ? [config.fixedTimeframe]
        : [...TIMEFRAME_IDS];
    const createPairs = (instruments: AvailableInstrument[], allowedTimeframes?: string[]) => instruments.flatMap((item) =>
      item.timeframes
        .filter((candidateTimeframe) => !allowedTimeframes || allowedTimeframes.includes(candidateTimeframe))
        .map((candidateTimeframe) => ({ instrument: item, timeframe: candidateTimeframe })));
    if (config.instrumentMode === "market") {
      const marketPairs = createPairs(instrumentCandidates, requestedTimeframes);
      const marketFallback = marketPairs.length ? marketPairs : createPairs(instrumentCandidates);
      return [...marketFallback].sort(() => randomUint32() / 0x1_0000_0000 - 0.5);
    }
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
    const data = await marketDataGateway.loadCandles<{ instrument?: Instrument; candles?: KLineData[] }>(requestInstrumentId, requestTimeframe);
    return {
      candles: (data.candles ?? []) as PatternCandle[],
      timezone: data.instrument?.timezone ?? "Asia/Shanghai",
    };
  }, [bars, instrument.timezone, instrumentId, marketDataGateway, timeframe]);

  const createRandomWindowSnapshot = useCallback(async (
    requestInstrumentId: string,
    requestTimeframe: string,
    draft: TrainingTaskDraft,
    randomConfig: RandomTrainingConfig,
    selectedPresets: PatternPreset[] = [],
    requestMarket?: string,
  ) => {
    const data = await marketDataGateway.createSnapshot<{
      snapshot?: SnapshotMeta;
      selection?: { startCursor?: number; endCursor?: number };
      patternMatch?: {
        timestamp?: number;
        presetIds?: string[];
        presetNames?: string[];
        attempts?: number;
      };
    }>({
        instrumentId: requestInstrumentId,
        timeframe: requestTimeframe,
        adjustmentType: defaultAdjustmentTypeForInstrument(requestInstrumentId, requestMarket),
        randomWindow: {
          length: draft.length > 0 ? draft.length : randomConfig.length,
          historyBars: appSettingsRef.current.replayHistoryBars,
          startDate: randomConfig.dateMode === "range" ? randomConfig.startDate : undefined,
          endDate: randomConfig.dateMode === "range" ? randomConfig.endDate : undefined,
          patternPresets: selectedPresets.length ? selectedPresets : undefined,
          patternAttempts: selectedPresets.length ? appSettingsRef.current.patternScanAttempts : undefined,
        },
      });
    const startCursor = Number(data.selection?.startCursor);
    if (!data.snapshot?.id || !Number.isInteger(startCursor) || startCursor < 0) return null;
    return { snapshotId: data.snapshot.id, startCursor, patternMatch: data.patternMatch };
  }, [marketDataGateway]);

  const findCandidatePatternMatch = useCallback(async (
    requestInstrumentId: string,
    requestTimeframe: string,
    requestMarket: string,
    draft: TrainingTaskDraft,
    applyRandomDateRange: boolean,
    randomConfig: RandomTrainingConfig = currentRandomConfig(),
  ): Promise<PatternMatch | null> => {
    const selectedPresets = visiblePatternPresets(patternPresets).filter((preset) => draft.patternPresetIds?.includes(preset.id));
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
    const targetMarket = availableInstruments.find((item) => item.id === requestInstrumentId)?.market
      ?? (/\.FX$/i.test(requestInstrumentId) ? "FX" : undefined);
    setLoading(true);
    setChartLoadError("");
    setTrainingReady(false);
    setPlaying(false);
    latestWatchRequestRef.current = null;
    setLatestWatchMode(false);
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
    setOrderQty(configuredDefaultOrderQuantityForRequest(appSettingsRef.current, targetMarket, requestInstrumentId));
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
        const requiresClientLiquidityScan = isUsMarket(pair.instrument.market)
          && randomConfig.usLiquidityFilter !== false;
        if (!requiresClientLiquidityScan) {
          const windowSnapshot = await createRandomWindowSnapshot(
            pair.instrument.id,
            pair.timeframe,
            draft,
            randomConfig,
            [],
            pair.instrument.market,
          );
          if (!windowSnapshot) continue;
          return {
            instrumentId: pair.instrument.id,
            timeframe: pair.timeframe,
            snapshotId: windowSnapshot.snapshotId,
            draft: {
              ...draft,
              startMode: "bar" as const,
              startBar: windowSnapshot.startCursor + 1,
              length: requestedLength,
              randomRun: true,
              randomConfig,
            },
          };
        }
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
  }, [appSettings.patternScanAttempts, createRandomWindowSnapshot, currentRandomConfig, loadPatternCandles, randomCandidatePairs]);

  const resolvePatternRandomRequest = useCallback(async (
    draft: TrainingTaskDraft,
    randomConfig: RandomTrainingConfig = currentRandomConfig(),
  ) => {
    const pairs = randomCandidatePairs(randomConfig);
    const attemptLimit = Math.min(pairs.length, appSettings.patternScanAttempts);
    const selectedPresets = visiblePatternPresets(patternPresets).filter((preset) => draft.patternPresetIds?.includes(preset.id));
    for (let index = 0; index < attemptLimit; index += 1) {
      const pair = pairs[index];
      setPatternScanStatus(`正在检查候选 ${index + 1}/${attemptLimit}：${pair.instrument.short} · ${timeframeLabel(pair.timeframe)}`);
      try {
        const requiresClientLiquidityScan = isUsMarket(pair.instrument.market)
          && randomConfig.usLiquidityFilter !== false;
        if (!requiresClientLiquidityScan) {
          const windowSnapshot = await createRandomWindowSnapshot(
            pair.instrument.id,
            pair.timeframe,
            draft,
            randomConfig,
            selectedPresets,
            pair.instrument.market,
          );
          const match = windowSnapshot?.patternMatch;
          if (!windowSnapshot || !Number.isFinite(match?.timestamp) || !match?.presetIds?.length) continue;
          return {
            instrumentId: pair.instrument.id,
            timeframe: pair.timeframe,
            snapshotId: windowSnapshot.snapshotId,
            draft: {
              ...draft,
              startMode: "bar" as const,
              startBar: windowSnapshot.startCursor + 1,
              length: draft.length > 0 ? draft.length : randomConfig.length,
              randomRun: true,
              randomConfig,
              patternPresetNames: selectedPresets.map((preset) => preset.name),
              patternMatchedPresetIds: match.presetIds,
              patternMatchTimestamp: match.timestamp,
            },
          };
        }
        const match = await findCandidatePatternMatch(pair.instrument.id, pair.timeframe, pair.instrument.market, draft, true, randomConfig);
        if (!match) continue;
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
  }, [appSettings.patternScanAttempts, createRandomWindowSnapshot, currentRandomConfig, findCandidatePatternMatch, patternPresets, randomCandidatePairs]);

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
      : (draft.patternPresetIds ?? []).filter((id) => visiblePatternPresets(patternPresets).some((preset) => preset.id === id));
    draft = { ...draft, patternPresetIds: selectedPatternIds };
    const randomConfig = taskSetupKind === "random" ? currentRandomConfig() : undefined;
    preemptStartupRandom();
    setStartingTraining(true);
    setPatternScanStatus("");
    setSetupError("");
    try {
      if (selectedPatternIds.length && taskSetupKind === "random") {
        const request = await resolvePatternRandomRequest(draft, randomConfig);
        if (!request) {
          setSetupError("服务端已完成有界候选窗口扫描，但没有找到符合条件的历史位置，并非仍在加载。5m 等短周期可降低趋势升幅阈值、减少同时启用的形态，或先取消形态筛选。");
          return;
        }
        requestInstrumentId = request.instrumentId;
        requestTimeframe = request.timeframe;
        requestSnapshotId = request.snapshotId;
        draft = request.draft;
      } else if (selectedPatternIds.length) {
        setPatternScanStatus(`正在扫描 ${requestInstrumentId} · ${requestTimeframe} 的历史形态…`);
        const requestMarket = availableInstruments.find((item) => item.id === requestInstrumentId)?.market ?? instrument.market;
        const match = await findCandidatePatternMatch(requestInstrumentId, requestTimeframe, requestMarket, draft, false);
        if (!match) {
          setSetupError("当前品种和周期没有找到符合所选形态的可训练历史位置。请调整形态或参数。");
          return;
        }
        const selectedPresets = visiblePatternPresets(patternPresets).filter((preset) => selectedPatternIds.includes(preset.id));
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
        requestSnapshotId = request.snapshotId;
        draft = request.draft;
      }
      launchTraining(requestInstrumentId, requestTimeframe, draft, requestSnapshotId);
    } finally {
      setStartingTraining(false);
      setPatternScanStatus("");
    }
  };

  const updateQuickRandomPattern = (presetId: string) => {
    const nextPresetId = availablePatternPresets.some((preset) => preset.id === presetId) ? presetId : "";
    setQuickRandomPatternPresetId(nextPresetId);
    setQuickRandomError("");
    settingsGateway.saveQuickRandomPattern(nextPresetId);
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
    preemptStartupRandom();
    const blind = quickRandomMode === "blind";
    const randomConfig = currentRandomConfig();
    const selectedPatternIds = availablePatternPresets.some((preset) => preset.id === quickRandomPatternPresetId)
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
          ? `服务端已完成有界扫描，但没有找到“${patternPresets.find((preset) => preset.id === quickRandomPatternPresetId)?.name ?? "所选形态"}”。5m 等短周期可降低趋势升幅阈值，或换一个形态。`
          : "没有找到满足历史范围和流动性门槛的训练片段，请调整随机训练规则。");
        setMobileToolbarOpen(true);
        return;
      }
      setMobileToolbarOpen(false);
      launchTraining(
        request.instrumentId,
        request.timeframe,
        request.draft,
        "snapshotId" in request ? request.snapshotId : undefined,
      );
    } finally {
      setStartingTraining(false);
      setPatternScanStatus("");
    }
  };

  const continueRandomTraining = async () => {
    const completedTask = trainingTask;
    if (!completedTask?.randomRun) return;
    preemptStartupRandom();
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
    launchTraining(
      request.instrumentId,
      request.timeframe,
      request.draft,
      "snapshotId" in request ? request.snapshotId : undefined,
    );
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (view === "database") loadCoverage();
      if (view === "review" || view === "performance") loadSessions(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      sessionSummaryLoadRef.current.controller?.abort();
    };
  }, [loadCoverage, loadSessions, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInstrumentCatalog();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadInstrumentCatalog]);

  useEffect(() => {
    if (
      !settingsReady
      || !instrumentCatalogReady
      || startupRandomStartedRef.current
      || startupRandomCancelledRef.current
    ) return;
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
        if (cancelled || startupRandomCancelledRef.current) return;
        if (!request) {
          setChartLoadError("没有找到满足随机规则的训练片段，请在设置中调整市场范围或美股流动性门槛。");
          setStartupReady(true);
          return;
        }
        newTaskRequestRef.current = {
          instrumentId: request.instrumentId,
          timeframe: request.timeframe,
          draft: request.draft,
          snapshotId: request.snapshotId,
        };
        restoreRequestRef.current = null;
        setInstrumentId(request.instrumentId);
        setTimeframe(request.timeframe);
        setLoading(true);
        setChartLoadError("");
        setStartupReady(true);
        setLoadNonce((value) => value + 1);
      })
      .catch(() => {
        if (cancelled || startupRandomCancelledRef.current) return;
        setChartLoadError("训练行情准备失败，请重试随机训练。");
        setStartupReady(true);
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
        const result = await marketDataGateway.importCandles<{ imported?: number; error?: string }>({
          instrument: { id: customId, symbol: customId, name: file.name, market: dataMarket, timezone },
          timeframe: importTimeframe,
          adjustmentType: defaultAdjustmentTypeForMarket(dataMarket),
          bars: barsToImport.slice(offset, offset + 4000),
        });
        imported += Number(result.imported ?? 0);
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

  const currentSettingsMarket = selectedCatalogInstrument?.market ?? instrument.market;
  const settingsRandomIncludesCn = randomScopeIncludesMarket(
    settingsDraft.randomInstrumentMode,
    settingsDraft.randomMarket,
    currentSettingsMarket,
    "CN",
  );
  const settingsRandomIncludesUs = randomScopeIncludesMarket(
    settingsDraft.randomInstrumentMode,
    settingsDraft.randomMarket,
    currentSettingsMarket,
    "US",
  );
  const activeRandomIncludesCn = randomScopeIncludesMarket(
    appSettings.randomInstrumentMode,
    appSettings.randomMarket,
    currentSettingsMarket,
    "CN",
  );
  const activeRandomIncludesUs = randomScopeIncludesMarket(
    appSettings.randomInstrumentMode,
    appSettings.randomMarket,
    currentSettingsMarket,
    "US",
  );

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
        {view === "replay" && (
          <header className="topbar">
          <div className="instrument-selectors">
            {hideTaskInstrument ? (
              <span className="blind-pill">品种已隐藏</span>
            ) : (
              <>
                <InstrumentPicker
                  value={instrumentId}
                  instruments={availableInstruments}
                  ariaLabel="选择品种"
                  onChange={openInstrumentWatch}
                />
                <span className="market-pill">{currentAssetLabel}</span>
              </>
            )}
            <span className="rule-pill">{liveMode || latestWatchMode ? "仅看盘" : trainingTask ? trainingModeLabels[trainingTask.mode] : "自由训练"}</span>
            <span className="rule-pill">{tradingMode === "capital" ? "资金账户" : "收益率"}</span>
            {trashPreview && <span className="rule-pill read-only">{duplicateTrainingPreview ? "重复训练预览 · 未恢复" : "回收站查看 · 未恢复"}</span>}
            {!marketRules.tradingEnabled && <span className="rule-pill read-only">只看盘</span>}
            {trainingTask?.patternFilter && (
              <span className="rule-pill" title={`命中：${trainingTask.patternFilter.matchedPresetIds.join("、")}`}>
                形态 · {trainingTask.patternFilter.presetNames.join(" / ")}
              </span>
            )}
            <div className="timeframes" aria-label="周期">
              {TIMEFRAME_IDS.map((item) => {
                const available = currentAvailableTimeframes.includes(item);
                return (
                  <button
                    key={item}
                    className={`${chartTimeframe === item ? "active" : ""}${available ? "" : " unavailable"}`}
                    disabled={chartViewLoading || !available}
                    onClick={() => handleTimeframeChange(item)}
                  >{timeframeLabel(item)}</button>
                );
              })}
            </div>
            {chartViewLoading && <span className="chart-view-status">正在切换观察周期…</span>}
            {chartViewError && <span className="chart-view-status error" role="alert">{chartViewError}</span>}
            {chartViewSnapshotId && !chartViewLoading && !chartViewError && <span className="chart-view-status">观察数据已缓存</span>}
            {!showingCanonicalChart && <span className="chart-view-status">训练基准 {timeframeLabel(timeframe)} · 仅观察</span>}
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
              setWatchlistSource("scan");
              setShowLiveScan(true);
            }}><Activity size={16} />实盘筛选</button>
            <button className="ghost-button" onClick={openRandomTraining}><Shuffle size={16} />随机训练</button>
            <button className="ghost-button" onClick={openTaskSetup}><Play size={16} />新建 Replay 训练</button>
            <button className="primary-button" disabled={trashPreview} onClick={saveSession}><Save size={16} />保存训练</button>
          </div>
          <div className="mobile-quick-actions" aria-label="训练快捷操作">
            <button type="button" aria-label="实盘筛选" title="实盘筛选" onClick={() => {
              setLiveScanError("");
              setWatchlistSource("scan");
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
          {view === "replay" && (
            <button
              type="button"
              className="mobile-watchlist-toggle"
              aria-label={watchlistCollapsed ? "展开自选列表" : "收起自选列表"}
              title={watchlistCollapsed ? "展开自选列表" : "收起自选列表"}
              aria-expanded={!watchlistCollapsed}
              onClick={() => setWatchlistCollapsed((collapsed) => !collapsed)}
            ><List size={15} /></button>
          )}
          <button
            className="mobile-toolbar-toggle"
            type="button"
            aria-label="周期与训练工具"
            aria-expanded={mobileToolbarOpen}
            aria-controls="mobile-training-toolbar"
            onClick={() => setMobileToolbarOpen((value) => !value)}
          >
            <span>{timeframeLabel(chartTimeframe)}</span><ChevronDown size={15} />
          </button>
          {mobileToolbarOpen && (
            <div className="mobile-toolbar-popover" id="mobile-training-toolbar">
              <div className="mobile-toolbar-meta">
                <span>{trainingTask ? trainingModeLabels[trainingTask.mode] : "自由训练"}</span>
                <span>{tradingMode === "capital" ? "资金账户" : "收益率"}</span>
              </div>
              <div className="mobile-timeframes" aria-label="手机端周期">
                {TIMEFRAME_IDS.map((item) => {
                  const available = currentAvailableTimeframes.includes(item);
                  return (
                    <button
                      key={item}
                      className={`${chartTimeframe === item ? "active" : ""}${available ? "" : " unavailable"}`}
                      disabled={chartViewLoading || !available}
                      onClick={() => {
                        setMobileToolbarOpen(false);
                        handleTimeframeChange(item);
                      }}
                    >{timeframeLabel(item)}</button>
                  );
                })}
              </div>
              {!showingCanonicalChart && <span className="mobile-chart-view-note">训练基准 {timeframeLabel(timeframe)} · 仅观察</span>}
              {chartViewLoading && <div className="mobile-random-status"><Activity size={12} />正在切换观察周期…</div>}
              {chartViewError && <div className="mobile-random-error" role="alert">{chartViewError}</div>}
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
                  {availablePatternPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                <small>会记住本机选择，一键随机时自动寻找该形态。</small>
              </label>
              {startingTraining && patternScanStatus && <div className="mobile-random-status"><Activity size={12} />{patternScanStatus}</div>}
              {quickRandomError && <div className="mobile-random-error">{quickRandomError}</div>}
            </div>
          )}
          </header>
        )}

        {showSettings && (
          <SettingsPanel
            draft={settingsDraft}
            tab={settingsTab}
            availableInstruments={availableInstruments}
            settingsRandomIncludesCn={settingsRandomIncludesCn}
            settingsRandomIncludesUs={settingsRandomIncludesUs}
            dataPanel={<ProviderSettingsPanel />}
            error={settingsError}
            onDraftChange={(update) => setSettingsDraft(update)}
            onTabChange={setSettingsTab}
            onClose={() => setShowSettings(false)}
            onOpenTrash={openTrash}
            onSave={saveSettings}
          />
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
                      : "自由训练";
                    const totalResult = stats && state?.tradingMode === "capital" ? stats.pnl.total : stats?.returnPct ?? 0;
                    const realizedResult = stats && state?.tradingMode === "capital" ? stats.pnl.realized : stats?.realizedReturnPct ?? 0;
                    const floatingResult = stats && state?.tradingMode === "capital" ? stats.pnl.floating : stats?.floatingReturnPct ?? 0;
                    return (
                      <div className="trash-session-row" key={session.id}>
                        <div className="trash-session-main">
                          <div className="session-title">
                            <strong>{session.instrumentId} · {timeframeLabel(session.timeframe)}</strong>
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
            if (event.target === event.currentTarget) requestClosePatternFilters();
          }}>
            <section className="task-modal pattern-filter-modal" role="dialog" aria-modal="true" aria-labelledby="pattern-filter-title" ref={patternFilterModalRef}>
              <div className="task-modal-head">
                <div>
                  <span>PATTERN FILTERS</span>
                  <h2 id="pattern-filter-title">形态筛选</h2>
                  <p>管理历史 K 线的布尔筛选预设；预设内部条件全部满足才算命中。</p>
                </div>
                <button aria-label="关闭形态筛选" onClick={requestClosePatternFilters}><X size={19} /></button>
              </div>

              {patternDiscardPromptOpen && (
                <div className="pattern-discard-banner" role="alert">
                  <div>
                    <strong>有未保存修改</strong>
                    <span>关闭后这些形态编辑不会保留。</span>
                  </div>
                  <div>
                    <button type="button" className="ghost-button" onClick={() => setPatternDiscardPromptOpen(false)}>继续编辑</button>
                    <button type="button" className="danger-button" onClick={discardPatternFilterDrafts}>放弃更改</button>
                  </div>
                </div>
              )}

              <div className="pattern-filter-layout">
                <aside className="pattern-preset-list" aria-label="形态预设" ref={patternPresetListRef}>
                  <div className="pattern-preset-list-head">
                    <span>形态预设</span>
                    <button type="button" onClick={createCustomPatternPreset}><Plus size={13} />新建</button>
                  </div>
                  {availablePatternPresetDrafts.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      className={`pattern-preset-card${selectedPatternPresetDraft?.id === preset.id ? " active" : ""}`}
                      data-pattern-preset-id={preset.id}
                      onClick={() => selectPatternPreset(preset.id)}
                    >
                      <strong>{preset.name}</strong>
                      <span>{preset.builtIn ? "内置" : "自定义"}</span>
                    </button>
                  ))}
                  {!availablePatternPresetDrafts.length && <div className="pattern-preset-empty">暂无可用形态，请新建一个自定义形态。</div>}
                  {patternPresetDrafts.some((preset) => preset.builtIn && !isPatternPresetAvailable(preset)) && (
                    <small className="pattern-preset-hidden-note">已隐藏的内置形态可通过底部“恢复内置默认值”找回。</small>
                  )}
                </aside>

                {selectedPatternPresetDraft && (
                  <div className="pattern-preset-editor">
                    <div className="pattern-editor-head">
                      <div>
                        <small>{selectedPatternPresetDraft.builtIn ? "内置形态" : "自定义形态"}</small>
                        <strong>{selectedPatternPresetDraft.name}</strong>
                        {selectedPatternPresetDraft.builtIn && <span>{selectedPatternPresetDraft.description}</span>}
                      </div>
                      <div className="pattern-editor-head-actions">
                        <button className="ghost-button" onClick={clonePatternPreset}>复制为自定义</button>
                      </div>
                    </div>

                    {selectedPatternPresetDraft.kind === "custom" && <>
                      <label>预设名称
                        <input
                          value={selectedPatternPresetDraft.name}
                          onChange={(event) => updatePatternPresetDraft(selectedPatternPresetDraft.id, (preset) => ({ ...preset, name: event.target.value }))}
                        />
                      </label>
                      <label>说明
                        <textarea
                          value={selectedPatternPresetDraft.description}
                          onChange={(event) => updatePatternPresetDraft(selectedPatternPresetDraft.id, (preset) => ({ ...preset, description: event.target.value }))}
                        />
                      </label>
                    </>}

                    {selectedPatternPresetDraft.kind === "custom" ? (
                      <div className="pattern-condition-section">
                        <div className="pattern-condition-section-head">
                          <div>
                            <strong>筛选条件</strong>
                            <span>添加简短条件；同一形态内的条件全部满足才算命中。</span>
                          </div>
                          <button className="ghost-button" onClick={() => setPatternConditionPickerOpen(true)}><Plus size={14} />添加条件</button>
                        </div>
                        <div className="pattern-condition-list">
                          {(selectedPatternPresetDraft.conditions ?? []).map((condition) => {
                            const definition = patternConditionDefinitions.find((item) => item.kind === condition.kind);
                            if (!definition) return null;
                            return (
                              <div className="pattern-condition-row" key={condition.id}>
                                <div className="pattern-condition-row-head">
                                  <div>
                                    <strong>{definition.label}</strong>
                                    <span>{definition.description}</span>
                                  </div>
                                  <button type="button" aria-label={`删除${definition.label}条件`} onClick={() => removePatternCondition(selectedPatternPresetDraft.id, condition.id)}><X size={15} /></button>
                                </div>
                                <div className="pattern-condition-fields">
                                  {definition.fields.map((field) => (
                                    <label key={field.key}>{field.label}
                                      {field.type === "select" ? (
                                        <select
                                          value={String(condition.parameters[field.key] ?? field.defaultValue)}
                                          onChange={(event) => updatePatternCondition(selectedPatternPresetDraft.id, condition.id, (current) => ({
                                            ...current,
                                            parameters: { ...current.parameters, [field.key]: event.target.value },
                                          }))}
                                        >
                                          {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                      ) : (
                                        <span className="pattern-number-input">
                                          <input
                                            type="number"
                                            min={field.min}
                                            max={field.max}
                                            step={field.step}
                                            value={Number(condition.parameters[field.key] ?? field.defaultValue)}
                                            onChange={(event) => updatePatternCondition(selectedPatternPresetDraft.id, condition.id, (current) => ({
                                              ...current,
                                              parameters: { ...current.parameters, [field.key]: Number(event.target.value) },
                                            }))}
                                          />
                                          {field.suffix && <small>{field.suffix}</small>}
                                        </span>
                                      )}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {!(selectedPatternPresetDraft.conditions ?? []).length && (
                          <div className="pattern-condition-empty"><Plus size={16} />还没有条件，从“添加条件”开始。</div>
                        )}
                      </div>
                    ) : (
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
                    )}

                    {patternConditionPickerOpen && selectedPatternPresetDraft.kind === "custom" && (
                      <div className="pattern-condition-picker" ref={patternConditionPickerRef}>
                        <div className="pattern-condition-picker-head">
                          <div>
                            <strong>选择条件</strong>
                            <span>把一个短条件加入当前自定义形态。</span>
                          </div>
                          <button type="button" aria-label="关闭条件选择器" onClick={() => setPatternConditionPickerOpen(false)}><X size={16} /></button>
                        </div>
                        <label className="pattern-condition-search">
                          <Search size={15} />
                          <input
                            value={patternConditionSearch}
                            placeholder="搜索指标"
                            onChange={(event) => setPatternConditionSearch(event.target.value)}
                          />
                        </label>
                        <div className="pattern-condition-groups" role="tablist" aria-label="条件分类">
                          {[
                            "全部",
                            ...Array.from(new Set(patternConditionDefinitions.map((definition) => definition.group))),
                          ].map((group) => (
                            <button
                              type="button"
                              key={group}
                              className={patternConditionGroup === group ? "active" : ""}
                              onClick={() => setPatternConditionGroup(group)}
                            >
                              {group}
                            </button>
                          ))}
                        </div>
                        <div className="pattern-condition-catalog">
                          {filteredPatternConditionDefinitions.map((definition) => (
                            <button type="button" key={definition.kind} onClick={() => addPatternCondition(definition.kind)}>
                              <span>
                                <strong>{definition.label}</strong>
                                <small>{definition.description}</small>
                              </span>
                              <Plus size={16} />
                            </button>
                          ))}
                          {!filteredPatternConditionDefinitions.length && <div className="pattern-condition-empty">没有找到匹配条件。</div>}
                        </div>
                      </div>
                    )}

                    <div className="pattern-logic-note">
                      <ListChecks size={17} />
                      <span>{selectedPatternPresetDraft.kind === "custom" ? "本形态内的简短条件使用 AND；训练时勾选多个形态使用 OR。检测只读取命中 K 线及之前的数据，不读取未来。" : "本预设参数之间使用 AND；训练时勾选多个预设使用 OR。检测只读取命中 K 线及之前的数据，不读取未来。"}</span>
                    </div>

                    <button className="delete-pattern-preset" onClick={removeSelectedPatternPreset}>
                      {selectedPatternPresetDraft.builtIn ? <><EyeOff size={14} />隐藏这个内置形态</> : <><Trash2 size={14} />删除这个自定义预设</>}
                    </button>
                    {patternEditorError && <div className="pattern-editor-error" role="alert">{patternEditorError}</div>}
                  </div>
                )}
              </div>

              <div className="task-modal-actions pattern-modal-actions">
                <button className="ghost-button" onClick={resetPatternPresets}><RotateCcw size={15} />恢复内置默认值</button>
                <span />
                <button className="ghost-button" onClick={requestClosePatternFilters}>取消</button>
                <button className="primary-button" onClick={savePatternFilters}><Save size={16} />保存形态预设</button>
              </div>
            </section>
          </div>
        )}

        {showLiveScan && (
          <LiveScanPanel
            market={liveScanMarket}
            presets={availablePatternPresets}
            presetIds={liveScanPresetIds}
            minPrice={liveScanMinPrice}
            maxPrice={liveScanMaxPrice}
            minVolume={liveScanMinVolume}
            minChangePct={liveScanMinChangePct}
            maxChangePct={liveScanMaxChangePct}
            excludeLimitUp={liveScanExcludeLimitUp}
            sort={liveScanSort}
            limit={liveScanLimit}
            status={liveScanStatus}
            error={liveScanError}
            running={liveScanRunning}
            data={liveScanData}
            onClose={() => setShowLiveScan(false)}
            onMarketChange={(market) => {
              setLiveScanMarket(market);
              setLiveScanData(null);
              setLiveScanError("");
            }}
            onTogglePreset={(presetId) => setLiveScanPresetIds((ids) => ids.includes(presetId)
              ? ids.filter((id) => id !== presetId)
              : [...ids, presetId])}
            onClearPresets={() => setLiveScanPresetIds([])}
            onMinPriceChange={setLiveScanMinPrice}
            onMaxPriceChange={setLiveScanMaxPrice}
            onMinVolumeChange={setLiveScanMinVolume}
            onMinChangePctChange={setLiveScanMinChangePct}
            onMaxChangePctChange={setLiveScanMaxChangePct}
            onExcludeLimitUpChange={setLiveScanExcludeLimitUp}
            onSortChange={setLiveScanSort}
            onLimitChange={(limit) => setLiveScanLimit(normalizeLiveScanLimit(limit))}
            onStart={(skipUpdate) => void startLiveScan(skipUpdate)}
            onRestore={restoreLiveScan}
            onSelectResult={(index) => {
              const result = liveScanData?.results[index];
              if (result) openLiveScanResult(result, index);
            }}
          />
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
                  <p>训练内容发生实际修改后会自动保存；也可以随时手动保存。单纯浏览 K 线不会触发保存。</p>
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
                      onChange={(nextInstrumentId) => {
                        const nextAvailableTimeframes = availableTimeframesForInstrument(
                          availableInstruments,
                          nextInstrumentId,
                          timeframes,
                        );
                        setSetupInstrumentId(nextInstrumentId);
                        setSetupTimeframe((current) => resolveAvailableTimeframe(nextAvailableTimeframes, current));
                      }}
                    />
                  </label>
                  <label>周期
                    <select value={setupTimeframe} onChange={(event) => setSetupTimeframe(event.target.value)}>
                      {TIMEFRAME_IDS.map((item) => (
                        <option key={item} value={item} disabled={!setupAvailableTimeframes.includes(item)}>
                          {timeframeLabel(item)}
                        </option>
                      ))}
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
                      {activeRandomIncludesCn && <> · {appSettings.randomIncludeIndices ? "纳入指数（只看盘）" : "仅可交易品种"}</>}
                      {activeRandomIncludesUs && <> · {appSettings.randomUsLiquidityFilter ? `过滤低流动性美股（≥ ${appSettings.randomUsMinAverageDailyDollarVolume.toLocaleString("zh-CN")} 美元）` : "不过滤美股流动性"}</>}
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
                    {availablePatternPresets.map((preset) => {
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
                      ? "开始时由服务端分段抽样检查候选窗口，不再把整段历史载入浏览器；命中后从该 K 线开始。"
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
                  <small>填 0 时默认载入后续 5,000 根；为避免分钟级超大数据卡死，单个 Replay 最多载入后续 10,000 根。填入数量后，到达边界会按最后一根收盘价自动平仓、保存并进入完成状态。</small>
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
                <button className="primary-button" disabled={startingTraining || (taskDraft.mode === "mistake" && !mistakeSources.length)} onClick={() => void startConfiguredTraining()}><Play size={16} />{startingTraining ? "正在筛选…" : taskSetupKind === "random" ? "开始随机训练" : "开始训练"}</button>
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
          <div className={`replay-layout${watchlistCollapsed ? "" : " watchlist-open"}`}>
            {!watchlistCollapsed && (
              <aside className="watchlist-panel" aria-label="自选与最近浏览">
                <div className="watchlist-panel-head">
                  <div><span className="section-label">WATCHLIST</span><strong>自选</strong></div>
                  <button type="button" aria-label="收起自选列表" title="收起列表" onClick={() => setWatchlistCollapsed(true)}><ChevronLeft size={16} /></button>
                </div>
                <div className="watchlist-source-row">
                  <select
                    aria-label="选择看盘列表"
                    value={watchlistSource}
                    onChange={(event) => setWatchlistSource(event.target.value as WatchlistSource)}
                  >
                    <option value="watchlist">自选</option>
                    <option value="recent">最近浏览</option>
                    <option value="scan">最近一次实盘筛选</option>
                  </select>
                  <button type="button" className="watchlist-scan-button" onClick={() => {
                    setWatchlistSource("scan");
                    setLiveScanError("");
                    setShowLiveScan(true);
                  }}><Activity size={13} />筛选</button>
                </div>
                {watchlistSource === "scan" && liveScanData && (
                  <div className="watchlist-source-meta">
                    最近筛选 · {liveScanData.market === "CN" ? "A 股" : "美股"} · {new Date(liveScanData.latestTimestamp).toLocaleDateString("zh-CN")}
                  </div>
                )}
                <div className="watchlist-list" role="list" aria-live="polite">
                  {watchlistDisplayResults.length ? watchlistDisplayResults.map((result, index) => {
                    const watched = liveWatchlist.some((watch) => watch.instrumentId === result.instrumentId);
                    const selected = (liveMode && liveContext?.instrumentId === result.instrumentId)
                      || (latestWatchMode && instrument.id === result.instrumentId);
                    const resultMarket = performanceMarketCode(result.market, result.instrumentId);
                    const hasChange = Number.isFinite(result.changePct) && Number.isFinite(result.close) && result.close > 0;
                    return (
                      <button
                        type="button"
                        role="listitem"
                        className={`watchlist-row${selected ? " active" : ""}`}
                        key={`${watchlistSource}:${result.instrumentId}`}
                        onClick={() => {
                          rememberRecentLiveResult(result);
                          if (resultMarket === "CN" || resultMarket === "US") {
                            openLiveScanResult(result, index, watchlistSource === "watchlist" ? "watch" : "scan");
                          } else {
                            startFreshTraining(result.instrumentId, "1d", { latestWatch: true });
                          }
                        }}
                      >
                        <span className="watchlist-row-main"><strong>{result.symbol}</strong><small>{result.name} · {performanceMarketLabel(resultMarket)}</small></span>
                        <span className={hasChange ? (result.changePct >= 0 ? "up" : "down") : undefined}>{hasChange ? `${result.changePct >= 0 ? "+" : ""}${result.changePct.toFixed(2)}%` : "--"}</span>
                        {watched && <Star className="watchlist-row-star" size={13} fill="currentColor" aria-label="已加入自选" />}
                      </button>
                    );
                  }) : (
                    <div className="watchlist-empty">
                      {watchlistSource === "watchlist" ? "还没有自选品种。打开实盘筛选或数据列表后，可以加入自选。" : watchlistSource === "recent" ? "还没有最近浏览记录。点击筛选结果即可记录。" : "还没有实盘筛选结果。点击“筛选”开始。"}
                    </div>
                  )}
                </div>
              </aside>
            )}
            <section className="chart-stage">
              <div className="chart-heading">
                <div>
                  <button
                    type="button"
                    className="watchlist-toggle"
                    aria-label={watchlistCollapsed ? "展开自选列表" : "收起自选列表"}
                    title={watchlistCollapsed ? "展开自选列表" : "收起自选列表"}
                    aria-expanded={!watchlistCollapsed}
                    onClick={() => setWatchlistCollapsed((collapsed) => !collapsed)}
                  ><List size={16} /></button>
                  <strong>{hideTaskInstrument ? "BLIND" : instrument.symbol}</strong>
                  <span>{hideTaskInstrument
                    ? `品种已隐藏 · ${timeframeLabel(chartTimeframe)}${showingCanonicalChart ? "" : ` · 训练基准 ${timeframeLabel(timeframe)}`}`
                    : liveMode
                      ? `${instrument.name} · ${timeframeLabel(chartTimeframe)} · 最新行情`
                      : latestWatchMode
                        ? `${instrument.name} · ${timeframeLabel(chartTimeframe)} · 最新行情 · 仅看盘`
                      : `${instrument.name} · ${timeframeLabel(chartTimeframe)}${showingCanonicalChart ? "" : ` · 训练基准 ${timeframeLabel(timeframe)}`} · 历史训练`}</span>
                </div>
                {latestWatchMode && (
                  <button
                    type="button"
                    className="watch-mode-exit"
                    onClick={() => startFreshTraining(instrumentId, timeframe)}
                  >返回训练</button>
                )}
                {currentBar && (
                  <div className="ohlc-line">
                    {hideTaskPrice ? <span><EyeOff size={13} />绝对价格已隐藏</span> : (
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

              {duplicateTrainingPreview && (
                <div className="duplicate-training-preview" role="status" aria-live="polite">
                  <BookOpenCheck size={17} />
                  <div>
                    <strong>重复训练预览</strong>
                    <span>{duplicateTrainingPreview.session.instrumentId} · {timeframeLabel(duplicateTrainingPreview.session.timeframe)} · 当前仅查看历史训练内容，不会覆盖或保存当前训练。</span>
                  </div>
                  <div className="duplicate-training-preview-actions">
                    <button type="button" className="duplicate-market-link" onClick={() => {
                      const preview = duplicateTrainingPreview;
                      if (!preview) return;
                      setReviewedSession({ session: preview.session, state: preview.state });
                      setReviewSessionFilters(defaultReviewSessionFilters);
                      setView("review");
                    }}>查看复盘</button>
                    <button type="button" className="duplicate-training-return" onClick={returnFromDuplicateTrainingPreview}>返回当前训练</button>
                  </div>
                </div>
              )}

              {duplicateMarketWarning && trainingTask?.randomRun && (
                <div className="duplicate-market-warning" role="status" aria-live="polite">
                  <BookOpenCheck size={17} />
                  <div>
                    <strong>可能是重复行情 · {Math.round(duplicateMarketWarning.overlapRatio * 100)}%</strong>
                    <span>{hideTaskInstrument || hideTaskDate
                      ? `与训练库中的一场历史训练高度重叠 · ${duplicateMarketWarning.overlapBars}/${duplicateMarketWarning.currentBarCount} 根`
                      : `与 ${duplicateMarketWarning.session.instrumentId} · ${timeframeLabel(duplicateMarketWarning.session.timeframe)} · ${formatDate(duplicateMarketWarning.state.trainingTask!.startTimestamp, duplicateMarketWarning.session.timeframe)} 的训练高度重叠`}</span>
                  </div>
                  <button type="button" className="duplicate-market-link" onClick={() => openDuplicateTrainingPreview(duplicateMarketWarning)}>查看对应训练</button>
                  <button type="button" className="duplicate-market-dismiss" aria-label="关闭重复行情提示" onClick={() => setDuplicateMarketWarning(null)}><X size={13} /></button>
                </div>
              )}

              <div className="chart-area">
                <div className={`drawing-rail${showingCanonicalChart ? "" : " observation-only"}`} aria-label="画图工具">
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
                      bars={renderedChartBars}
                      dataIndexOffset={showingCanonicalChart ? chartDataIndexOffset : 0}
                      symbol={hideTaskInstrument ? "BLIND" : instrument.symbol}
                      timezone={instrument.timezone}
                      timeframe={chartTimeframe}
                      pricePrecision={instrument.pricePrecision}
                      movingAverageSettings={movingAverageSettings}
                      drawingRequest={showingCanonicalChart ? drawingRequest : null}
                      clearNonce={clearNonce}
                      tradeMarkers={tradeMarkers}
                      decisionMarkers={decisionMarkers}
                      corporateActionMarkers={corporateActionMarkers}
                      protectionLines={protectionLines}
                      priceSelectionMode={showingCanonicalChart ? protectionPriceSelection : null}
                      drawings={showingCanonicalChart ? drawings : []}
                      selectedDrawingId={showingCanonicalChart ? selectedDrawingId : ""}
                      drawingsRestoreNonce={showingCanonicalChart ? drawingsRestoreNonce : 0}
                      hideDate={hideTaskDate}
                      hidePrice={hideTaskPrice}
                      onDecisionSelect={setSelectedDecisionId}
                      onCorporateActionSelect={setSelectedCorporateActionId}
                      onProtectionPriceSelect={showingCanonicalChart ? applyDraftProtectionPrice : ignoreProtectionPriceSelect}
                      onProtectionLineMove={showingCanonicalChart ? moveProtectionLine : rejectProtectionLineMove}
                      onCandleContextMenu={showingCanonicalChart ? openDecisionForCandle : ignoreCandleContextMenu}
                      onDrawingsChange={showingCanonicalChart ? handleDrawingsChange : ignoreDrawingsChange}
                      onDrawingSelect={showingCanonicalChart ? (id) => setSelectedDrawingId(id ?? "") : ignoreDrawingSelect}
                    />
                  )}
                  {selectedCorporateAction && (
                    <div className="corporate-action-card" role="status">
                      <div><span>权息事件 · {selectedCorporateAction.label}</span><strong>{selectedCorporateAction.date}</strong></div>
                      <p>{selectedCorporateAction.description}</p>
                    </div>
                  )}
                  {protectionPriceSelection && (
                    <div className="price-selection-hint">
                      点击图表选择{protectionPriceSelection === "stop-loss" ? "止损" : "止盈"}价格
                      <button type="button" onClick={() => setProtectionPriceSelection(null)}>取消</button>
                    </div>
                  )}
                  {selectedDecision && (
                    <div className="decision-chart-card">
                      <div className="decision-chart-card-head">
                        <div>
                          <span>{selectedDecision.autoGenerated ? "订单自动计划" : selectedDecision.backfilled ? "补写决策" : "已提交决策"}</span>
                          <strong>{hideTaskDate ? `K线 #${selectedDecision.cursor + 1}` : formatDate(selectedDecision.barTimestamp, timeframe)}</strong>
                        </div>
                        <button aria-label="关闭决策卡" onClick={() => setSelectedDecisionId("")}>×</button>
                      </div>
                      <div className="decision-chart-tags">
                        <span>{selectedDecision.decision.marketState}</span>
                        <span>{selectedDecision.decision.location}</span>
                        {selectedDecision.decision.reasons.map((reason) => <span key={reason}>{reason}</span>)}
                      </div>
                      <div className="decision-chart-levels">
                        <span>参考价 <strong>{hideTaskPrice ? "已隐藏" : selectedDecision.referencePrice.toFixed(instrument.pricePrecision)}</strong></span>
                        <span>失效 <strong>{hideTaskPrice ? "训练结束后揭示" : selectedDecision.decision.stop || "未填写"}</strong></span>
                        <span>目标 <strong>{hideTaskPrice ? "训练结束后揭示" : selectedDecision.decision.target || "未填写"}</strong></span>
                      </div>
                      <DecisionLinkedTradeSummary
                        positions={linkedDecisionPositions}
                        tradingMode={tradingMode}
                        marginInstrument={marginInstrument}
                        dateLabel={trainingDateLabel}
                        priceLabel={trainingPriceLabel}
                        onEvidence={openReviewEvidence}
                        compact
                      />
                      <p>{selectedDecision.decision.note || "没有填写计划说明"}</p>
                      <div className="decision-chart-actions">
                        <button type="button" className="ghost-button" onClick={() => editDecision(selectedDecision)}><Pencil size={14} />编辑</button>
                        <button type="button" className="danger-button" onClick={() => deleteDecision(selectedDecision)}><Trash2 size={14} />删除</button>
                      </div>
                    </div>
                  )}
                  <div className="replay-watermark">{liveMode || latestWatchMode ? "WATCH · 最新行情" : `REPLAY · ${trainingComplete ? "未来已揭示" : "未来已隐藏"}`}</div>
                  <div className="chart-touch-hint">长按 K 线补写决策</div>
                </div>
              </div>

              <div className="replay-controls">
                <div className="progress-meta">
                  <span>{currentBar ? (hideTaskDate ? `训练第 ${currentTaskProgress.revealed} 根` : formatDate(currentBar.timestamp, timeframe)) : "--"}</span>
                  <span>{loading ? "正在加载…" : trainingTask ? `${currentTaskProgress.revealed} / ${currentTaskProgress.total} 根` : `${cursor + 1} / ${bars.length} 根`}</span>
                </div>
                <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="transport">
                  <button aria-label={rewindLocked ? "随机训练不可重置" : "重置"} title={rewindLocked ? "随机训练为单向揭示，不允许重置" : undefined} disabled={playbackDisabled || rewindLocked} onClick={resetTraining}><RotateCcw size={17} /></button>
                  <button aria-label={rewindLocked ? "随机训练不可回退" : "上一根"} title={rewindLocked ? "随机训练为单向揭示，不允许查看上一根" : undefined} disabled={rewindLocked || trainingComplete || cursor <= (trainingTask?.startCursor ?? 0)} onClick={revealPrevious}><ChevronLeft size={19} /></button>
                  <button className="play-button" disabled={playbackDisabled} aria-label={playing ? "暂停" : "播放"} onClick={() => {
                    const nextPlaying = !playing;
                    setPlaying(nextPlaying);
                    appendEvent("playback_toggled", { playing: nextPlaying, speed });
                  }}>
                    {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
                  </button>
                  <button aria-label="下一根" disabled={playbackDisabled} onClick={revealNext}><ChevronRight size={19} /></button>
                  <button aria-label="前进五根" disabled={playbackDisabled} onClick={() => revealMany(5)}><FastForward size={18} /></button>
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
                <div className="trade-setup-panel">
                  <div className="trade-stats">
                  {tradingMode === "capital" && marginInstrument ? (
                    <>
                      <span>账户余额 <strong>{money(cashBalance)}</strong></span>
                      <span>账户权益 <strong className={equity >= initialCapital ? "up" : "down"}>{money(equity)}</strong></span>
                      <span>已用保证金 <strong>{money(currentMarginAccount?.usedMargin ?? 0)}</strong></span>
                      <span>可用保证金 <strong>{money(availableBuyingPower)}</strong></span>
                      <span>保证金水平 <strong className={(currentMarginAccount?.marginLevelPct ?? 9999) <= Number(instrumentEconomics?.stopOutLevelPct ?? 50) ? "down" : ""}>{currentMarginAccount?.marginLevelPct == null ? "--" : `${currentMarginAccount.marginLevelPct.toFixed(1)}%`}</strong></span>
                      <span>分红收入 <strong className={dividendIncome >= 0 ? "up" : "down"}>{money(dividendIncome)}</strong></span>
                      <span>总盈亏 <strong className={totalPnl >= 0 ? "up" : "down"}>{money(totalPnl)}</strong></span>
                    </>
                  ) : tradingMode === "capital" ? (
                    <>
                      <span>账户权益 <strong className={equity >= initialCapital ? "up" : "down"}>{money(equity)}</strong></span>
                      <span>可用资金 <strong>{money(availableBuyingPower)}</strong></span>
                      <span>持仓市值 <strong>{money(marketValue)}</strong></span>
                      <span>分红收入 <strong className={dividendIncome >= 0 ? "up" : "down"}>{money(dividendIncome)}</strong></span>
                      <span>总盈亏 <strong className={totalPnl >= 0 ? "up" : "down"}>{money(totalPnl)}</strong></span>
                    </>
                  ) : (
                    <>
                      <span>持仓笔数 <strong>{openPositions.length}</strong></span>
                      <span>分红收入 <strong className={dividendIncome >= 0 ? "up" : "down"}>{money(dividendIncome)}</strong></span>
                      <span>总收益率 <strong className={totalReturnPct >= 0 ? "up" : "down"}>{percent(totalReturnPct)}</strong></span>
                      <span>浮动收益率 <strong className={floatingReturnPct >= 0 ? "up" : "down"}>{percent(floatingReturnPct)}</strong></span>
                      <span>已实现收益率 <strong className={realizedReturnPct >= 0 ? "up" : "down"}>{percent(realizedReturnPct)}</strong></span>
                    </>
                  )}
                  </div>
                  <div className="execution-order-controls">
                  {!liveMode && <label>下单方式
                    <select aria-label="下单方式" value={positionSizeMode} onChange={(event) => {
                      const value = event.target.value as PositionSizeMode;
                      setPositionSizeMode(value);
                      rememberOrderEntryPreference({ positionSizeMode: value });
                    }}>
                      <option value="fixed">固定数量</option>
                      <option value="risk-percent">按止损风险（余额%）</option>
                    </select>
                  </label>}
                  {!liveMode && positionSizeMode === "risk-percent" && <label>单笔风险（余额%）
                    <input aria-label="单笔风险百分比" type="number" min="0.1" max="100" step="0.1" value={riskPercent} onChange={(event) => {
                      const value = Math.max(0.1, Math.min(100, Number(event.target.value) || 0.1));
                      setRiskPercent(value);
                      rememberOrderEntryPreference({ riskPercent: value });
                    }} />
                  </label>}
                  <label>开仓委托
                    <select aria-label="开仓委托类型" value={orderType} onChange={(event) => {
                      const value = event.target.value as OrderType;
                      setOrderType(value);
                      rememberOrderEntryPreference({ orderType: value });
                    }}>
                      <option value="market">市价 · 下一根开盘</option>
                      <option value="limit">限价单（Limit Order）</option>
                      <option value="stop">突破单（Stop Order）</option>
                    </select>
                  </label>
                  {!liveMode && <label>跳空不买
                    <button
                      aria-label="跳空不买模式"
                      className={`opening-gap-mode-button ${openingGapMode}`}
                      type="button"
                      title="按顺序点击：高开不买、低开不买、取消此功能"
                      onClick={() => {
                        const nextMode = nextOpeningGapMode(openingGapMode);
                        setOpeningGapMode(nextMode);
                        rememberOrderEntryPreference({ openingGapMode: nextMode });
                      }}
                    >{openingGapMode === "low" ? "低开不买" : "高开不买"}</button>
                  </label>}
                  {!liveMode && openingGapMode !== "off" && <label>不买阈值
                    <span className="opening-gap-threshold-control">
                      <input
                        aria-label="跳空不买阈值"
                        type="number"
                        min="0.01"
                        step={openingGapUnit === "percent" ? "0.1" : "any"}
                        value={openingGapThreshold}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value) || value <= 0) return;
                          setOpeningGapThreshold(value);
                          rememberOrderEntryPreference({ openingGapThreshold: value });
                        }}
                      />
                      <select
                        aria-label="跳空不买阈值单位"
                        value={openingGapUnit}
                        onChange={(event) => {
                          const value = event.target.value as OpeningGapUnit;
                          setOpeningGapUnit(value);
                          rememberOrderEntryPreference({ openingGapUnit: value });
                        }}
                      >
                        <option value="percent">百分比</option>
                        <option value="price">价格</option>
                      </select>
                    </span>
                  </label>}
                  {orderType !== "market" && (
                    <label>触发价
                      <span className="entry-trigger-control">
                        <input aria-label="委托触发价" type={hideTaskPrice ? "password" : "number"} inputMode="decimal" min="0" step="any" value={orderTriggerPrice} onChange={(event) => setOrderTriggerPrice(event.target.value)} placeholder={hideTaskPrice ? "•••" : currentBar?.close.toFixed(instrument.pricePrecision)} />
                        <button
                          aria-label="在图表选择委托触发价"
                          aria-pressed={protectionPriceSelection === "entry-trigger"}
                          className={protectionPriceSelection === "entry-trigger" ? "active" : ""}
                          type="button"
                          title={showingCanonicalChart ? "点击 K 线图选择委托触发价" : `请先切换回训练基准周期 ${timeframeLabel(timeframe)}`}
                          onClick={() => {
                            if (!showingCanonicalChart) {
                              setRuleNotice(`请先切换回训练基准周期 ${timeframeLabel(timeframe)}，再在图表选择委托触发价`);
                              return;
                            }
                            setProtectionPriceSelection((current) => current === "entry-trigger" ? null : "entry-trigger");
                            setRuleNotice("请在上方 K 线图点击选择委托触发价");
                          }}
                        ><MousePointer2 size={12} />图表</button>
                      </span>
                    </label>
                  )}
                  {!liveMode && <label>止损
                    <span className="protection-picker-control">
                      <button
                        aria-label="在图表选择保护止损价"
                        aria-pressed={protectionPriceSelection === "stop-loss"}
                        className={protectionPriceSelection === "stop-loss" ? "active" : ""}
                        type="button"
                        title={showingCanonicalChart ? "点击 K 线图选择止损价格" : `请先切换回训练基准周期 ${timeframeLabel(timeframe)}`}
                        onClick={() => {
                          if (!showingCanonicalChart) {
                            setRuleNotice(`请先切换回训练基准周期 ${timeframeLabel(timeframe)}，再在图表选择止损价格`);
                            return;
                          }
                          setProtectionPriceSelection((current) => current === "stop-loss" ? null : "stop-loss");
                          setRuleNotice("请在上方 K 线图点击选择止损价格");
                        }}
                      >{effectiveOrderStop ? trainingPriceLabel(effectiveOrderStop) : "点击图表选价"}</button>
                      {effectiveOrderStop && <button aria-label="清除保护止损价" className="clear" type="button" onClick={() => clearDraftProtectionPrice("stop-loss")}><X size={11} /></button>}
                    </span>
                  </label>}
                  {!liveMode && <label>止盈
                    <span className="protection-picker-control">
                      <button
                        aria-label="在图表选择保护止盈价"
                        aria-pressed={protectionPriceSelection === "take-profit"}
                        className={protectionPriceSelection === "take-profit" ? "active" : ""}
                        type="button"
                        title={showingCanonicalChart ? "点击 K 线图选择止盈价格" : `请先切换回训练基准周期 ${timeframeLabel(timeframe)}`}
                        onClick={() => {
                          if (!showingCanonicalChart) {
                            setRuleNotice(`请先切换回训练基准周期 ${timeframeLabel(timeframe)}，再在图表选择止盈价格`);
                            return;
                          }
                          setProtectionPriceSelection((current) => current === "take-profit" ? null : "take-profit");
                          setRuleNotice("请在上方 K 线图点击选择止盈价格");
                        }}
                      >{effectiveOrderTarget ? trainingPriceLabel(effectiveOrderTarget) : "点击图表选价"}</button>
                      {effectiveOrderTarget && <button aria-label="清除保护止盈价" className="clear" type="button" onClick={() => clearDraftProtectionPrice("take-profit")}><X size={11} /></button>}
                    </span>
                  </label>}
                  <small>{liveMode
                    ? "实盘观察按下一交易日开盘价处理；市价单直接成交，限价单和突破单不满足触发条件时继续挂单，不计模拟费用。"
                    : marginInstrument
                      ? `成交模型 ${EXECUTION_ENGINE_VERSION} · BID K线 · 买入/回补用 Ask，卖出/平多用 Bid · 1 手 ${Number(instrumentEconomics?.contractSize ?? 100000).toLocaleString()} ${marginContractUnit} · ${marginPipLabel} ${oneLotPipValue == null ? "待换算" : `${oneLotPipValue.toFixed(2)} ${instrumentEconomics?.accountCurrency ?? "USD"}`} · 杠杆 1:${instrumentEconomics?.leverage ?? 100} · 强平线 ${instrumentEconomics?.stopOutLevelPct ?? 50}%`
                      : `成交模型 ${EXECUTION_ENGINE_VERSION} · 佣金 ${executionProfile.commissionRateBps}bp · 滑点 ${executionProfile.slippageBps}bp · 价差 ${executionProfile.spreadBps}bp · 当根量参与 ${executionProfile.maxVolumeParticipationPct || "不限"}${executionProfile.maxVolumeParticipationPct ? "%" : ""}`}</small>
                  {!liveMode && positionSizeMode === "risk-percent" && <small>
                    {effectiveOrderStop
                      ? `按账户余额 ${money(riskBalance)} × ${riskPercent}% 风险计算；拖动止损线后风险${marginInstrument ? "手数" : "数量"}会自动更新。`
                      : "请先在图表点击或拖动止损线；系统会按账户余额和单笔风险自动计算数量/手数。"}
                  </small>}
                  {!liveMode && protectionPriceSelection && <div className="mobile-protection-selection-hint" role="status">
                    请在上方 K 线图点击选择{protectionPriceSelection === "stop-loss" ? "止损" : protectionPriceSelection === "take-profit" ? "止盈" : "委托触发价"}{positionSizeMode === "risk-percent" && protectionPriceSelection === "stop-loss" ? "，风险手数/数量会自动更新" : ""}。
                  </div>}
                  </div>
                </div>
                <div className="trade-fixed-dock">
                  <div className="order-entry">
                  <label><span className="quantity-label">{marginInstrument ? (positionSizeMode === "risk-percent" && !liveMode ? "风险手数" : "手数") : positionSizeMode === "risk-percent" && !liveMode ? "风险数量" : "数量"}</span><input
                    aria-label="下单数量"
                    type="number"
                    min={minimumBuyQuantity(marketRules)}
                    value={positionSizeMode === "risk-percent" && !liveMode ? riskSizingPreview?.quantity ?? "" : orderQty}
                    readOnly={positionSizeMode === "risk-percent" && !liveMode}
                    placeholder={positionSizeMode === "risk-percent" && !liveMode ? "先选止损" : undefined}
                    title={positionSizeMode === "risk-percent" && riskSizingPreview
                      ? `风险预算 ${riskSizingPreview.riskBudget.toFixed(2)}，预计风险 ${riskSizingPreview.estimatedRisk.toFixed(2)}${riskSizingPreview.limitedByMargin ? "，已受可用保证金限制" : riskSizingPreview.limitedByCash ? "，已受可用资金限制" : ""}`
                      : undefined}
                    onChange={(event) => {
                      const quantity = Math.max(minimumBuyQuantity(marketRules), Number(event.target.value));
                      setOrderQty(quantity);
                      appendEvent("order_quantity_changed", { quantity });
                    }}
                    step={buyQuantityStep(marketRules)}
                  /></label>
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
                     ? `${pendingOrders.length} 笔委托等待成交；${liveMode ? "市价单下一交易日开盘成交，限价/突破单按开盘价触发" : "触价后按当根成交量参与率部分成交，余量继续挂单"}${tradingMode === "capital" ? marginInstrument ? ` · 已预留保证金/费用 ${reservedMarginTotal.toFixed(2)}` : ` · 已预留 ${(cashBalance - availableBuyingPower).toFixed(2)}` : ""}`
                    : `${marketRules.name}：${describeBuyQuantity(marketRules)}${marginInstrument ? ` · ${instrumentEconomics?.accountCurrency ?? "USD"} 账户 · 1:${instrumentEconomics?.leverage ?? 100}` : ""}${marketRules.tPlusOne ? " · T+1" : ""}${marketRules.priceLimitRatio ? ` · 涨跌幅 ${(marketRules.priceLimitRatio * 100).toFixed(0)}%` : ""}`)}
                </div>

                <div className={`orders-board ${mobileOrdersExpanded ? "mobile-expanded" : ""}`}>
                  <div className="orders-board-head">
                    <div className="orders-board-title">
                      <strong>订单与持仓</strong>
                      <button className="orders-mobile-toggle" aria-expanded={mobileOrdersExpanded} onClick={() => setMobileOrdersExpanded((value) => !value)}>{mobileOrdersExpanded ? "收起" : "明细"}</button>
                    </div>
                    <div className="orders-tabs">
                      <button className={orderPanelTab === "positions" ? "active" : ""} onClick={() => { setHoveredClosedPositionId(null); setOrderPanelTab("positions"); setMobileOrdersExpanded(true); }}>当前持仓 <span>{openPositions.length}</span></button>
                      <button className={orderPanelTab === "pending" ? "active" : ""} onClick={() => { setHoveredClosedPositionId(null); setOrderPanelTab("pending"); setMobileOrdersExpanded(true); }}>待成交 <span>{pendingOrders.length}</span></button>
                      <button className={orderPanelTab === "history" ? "active" : ""} onClick={() => { setHoveredClosedPositionId(null); setOrderPanelTab("history"); setMobileOrdersExpanded(true); }}>已平仓 <span>{closedPositions.length}</span></button>
                    </div>
                  </div>

                  <div className="orders-table-wrap">
                    {orderPanelTab === "positions" && (
                      <table className="orders-table">
                        <thead><tr><th>仓位</th><th>方向</th><th>数量</th><th>开仓时间</th><th>开仓价</th><th>保护价</th><th>现价</th><th>浮动盈亏</th><th>操作</th></tr></thead>
                        <tbody>{openPositions.length ? openPositions.map((position) => {
                          const pnl = currentBar
                            ? (marginInstrument
                              ? markToMarketPnl(position, currentBar.close, executionProfile.spreadBps)
                              : (currentBar.close - position.entryPrice) * position.qty * (position.side === "long" ? 1 : -1))
                              - (position.entryFee ?? 0)
                            : 0;
                          const notional = entryNotional(position);
                          const positionReturn = notional > 0
                            ? pnl / notional * 100
                            : 0;
                          const closeQueued = pendingOrders.some((order) => order.action === "close" && order.positionId === position.id);
                          const closeValidation = currentBar
                            ? validateCloseOrder(marketRules, position, currentBar.timestamp, instrument.timezone)
                            : { ok: false, message: "行情未就绪" };
                          const activeRule = appSettings.personalSopCheckEnabled ? appSettings.activePersonalSopRule : null;
                          const holdingAge = activeRule && currentBar
                            ? holdingBarsAtCursor(bars, cursor, position.entryTimestamp)
                            : 0;
                          const holdingStatus = activeRule && holdingAge
                            ? evaluatePersonalSopManagement(activeRule, holdingAge)
                            : null;
                          return (
                            <tr key={position.id}>
                              <td data-label="仓位"><span className="position-id">#{position.id.slice(0, 6)}</span></td>
                              <td data-label="方向"><span className={position.side === "long" ? "side-long" : "side-short"}>{position.side === "long" ? "多 / 买" : "空 / 卖"}</span></td>
                              <td data-label="数量">{marginInstrument ? `${position.qty.toFixed(2)} 手` : position.qty}</td>
                              <td data-label="开仓时间"><span>{trainingDateLabel(position.entryTimestamp)}</span>{holdingStatus?.overMax && <small className="position-sop-warning">超出 SOP {holdingAge} / {activeRule?.management.holdingBarsMax} 根</small>}</td>
                              <td data-label="开仓价">{trainingPriceLabel(position.entryPrice)}</td>
                              <td data-label="保护价">损 {trainingPriceLabel(position.stopLoss)} / 盈 {trainingPriceLabel(position.takeProfit)}</td>
                              <td data-label="现价">{trainingPriceLabel(currentBar?.close)}</td>
                              <td data-label="浮动盈亏"><strong className={pnl >= 0 ? "up" : "down"}>{tradingMode === "capital" ? money(pnl) : percent(positionReturn)}</strong></td>
                              <td data-label="操作"><button
                                className="row-action"
                                disabled={trainingComplete || closeQueued || (!closeValidation.ok && closeValidation.code !== "t_plus_one_locked")}
                                title={closeValidation.code === "t_plus_one_locked" ? "预约到下一交易日第一根K线开盘平仓" : closeValidation.message}
                                onClick={() => closeValidation.ok ? queueClosePosition(position.id) : queueCloseNextSession(position.id)}
                              >{closeQueued ? "已委托" : closeValidation.ok ? "平仓" : closeValidation.code === "t_plus_one_locked" ? "次日开盘平仓" : "不可平仓"}</button></td>
                            </tr>
                          );
                        }) : <tr><td className="orders-empty" colSpan={9}>暂无持仓。市价单在下一根开盘成交，限价单（Limit Order）与突破单（Stop Order）会等待价格触发。</td></tr>}</tbody>
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
                            <td data-label="数量">{order.filledQty
                              ? `已成 ${order.filledQty} / ${order.originalQty ?? order.filledQty + order.qty} · 剩 ${order.qty}`
                              : marginInstrument ? `${order.qty.toFixed(2)} 手` : order.qty}</td>
                            <td data-label="提交时间">{trainingDateLabel(order.createdAt)}</td>
                            <td data-label="关联仓位">#{order.positionId.slice(0, 6)}</td>
                            <td data-label="成交规则">{order.executeAtTimestamp
                              ? `${trainingDateLabel(order.executeAtTimestamp)} 开盘`
                              : `${orderTypeLabel(order.orderType)}${order.triggerPrice ? ` @ ${trainingPriceLabel(order.triggerPrice)}` : ""}`}{order.stopLoss || order.takeProfit ? ` · 损 ${trainingPriceLabel(order.stopLoss)} / 盈 ${trainingPriceLabel(order.takeProfit)}` : ""} · {order.ruleVersion ?? "旧规则"}</td>
                            <td data-label="操作"><button className="row-action danger" onClick={() => cancelPendingOrder(order.id)}>撤单</button></td>
                          </tr>
                        )) : <tr><td className="orders-empty" colSpan={8}>暂无待成交委托。</td></tr>}</tbody>
                      </table>
                    )}

                    {orderPanelTab === "history" && (
                      <table className="orders-table" onMouseLeave={() => setHoveredClosedPositionId(null)}>
                        <thead><tr><th>仓位</th><th>方向</th><th>数量</th><th>开仓时间</th><th>开仓价</th><th>平仓时间</th><th>平仓价</th><th>费用 / 原因</th><th>净盈亏</th></tr></thead>
                        <tbody>{closedPositions.length ? [...closedPositions].reverse().map((position) => (
                          <tr
                            key={position.id}
                            onMouseEnter={() => setHoveredClosedPositionId(position.id)}
                            onMouseLeave={() => setHoveredClosedPositionId((current) => current === position.id ? null : current)}
                          >
                            <td data-label="仓位"><span className="position-id">#{position.id.slice(0, 6)}</span></td>
                            <td data-label="方向"><span className={position.side === "long" ? "side-long" : "side-short"}>{position.side === "long" ? "多 / 买" : "空 / 卖"}</span></td>
                            <td data-label="数量">{marginInstrument ? `${position.qty.toFixed(2)} 手` : position.qty}</td>
                            <td data-label="开仓时间">{trainingDateLabel(position.entryTimestamp)}</td>
                            <td data-label="开仓价">{trainingPriceLabel(position.entryPrice)}</td>
                            <td data-label="平仓时间">{position.exitTimestamp ? trainingDateLabel(position.exitTimestamp) : "--"}</td>
                            <td data-label="平仓价">{trainingPriceLabel(position.exitPrice)}</td>
                            <td data-label="费用 / 原因">{(position.totalFees ?? 0).toFixed(2)} · {exitReasonLabel(position.exitReason)}{position.intrabarAmbiguous ? " · 同根冲突" : ""}</td>
                            <td data-label="净盈亏"><strong className={(position.realizedPnl ?? 0) >= 0 ? "up" : "down"}>{tradingMode === "capital" ? money(position.realizedPnl ?? 0) : percent(positionReturnPct(position, position.exitPrice ?? position.entryPrice))}</strong></td>
                          </tr>
                        )) : <tr><td className="orders-empty" colSpan={9}>平仓后，买卖点会以浅色虚线连接并保留在这里。</td></tr>}</tbody>
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
                    <strong>{hideTaskDate ? `K线 #${decisionTarget.dataIndex + 1}` : formatDate(decisionTarget.timestamp, timeframe)}</strong>
                    <small>{hideTaskPrice ? "参考价已隐藏" : `参考价 ${decisionTarget.referencePrice.toFixed(instrument.pricePrecision)}`}</small>
                  </div>
                  <button type="button" onClick={cancelDecisionBackfill}>取消</button>
                </div>
              )}
              {decisionTarget && !editingDecisionId && (
                <div className="decision-backfill-link">
                  {backfillCandidates.length ? (
                    <>
                      <div>
                        <strong>发现 {backfillCandidates.length} 笔过去交易</strong>
                        <small>默认把这根 K 线之后、下一张计划之前的交易关联到本卡。</small>
                      </div>
                      <label className="decision-backfill-toggle">
                        <input
                          type="checkbox"
                          checked={backfillAssociation === "associate"}
                          onChange={(event) => setBackfillAssociation(event.target.checked ? "associate" : "none")}
                        />
                        <span>{backfillAssociation === "associate" ? "保存并关联" : "只保存计划"}</span>
                      </label>
                    </>
                  ) : (
                    <small>这段没有找到尚未关联的过去交易，本次只保存计划。</small>
                  )}
                </div>
              )}
              {activeDecisionSubmission && (
                <DecisionLinkedTradeSummary
                  positions={linkedDecisionPositions}
                  tradingMode={tradingMode}
                  marginInstrument={marginInstrument}
                  dateLabel={trainingDateLabel}
                  priceLabel={trainingPriceLabel}
                  onEvidence={openReviewEvidence}
                />
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
                <button type="button" className={`decision-price-level${protectionPriceSelection === "stop-loss" ? " active" : ""}`} onClick={() => setProtectionPriceSelection((current) => current === "stop-loss" ? null : "stop-loss")}>
                  <span>失效 / 止损</span><strong>{hideTaskPrice ? "已隐藏" : decision.stop || "点击图表取点"}</strong>
                </button>
                <button type="button" className={`decision-price-level${protectionPriceSelection === "take-profit" ? " active" : ""}`} onClick={() => setProtectionPriceSelection((current) => current === "take-profit" ? null : "take-profit")}>
                  <span>第一目标</span><strong>{hideTaskPrice ? "已隐藏" : decision.target || "点击图表取点"}</strong>
                </button>
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
              <button className="commit-plan" disabled={trainingComplete && !decisionTarget} onClick={submitDecision}><ListChecks size={17} />{editingDecisionId ? "保存编辑" : decisionTarget ? backfillCandidates.length && backfillAssociation === "associate" ? "保存并关联" : "只保存计划" : trainingComplete ? "训练已结束" : "提交决策并揭示下一根"}</button>
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
              <span>{liveEntryFromCoverage ? "看盘" : liveNavigatorSource === "portfolio" ? "实盘观察" : liveNavigatorSource === "watch" ? "实盘观望" : "实盘筛选"}</span>
              <strong>{liveContext?.symbol ?? "--"}</strong>
              <small>{liveNavigatorDisplayIndex + 1} / {liveNavigatorResults.length}</small>
            </div>
            <button type="button" aria-label="下一个筛选结果" title="下一个" onPointerDown={(event) => event.stopPropagation()} onClick={() => moveLiveScanResult(1)}><ChevronRight size={16} /></button>
            <button
              type="button"
              className={`live-scan-navigator-watch${liveWatchExists ? " active" : ""}`}
              aria-label={liveWatchExists ? "移除自选" : "加入自选"}
              title={liveWatchExists ? "移除自选" : "加入自选"}
              disabled={!liveContext || !currentBar}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={toggleLiveWatchFromNavigator}
            ><Star size={14} fill="currentColor" /></button>
            <button
              type="button"
              className="live-scan-navigator-exit"
              aria-label={liveEntryFromCoverage ? "退出看盘" : "退出实盘观察"}
              title={liveEntryFromCoverage ? "退出看盘" : "退出实盘观察"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                liveRequestRef.current = null;
                liveRequestTimeframeRef.current = null;
                setLiveMode(false);
                setLiveContext(null);
                setLiveEntryFromCoverage(false);
                startFreshTraining(instrumentId, timeframe);
              }}
            ><X size={14} /></button>
          </div>
        ) : null}

        {view === "replay" && !liveMode && trainingNavigatorActive && trainingNavigatorSessions.length > 1 ? (
          <div
            className="live-scan-navigator training-session-navigator"
            style={{ transform: `translate(calc(-50% + ${trainingNavigatorOffset.x}px), ${trainingNavigatorOffset.y}px)` }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              trainingBarDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: trainingNavigatorOffset.x,
                offsetY: trainingNavigatorOffset.y,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerUp={(event) => {
              if (trainingBarDragRef.current?.pointerId === event.pointerId) trainingBarDragRef.current = null;
            }}
            role="region"
            aria-label="训练记录导航"
          >
            <button type="button" aria-label="上一场训练" title="上一场训练" onPointerDown={(event) => event.stopPropagation()} onClick={() => moveTrainingSession(-1)}><ChevronLeft size={16} /></button>
            <div className="live-scan-navigator-label">
              <span>训练切换</span>
              <strong>{trainingNavigatorSessions[trainingNavigatorIndex]?.instrumentId ?? "--"} · {timeframeLabel(trainingNavigatorSessions[trainingNavigatorIndex]?.timeframe ?? "--")}</strong>
              <small>{trainingNavigatorIndex + 1} / {trainingNavigatorSessions.length}</small>
            </div>
            <button type="button" aria-label="下一场训练" title="下一场训练" onPointerDown={(event) => event.stopPropagation()} onClick={() => moveTrainingSession(1)}><ChevronRight size={16} /></button>
            <button
              type="button"
              className="live-scan-navigator-exit"
              aria-label="关闭训练导航"
              title="关闭训练导航"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                trainingBarDragRef.current = null;
                setTrainingNavigatorActive(false);
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
              <button type="button" role="tab" aria-selected={performanceSection === "sop"} className={performanceSection === "sop" ? "active" : ""} onClick={() => setPerformanceSection("sop")}>个人 SOP</button>
              <button type="button" role="tab" aria-selected={performanceSection === "live"} className={performanceSection === "live" ? "active" : ""} onClick={() => setPerformanceSection("live")}>实盘表现 <span>{filteredLivePerformanceRows.length}</span></button>
              <button type="button" role="tab" aria-selected={performanceSection === "watch"} className={performanceSection === "watch" ? "active" : ""} onClick={() => setPerformanceSection("watch")}>实盘观望 <span>{liveWatchlist.length}</span></button>
            </div>

            {performanceSection === "sop" ? (
              <section className="performance-sop-panel">
                <div className="performance-section-head">
                  <div><span className="section-label">PERSONAL SOP</span><h2>个人交易 SOP</h2></div>
                  <button type="button" className="ghost-button" onClick={() => openSettingsPanel("discipline")}><Settings2 size={15} />交易纪律设置</button>
                </div>
                <PersonalSopRecommendations
                  recommendations={personalSopRecommendations}
                  scopeSummaries={personalSopScopeSummaries}
                  activeRule={appSettings.activePersonalSopRule}
                  formatResult={(value) => percent(value)}
                  onApply={applyPersonalSopRule}
                />
                <section className="sop-logic-card">
                  <div><span className="section-label">RULE LOGIC</span><h2>它会管理什么</h2></div>
                  <div className="sop-logic-grid">
                    <div><strong>入场</strong><span>市场/周期（品种不限）、形态、市场状态、位置和理由。</span></div>
                    <div><strong>资料</strong><span>价格、日均成交量、成交额和市值；当前资料缺失时提示但不伪造通过。</span></div>
                    <div><strong>持仓</strong><span>使用真实揭示 K 线索引管理持仓范围；超限后提示，开启严格自动平仓才会排队。</span></div>
                  </div>
                </section>
              </section>
            ) : performanceSection === "live" ? (
              <section className="live-performance-panel">
                <div className="performance-section-head">
                  <div><span className="section-label">LIVE PERFORMANCE</span><h2>实盘表现</h2></div>
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
                  <div className="performance-section-head"><div><span className="section-label">WATCHLIST</span><h2>实盘表现标的</h2></div><div className="live-performance-actions"><small>点击打开标的，继续观察或交易</small><button type="button" className="ghost-button live-review-button" disabled={!livePortfolios.length} onClick={reviewLivePortfolios}><BookOpenCheck size={13} />审阅</button></div></div>
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
                            <span><strong>{performanceMarketLabel(watch.market)}</strong><small>{new Date(watch.latestTimestamp).toLocaleDateString("zh-CN")}</small></span>
                            <span><strong>{watch.latestClose.toFixed(4)}</strong><small>最新价 · 观望日开盘基准 {observationPrice.toFixed(4)} · {new Date(observationTimestamp).toLocaleDateString("zh-CN")}</small></span>
                            <span className="live-performance-result"><strong className={returnPct === null || returnPct >= 0 ? "up" : "down"}>{pending ? "待计算" : returnPct === null ? "--" : percent(returnPct)}</strong><small>{pending ? "观望日行情尚未产生后续价格" : change === null ? "观望基准价不可用" : `开盘基准 ${observationPrice.toFixed(4)} · 价格变动 ${priceDelta(change)} · ${watch.presetNames.length ? watch.presetNames.join(" · ") : "未设置形态"}`}</small></span>
                            <span className="live-watch-row-actions"><button
                              type="button"
                              className="ghost-button"
                              onClick={() => {
                                const market = performanceMarketCode(watch.market, watch.instrumentId);
                                if (market === "CN" || market === "US") openLiveScanResult(result, index >= 0 ? index : undefined, "watch");
                                else startFreshTraining(watch.instrumentId, "1d", { latestWatch: true });
                              }}
                            ><BarChart3 size={14} />打开</button><button type="button" className="row-action danger" onClick={() => removeLiveWatch(watch.instrumentId)}>移除</button></span>
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
                    {TIMEFRAME_IDS.map((value) => <option key={value} value={value}>{timeframeLabel(value)}</option>)}
                  </select>
                </label>
                <label>计价模式
                  <select
                    value={performanceFilters.accountingMode}
                    onChange={(event) => setPerformanceFilters((filters) => ({
                      ...filters,
                      accountingMode: event.target.value as PerformanceFilters["accountingMode"],
                    }))}
                  >
                    <option value="all">全部（按收益率汇总）</option>
                    <option value="return">收益率模式</option>
                    <option value="capital">资金账户</option>
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
              <small>默认展示全部已保存训练；点击上方主卡可在累计收益率与累计总盈亏之间切换。</small>
            </div>
            <div className="performance-overview">
              <button
                type="button"
                className="performance-hero performance-hero-toggle"
                aria-pressed={performanceHeroUsesAmount}
                aria-label={`切换训练集主指标，当前显示${performanceHeroUsesAmount ? "累计总盈亏" : "训练收益率合计"}`}
                title="点击切换累计总盈亏与训练收益率合计"
                onClick={() => setPerformanceHeroDisplayMode((mode) => mode === "amount" ? "return" : "amount")}
              >
                <span>{performanceHeroUsesAmount ? "累计总盈亏" : "训练收益率合计"}</span>
                <strong className={performanceHeroValue >= 0 ? "up" : "down"}>{performanceHeroUsesAmount ? money(performanceHeroValue) : percent(performanceHeroValue)}</strong>
                <small>{performanceHeroUsesAmount
                  ? `训练收益率合计 ${percent(filteredPerformanceTotals.totalReturnPct)} · 已实现 ${money(filteredPerformanceTotals.realizedPnl)} · 浮动 ${money(filteredPerformanceTotals.floatingPnl)} · 点击切换收益率`
                  : `累计总盈亏 ${money(filteredPerformanceTotals.totalPnl)} · 已实现收益率合计 ${percent(filteredPerformanceTotals.realizedReturnPct)} · 浮动收益率合计 ${percent(filteredPerformanceTotals.floatingReturnPct)} · 点击切换金额`}</small>
              </button>
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
                <small>按每笔已平仓交易的平均{performanceUsesCapital ? "盈亏" : "收益率"}排序；至少 2 笔才标为当前最优。严格事前计划优先，训练开始后补写的计划会单独标明。</small>
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
                <small>训练结果统一按上方主卡显示{performanceHeroUsesAmount ? "资金" : "收益率"}；选中一场后，可以查看完整复盘或继续训练。</small>
              </div>
              {filteredSessionSummaries.length ? (
                <div className="performance-session-list">
                  <div className="performance-session-header">
                    <span>训练</span><span>模式 / 区间</span><span>状态</span><span>结果（{performanceHeroUsesAmount ? "资金" : "收益率"}）</span><span>创建时间</span><span>操作</span>
                  </div>
                  {filteredSessionSummaries.map((summary) => (
                    <div
                      className={`performance-session-row ${selectedPerformanceSession?.session.id === summary.session.id ? "selected" : ""}`}
                      key={summary.session.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`选择训练 ${summary.session.instrumentId} ${timeframeLabel(summary.session.timeframe)}`}
                      onClick={() => setSelectedPerformanceSessionId(summary.session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedPerformanceSessionId(summary.session.id);
                        }
                      }}
                    >
                      <span><strong>{summary.session.instrumentId}</strong><small>{timeframeLabel(summary.session.timeframe)}</small></span>
                      <span><strong>{summary.modeLabel}</strong><small>{summary.rangeLabel}{summary.task?.patternFilter ? ` · 形态：${summary.task.patternFilter.presetNames.join("、") || summary.task.patternFilter.presetIds.join("、")}` : ""}</small></span>
                      <span className={summary.task?.status === "completed" ? "session-status completed" : "session-status"}>{summary.task?.status === "completed" ? "已完成" : "可继续"}</span>
                      <span className="performance-session-result">
                        <strong className={(performanceHeroUsesAmount ? summary.pnl.total : summary.returnPct) >= 0 ? "up" : "down"}>{performanceHeroUsesAmount ? money(summary.pnl.total) : percent(summary.returnPct)}</strong>
                        <small>{summary.closedTradePnls.length} 笔已平仓 · {summary.winningTrades}胜/{summary.losingTrades}负/{summary.flatTrades}平</small>
                      </span>
                      <time>{new Date(summary.session.createdAt).toLocaleString("zh-CN")}</time>
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
                            resumeSession(summary.session, false, filteredSessionSummaries.map((item) => item.session));
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
              hasData={coverageSummary.hasNonSampleData}
              onOpenSettings={() => openSettingsPanel("data")}
              onDataChanged={async (changedMarket) => {
                if (changedMarket !== activeDataMarketRef.current) return;
                await Promise.all([loadCoverage(), loadInstrumentCatalog()]);
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
                  <th>品种</th><th>市场</th><th>周期</th><th>数量</th><th>覆盖范围</th><th>复权</th><th>来源</th><th>状态</th><th className="coverage-watch-cell">自选</th>
                </tr></thead>
                <tbody>{coverage.map((item) => {
                  const key = coverageKey(item);
                  const selected = selectedCoverageKeys.includes(key);
                  const watched = liveWatchlist.some((watch) => watch.instrumentId === item.id);
                  return (
                  <tr
                    className={`coverage-clickable-row${selected ? " selected" : ""}`}
                    key={key}
                    onClick={() => openCoverageWatch(item)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openCoverageWatch(item);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td className="coverage-select-cell" data-label="选择">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${item.symbol} ${timeframeLabel(item.timeframe)} ${item.source}`}
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => setSelectedCoverageKeys((current) => current.includes(key)
                          ? current.filter((value) => value !== key)
                          : [...current, key])}
                      />
                    </td>
                    <td data-label="品种">
                      <button
                        type="button"
                        className="coverage-instrument-link"
                        title={`打开 ${item.symbol} 最新 K 线`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openCoverageWatch(item);
                        }}
                      >
                        <strong>{item.symbol}</strong><span>{item.name}</span>
                      </button>
                    </td>
                    <td data-label="市场">{item.market}</td><td data-label="周期"><span className="tf-badge">{timeframeLabel(item.timeframe)}</span></td>
                    <td data-label="数量">{Number(item.barCount).toLocaleString()}</td>
                    <td data-label="覆盖范围">{new Date(item.firstTimestamp).toLocaleDateString("zh-CN")} — {new Date(item.lastTimestamp).toLocaleDateString("zh-CN")}</td>
                    <td data-label="复权">{adjustmentLabel(item.adjustmentType)}</td><td data-label="来源">{item.source}</td><td data-label="状态"><span className="coverage-status-actions"><span><span className="healthy-dot" />完整</span></span></td>
                    <td className="coverage-watch-cell" data-label="自选">
                      <button
                        type="button"
                        className="coverage-watch-toggle"
                        aria-label={`${watched ? "移除" : "加入"} ${item.symbol} 自选`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleLiveWatchFromCoverage(item);
                        }}
                      >
                        <Star size={13} fill={watched ? "currentColor" : "none"} />{watched ? "移除自选" : "加入自选"}
                      </button>
                    </td>
                  </tr>
                );})}</tbody>
              </table>
            </div>
            <div className="csv-help"><strong>CSV 格式</strong><code>timestamp,open,high,low,close,volume,turnover</code><span>时间可用毫秒时间戳或可解析日期；单次最多 5000 根。</span></div>
          </section>
        )}

        {view === "review" && (
          <section className="content-page review-page">
            <ReviewPanel
              title={reviewTitle}
              summary={reviewPanelSummary}
              hasReviewedSession={Boolean(reviewedSession)}
              reviewMetrics={reviewMetrics}
              timeframe={reviewedSession?.session.timeframe ?? timeframe}
              onOpenPatternFilters={openPatternFiltersPanel}
              onOpenSettings={() => openSettingsPanel()}
              linkedDecisionLabel={(id) => {
                const linked = id ? reviewDecisionById.get(id) : undefined;
                return linked ? linked.decision.marketState || linked.decision.location || "已关联" : undefined;
              }}
              onBack={() => duplicateTrainingPreview ? returnFromDuplicateTrainingPreview() : setReviewedSession(null)}
              onEvidence={openReviewEvidence}
              formatDate={formatDate}
              money={money}
              percent={percent}
              profitFactorLabel={profitFactorLabel}
              exitReasonLabel={exitReasonLabel}
            />
            <div className="review-columns">
              <div className="review-module-stack">
              <ReviewChartPreview
                key={reviewedSession ? `${reviewedSession.session.id}:${reviewPreviewSnapshot?.snapshotId ?? "loading"}` : "current-training"}
                bars={reviewPreviewBars}
                instrument={reviewPreviewInstrument}
                timeframe={timeframeLabel(reviewPreviewTimeframe)}
                dataIndexOffset={reviewPreviewDataIndexOffset}
                movingAverageSettings={movingAverageSettings}
                initialDrawings={reviewState.drawings}
                tradeMarkers={reviewPreviewTradeMarkers}
                decisionMarkers={reviewPreviewDecisionMarkers}
                corporateActionMarkers={reviewPreviewCorporateActionMarkers}
                onCorporateActionSelect={setSelectedCorporateActionId}
                loading={reviewedSession ? reviewChartLoading : loading}
                error={reviewedSession ? reviewChartError : chartLoadError}
              />
              <article className="decision-history-card">
                <div className="section-label">事前决策记录</div>
                <h2>{reviewState.decisionSubmissions.length ? `${reviewState.decisionSubmissions.length} 份已提交计划` : "还没有正式提交的计划"}</h2>
                {reviewState.decisionSubmissions.length ? (
                  <div className="decision-history-list">
                    {[...reviewState.decisionSubmissions].reverse().map((submission, reverseIndex) => (
                      <div className="decision-history-item" key={submission.id}>
                        <div className="decision-history-head">
                          <div>
                            <strong>计划 {reviewState.decisionSubmissions.length - reverseIndex}{submission.autoGenerated ? " · 自动关联保护价" : submission.backfilled ? " · 补写" : ""}</strong>
                            <span><button type="button" className="evidence-link" onClick={() => openReviewEvidence(submission.barTimestamp, "计划")}>{formatDate(submission.barTimestamp, reviewedSession?.session.timeframe ?? timeframe)}</button> · 参考价 {submission.referencePrice.toFixed(2)}</span>
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
                        <small className="decision-history-linked">{reviewState.positions.filter((position) => position.decisionSubmissionId === submission.id).length
                          ? `已关联 ${reviewState.positions.filter((position) => position.decisionSubmissionId === submission.id).length} 笔交易`
                          : "尚未关联交易"}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">旧训练中的当前决策草稿仍显示在上方，但只有以后点击“提交决策”生成的内容才会冻结为独立记录。</div>
                )}
              </article>
              </div>
              <div className="review-module-stack">
              <SessionHistoryPanel
                items={reviewHistoryItems}
                totalCount={sessionSummaries.length}
                filters={reviewSessionFilters}
                timeframes={timeframes}
                modeOptions={reviewModeOptions}
                auditEvents={reviewAuditEvents}
                emptyText={sessionSummaries.length
                  ? "没有符合当前筛选条件的训练。"
                  : "这里还没有保存记录。点击“保存训练”，或完成一场有结束边界的训练后，才会出现在这里。"}
                onFilterChange={(update) => setReviewSessionFilters((filters) => ({ ...filters, ...update }))}
                onResetFilters={() => setReviewSessionFilters(defaultReviewSessionFilters)}
                emptyActivityCount={emptyReviewSessionSummaries.length}
                batchDeleteRunning={emptySessionCleanupRunning}
                onDeleteEmpty={() => void deleteEmptyTrainingSessions(emptyReviewSessionSummaries)}
                onReview={(id) => {
                  const summary = filteredReviewSessionSummaries.find((item) => item.session.id === id);
                  if (summary) inspectSession(summary.session);
                }}
                onResume={(id) => {
                  const summary = filteredReviewSessionSummaries.find((item) => item.session.id === id);
                  if (summary) resumeSession(summary.session, false, filteredReviewSessionSummaries.map((item) => item.session));
                }}
                onDelete={(id) => {
                  const summary = filteredReviewSessionSummaries.find((item) => item.session.id === id);
                  if (summary) deleteSession(summary.session);
                }}
              />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
