import {
  accountNotional,
  accountPnl,
  type InstrumentEconomics,
} from "./fxTrading.ts";

export type TradingMode = "return" | "capital";

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
