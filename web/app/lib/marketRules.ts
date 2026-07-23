export type MarketRuleProfile = {
  id: string;
  version: string;
  name: string;
  market: string;
  tradingEnabled: boolean;
  allowShort: boolean;
  boardLot: number;
  tPlusOne: boolean;
  priceLimitRatio: number | null;
  priceTick: number;
  limitFillPolicy: "allow" | "conservative";
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
  tPlusOne: false,
  priceLimitRatio: null,
  priceTick: 0.01,
  limitFillPolicy: "allow",
});

export const CN_UNSUPPORTED_RULES_V1: MarketRuleProfile = Object.freeze({
  id: "cn-a-board-unsupported",
  version: "2026.07-v1",
  name: "A股其他板块（待实现）",
  market: "CN",
  tradingEnabled: false,
  allowShort: false,
  boardLot: 100,
  tPlusOne: true,
  priceLimitRatio: null,
  priceTick: 0.01,
  limitFillPolicy: "conservative",
});

const MAINBOARD_SYMBOL = /^(?:60[0135]\d{3}\.SH|00[0123]\d{3}\.SZ)$/;

export function resolveMarketRules(market: string, instrumentId: string): MarketRuleProfile {
  if (market === "CN") {
    return MAINBOARD_SYMBOL.test(instrumentId) ? CN_A_MAINBOARD_RULES_V1 : CN_UNSUPPORTED_RULES_V1;
  }
  return { ...GENERIC_CASH_RULES_V1, market };
}

export function validateOpenOrder(
  rules: MarketRuleProfile,
  side: "buy" | "sell",
  quantity: number,
): RuleValidation {
  if (!rules.tradingEnabled) {
    return { ok: false, code: "market_rule_not_implemented", message: `${rules.name}暂未开放模拟交易` };
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, code: "invalid_quantity", message: "委托数量必须是正整数" };
  }
  if (side === "sell" && !rules.allowShort) {
    return { ok: false, code: "short_not_allowed", message: `${rules.name}默认禁止卖出开仓` };
  }
  if (side === "buy" && quantity % rules.boardLot !== 0) {
    return {
      ok: false,
      code: "board_lot_required",
      message: `买入数量必须是 ${rules.boardLot} 股的整数倍`,
    };
  }
  return { ok: true };
}

export function tradingDate(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
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

export function createPriceBand(rules: MarketRuleProfile, referenceClose: number): PriceBand | null {
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
