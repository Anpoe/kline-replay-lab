export type QuoteBasis = "mid" | "bid";
export type SettlementMode = "cash" | "margin";

export type FxAccountConfig = {
  accountCurrency: string;
  leverage: number;
  stopOutLevelPct: number;
  /** One quote-currency unit expressed in the account currency. Used only for a third-currency account. */
  manualQuoteToAccountRate: number;
};

export type InstrumentEconomics = {
  settlementMode: SettlementMode;
  quoteBasis: QuoteBasis;
  quantityUnit: "unit" | "share" | "lot";
  contractSize: number;
  pipSize?: number;
  pointSize?: number;
  baseCurrency?: string;
  quoteCurrency?: string;
  accountCurrency?: string;
  leverage?: number;
  stopOutLevelPct?: number;
  manualQuoteToAccountRate?: number;
};

export type MarginPosition = {
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  status: "open" | "closed";
  marginUsed?: number;
  instrumentEconomics?: InstrumentEconomics;
};

export type MarginAccountSnapshot = {
  balance: number;
  equity: number;
  floatingPnl: number;
  usedMargin: number;
  reservedMargin: number;
  availableMargin: number;
  marginLevelPct: number | null;
  stopOutLevelPct: number;
  liquidationRequired: boolean;
  accountCurrency: string;
};

export const DEFAULT_FX_ACCOUNT_CONFIG: FxAccountConfig = Object.freeze({
  accountCurrency: "USD",
  leverage: 100,
  stopOutLevelPct: 50,
  manualQuoteToAccountRate: 0,
});

function positive(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function normalizeCurrency(value: unknown, fallback = "USD") {
  const currency = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}

export function normalizeFxAccountConfig(value?: Partial<FxAccountConfig> | null): FxAccountConfig {
  return {
    accountCurrency: normalizeCurrency(value?.accountCurrency, DEFAULT_FX_ACCOUNT_CONFIG.accountCurrency),
    leverage: positive(value?.leverage, DEFAULT_FX_ACCOUNT_CONFIG.leverage, 1, 2_000),
    stopOutLevelPct: positive(value?.stopOutLevelPct, DEFAULT_FX_ACCOUNT_CONFIG.stopOutLevelPct, 1, 1_000),
    manualQuoteToAccountRate: positive(
      value?.manualQuoteToAccountRate,
      DEFAULT_FX_ACCOUNT_CONFIG.manualQuoteToAccountRate,
      0,
      1_000_000,
    ),
  };
}

export function parseFxInstrumentCurrencies(instrumentId: string) {
  const normalized = String(instrumentId).toUpperCase().replace(/\.FX$/, "").replace(/[^A-Z]/g, "");
  if (normalized.length !== 6) return null;
  return { baseCurrency: normalized.slice(0, 3), quoteCurrency: normalized.slice(3, 6) };
}

export function createFxInstrumentEconomics(
  instrumentId: string,
  accountConfig?: Partial<FxAccountConfig> | null,
): InstrumentEconomics {
  const currencies = parseFxInstrumentCurrencies(instrumentId);
  const config = normalizeFxAccountConfig(accountConfig);
  const jpyQuote = currencies?.quoteCurrency === "JPY";
  return {
    settlementMode: "margin",
    quoteBasis: "bid",
    quantityUnit: "lot",
    contractSize: 100_000,
    pipSize: jpyQuote ? 0.01 : 0.0001,
    pointSize: jpyQuote ? 0.001 : 0.00001,
    baseCurrency: currencies?.baseCurrency,
    quoteCurrency: currencies?.quoteCurrency,
    accountCurrency: config.accountCurrency,
    leverage: config.leverage,
    stopOutLevelPct: config.stopOutLevelPct,
    manualQuoteToAccountRate: config.manualQuoteToAccountRate,
  };
}

export function createGoldInstrumentEconomics(
  accountConfig?: Partial<FxAccountConfig> | null,
): InstrumentEconomics {
  const config = normalizeFxAccountConfig(accountConfig);
  return {
    settlementMode: "margin",
    quoteBasis: "bid",
    quantityUnit: "lot",
    contractSize: 100,
    pipSize: 0.01,
    pointSize: 0.01,
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    accountCurrency: config.accountCurrency,
    leverage: config.leverage,
    stopOutLevelPct: config.stopOutLevelPct,
    manualQuoteToAccountRate: config.manualQuoteToAccountRate,
  };
}

export function isMarginEconomics(value?: InstrumentEconomics | null) {
  return value?.settlementMode === "margin";
}

export function quoteToAccountRate(
  economics: InstrumentEconomics | undefined,
  quotePrice: number,
): number | null {
  if (!economics || economics.settlementMode === "cash") return 1;
  const price = Number(quotePrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const account = normalizeCurrency(economics.accountCurrency, "USD");
  const base = normalizeCurrency(economics.baseCurrency, "");
  const quote = normalizeCurrency(economics.quoteCurrency, "");
  if (account && account === quote) return 1;
  if (account && account === base) return 1 / price;
  const manual = Number(economics.manualQuoteToAccountRate);
  return Number.isFinite(manual) && manual > 0 ? manual : null;
}

export function accountNotional(
  quotePrice: number,
  quantity: number,
  economics?: InstrumentEconomics,
) {
  const price = Number(quotePrice);
  const qty = Number(quantity);
  const contractSize = Math.max(0, Number(economics?.contractSize ?? 1));
  const conversion = quoteToAccountRate(economics, price);
  if (![price, qty, contractSize].every(Number.isFinite) || price <= 0 || qty < 0 || conversion == null) return null;
  return price * qty * contractSize * conversion;
}

export function accountPnl(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  side: "long" | "short",
  economics?: InstrumentEconomics,
) {
  const conversion = quoteToAccountRate(economics, exitPrice);
  if (conversion == null) return null;
  const direction = side === "long" ? 1 : -1;
  const contractSize = Math.max(0, Number(economics?.contractSize ?? 1));
  return (exitPrice - entryPrice) * quantity * contractSize * conversion * direction;
}

export function requiredMargin(
  quotePrice: number,
  quantity: number,
  economics?: InstrumentEconomics,
) {
  if (!isMarginEconomics(economics)) return 0;
  const notional = accountNotional(quotePrice, quantity, economics);
  const leverage = Number(economics?.leverage);
  if (notional == null || !Number.isFinite(leverage) || leverage <= 0) return null;
  return notional / leverage;
}

export function pipValueInAccount(
  quotePrice: number,
  quantity: number,
  economics?: InstrumentEconomics,
) {
  const conversion = quoteToAccountRate(economics, quotePrice);
  if (conversion == null) return null;
  const pipSize = Math.max(0, Number(economics?.pipSize ?? 0));
  const contractSize = Math.max(0, Number(economics?.contractSize ?? 1));
  return pipSize * quantity * contractSize * conversion;
}

export function pointValueInAccount(
  quotePrice: number,
  quantity: number,
  economics?: InstrumentEconomics,
) {
  const conversion = quoteToAccountRate(economics, quotePrice);
  if (conversion == null) return null;
  const pointSize = Math.max(0, Number(economics?.pointSize ?? 0));
  const contractSize = Math.max(0, Number(economics?.contractSize ?? 1));
  return pointSize * quantity * contractSize * conversion;
}

export function sourceQuotePrice(
  side: "buy" | "sell",
  sourcePrice: number,
  spreadBps: number,
  economics?: InstrumentEconomics,
) {
  const spread = Math.max(0, Number(spreadBps) || 0) / 10_000;
  if (economics?.quoteBasis === "bid") return side === "buy" ? sourcePrice * (1 + spread) : sourcePrice;
  const direction = side === "buy" ? 1 : -1;
  return sourcePrice * (1 + direction * spread / 2);
}

export function quoteSourcePrice(
  side: "buy" | "sell",
  quotePrice: number,
  spreadBps: number,
  economics?: InstrumentEconomics,
) {
  const spread = Math.max(0, Number(spreadBps) || 0) / 10_000;
  if (economics?.quoteBasis === "bid") return side === "buy" ? quotePrice / (1 + spread) : quotePrice;
  const direction = side === "buy" ? 1 : -1;
  return quotePrice / (1 + direction * spread / 2);
}

export function markToMarketPnl(
  position: MarginPosition,
  sourcePrice: number,
  spreadBps: number,
) {
  if (position.status === "closed") return 0;
  const side = position.side === "long" ? "sell" : "buy";
  const quotePrice = sourceQuotePrice(side, sourcePrice, spreadBps, position.instrumentEconomics);
  return accountPnl(
    position.entryPrice,
    quotePrice,
    position.qty,
    position.side,
    position.instrumentEconomics,
  ) ?? 0;
}

export function usedMargin(positions: MarginPosition[]) {
  return positions
    .filter((position) => position.status === "open")
    .reduce((sum, position) => sum + Math.max(0, Number(position.marginUsed ?? 0)), 0);
}

export function marginAccountSnapshot(input: {
  balance: number;
  positions: MarginPosition[];
  sourcePrice: number;
  spreadBps: number;
  reservedMargin?: number;
  economics: InstrumentEconomics;
}): MarginAccountSnapshot {
  const floatingPnl = input.positions.reduce(
    (sum, position) => sum + markToMarketPnl(position, input.sourcePrice, input.spreadBps),
    0,
  );
  const margin = usedMargin(input.positions);
  const reserved = Math.max(0, Number(input.reservedMargin ?? 0));
  const equity = input.balance + floatingPnl;
  const level = margin > 0 ? equity / margin * 100 : null;
  const stopOutLevelPct = Math.max(1, Number(input.economics.stopOutLevelPct ?? 50));
  return {
    balance: input.balance,
    equity,
    floatingPnl,
    usedMargin: margin,
    reservedMargin: reserved,
    availableMargin: equity - margin - reserved,
    marginLevelPct: level,
    stopOutLevelPct,
    liquidationRequired: level != null && level <= stopOutLevelPct,
    accountCurrency: normalizeCurrency(input.economics.accountCurrency, "USD"),
  };
}
