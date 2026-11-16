export type ChartOrderChoice = { side: "buy" | "sell"; orderType: "limit" | "stop" };
export type ChartProtectionKind = "stop-loss" | "take-profit";

export function chartOrderLabel(choice: ChartOrderChoice) {
  return `${choice.side === "buy" ? "Buy" : "Sell"} ${choice.orderType === "limit" ? "Limit" : "Stop"}`;
}

export function pendingOrderIdsAtPrice(orders: Array<{ id: string; price: number }>, price: number, tolerance: number) {
  return orders.filter(order => Number.isFinite(order.price) && Math.abs(order.price - price) <= Math.abs(tolerance)).map(order => order.id);
}

export function chartOrderChoicesAtPrice(price: number, buyReference: number, sellReference: number): ChartOrderChoice[] {
  if (![price, buyReference, sellReference].every(value => Number.isFinite(value) && value > 0)) return [];
  const buy: ChartOrderChoice[] = price === buyReference ? [] : [{ side: "buy", orderType: price < buyReference ? "limit" : "stop" }];
  const sell: ChartOrderChoice[] = price === sellReference ? [] : [{ side: "sell", orderType: price > sellReference ? "limit" : "stop" }];
  return price > (buyReference + sellReference) / 2 ? [...sell, ...buy] : [...buy, ...sell];
}

export function protectionKindAtPrice(side: "long" | "short", price: number, reference: number): ChartProtectionKind | null {
  if (!Number.isFinite(price) || !Number.isFinite(reference) || price <= 0 || reference <= 0 || price === reference) return null;
  return (side === "long" ? price < reference : price > reference) ? "stop-loss" : "take-profit";
}
