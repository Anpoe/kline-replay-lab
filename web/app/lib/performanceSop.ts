import type { HabitTrade } from "./performance.ts";
import { tradingDate } from "./marketRules.ts";
import { timeframeLabel } from "./timeframeCatalog.ts";

export const MIN_PERSONAL_SOP_SAMPLES = 15;
export const MAX_PERSONAL_SOP_RECOMMENDATIONS = 3;
export const personalSopTemplateScopes: PersonalSopScope[] = [
  { market: "US", timeframe: "1d" },
  { market: "CN", timeframe: "1d" },
  { market: "FX", timeframe: "5m" },
];

export type PersonalSopScope = {
  market: string;
  timeframe: string;
  instrumentId?: string;
};

export type PersonalSopRange = {
  key: string;
  label: string;
  min: number;
  max?: number;
};

export type PersonalSopPlanConditions = {
  minScore?: number;
  requireStop?: boolean;
  requireTarget?: boolean;
  requireNote?: boolean;
  minRiskReward?: number;
};

export type PersonalSopConditions = {
  patterns: string[];
  marketState?: string;
  location?: string;
  reasons: string[];
  plan: PersonalSopPlanConditions;
  priceRange?: PersonalSopRange;
  volumeRange?: PersonalSopRange;
  turnoverRange?: PersonalSopRange;
  marketCapRange?: PersonalSopRange;
};

export type PersonalSopManagement = {
  holdingBarsMin: number;
  holdingBarsMax: number;
};

export type PersonalSopStats = {
  samples: number;
  winningTrades: number;
  losingTrades: number;
  flatTrades: number;
  winRate: number;
  averageResult: number;
  expectancy: number;
  maxDrawdown: number;
  totalResult: number;
  profitFactor: number | null;
};

export type PersonalSopDimensionKey =
  | "market"
  | "timeframe"
  | "instrument"
  | "patterns"
  | "marketState"
  | "location"
  | "reasons"
  | "plan"
  | "price"
  | "volume"
  | "turnover"
  | "marketCap"
  | "holdingBars";

export type PersonalSopDimension = {
  key: PersonalSopDimensionKey;
  label: string;
  mode: "hard" | "observe" | "ignore";
  coverage: number;
  value?: string;
};

export type PersonalSopRule = {
  id: string;
  version: "v1";
  title: string;
  scope: PersonalSopScope;
  conditions: PersonalSopConditions;
  management: PersonalSopManagement;
  stats: PersonalSopStats;
  managedDimensions: PersonalSopDimension[];
  generatedAt: string;
};

export type PersonalSopRecommendation = PersonalSopRule & {
  eligible: boolean;
  adoptable: boolean;
  missingSamples: number;
};

export type PersonalSopScopeSummary = PersonalSopScope & {
  samples: number;
  missingSamples: number;
  eligible: boolean;
};

export type PersonalSopCheckStatus = "pass" | "missing" | "mismatch";

export type PersonalSopCheck = {
  key: PersonalSopDimensionKey | "scope";
  label: string;
  status: PersonalSopCheckStatus;
  message: string;
};

export type PersonalSopEntryInput = {
  rule: PersonalSopRule;
  scope: PersonalSopScope;
  decision?: {
    marketState: string;
    location: string;
    reasons: string[];
    score: number;
    hasStop: boolean;
    hasTarget: boolean;
    hasNote: boolean;
  };
  patterns?: string[];
  instrument?: HabitTrade["instrument"];
  riskReward?: number;
};

export type PersonalSopEntryEvaluation = {
  status: "pass" | "warning" | "blocked";
  blocking: boolean;
  checks: PersonalSopCheck[];
};

export type PersonalSopManagementEvaluation = {
  status: "pass" | "under" | "over";
  overMax: boolean;
  underMin: boolean;
};

export function normalizePersonalSopRule(value: unknown): PersonalSopRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PersonalSopRule>;
  const scope = candidate.scope;
  const stats = candidate.stats;
  const management = candidate.management;
  const conditions = candidate.conditions;
  if (
    candidate.version !== "v1"
    || !text(candidate.id)
    || !text(candidate.title)
    || !scope || typeof scope !== "object"
    || !text(scope.market) || !text(scope.timeframe)
    || !stats || typeof stats !== "object" || Number(stats.samples) < MIN_PERSONAL_SOP_SAMPLES
    || !management || typeof management !== "object"
    || !Number.isFinite(Number(management.holdingBarsMin))
    || !Number.isFinite(Number(management.holdingBarsMax))
    || Number(management.holdingBarsMax) < Number(management.holdingBarsMin)
    || !conditions || typeof conditions !== "object"
    || !Array.isArray(conditions.patterns)
    || !Array.isArray(conditions.reasons)
    || !conditions.plan || typeof conditions.plan !== "object"
  ) return null;
  return {
    ...candidate,
    stats: {
      ...stats,
      expectancy: Number.isFinite(Number(stats.expectancy))
        ? Number(stats.expectancy)
        : Number(stats.averageResult) || 0,
      maxDrawdown: Number.isFinite(Number(stats.maxDrawdown))
        ? Math.max(0, Number(stats.maxDrawdown))
        : 0,
    },
  } as PersonalSopRule;
}

const CONDITION_COVERAGE = 0.8;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function normalizeMarket(value: string | undefined) {
  const normalized = text(value).toUpperCase();
  if (normalized === "US" || normalized === "美股") return "US";
  if (normalized === "CN" || normalized === "A股") return "CN";
  if (normalized === "FX" || normalized === "FOREX" || normalized === "外汇") return "FX";
  if (normalized === "GOLD" || normalized === "METAL" || normalized === "黄金") return "GOLD";
  return normalized;
}

function normalizeScope(scope: PersonalSopScope | undefined, trade?: HabitTrade): PersonalSopScope {
  const source = scope ?? trade?.scope;
  const market = normalizeMarket(source?.market || trade?.instrument?.market) || "UNKNOWN";
  return {
    market,
    timeframe: text(source?.timeframe) || "all",
    ...(text(source?.instrumentId) ? { instrumentId: text(source?.instrumentId) } : {}),
  };
}

function scopeKey(scope: PersonalSopScope) {
  return `${normalizeMarket(scope.market)}|${text(scope.timeframe) || "all"}|${text(scope.instrumentId) || "*"}`;
}

function scopeMatches(actual: PersonalSopScope, expected: PersonalSopScope) {
  return normalizeMarket(actual.market) === normalizeMarket(expected.market)
    && (text(expected.timeframe) === "all" || actual.timeframe === expected.timeframe)
    && (!expected.instrumentId || actual.instrumentId === expected.instrumentId);
}

function scopeLabel(scope: PersonalSopScope) {
  const market = scope.market === "US" ? "美股" : scope.market === "CN" ? "A股" : scope.market === "FX" ? "EURUSD / 外汇" : scope.market;
  return `${market} ${timeframeLabel(scope.timeframe)}${scope.instrumentId ? ` · ${scope.instrumentId}` : ""}`;
}

function marketPrefix(market: string) {
  if (normalizeMarket(market) === "US") return "美股 $";
  if (normalizeMarket(market) === "CN") return "A股 ¥";
  return `${market} `;
}

function numericRange(key: string, label: string, min: number, max?: number): PersonalSopRange {
  return { key, label, min, ...(max == null ? {} : { max }) };
}

function priceBucket(price: number, market: string): PersonalSopRange | undefined {
  if (!Number.isFinite(price) || price <= 0) return undefined;
  const prefix = marketPrefix(market);
  if (price < 5) return numericRange(`${prefix}5 以下`, `${prefix}5 以下`, 0, 5);
  if (price < 10) return numericRange(`${prefix}5–10`, `${prefix}5–10`, 5, 10);
  if (price < 30) return numericRange(`${prefix}10–30`, `${prefix}10–30`, 10, 30);
  if (price < 100) return numericRange(`${prefix}30–100`, `${prefix}30–100`, 30, 100);
  if (price < 300) return numericRange(`${prefix}100–300`, `${prefix}100–300`, 100, 300);
  return numericRange(`${prefix}300 以上`, `${prefix}300 以上`, 300);
}

function volumeBucket(volume: number): PersonalSopRange | undefined {
  if (!Number.isFinite(volume) || volume <= 0) return undefined;
  if (volume < 100000) return numericRange("volume-under-100k", "日均成交量 10 万股以下", 0, 100000);
  if (volume < 500000) return numericRange("volume-100k-500k", "日均成交量 10–50 万股", 100000, 500000);
  if (volume < 2000000) return numericRange("volume-500k-2m", "日均成交量 50–200 万股", 500000, 2000000);
  if (volume < 10000000) return numericRange("volume-2m-10m", "日均成交量 200–1000 万股", 2000000, 10000000);
  return numericRange("volume-over-10m", "日均成交量 1000 万股以上", 10000000);
}

function amountBucket(value: number, market: string, kind: "turnover" | "marketCap"): PersonalSopRange | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const us = normalizeMarket(market) === "US";
  if (kind === "turnover") {
    const unit = us ? "美元" : "元";
    if (value < 1000000) return numericRange(`turnover-under-1m-${unit}`, `日均成交额 100 万${unit}以下`, 0, 1000000);
    if (value < 10000000) return numericRange(`turnover-1m-10m-${unit}`, `日均成交额 100–1000 万${unit}`, 1000000, 10000000);
    if (value < 100000000) return numericRange(`turnover-10m-100m-${unit}`, `日均成交额 1000 万–1 亿${unit}`, 10000000, 100000000);
    if (value < 1000000000) return numericRange(`turnover-100m-1b-${unit}`, `日均成交额 1–10 亿${unit}`, 100000000, 1000000000);
    return numericRange(`turnover-over-1b-${unit}`, `日均成交额 10 亿${unit}以上`, 1000000000);
  }
  if (us) {
    if (value < 2e9) return numericRange("market-cap-under-2b-usd", "美股市值 20 亿美元以下", 0, 2e9);
    if (value < 10e9) return numericRange("market-cap-2b-10b-usd", "美股市值 20–100 亿美元", 2e9, 10e9);
    if (value < 50e9) return numericRange("market-cap-10b-50b-usd", "美股市值 100–500 亿美元", 10e9, 50e9);
    return numericRange("market-cap-over-50b-usd", "美股市值 500 亿美元以上", 50e9);
  }
  if (value < 5e9) return numericRange("market-cap-under-5b-cny", "A股市值 50 亿元以下", 0, 5e9);
  if (value < 20e9) return numericRange("market-cap-5b-20b-cny", "A股市值 50–200 亿元", 5e9, 20e9);
  if (value < 100e9) return numericRange("market-cap-20b-100b-cny", "A股市值 200–1000 亿元", 20e9, 100e9);
  return numericRange("market-cap-over-100b-cny", "A股市值 1000 亿元以上", 100e9);
}

function tradeScope(trade: HabitTrade, fallback?: PersonalSopScope) {
  return normalizeScope(trade.scope ?? fallback, trade);
}

function recommendationScope(trade: HabitTrade, fallback?: PersonalSopScope) {
  const actual = tradeScope(trade, fallback);
  if (!fallback || text(fallback.instrumentId)) return actual;
  return {
    market: normalizeMarket(fallback.market) || actual.market,
    timeframe: text(fallback.timeframe) || actual.timeframe,
  };
}

export function deriveSopInstrumentContext(
  bars: Array<{
    timestamp: number;
    close: number;
    volume?: number | null;
    turnover?: number | null;
  }>,
  cursor: number,
  timezone: string,
  timeframe: string,
  instrument: Pick<NonNullable<HabitTrade["instrument"]>, "market" | "entryPrice"> & { marketCap?: number },
): NonNullable<HabitTrade["instrument"]> {
  const result: NonNullable<HabitTrade["instrument"]> = {
    market: instrument.market,
    entryPrice: instrument.entryPrice,
    ...(Number.isFinite(instrument.marketCap) && Number(instrument.marketCap) > 0
      ? { marketCap: Number(instrument.marketCap) }
      : {}),
  };
  const end = Math.max(0, Math.min(bars.length, Math.trunc(cursor)));
  const sessions = new Map<string, { volume: number; turnover: number }>();
  for (let index = end - 1; index >= 0; index -= 1) {
    const bar = bars[index];
    const session = tradingDate(bar.timestamp, timezone);
    if (!sessions.has(session) && sessions.size >= 20) break;
    const volume = Math.max(0, Number(bar.volume) || 0);
    const turnover = Number.isFinite(Number(bar.turnover))
      ? Math.max(0, Number(bar.turnover))
      : volume * Math.max(0, Number(bar.close) || 0);
    const current = sessions.get(session) ?? { volume: 0, turnover: 0 };
    current.volume += volume;
    current.turnover += turnover;
    sessions.set(session, current);
  }
  if (sessions.size < 5) return result;
  const dailyActivityDivisor = timeframe === "1w" ? 5 : timeframe === "1mo" ? 21 : 1;
  const totals = [...sessions.values()].reduce((sum, session) => ({
    volume: sum.volume + session.volume,
    turnover: sum.turnover + session.turnover,
  }), { volume: 0, turnover: 0 });
  return {
    ...result,
    averageDailyVolume: totals.volume / sessions.size / dailyActivityDivisor,
    averageDailyTurnover: totals.turnover / sessions.size / dailyActivityDivisor,
  };
}

function baseGroupKey(trade: HabitTrade) {
  const decision = trade.decision;
  if (!decision) return "no-decision";
  const patterns = uniqueSorted(trade.patterns).join("/") || "none";
  const reasons = uniqueSorted(decision.reasons).join("/") || "none";
  return [patterns, text(decision.marketState), text(decision.location), reasons].join("|");
}

function modeForCoverage(coverage: number) {
  return coverage >= CONDITION_COVERAGE ? "hard" as const : "observe" as const;
}

function dominant<T>(items: T[], keyOf: (item: T) => string) {
  const counts = new Map<string, { key: string; count: number; item: T }>();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!key) return;
    const current = counts.get(key);
    counts.set(key, current ? { ...current, count: current.count + 1 } : { key, count: 1, item });
  });
  return [...counts.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "zh-CN"))[0];
}

function summarizeStats(trades: HabitTrade[]): PersonalSopStats {
  const results = trades.map((trade) => Number(trade.result)).filter(Number.isFinite);
  const winningTrades = results.filter((result) => result > 0).length;
  const losingTrades = results.filter((result) => result < 0).length;
  const flatTrades = results.length - winningTrades - losingTrades;
  const decisiveTrades = winningTrades + losingTrades;
  const grossProfit = results.filter((result) => result > 0).reduce((sum, result) => sum + result, 0);
  const grossLoss = Math.abs(results.filter((result) => result < 0).reduce((sum, result) => sum + result, 0));
  const totalResult = results.reduce((sum, result) => sum + result, 0);
  const orderedResults = trades
    .map((trade, index) => ({
      result: Number(trade.result),
      index,
      closedTimestamp: Number(trade.closedTimestamp),
    }))
    .filter((item) => Number.isFinite(item.result))
    .sort((left, right) => (
      (Number.isFinite(left.closedTimestamp) ? left.closedTimestamp : Number.POSITIVE_INFINITY)
      - (Number.isFinite(right.closedTimestamp) ? right.closedTimestamp : Number.POSITIVE_INFINITY)
      || left.index - right.index
    ));
  let cumulativeResult = 0;
  let peakResult = 0;
  let maxDrawdown = 0;
  orderedResults.forEach(({ result }) => {
    cumulativeResult += result;
    peakResult = Math.max(peakResult, cumulativeResult);
    maxDrawdown = Math.max(maxDrawdown, peakResult - cumulativeResult);
  });
  return {
    samples: results.length,
    winningTrades,
    losingTrades,
    flatTrades,
    winRate: decisiveTrades ? Math.round(winningTrades / decisiveTrades * 100) : 0,
    averageResult: results.length ? totalResult / results.length : 0,
    expectancy: results.length ? totalResult / results.length : 0,
    maxDrawdown,
    totalResult,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
  };
}

function majorityRange(
  trades: HabitTrade[],
  getValue: (trade: HabitTrade) => PersonalSopRange | undefined,
) {
  const values = trades.map(getValue).filter((value): value is PersonalSopRange => Boolean(value));
  const winner = dominant(values, (value) => value.key);
  if (!winner) return { range: undefined, coverage: 0 };
  return {
    range: winner.item,
    coverage: winner.count / trades.length,
  };
}

function deriveHoldingRange(trades: HabitTrade[]) {
  const values = trades
    .map((trade) => Math.max(1, Math.round(Number(trade.holdingBars) || 1)))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!values.length) return { min: 1, max: 1 };
  return {
    min: values[0],
    max: values.at(-1) ?? values[0],
  };
}

function buildDimensions(
  scope: PersonalSopScope,
  trades: HabitTrade[],
  conditions: PersonalSopConditions,
  management: PersonalSopManagement,
): PersonalSopDimension[] {
  const total = trades.length || 1;
  const decisions = trades.map((trade) => trade.decision).filter(Boolean);
  const rangeCoverage = (getValue: (trade: HabitTrade) => PersonalSopRange | undefined) => trades.filter((trade) => Boolean(getValue(trade))).length / total;
  return [
    { key: "market", label: "市场", mode: "hard", coverage: 1, value: scope.market },
    { key: "timeframe", label: "周期", mode: "hard", coverage: 1, value: scope.timeframe },
    { key: "instrument", label: "品种范围", mode: scope.instrumentId ? "hard" : "ignore", coverage: 1, value: scope.instrumentId ?? "不限制具体品种" },
    { key: "patterns", label: "交易形态", mode: "hard", coverage: 1, value: conditions.patterns.join(" / ") || "未使用形态筛选" },
    { key: "marketState", label: "市场状态", mode: "hard", coverage: decisions.length / total, value: conditions.marketState },
    { key: "location", label: "当前位置", mode: "hard", coverage: decisions.length / total, value: conditions.location },
    { key: "reasons", label: "交易理由", mode: "hard", coverage: decisions.length / total, value: conditions.reasons.join(" + ") || "未填写理由" },
    { key: "price", label: "价格区间", mode: modeForCoverage(rangeCoverage((trade) => trade.instrument ? priceBucket(trade.instrument.entryPrice, trade.instrument.market) : undefined)), coverage: rangeCoverage((trade) => trade.instrument ? priceBucket(trade.instrument.entryPrice, trade.instrument.market) : undefined), value: conditions.priceRange?.label },
    { key: "volume", label: "成交量区间", mode: modeForCoverage(rangeCoverage((trade) => trade.instrument?.averageDailyVolume == null ? undefined : volumeBucket(trade.instrument.averageDailyVolume))), coverage: rangeCoverage((trade) => trade.instrument?.averageDailyVolume == null ? undefined : volumeBucket(trade.instrument.averageDailyVolume)), value: conditions.volumeRange?.label },
    { key: "turnover", label: "成交额区间", mode: modeForCoverage(rangeCoverage((trade) => trade.instrument?.averageDailyTurnover == null ? undefined : amountBucket(trade.instrument.averageDailyTurnover, trade.instrument.market, "turnover"))), coverage: rangeCoverage((trade) => trade.instrument?.averageDailyTurnover == null ? undefined : amountBucket(trade.instrument.averageDailyTurnover, trade.instrument.market, "turnover")), value: conditions.turnoverRange?.label },
    { key: "marketCap", label: "市值区间", mode: modeForCoverage(rangeCoverage((trade) => trade.instrument?.marketCap == null ? undefined : amountBucket(trade.instrument.marketCap, trade.instrument.market, "marketCap"))), coverage: rangeCoverage((trade) => trade.instrument?.marketCap == null ? undefined : amountBucket(trade.instrument.marketCap, trade.instrument.market, "marketCap")), value: conditions.marketCapRange?.label },
    { key: "holdingBars", label: "持仓 K 线", mode: "hard", coverage: 1, value: `${management.holdingBarsMin}–${management.holdingBarsMax} 根` },
  ];
}

function candidateForGroup(scope: PersonalSopScope, trades: HabitTrade[], groupKey: string, generatedAt: string): PersonalSopRecommendation {
  const firstDecision = trades.find((trade) => trade.decision)?.decision;
  const firstPatterns = uniqueSorted(trades.flatMap((trade) => trade.patterns));
  const firstReasons = uniqueSorted(firstDecision?.reasons ?? []);
  const price = majorityRange(trades, (trade) => trade.instrument ? priceBucket(trade.instrument.entryPrice, trade.instrument.market) : undefined);
  const volume = majorityRange(trades, (trade) => trade.instrument?.averageDailyVolume == null ? undefined : volumeBucket(trade.instrument.averageDailyVolume));
  const turnover = majorityRange(trades, (trade) => trade.instrument?.averageDailyTurnover == null ? undefined : amountBucket(trade.instrument.averageDailyTurnover, trade.instrument.market, "turnover"));
  const marketCap = majorityRange(trades, (trade) => trade.instrument?.marketCap == null ? undefined : amountBucket(trade.instrument.marketCap, trade.instrument.market, "marketCap"));
  const holding = deriveHoldingRange(trades);
  const conditions: PersonalSopConditions = {
    patterns: firstPatterns,
    marketState: text(firstDecision?.marketState) || undefined,
    location: text(firstDecision?.location) || undefined,
    reasons: firstReasons,
    plan: {},
    ...(price.range ? { priceRange: price.range } : {}),
    ...(volume.range ? { volumeRange: volume.range } : {}),
    ...(turnover.range ? { turnoverRange: turnover.range } : {}),
    ...(marketCap.range ? { marketCapRange: marketCap.range } : {}),
  };
  const stats = summarizeStats(trades);
  const management = { holdingBarsMin: holding.min, holdingBarsMax: holding.max };
  const id = `personal-sop:${scopeKey(scope)}:${groupKey}`;
  const eligible = stats.samples >= MIN_PERSONAL_SOP_SAMPLES;
  const adoptable = eligible
    && stats.averageResult > 0
    && (stats.profitFactor === Number.POSITIVE_INFINITY || (stats.profitFactor != null && stats.profitFactor > 1));
  return {
    id,
    version: "v1",
    title: `${scopeLabel(scope)} · ${conditions.patterns.join(" / ") || "未使用形态"}`,
    scope,
    conditions,
    management,
    stats,
    managedDimensions: buildDimensions(scope, trades, conditions, management),
    generatedAt,
    eligible,
    adoptable,
    missingSamples: Math.max(0, MIN_PERSONAL_SOP_SAMPLES - stats.samples),
  };
}

export function summarizePersonalSopScopes(
  trades: HabitTrade[],
  scopes: PersonalSopScope[],
): PersonalSopScopeSummary[] {
  return scopes.map((scope) => {
    const samples = trades.filter((trade) => trade.decision && scopeMatches(tradeScope(trade), scope)).length;
    return {
      ...scope,
      samples,
      missingSamples: Math.max(0, MIN_PERSONAL_SOP_SAMPLES - samples),
      eligible: samples >= MIN_PERSONAL_SOP_SAMPLES,
    };
  });
}

export function generatePersonalSopRecommendations(
  trades: HabitTrade[],
  options: {
    scope?: PersonalSopScope;
    generatedAt?: string;
    limit?: number;
  } = {},
): PersonalSopRecommendation[] {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const source = trades
    .filter((trade) => trade.decision)
    .filter((trade) => !options.scope || scopeMatches(tradeScope(trade, options.scope), options.scope));
  const groups = new Map<string, { scope: PersonalSopScope; key: string; trades: HabitTrade[] }>();
  source.forEach((trade) => {
    const scope = recommendationScope(trade, options.scope);
    const key = `${scopeKey(scope)}|${baseGroupKey(trade)}`;
    const group = groups.get(key) ?? { scope, key: baseGroupKey(trade), trades: [] };
    group.trades.push(trade);
    groups.set(key, group);
  });
  return [...groups.values()]
    .map((group) => candidateForGroup(group.scope, group.trades, group.key, generatedAt))
    .sort((left, right) => (
      (Number(right.adoptable) - Number(left.adoptable))
      || (Number(right.eligible) - Number(left.eligible))
      || right.stats.samples - left.stats.samples
      || right.stats.expectancy - left.stats.expectancy
      || left.stats.maxDrawdown - right.stats.maxDrawdown
      || right.stats.averageResult - left.stats.averageResult
      || Number(right.stats.profitFactor === Number.POSITIVE_INFINITY) - Number(left.stats.profitFactor === Number.POSITIVE_INFINITY)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, Math.max(1, options.limit ?? MAX_PERSONAL_SOP_RECOMMENDATIONS));
}

export function recommendationToPersonalSopRule(recommendation: PersonalSopRecommendation): PersonalSopRule {
  const { eligible, adoptable, missingSamples, ...rule } = recommendation;
  void eligible;
  void adoptable;
  void missingSamples;
  return rule;
}

function addCheck(checks: PersonalSopCheck[], key: PersonalSopCheck["key"], label: string, status: PersonalSopCheckStatus, message: string) {
  checks.push({ key, label, status, message });
}

function checkScope(input: PersonalSopEntryInput, checks: PersonalSopCheck[]) {
  const expected = input.rule.scope;
  const actual = input.scope;
  const label = expected.instrumentId ? "市场/周期/品种" : "市场/周期";
  if (normalizeMarket(expected.market) !== normalizeMarket(actual.market)) {
    addCheck(checks, "scope", label, "mismatch", `当前市场 ${actual.market} 不在规则范围 ${expected.market}`);
    return;
  }
  if (text(expected.timeframe) && expected.timeframe !== "all" && expected.timeframe !== actual.timeframe) {
    addCheck(checks, "scope", label, "mismatch", `当前周期 ${timeframeLabel(actual.timeframe)} 不在规则范围 ${timeframeLabel(expected.timeframe)}`);
    return;
  }
  if (expected.instrumentId && expected.instrumentId !== actual.instrumentId) {
    addCheck(checks, "scope", label, "mismatch", `当前品种 ${actual.instrumentId || "未识别"} 不在规则范围 ${expected.instrumentId}`);
    return;
  }
  addCheck(checks, "scope", label, "pass", expected.instrumentId ? "当前训练范围匹配" : "当前市场/周期匹配，品种不限");
}

function checkExact(checks: PersonalSopCheck[], key: PersonalSopDimensionKey, label: string, expected: string | undefined, actual: string | undefined) {
  if (!expected) {
    addCheck(checks, key, label, "missing", "规则没有形成稳定条件");
  } else if (!actual) {
    addCheck(checks, key, label, "missing", "当前决策卡没有填写");
  } else if (expected !== actual) {
    addCheck(checks, key, label, "mismatch", `当前为“${actual}”，规则要求“${expected}”`);
  } else {
    addCheck(checks, key, label, "pass", `匹配“${expected}”`);
  }
}

function checkRange(checks: PersonalSopCheck[], key: PersonalSopDimensionKey, label: string, range: PersonalSopRange | undefined, value: number | undefined, marketLabel: string) {
  if (!range) {
    addCheck(checks, key, label, "missing", "历史资料不足，暂不形成硬区间");
    return;
  }
  if (!Number.isFinite(value)) {
    addCheck(checks, key, label, "missing", `当前${marketLabel}资料不可用，只记录不拦截`);
    return;
  }
  const numeric = Number(value);
  const inRange = numeric >= range.min && (range.max == null || numeric < range.max);
  addCheck(checks, key, label, inRange ? "pass" : "mismatch", inRange ? `匹配${range.label}` : `当前值不在${range.label}`);
}

export function evaluatePersonalSopEntry(input: PersonalSopEntryInput): PersonalSopEntryEvaluation {
  const checks: PersonalSopCheck[] = [];
  checkScope(input, checks);
  const conditions = input.rule.conditions;
  const patterns = uniqueSorted(input.patterns ?? []);
  if (!conditions.patterns.length) {
    addCheck(checks, "patterns", "交易形态", "missing", "规则未要求特定形态");
  } else if (!conditions.patterns.every((pattern) => patterns.includes(pattern))) {
    addCheck(checks, "patterns", "交易形态", "mismatch", `需要包含：${conditions.patterns.join("、")}`);
  } else {
    addCheck(checks, "patterns", "交易形态", "pass", `已命中：${conditions.patterns.join("、")}`);
  }
  checkExact(checks, "marketState", "市场状态", conditions.marketState, input.decision?.marketState);
  checkExact(checks, "location", "当前位置", conditions.location, input.decision?.location);
  const expectedReasons = conditions.reasons;
  const actualReasons = uniqueSorted(input.decision?.reasons ?? []);
  if (!expectedReasons.length) {
    addCheck(checks, "reasons", "交易理由", "missing", "规则未形成稳定理由集合");
  } else if (!expectedReasons.every((reason) => actualReasons.includes(reason))) {
    addCheck(checks, "reasons", "交易理由", "mismatch", `需要包含：${expectedReasons.join("、")}`);
  } else {
    addCheck(checks, "reasons", "交易理由", "pass", `已包含：${expectedReasons.join("、")}`);
  }

  checkRange(checks, "price", "价格区间", conditions.priceRange, input.instrument?.entryPrice, "价格");
  checkRange(checks, "volume", "成交量区间", conditions.volumeRange, input.instrument?.averageDailyVolume, "日均成交量");
  checkRange(checks, "turnover", "成交额区间", conditions.turnoverRange, input.instrument?.averageDailyTurnover, "日均成交额");
  checkRange(checks, "marketCap", "市值区间", conditions.marketCapRange, input.instrument?.marketCap, "市值");

  const blocking = checks.some((check) => check.status === "mismatch");
  const hasWarning = checks.some((check) => check.status === "missing");
  return {
    status: blocking ? "blocked" : hasWarning ? "warning" : "pass",
    blocking,
    checks,
  };
}

export function holdingBarsAtCursor(
  bars: Array<{ timestamp: number }>,
  cursor: number,
  entryTimestamp: number,
) {
  const entryIndex = bars.findIndex((bar) => bar.timestamp === entryTimestamp);
  if (entryIndex < 0 || cursor < entryIndex) return 0;
  return Math.max(1, cursor - entryIndex + 1);
}

export function evaluatePersonalSopManagement(rule: PersonalSopRule, holdingBars: number): PersonalSopManagementEvaluation {
  const age = Math.max(0, Math.round(Number(holdingBars) || 0));
  const overMax = age > rule.management.holdingBarsMax;
  const underMin = age > 0 && age < rule.management.holdingBarsMin;
  return {
    status: overMax ? "over" : underMin ? "under" : "pass",
    overMax,
    underMin,
  };
}
