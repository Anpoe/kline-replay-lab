import { marketRuleCode, marketSelectionLabel, type DataMarket } from "../../lib/dataMarkets.ts";
import {
  DEFAULT_EXECUTION_COST_PROFILE,
  normalizeExecutionCostProfile,
  type ExecutionCostProfile,
  type OrderType,
} from "../../lib/executionEngine.ts";
import {
  DEFAULT_FX_ACCOUNT_CONFIG,
  normalizeFxAccountConfig,
  type FxAccountConfig,
} from "../../lib/fxTrading.ts";
import {
  normalizeBuyQuantity,
  resolveMarketRules,
  type MarketRuleProfile,
} from "../../lib/marketRules.ts";
import {
  DEFAULT_REPLAY_HISTORY_BARS,
  MAX_REPLAY_HISTORY_BARS,
  MIN_REPLAY_HISTORY_BARS,
  normalizeReplayHistoryBars,
} from "../../lib/trainingTasks.ts";
import type { TradingMode } from "../../lib/tradingAccount.ts";
import {
  defaultRequiredPretradeFields,
  pretradePlanFieldOptions,
  type PretradePlanField,
} from "../../lib/tradingDiscipline.ts";

export type { DataMarket } from "../../lib/dataMarkets.ts";

export type PositionSizeMode = "fixed" | "risk-percent";
export type MarketOrderQtySettings = Record<DataMarket, number>;
export type SettingsTab = "basic" | "training" | "discipline" | "data";

export const timeframes: string[] = ["1m", "5m", "1h", "1d", "1w"];

export const DEFAULT_MARKET_ORDER_QTYS: MarketOrderQtySettings = {
  CN: 100,
  US: 1,
  FX: 1,
  GOLD: 1,
};

export const marketOrderQuantityFields: Array<{
  key: DataMarket;
  label: string;
  min: number;
  step: number;
}> = [
  { key: "CN", label: "A股默认数量（股）", min: 1, step: 1 },
  { key: "US", label: "美股默认数量（股）", min: 1, step: 1 },
  { key: "FX", label: "外汇默认手数（手）", min: 0.01, step: 0.01 },
  { key: "GOLD", label: "黄金默认数量", min: 1, step: 1 },
];

export type AppSettings = {
  defaultInstrumentId: string;
  defaultTimeframe: string;
  defaultOrderQty: number;
  defaultOrderQtyByMarket: MarketOrderQtySettings;
  orderType: OrderType;
  positionSizeMode: PositionSizeMode;
  riskPercent: number;
  defaultSpeed: number;
  tradingMode: TradingMode;
  initialCapital: number;
  executionProfile: ExecutionCostProfile;
  fxAccountConfig: FxAccountConfig;
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
  strictModeEnabled: boolean;
  requirePretradePlan: boolean;
  requiredPretradeFields: PretradePlanField[];
  sopCheckEnabled: boolean;
};

export const defaultAppSettings: AppSettings = {
  defaultInstrumentId: "600519.SH",
  defaultTimeframe: "1d",
  defaultOrderQty: 100,
  defaultOrderQtyByMarket: { ...DEFAULT_MARKET_ORDER_QTYS },
  orderType: "market",
  positionSizeMode: "fixed",
  riskPercent: 1,
  defaultSpeed: 1,
  tradingMode: "return",
  initialCapital: 100000,
  executionProfile: { ...DEFAULT_EXECUTION_COST_PROFILE, maxVolumeParticipationPct: 10 },
  fxAccountConfig: { ...DEFAULT_FX_ACCOUNT_CONFIG },
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
  strictModeEnabled: false,
  requirePretradePlan: true,
  requiredPretradeFields: [...defaultRequiredPretradeFields],
  sopCheckEnabled: true,
};

export function marketOrderQtyKey(market: string | undefined, instrumentId = ""): DataMarket | null {
  const normalized = (market ?? "").trim().toUpperCase();
  if (normalized === "CN" || normalized === "A股") return "CN";
  if (normalized === "US" || normalized === "美股") return "US";
  if (normalized === "FX" || normalized === "FOREX" || normalized === "外汇" || /\.FX$/i.test(instrumentId)) return "FX";
  if (normalized === "GOLD" || normalized === "METAL" || normalized === "黄金") return "GOLD";
  return null;
}

export function positiveOrderQty(value: unknown, fallback: number) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : fallback;
}

export function normalizeRequiredPretradeFields(value: unknown): PretradePlanField[] {
  if (!Array.isArray(value)) return [...defaultRequiredPretradeFields];
  const allowed = new Set(pretradePlanFieldOptions.map((field) => field.key));
  return value.filter((field): field is PretradePlanField => (
    typeof field === "string" && allowed.has(field as PretradePlanField)
  )).filter((field, index, fields) => fields.indexOf(field) === index);
}

export function normalizeMarketOrderQtySettings(value: unknown, legacyValue?: unknown): MarketOrderQtySettings {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<DataMarket, unknown>>
    : undefined;
  const legacyQuantity = Number(legacyValue);
  // A missing per-market map comes from the old single default. Keep an
  // explicitly changed legacy value, but do not migrate the old built-in 100
  // shares into FX and gold, where it was never the intended default.
  const legacyFallback = Number.isFinite(legacyQuantity)
    && legacyQuantity > 0
    && legacyQuantity !== defaultAppSettings.defaultOrderQty
    ? legacyQuantity
    : undefined;
  const fallback = (key: DataMarket) => legacyFallback ?? DEFAULT_MARKET_ORDER_QTYS[key];
  return {
    CN: positiveOrderQty(stored?.CN, fallback("CN")),
    US: positiveOrderQty(stored?.US, fallback("US")),
    FX: positiveOrderQty(stored?.FX, fallback("FX")),
    GOLD: positiveOrderQty(stored?.GOLD, fallback("GOLD")),
  };
}

export function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  const merged = { ...defaultAppSettings, ...value };
  const defaultOrderQtyByMarket = normalizeMarketOrderQtySettings(
    value.defaultOrderQtyByMarket,
    value.defaultOrderQty,
  );
  return {
    ...merged,
    defaultInstrumentId: typeof merged.defaultInstrumentId === "string" && merged.defaultInstrumentId
      ? merged.defaultInstrumentId
      : defaultAppSettings.defaultInstrumentId,
    defaultTimeframe: timeframes.includes(merged.defaultTimeframe)
      ? merged.defaultTimeframe
      : defaultAppSettings.defaultTimeframe,
    // Keep the old field as a compatibility alias for older preference data.
    // All new order-entry paths use the market-specific map below.
    defaultOrderQty: defaultOrderQtyByMarket.CN,
    defaultOrderQtyByMarket,
    orderType: ["market", "limit", "stop"].includes(merged.orderType)
      ? merged.orderType
      : defaultAppSettings.orderType,
    positionSizeMode: merged.positionSizeMode === "risk-percent" ? "risk-percent" : "fixed",
    riskPercent: Math.max(0.1, Math.min(100, Number(merged.riskPercent) || defaultAppSettings.riskPercent)),
    tradingMode: merged.tradingMode === "capital" ? "capital" : "return",
    initialCapital: Math.max(1000, Math.round(Number(merged.initialCapital) || defaultAppSettings.initialCapital)),
    executionProfile: normalizeExecutionCostProfile({
      ...defaultAppSettings.executionProfile,
      ...merged.executionProfile,
    }),
    fxAccountConfig: normalizeFxAccountConfig(merged.fxAccountConfig),
    replayHistoryBars: normalizeReplayHistoryBars(merged.replayHistoryBars),
    defaultSpeed: [0.5, 1, 2, 5].includes(Number(merged.defaultSpeed))
      ? Number(merged.defaultSpeed)
      : defaultAppSettings.defaultSpeed,
    randomInstrumentMode: ["current", "all", "market"].includes(merged.randomInstrumentMode)
      ? merged.randomInstrumentMode
      : defaultAppSettings.randomInstrumentMode,
    randomMarket: marketSelectionLabel(merged.randomMarket) || defaultAppSettings.randomMarket,
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
    strictModeEnabled: merged.strictModeEnabled === true,
    requirePretradePlan: merged.requirePretradePlan !== false,
    requiredPretradeFields: normalizeRequiredPretradeFields(value.requiredPretradeFields),
    sopCheckEnabled: merged.sopCheckEnabled !== false,
  };
}

export function configuredDefaultOrderQuantity(
  settings: AppSettings,
  market: string | undefined,
  instrumentId: string,
  rules: MarketRuleProfile,
) {
  const key = marketOrderQtyKey(market, instrumentId);
  const requested = key ? settings.defaultOrderQtyByMarket[key] : settings.defaultOrderQty;
  return normalizeBuyQuantity(
    rules,
    positiveOrderQty(requested, rules.defaultOrderQuantity ?? settings.defaultOrderQty),
  );
}

export function configuredDefaultOrderQuantityForRequest(
  settings: AppSettings,
  market: string | undefined,
  instrumentId: string,
) {
  const key = marketOrderQtyKey(market, instrumentId);
  const rules = resolveMarketRules(
    key ?? marketRuleCode(market ?? ""),
    instrumentId,
    settings.fxAccountConfig,
  );
  return configuredDefaultOrderQuantity(settings, market, instrumentId, rules);
}

export {
  MAX_REPLAY_HISTORY_BARS,
  MIN_REPLAY_HISTORY_BARS,
  normalizeReplayHistoryBars,
};
