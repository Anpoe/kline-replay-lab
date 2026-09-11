import {
  createGoldInstrumentEconomics,
  createFxInstrumentEconomics,
  type FxAccountConfig,
  type InstrumentEconomics,
} from "./fxTrading.ts";

export type MarketRuleProfile = {
  id: string;
  version: string;
  name: string;
  market: string;
  tradingEnabled: boolean;
  allowShort: boolean;
  boardLot: number;
  minimumBuyQuantity?: number;
  buyQuantityStep?: number;
  ipoNoLimitTradingDays?: number;
  tPlusOne: boolean;
  priceLimitRatio: number | null;
  priceTick: number;
  limitFillPolicy: "allow" | "conservative";
  quantityUnit?: "share" | "unit" | "lot";
  defaultOrderQuantity?: number;
  instrumentEconomics?: InstrumentEconomics;
};

export type RuleValidation = {
  ok: boolean;
  code?: string;
  message?: string;
};

export type PriceBand = {
  referenceClose: number;
  lower: number;
  upper: number;
  ratio: number;
};

export const CN_A_MAINBOARD_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "cn-a-mainboard-cash",
  version: "2026.07-v1",
  name: "A股主板现货",
  market: "CN",
  tradingEnabled: true,
  allowShort: false,
  boardLot: 100,
  minimumBuyQuantity: 100,
  buyQuantityStep: 100,
  ipoNoLimitTradingDays: 5,
  tPlusOne: true,
  priceLimitRatio: 0.1,
  priceTick: 0.01,
  limitFillPolicy: "conservative",
});

export const GENERIC_CASH_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "generic-cash",
  version: "2026.07-v1",
  name: "通用现货（基础）",
  market: "GENERIC",
  tradingEnabled: true,
  allowShort: true,
  boardLot: 1,
  minimumBuyQuantity: 1,
  buyQuantityStep: 1,
  ipoNoLimitTradingDays: 0,
  tPlusOne: false,
  priceLimitRatio: null,
  priceTick: 0.01,
  limitFillPolicy: "allow",
});

export const FX_SPOT_RULES_V2: MarketRuleProfile = Object.freeze({
  id: "fx-spot-margin",
  version: "2026.08-v2",
  name: "外汇保证金（Bid/Ask）",
  market: "FX",
  tradingEnabled: true,
  allowShort: true,
  boardLot: 0.01,
  minimumBuyQuantity: 0.01,
  buyQuantityStep: 0.01,
  ipoNoLimitTradingDays: 0,
  tPlusOne: false,
  priceLimitRatio: null,
  priceTick: 0.00001,
  limitFillPolicy: "allow",
  quantityUnit: "lot",
  defaultOrderQuantity: 1,
});

export const GOLD_SPOT_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "gold-spot-margin",
  version: "2026.08-v1",
  name: "黄金现货保证金（Bid/Ask）",
  market: "GOLD",
  tradingEnabled: true,
  allowShort: true,
  boardLot: 0.01,
  minimumBuyQuantity: 0.01,
  buyQuantityStep: 0.01,
  ipoNoLimitTradingDays: 0,
  tPlusOne: false,
  priceLimitRatio: null,
  priceTick: 0.01,
  limitFillPolicy: "allow",
  quantityUnit: "lot",
  defaultOrderQuantity: 1,
  instrumentEconomics: createGoldInstrumentEconomics(),
});

export const CN_UNSUPPORTED_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "cn-a-board-unsupported",
  version: "2026.07-v1",
  name: "A股其他板块（待实现）",
  market: "CN",
  tradingEnabled: false,
  allowShort: false,
  boardLot: 100,
  minimumBuyQuantity: 100,
  buyQuantityStep: 100,
  ipoNoLimitTradingDays: 0,
  tPlusOne: true,
  priceLimitRatio: null,
  priceTick: 0.01,
  limitFillPolicy: "conservative",
});

const MAINBOARD_SYMBOL = /^(?:60[0135]\d{3}\.SH|00[0123]\d{3}\.SZ)$/;
const STAR_MARKET_SYMBOL = /^(?:688|689)\d{3}\.SH$/;
const CHINEXT_SYMBOL = /^(?:300|301)\d{3}\.SZ$/;
const BEIJING_SYMBOL = /^[489]\d{5}\.BJ$/;

export const CN_STAR_MARKET_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "cn-a-star-market-cash",
  version: "2026.07-v1",
  name: "科创板现货",
  market: "CN",
  tradingEnabled: true,
  allowShort: false,
  boardLot: 200,
  minimumBuyQuantity: 200,
  buyQuantityStep: 1,
  ipoNoLimitTradingDays: 5,
  tPlusOne: true,
  priceLimitRatio: 0.2,
  priceTick: 0.01,
  limitFillPolicy: "conservative",
});

export const CN_CHINEXT_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "cn-a-chinext-cash",
  version: "2026.07-v1",
  name: "创业板现货",
  market: "CN",
  tradingEnabled: true,
  allowShort: false,
  boardLot: 100,
  minimumBuyQuantity: 100,
  buyQuantityStep: 100,
  ipoNoLimitTradingDays: 5,
  tPlusOne: true,
  priceLimitRatio: 0.2,
  priceTick: 0.01,
  limitFillPolicy: "conservative",
});

export const CN_BEIJING_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "cn-a-beijing-cash",
  version: "2026.07-v1",
  name: "北交所现货",
  market: "CN",
  tradingEnabled: true,
  allowShort: false,
  boardLot: 100,
  minimumBuyQuantity: 100,
  buyQuantityStep: 1,
  ipoNoLimitTradingDays: 1,
  tPlusOne: true,
  priceLimitRatio: 0.3,
  priceTick: 0.01,
  limitFillPolicy: "conservative",
});

export function resolveMarketRules(
  market: string,
  instrumentId: string,
  fxAccountConfig?: Partial<FxAccountConfig> | null,
): MarketRuleProfile {
  const normalizedMarket = market.trim().toUpperCase();
  if (normalizedMarket === "CN") {
    if (MAINBOARD_SYMBOL.test(instrumentId)) return CN_A_MAINBOARD_RULES_V1;
    if (STAR_MARKET_SYMBOL.test(instrumentId)) return CN_STAR_MARKET_RULES_V1;
    if (CHINEXT_SYMBOL.test(instrumentId)) return CN_CHINEXT_RULES_V1;
    if (BEIJING_SYMBOL.test(instrumentId)) return CN_BEIJING_RULES_V1;
    return CN_UNSUPPORTED_RULES_V1;
  }
  if (normalizedMarket === "FX" || /\.FX$/i.test(instrumentId)) {
    return {
      ...FX_SPOT_RULES_V2,
      priceTick: /JPY(?:\.FX)?$/i.test(instrumentId) ? 0.001 : 0.00001,
      instrumentEconomics: createFxInstrumentEconomics(instrumentId, fxAccountConfig),
    };
  }
  if (normalizedMarket === "GOLD" || /\.GOLD$/i.test(instrumentId)) {
    return {
      ...GOLD_SPOT_RULES_V1,
      instrumentEconomics: createGoldInstrumentEconomics(fxAccountConfig),
    };
  }
  return { ...GENERIC_CASH_RULES_V1, market };
}

export function minimumBuyQuantity(rules: MarketRuleProfile) {
  return rules.minimumBuyQuantity ?? rules.boardLot;
}

export function buyQuantityStep(rules: MarketRuleProfile) {
  return rules.buyQuantityStep ?? rules.boardLot;
}

export function normalizeBuyQuantity(rules: MarketRuleProfile, requested: number) {
  const minimum = minimumBuyQuantity(rules);
  const step = buyQuantityStep(rules);
  const safeRequested = Number.isFinite(requested) ? Math.max(minimum, requested) : minimum;
  const precision = Math.max(0, String(step).split(".")[1]?.length ?? 0);
  return Number((Math.ceil((safeRequested - 1e-12) / step) * step).toFixed(precision));
}

export function describeBuyQuantity(rules: MarketRuleProfile) {
  const minimum = minimumBuyQuantity(rules);
  const step = buyQuantityStep(rules);
  const unit = rules.quantityUnit === "lot" ? "手" : rules.market === "FX" ? "单位" : "股";
  return minimum === step
    ? `买入 ${minimum} ${unit}整数倍`
    : `买入至少 ${minimum} ${unit}，之后按 ${step} ${unit}递增`;
}

export function validateOpenOrder(
  rules: MarketRuleProfile,
  side: "buy" | "sell",
  quantity: number,
): RuleValidation {
  if (!rules.tradingEnabled) {
    return { ok: false, code: "market_rule_not_implemented", message: `${rules.name}暂未开放模拟交易` };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, code: "invalid_quantity", message: "委托数量必须大于 0" };
  }
  if (side === "sell" && !rules.allowShort) {
    return { ok: false, code: "short_not_allowed", message: `${rules.name}默认禁止卖出开仓` };
  }
  const minimum = minimumBuyQuantity(rules);
  const step = buyQuantityStep(rules);
  const unit = rules.quantityUnit === "lot" ? "手" : rules.market === "FX" ? "单位" : "股";
  const quantityRuleApplies = side === "buy" || rules.quantityUnit === "lot";
  if (quantityRuleApplies && quantity < minimum) {
    return {
      ok: false,
      code: "minimum_quantity_required",
      message: `下单数量不得少于 ${minimum} ${unit}`,
    };
  }
  const alignedSteps = quantity / step;
  if (quantityRuleApplies && Math.abs(alignedSteps - Math.round(alignedSteps)) > 1e-8) {
    return {
      ok: false,
      code: "board_lot_required",
      message: `下单数量必须以 ${step} ${unit}为增量`,
    };
  }
  return { ok: true };
}

// Snapshot analysis can visit hundreds of thousands of candles. Intl formatters
// own substantial native memory, so reuse them instead of allocating per bar.
const tradingDateFormatters = new Map<string, Intl.DateTimeFormat>();

export function tradingDate(timestamp: number, timezone: string) {
  let formatter = tradingDateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // Bound the cache even when legacy snapshot metadata supplies many zones.
    if (tradingDateFormatters.size >= 32) tradingDateFormatters.clear();
    tradingDateFormatters.set(timezone, formatter);
  }
  return formatter.format(new Date(timestamp));
}

export function findNextTradingSessionIndex(
  bars: Array<{ timestamp: number }>,
  cursor: number,
  timezone: string,
) {
  const current = bars[cursor];
  if (!current) return -1;
  const currentSession = tradingDate(current.timestamp, timezone);
  return bars.findIndex((bar, index) => (
    index > cursor && tradingDate(bar.timestamp, timezone) !== currentSession
  ));
}

export function validateCloseOrder(
  rules: MarketRuleProfile,
  position: { side: "long" | "short"; entryTimestamp: number; qty: number },
  submittedAt: number,
  timezone: string,
): RuleValidation {
  if (!rules.tradingEnabled) {
    return { ok: false, code: "market_rule_not_implemented", message: `${rules.name}暂未开放模拟交易` };
  }
  if (
    rules.tPlusOne
    && position.side === "long"
    && tradingDate(position.entryTimestamp, timezone) === tradingDate(submittedAt, timezone)
  ) {
    return { ok: false, code: "t_plus_one_locked", message: "A股当日买入的股票，下一交易日才可卖出" };
  }
  return { ok: true };
}

function tickPrecision(tick: number) {
  const text = String(tick);
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

function roundToTick(value: number, tick: number) {
  return Number((Math.round((value + Number.EPSILON) / tick) * tick).toFixed(tickPrecision(tick)));
}

export function createPriceBand(
  rules: MarketRuleProfile,
  referenceClose: number,
  listedTradingDay?: number,
): PriceBand | null {
  if (
    listedTradingDay != null
    && listedTradingDay <= (rules.ipoNoLimitTradingDays ?? 0)
  ) return null;
  if (rules.priceLimitRatio == null || !Number.isFinite(referenceClose) || referenceClose <= 0) return null;
  return {
    referenceClose,
    lower: roundToTick(referenceClose * (1 - rules.priceLimitRatio), rules.priceTick),
    upper: roundToTick(referenceClose * (1 + rules.priceLimitRatio), rules.priceTick),
    ratio: rules.priceLimitRatio,
  };
}

export function validateMarketFill(
  rules: MarketRuleProfile,
  side: "buy" | "sell",
  price: number,
  priceBand: PriceBand | null,
): RuleValidation {
  if (!priceBand) return { ok: true };
  const tolerance = rules.priceTick / 10;
  if (price > priceBand.upper + tolerance || price < priceBand.lower - tolerance) {
    return {
      ok: false,
      code: "bar_outside_price_limit",
      message: `K线开盘价 ${price.toFixed(2)} 超出涨跌停范围 ${priceBand.lower.toFixed(2)}–${priceBand.upper.toFixed(2)}`,
    };
  }
  if (rules.limitFillPolicy === "conservative" && side === "buy" && price >= priceBand.upper - tolerance) {
    return { ok: false, code: "limit_up_buy_blocked", message: "涨停开盘按保守模式视为买不到" };
  }
  if (rules.limitFillPolicy === "conservative" && side === "sell" && price <= priceBand.lower + tolerance) {
    return { ok: false, code: "limit_down_sell_blocked", message: "跌停开盘按保守模式视为卖不出" };
  }
  return { ok: true };
}
