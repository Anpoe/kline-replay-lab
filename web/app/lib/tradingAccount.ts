import {
  accountNotional,
  accountPnl,
  type InstrumentEconomics,
} from "./fxTrading.ts";

export type TradingMode = "return" | "capital";

export type LiveAccountMarket = "CN" | "US";

export type LiveAccountStatus = "active" | "paused" | "ending" | "archived";
export type LiveAccountSwitchState = "legacy" | "pending" | "current" | "failed";

export type LiveMarketAccountSnapshot = {
  id: string;
  market: LiveAccountMarket;
  currency: "CNY" | "USD";
  displayName: string;
  status: LiveAccountStatus;
  tradingMode: TradingMode;
  initialCapital: number;
  riskCapital: number;
  cashBalance: number;
  reservedCash: number;
  reservedMargin: number;
  equity: number;
  availableCash: number;
  version: number;
  payloadVersion: number;
  executionProfileVersion: string | null;
  executionProfile: Record<string, unknown>;
  executionEngineVersion: string;
  executionSwitchState: LiveAccountSwitchState;
  switchedAt: string | null;
  previousAccountVersion: number | null;
  marketRuleVersion: string | null;
  dataContractVersion: string | null;
  legacyPendingOrderCount: number;
  carriedPositionCount: number;
  needsUserAction: boolean;
  lastProcessedTimestamp: number | null;
  lastProcessedRevision: string | null;
  createdAt: string;
  updatedAt: string;
  portfolioInstrumentIds: string[];
};

export function liveAccountIdForMarket(market: LiveAccountMarket) {
  return `live-account-${market}`;
}

export function liveAccountCurrencyForMarket(market: LiveAccountMarket) {
  return market === "CN" ? "CNY" : "USD";
}

function liveAccountNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function liveAccountNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function liveAccountString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function liveAccountRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeLiveMarketAccountSnapshot(value: unknown): LiveMarketAccountSnapshot | null {
  const record = liveAccountRecord(value);
  const market = record.market === "CN" || record.market === "US" ? record.market : null;
  const id = liveAccountString(record.id || record.accountId);
  if (!market || !id) return null;
  const reservedCash = Math.max(0, liveAccountNumber(record.reservedCash));
  const cashBalance = liveAccountNumber(record.cashBalance);
  const status: LiveAccountStatus = record.status === "paused"
    || record.status === "ending"
    || record.status === "archived"
    ? record.status
    : "active";
  const tradingMode: TradingMode = record.tradingMode === "capital" ? "capital" : "return";
  const executionProfile = liveAccountRecord(record.executionProfile);
  const portfolioInstrumentIds = Array.isArray(record.portfolioInstrumentIds)
    ? [...new Set(record.portfolioInstrumentIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].slice(0, 500)
    : [];
  return {
    id,
    market,
    currency: record.currency === "USD" || record.currency === "CNY"
      ? record.currency
      : liveAccountCurrencyForMarket(market),
    displayName: liveAccountString(record.displayName, market === "CN" ? "A 股实时模拟账户" : "美股实时模拟账户"),
    status,
    tradingMode,
    initialCapital: liveAccountNumber(record.initialCapital),
    riskCapital: liveAccountNumber(record.riskCapital),
    cashBalance,
    reservedCash,
    reservedMargin: Math.max(0, liveAccountNumber(record.reservedMargin)),
    equity: liveAccountNumber(record.equity, cashBalance),
    availableCash: liveAccountNumber(record.availableCash, cashBalance - reservedCash),
    version: Math.max(1, Math.trunc(liveAccountNumber(record.version ?? record.accountVersion, 1))),
    payloadVersion: Math.max(1, Math.trunc(liveAccountNumber(record.payloadVersion, 1))),
    executionProfileVersion: liveAccountString(record.executionProfileVersion) || null,
    executionProfile,
    executionEngineVersion: liveAccountString(record.executionEngineVersion, "legacy-next-open-v0"),
    executionSwitchState: record.executionSwitchState === "pending"
      || record.executionSwitchState === "current"
      || record.executionSwitchState === "failed"
      ? record.executionSwitchState
      : "legacy",
    switchedAt: liveAccountString(record.switchedAt) || null,
    previousAccountVersion: liveAccountNullableNumber(record.previousAccountVersion),
    marketRuleVersion: liveAccountString(record.marketRuleVersion) || null,
    dataContractVersion: liveAccountString(record.dataContractVersion) || null,
    legacyPendingOrderCount: Math.max(0, Math.trunc(liveAccountNumber(record.legacyPendingOrderCount))),
    carriedPositionCount: Math.max(0, Math.trunc(liveAccountNumber(record.carriedPositionCount))),
    needsUserAction: record.needsUserAction === true,
    lastProcessedTimestamp: liveAccountNullableNumber(record.lastProcessedTimestamp),
    lastProcessedRevision: liveAccountString(record.lastProcessedRevision) || null,
    createdAt: liveAccountString(record.createdAt, new Date(0).toISOString()),
    updatedAt: liveAccountString(record.updatedAt, new Date(0).toISOString()),
    portfolioInstrumentIds,
  };
}

export function liveAccountHasActivity(account: Pick<LiveMarketAccountSnapshot, "portfolioInstrumentIds" | "status">) {
  return account.status !== "archived" && account.portfolioInstrumentIds.length > 0;
}

export function liveAccountAvailableCash(account: Pick<LiveMarketAccountSnapshot, "cashBalance" | "reservedCash">) {
  return account.cashBalance - account.reservedCash;
}

export type AccountPosition = {
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  status: "open" | "closed";
  exitPrice?: number;
  realizedPnl?: number;
  instrumentEconomics?: InstrumentEconomics;
};

export type CashReservation = {
  action: "open" | "close";
  side: "buy" | "sell";
  reservedCash?: number;
};

export function reservedCash(orders: CashReservation[]) {
  return orders.reduce((sum, order) => (
    order.action === "open" && order.side === "buy"
      ? sum + Math.max(0, Number(order.reservedCash ?? 0))
      : sum
  ), 0);
}

export function availableCash(cashBalance: number, orders: CashReservation[]) {
  return cashBalance - reservedCash(orders);
}

export function executionCashFlow(side: "buy" | "sell", price: number, qty: number) {
  const notional = price * qty;
  return side === "buy" ? -notional : notional;
}

export function positionPnl(position: AccountPosition, currentPrice: number) {
  if (position.status === "closed") return Number(position.realizedPnl ?? 0);
  return accountPnl(
    position.entryPrice,
    currentPrice,
    position.qty,
    position.side,
    position.instrumentEconomics,
  ) ?? 0;
}

function positionEntryNotional(position: AccountPosition) {
  return accountNotional(
    position.entryPrice,
    position.qty,
    position.instrumentEconomics,
  ) ?? 0;
}

export function settleOpenPositionsAtPrice<
  T extends AccountPosition & {
    id: string;
    exitTimestamp?: number;
    exitOrderId?: string;
  },
>(
  positions: T[],
  price: number,
  timestamp: number,
  createExitOrderId: (position: T) => string,
): T[] {
  return positions.map((position) => {
    if (position.status === "closed") return position;
    return {
      ...position,
      status: "closed",
      exitPrice: price,
      exitTimestamp: timestamp,
      exitOrderId: createExitOrderId(position),
      realizedPnl: positionPnl(position, price),
    } as T;
  });
}

export function positionReturnPct(position: AccountPosition, currentPrice: number) {
  const notional = positionEntryNotional(position);
  return notional > 0 ? positionPnl(position, currentPrice) / notional * 100 : 0;
}

export function portfolioReturnPct(positions: AccountPosition[], currentPrice: number) {
  const notional = positions.reduce((sum, position) => sum + positionEntryNotional(position), 0);
  const pnl = positions.reduce((sum, position) => sum + positionPnl(position, currentPrice), 0);
  return notional > 0 ? pnl / notional * 100 : 0;
}

export function accountMarketValue(positions: AccountPosition[], currentPrice: number) {
  return positions
    .filter((position) => position.status === "open")
    .reduce((sum, position) => (
      sum + currentPrice * position.qty * (position.side === "long" ? 1 : -1)
    ), 0);
}

export function accountEquity(cashBalance: number, positions: AccountPosition[], currentPrice: number) {
  return cashBalance + accountMarketValue(positions, currentPrice);
}
