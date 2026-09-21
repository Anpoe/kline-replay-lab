/**
 * 公共 FX 数据契约。
 *
 * 时间语义：所有归一化后的 timestamp 都是 UTC epoch milliseconds，且表示
 * K 线的开盘时刻（不是收盘时刻）。5m 桶以 Unix epoch 为锚点对齐；因此
 * `Math.floor(timestamp / 300000) * 300000` 是唯一的 5m 桶规则，不受本地
 * 时区或夏令时影响。
 *
 * 外汇周末策略：正常周末闭市不计为缺口；如果供应商真的返回周末报价，
 * 是否保留由任务层的策略决定，契约不会把周末时间戳偷偷改成工作日。
 * 首版交易日切分记录为 America/New_York 的 17:00，日线/周线聚合必须
 * 使用同一配置，不能让来源各自采用默认切分。
 *
 * 兼容现有 `marketDataProviders.ts`：`FxNormalizedCandle` 保留现有
 * `NormalizedCandle` 的必需 OHLCV/turnover 字段形状，FX 专属的
 * `volumeType` 采用可选扩展字段；来源、品种和周期放在 `FxCandleRecord`
 * 或任务/覆盖元数据中，而不是改变现有 Candle 表示。
 */

import {
  bucketStartTimestamp,
  DEFAULT_FX_SESSION,
  nextBucketStartTimestamp,
} from "./fx/dukascopyAggregation.ts";
import type { TimeframeId } from "./timeframeCatalog.ts";

export const FX_BASE_TIMEFRAME = "5m" as const;
export const FX_BASE_TIMEFRAME_MS = 5 * 60 * 1000;

export type FxBaseTimeframe = typeof FX_BASE_TIMEFRAME;
export type FxTimeframe = TimeframeId;
export type FxHigherTimeframe = Exclude<FxTimeframe, "1m" | "5m">;

export const FX_TIMEFRAME_MS: Readonly<Record<Exclude<FxTimeframe, "1mo">, number>> = Object.freeze({
  "1m": 60 * 1000,
  "5m": FX_BASE_TIMEFRAME_MS,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
});

/** 逻辑数据集中的可追溯来源；不得用 canonical 别名覆盖真实来源。 */
export type FxDataSource = "dukascopy" | "manual-csv";
export type FxHistoricalSource = Extract<FxDataSource, "dukascopy" | "manual-csv">;
export type FxIncrementSource = Extract<FxDataSource, "dukascopy">;

export type FxVolumeType = "none" | "tick";
export type FxTimestampUnit = "ms" | "s";
export type FxTimestampInput = number | string | Date;
export type FxNumberInput = number | string;

export type FxInstrumentId =
  | "EURUSD.FX"
  | "GBPUSD.FX"
  | "USDJPY.FX"
  | "AUDUSD.FX"
  | "USDCAD.FX"
  | "USDCHF.FX";

export type GoldInstrumentId = "XAUUSD.GOLD";
export type MarketInstrumentId = FxInstrumentId | GoldInstrumentId;

export type FxInstrumentDefinition = Readonly<{
  id: FxInstrumentId;
  market: "FX";
  displayName: string;
  baseCurrency: string;
  quoteCurrency: string;
  /** Dukascopy 的无分隔符品种代码。 */
  dukascopySymbol: string;
  /** 报价价格应保留的小数位数，不等于标准 pip 位数。 */
  pricePrecision: number;
  /** 标准 pip 大小；JPY 交叉盘与非 JPY 交叉盘不同。 */
  pipSize: number;
}>;

export type GoldInstrumentDefinition = Readonly<{
  id: GoldInstrumentId;
  market: "GOLD";
  displayName: string;
  baseCurrency: "XAU";
  quoteCurrency: "USD";
  /** Dukascopy 的无分隔符品种代码。 */
  dukascopySymbol: "XAUUSD";
  /** 黄金现货报价精度；成交规则不在本阶段由该字段推导。 */
  pricePrecision: number;
  pipSize: number;
}>;

export type MarketInstrumentDefinition = FxInstrumentDefinition | GoldInstrumentDefinition;

export const FX_INSTRUMENT_CATALOG: readonly FxInstrumentDefinition[] = Object.freeze([
  {
    id: "EURUSD.FX",
    market: "FX",
    displayName: "EUR/USD",
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    dukascopySymbol: "EURUSD",
    pricePrecision: 5,
    pipSize: 0.0001,
  },
  {
    id: "GBPUSD.FX",
    market: "FX",
    displayName: "GBP/USD",
    baseCurrency: "GBP",
    quoteCurrency: "USD",
    dukascopySymbol: "GBPUSD",
    pricePrecision: 5,
    pipSize: 0.0001,
  },
  {
    id: "USDJPY.FX",
    market: "FX",
    displayName: "USD/JPY",
    baseCurrency: "USD",
    quoteCurrency: "JPY",
    dukascopySymbol: "USDJPY",
    pricePrecision: 3,
    pipSize: 0.01,
  },
  {
    id: "AUDUSD.FX",
    market: "FX",
    displayName: "AUD/USD",
    baseCurrency: "AUD",
    quoteCurrency: "USD",
    dukascopySymbol: "AUDUSD",
    pricePrecision: 5,
    pipSize: 0.0001,
  },
  {
    id: "USDCAD.FX",
    market: "FX",
    displayName: "USD/CAD",
    baseCurrency: "USD",
    quoteCurrency: "CAD",
    dukascopySymbol: "USDCAD",
    pricePrecision: 5,
    pipSize: 0.0001,
  },
  {
    id: "USDCHF.FX",
    market: "FX",
    displayName: "USD/CHF",
    baseCurrency: "USD",
    quoteCurrency: "CHF",
    dukascopySymbol: "USDCHF",
    pricePrecision: 5,
    pipSize: 0.0001,
  },
] satisfies readonly FxInstrumentDefinition[]);

export const GOLD_INSTRUMENT_CATALOG: readonly GoldInstrumentDefinition[] = Object.freeze([
  {
    id: "XAUUSD.GOLD",
    market: "GOLD",
    displayName: "XAU/USD",
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    dukascopySymbol: "XAUUSD",
    pricePrecision: 2,
    pipSize: 0.01,
  },
]);

export const MARKET_INSTRUMENT_CATALOG: readonly MarketInstrumentDefinition[] = Object.freeze([
  ...FX_INSTRUMENT_CATALOG,
  ...GOLD_INSTRUMENT_CATALOG,
]);

/** 兼容不同页面/供应商的品种选择器，返回项目内部 ID。 */
export function normalizeFxInstrument(value: unknown): FxInstrumentId | null {
  if (typeof value !== "string") return null;

  const compact = value.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const withoutFxSuffix = compact.endsWith("FX") ? compact.slice(0, -2) : compact;
  if (withoutFxSuffix.length !== 6) return null;

  const candidate = `${withoutFxSuffix}.FX`;
  return FX_INSTRUMENT_CATALOG.some((instrument) => instrument.id === candidate)
    ? candidate as FxInstrumentId
    : null;
}

/** 显式 ID 别名，便于调用方表达“我要规范化内部 ID”。 */
export const normalizeFxInstrumentId = normalizeFxInstrument;

export function getFxInstrumentDefinition(value: unknown): FxInstrumentDefinition | null {
  const id = normalizeFxInstrument(value);
  return id ? FX_INSTRUMENT_CATALOG.find((instrument) => instrument.id === id) ?? null : null;
}

/** 便于 provider 适配器按用户输入解析目录项。 */
export const resolveFxInstrument = getFxInstrumentDefinition;

/** 兼容数据维护入口的跨市场品种解析；FX resolver 仍保持 FX-only。 */
export function normalizeMarketInstrument(value: unknown): MarketInstrumentId | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const withoutGoldSuffix = compact.endsWith("GOLD") ? compact.slice(0, -4) : compact;
  if (compact === "GOLD" || withoutGoldSuffix === "XAUUSD") return "XAUUSD.GOLD";
  return normalizeFxInstrument(value);
}

export function getMarketInstrumentDefinition(value: unknown): MarketInstrumentDefinition | null {
  const id = normalizeMarketInstrument(value);
  return id ? MARKET_INSTRUMENT_CATALOG.find((instrument) => instrument.id === id) ?? null : null;
}

export const resolveMarketInstrument = getMarketInstrumentDefinition;

export type FxRawCandle = Readonly<{
  timestamp: FxTimestampInput;
  open: FxNumberInput;
  high: FxNumberInput;
  low: FxNumberInput;
  close: FxNumberInput;
  volume?: FxNumberInput | null;
  /** 原始数据已知来源时填写；也可以由任务上下文补充。 */
  source?: FxDataSource;
  vendorSymbol?: string;
  timeframe?: FxTimeframe;
  volumeType?: FxVolumeType;
}>;

/**
 * 与现有 NormalizedCandle 结构兼容的 FX K 线。
 * volume 为 null 时 volumeType 必须省略或为 none；数值 volume 默认按 tick volume 处理。
 */
export type FxNormalizedCandle = Readonly<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: null;
  volumeType?: FxVolumeType;
}>;

export type FxCandleRecord = FxNormalizedCandle & Readonly<{
  instrumentId: FxInstrumentId;
  timeframe: FxTimeframe;
  source: FxDataSource;
}>;

export type FxCandleNormalizationOptions = Readonly<{
  timestampUnit?: FxTimestampUnit;
  pricePrecision?: number;
  /** 只有调用方明确要求时才舍入，默认保留供应商原始数值。 */
  roundPrices?: boolean;
  require5mAlignment?: boolean;
}>;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 把秒、毫秒、ISO 字符串或 Date 统一为 UTC epoch milliseconds。 */
export function normalizeFxTimestamp(
  value: FxTimestampInput,
  unit: FxTimestampUnit = "ms",
): number | null {
  let timestamp: number;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === "string" && Number.isNaN(Number(value.trim()))) {
    timestamp = Date.parse(value);
  } else {
    const number = finiteNumber(value);
    if (number === null) return null;
    timestamp = unit === "s" ? number * 1000 : number;
  }

  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
}

export function isFxOhlcValid(candle: Pick<FxNormalizedCandle, "open" | "high" | "low" | "close">): boolean {
  const values = [candle.open, candle.high, candle.low, candle.close];
  if (values.some((value) => !Number.isFinite(value))) return false;
  return candle.low <= Math.min(candle.open, candle.close)
    && candle.high >= Math.max(candle.open, candle.close);
}

export function roundFxPrice(value: number, precision: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(precision) || precision < 0 || precision > 15) {
    throw new RangeError("FX price or precision is invalid");
  }
  return Number(value.toFixed(precision));
}

export function isFxPriceAtPrecision(value: number, precision: number): boolean {
  if (!Number.isFinite(value) || !Number.isInteger(precision) || precision < 0 || precision > 15) return false;
  const rounded = roundFxPrice(value, precision);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(rounded)) * 8;
  return Math.abs(value - rounded) <= tolerance;
}

export function normalizeFxCandle(
  raw: FxRawCandle,
  options: FxCandleNormalizationOptions = {},
): FxNormalizedCandle | null {
  const timestamp = normalizeFxTimestamp(raw.timestamp, options.timestampUnit ?? "ms");
  let open = finiteNumber(raw.open);
  let high = finiteNumber(raw.high);
  let low = finiteNumber(raw.low);
  let close = finiteNumber(raw.close);
  if (timestamp === null || open === null || high === null || low === null || close === null) return null;

  if (options.roundPrices && options.pricePrecision !== undefined) {
    open = roundFxPrice(open, options.pricePrecision);
    high = roundFxPrice(high, options.pricePrecision);
    low = roundFxPrice(low, options.pricePrecision);
    close = roundFxPrice(close, options.pricePrecision);
  }

  const volume = raw.volume == null || (typeof raw.volume === "string" && raw.volume.trim() === "")
    ? null
    : finiteNumber(raw.volume);
  if (volume !== null && volume < 0) return null;

  const candle: FxNormalizedCandle = {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    turnover: null,
    volumeType: volume === null ? "none" : raw.volumeType ?? "tick",
  };

  if (!isFxOhlcValid(candle)) return null;
  if (options.require5mAlignment && !isFx5mAligned(timestamp)) return null;
  return candle;
}

export function getFx5mBucket(timestamp: number): number {
  if (!Number.isFinite(timestamp)) throw new RangeError("FX timestamp is invalid");
  return Math.floor(timestamp / FX_BASE_TIMEFRAME_MS) * FX_BASE_TIMEFRAME_MS;
}

export function isFx5mAligned(timestamp: number): boolean {
  return Number.isFinite(timestamp) && timestamp % FX_BASE_TIMEFRAME_MS === 0;
}

export function isFxTimeframeAligned(timestamp: number, timeframe: FxTimeframe): boolean {
  if (!Number.isFinite(timestamp)) return false;
  const duration = timeframe === "1mo" ? undefined : FX_TIMEFRAME_MS[timeframe];
  const sessionCalendarTimeframe = timeframe === "1d" || timeframe === "1w" || timeframe === "1mo";
  return duration != null && !sessionCalendarTimeframe
    ? timestamp % duration === 0
    : timestamp === bucketStartTimestamp(timestamp, timeframe, DEFAULT_FX_SESSION);
}

export function getFxCandleEndTimestamp(timestamp: number, timeframe: FxTimeframe): number {
  if (!Number.isFinite(timestamp)) throw new RangeError("FX timestamp is invalid");
  const duration = timeframe === "1mo" ? undefined : FX_TIMEFRAME_MS[timeframe];
  const sessionCalendarTimeframe = timeframe === "1d" || timeframe === "1w" || timeframe === "1mo";
  return duration != null && !sessionCalendarTimeframe
    ? timestamp + duration
    : nextBucketStartTimestamp(timestamp, timeframe, DEFAULT_FX_SESSION);
}

/** 将任意时间向后对齐到不早于它的 FX 周期起点。 */
export function alignFxTimestampUp(timestamp: number, timeframe: FxTimeframe = FX_BASE_TIMEFRAME): number {
  if (!Number.isFinite(timestamp)) throw new RangeError("FX timestamp is invalid");
  const duration = timeframe === "1mo" ? undefined : FX_TIMEFRAME_MS[timeframe];
  const sessionCalendarTimeframe = timeframe === "1d" || timeframe === "1w" || timeframe === "1mo";
  if (duration != null && !sessionCalendarTimeframe) return Math.ceil(timestamp / duration) * duration;
  const bucket = bucketStartTimestamp(timestamp, timeframe, DEFAULT_FX_SESSION);
  return bucket >= timestamp ? bucket : nextBucketStartTimestamp(bucket, timeframe, DEFAULT_FX_SESSION);
}

export function isFxCandleComplete(
  candleOrTimestamp: number | Pick<FxNormalizedCandle, "timestamp">,
  timeframe: FxTimeframe,
  asOfTimestamp: number,
): boolean {
  const timestamp = typeof candleOrTimestamp === "number"
    ? candleOrTimestamp
    : candleOrTimestamp.timestamp;
  if (!Number.isFinite(timestamp) || !Number.isFinite(asOfTimestamp)) return false;
  return asOfTimestamp >= getFxCandleEndTimestamp(timestamp, timeframe);
}

/** 同一判定的语义别名，供增量过滤器使用。 */
export const isFxCandleClosed = isFxCandleComplete;

/**
 * 将归一化的 M1（或更细粒度）K 线聚合成 5m 基准。
 * 不补造缺失桶；输入中的缺口会由质量扫描报告，而不是用上一根价格填充。
 */
export function aggregateFx5mCandles(candles: readonly FxNormalizedCandle[]): FxNormalizedCandle[] {
  const sorted = candles
    .map((candle, index) => ({ candle, index }))
    .filter(({ candle }) => Number.isFinite(candle.timestamp) && isFxOhlcValid(candle))
    .sort((left, right) => left.candle.timestamp - right.candle.timestamp || left.index - right.index);

  const grouped = new Map<number, FxNormalizedCandle[]>();
  for (const { candle } of sorted) {
    const bucket = getFx5mBucket(candle.timestamp);
    const group = grouped.get(bucket);
    if (group) group.push(candle);
    else grouped.set(bucket, [candle]);
  }

  return [...grouped.entries()].map(([timestamp, group]) => {
    const first = group[0];
    const last = group[group.length - 1];
    const hasVolume = group.some((candle) => candle.volume !== null && Number.isFinite(candle.volume));
    const volume = hasVolume
      ? group.reduce((sum, candle) => sum + (candle.volume ?? 0), 0)
      : null;
    return {
      timestamp,
      open: first.open,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      close: last.close,
      volume,
      turnover: null,
      volumeType: volume === null ? "none" : "tick",
    };
  });
}

export const aggregateToFx5m = aggregateFx5mCandles;

export type FxWeekendStrategy = "ignore-normal-closure" | "preserve-quoted-bars";

export type FxTradingCalendar = Readonly<{
  /** IANA 时区，仅用于交易日切分和展示；K 线 timestamp 仍永远是 UTC。 */
  timezone: string;
  /** 外汇交易日 rollover 的本地时间。 */
  rolloverLocalTime: `${number}:${number}`;
  /** ISO weekday：1=周一，7=周日。 */
  tradingWeekdays: readonly number[];
  weekendStrategy: FxWeekendStrategy;
}>;

export const DEFAULT_FX_TRADING_CALENDAR: FxTradingCalendar = Object.freeze({
  timezone: "America/New_York",
  rolloverLocalTime: "17:00",
  tradingWeekdays: Object.freeze([1, 2, 3, 4, 5]),
  weekendStrategy: "ignore-normal-closure",
});

export type FxQualityIssueCode =
  | "invalid-ohlc"
  | "duplicate-timestamp"
  | "out-of-order"
  | "unaligned-timestamp"
  | "price-precision"
  | "gap"
  | "weekend"
  | "incomplete";

export type FxQualityIssue = Readonly<{
  code: FxQualityIssueCode;
  timestamp?: number;
  endTimestamp?: number;
  message?: string;
}>;

/** 外汇质量报告；first/last timestamp 均为 UTC 毫秒。 */
export type FxQualityReport = Readonly<{
  instrumentId?: FxInstrumentId;
  timeframe: FxTimeframe;
  source: FxDataSource;
  received: number;
  accepted: number;
  invalid: number;
  duplicates: number;
  outOfOrder: number;
  alignmentErrors: number;
  precisionViolations: number;
  gapCount: number;
  weekendBars: number;
  incompleteBars: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
  issues: readonly FxQualityIssue[];
}>;

export type FxHistoryBoundary = Readonly<{
  instrumentId: FxInstrumentId;
  timeframe: FxBaseTimeframe;
  /** Dukascopy/manual CSV 历史段中最后一根已完成 K 线，边界本身包含在历史段。 */
  lastCompleteTimestamp: number;
  /** 跨来源增量的排他起点，等于 lastCompleteTimestamp + 5m。 */
  nextStartTimestamp: number;
  source: FxHistoricalSource;
  establishedAt: number;
}>;

export type FxHistoryBoundaryOptions = Readonly<{
  instrumentId: FxInstrumentId;
  timeframe?: FxBaseTimeframe;
  source: FxHistoricalSource;
  /** 计算时刻；传入它才能保持函数纯粹且排除尚未收盘的尾部 K 线。 */
  asOfTimestamp: number;
  establishedAt: number;
}>;

export function findLatestCompleteFxTimestamp(
  candles: readonly Pick<FxNormalizedCandle, "timestamp">[],
  timeframe: FxTimeframe,
  asOfTimestamp: number,
): number | null {
  const complete = candles
    .map((candle) => candle.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp)
      && isFxTimeframeAligned(timestamp, timeframe)
      && isFxCandleComplete(timestamp, timeframe, asOfTimestamp));
  return complete.length === 0 ? null : Math.max(...complete);
}

export function calculateFxHistoryBoundary(
  candles: readonly FxNormalizedCandle[],
  options: FxHistoryBoundaryOptions,
): FxHistoryBoundary | null {
  const timeframe = options.timeframe ?? FX_BASE_TIMEFRAME;
  const lastCompleteTimestamp = findLatestCompleteFxTimestamp(candles, timeframe, options.asOfTimestamp);
  if (lastCompleteTimestamp === null) return null;

  return {
    instrumentId: options.instrumentId,
    timeframe,
    lastCompleteTimestamp,
    nextStartTimestamp: getFxCandleEndTimestamp(lastCompleteTimestamp, timeframe),
    source: options.source,
    establishedAt: options.establishedAt,
  };
}

export type FxIncrementCursor = string | Readonly<Record<string, string | number | boolean | null>>;

export type FxIncrementCheckpoint = Readonly<{
  instrumentId: FxInstrumentId;
  timeframe: "1m";
  source: FxIncrementSource;
  /** Dukascopy 已成功写入的最后一根完整 M1 K 线，包含该时间戳。 */
  lastCompleteTimestamp: number | null;
  /** API 查询起点，排他且必须 1m 对齐；可由 lastCompleteTimestamp 推导。 */
  nextStartTimestamp: number | null;
  cursor: FxIncrementCursor | null;
  lastSuccessfulAt: number | null;
  updatedAt: number;
  lastError?: string | null;
}>;

/**
 * 计算 Dukascopy 下一次请求的排他起点。
 * historyBoundary 是历史段的包含边界；checkpoint 只能把起点向后推进，
 * 不能让增量请求回写边界之前的历史。
 */
export function calculateFxIncrementStart(
  historyBoundary: FxHistoryBoundary | null,
  checkpoint: FxIncrementCheckpoint | null,
): number | null {
  const starts: number[] = [];
  if (historyBoundary) starts.push(alignFxTimestampUp(historyBoundary.nextStartTimestamp, "1m"));
  if (checkpoint?.lastCompleteTimestamp !== null && checkpoint?.lastCompleteTimestamp !== undefined) {
    starts.push(getFxCandleEndTimestamp(checkpoint.lastCompleteTimestamp, "1m"));
  }
  if (checkpoint?.nextStartTimestamp !== null && checkpoint?.nextStartTimestamp !== undefined) {
    starts.push(alignFxTimestampUp(checkpoint.nextStartTimestamp, "1m"));
  }
  return starts.length === 0 ? null : Math.max(...starts);
}

export type FxDatasetLineage = Readonly<{
  /** 行级/分区级真实来源；不要写成 fx-canonical，否则无法审计跨来源切换。 */
  source: FxDataSource;
  /** Dukascopy 历史段与增量段共用的边界元数据。 */
  historyBoundary: FxHistoryBoundary | null;
}>;

export type FxTaskKind = "historical-initialization" | "incremental-update";
export type FxTaskStage = "queued" | "download" | "parse" | "aggregate" | "validate" | "persist" | "snapshot";
export type FxTaskState = "queued" | "running" | "paused" | "retrying" | "completed" | "failed" | "cancelled";

export type FxTaskProgress = Readonly<{
  taskId: string;
  kind: FxTaskKind;
  state: FxTaskState;
  stage: FxTaskStage;
  instrumentId: FxInstrumentId;
  source: FxDataSource;
  timeframe: FxTimeframe;
  /** 0 到 100；只表示当前任务总体进度，不代表行情覆盖率。 */
  percent: number;
  processed: number;
  total: number | null;
  unit: "bytes" | "rows" | "candles";
  startedAt: number | null;
  updatedAt: number;
  message?: string;
  error?: string | null;
}>;
