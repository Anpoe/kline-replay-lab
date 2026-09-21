import {
  resolveOrderRawPrice,
  type EngineOrder,
  type ExecutionBar,
} from "./executionEngine.ts";

/**
 * Live observation only receives the next session's opening quote.  Reuse the
 * execution engine's market/limit/stop rules by treating that quote as a
 * one-price bar.  An order created on the same bar is held until a later
 * refresh, matching the replay order lifecycle.
 */
export type LiveOrderPrice = Pick<ExecutionBar, "timestamp" | "open" | "close">;

export type LiveEntryBar = LiveOrderPrice;

export function resolveLivePendingOrderPrice(
  order: Pick<EngineOrder, "action" | "side" | "qty" | "createdAt" | "positionId" | "orderType" | "triggerPrice" | "executeAtTimestamp">,
  price: LiveOrderPrice,
) {
  if (order.createdAt >= price.timestamp) return null;
  return resolveOrderRawPrice(order as EngineOrder, {
    timestamp: price.timestamp,
    open: price.open,
    high: price.open,
    low: price.open,
    close: price.close,
  });
}

/**
 * Find the first complete historical bar after an order was created that
 * satisfies the shared market/limit/stop rules.  Historical refreshes may
 * return bars newest-first, so ordering is normalized before evaluation.
 */
export function findLiveOrderFill(
  order: Parameters<typeof resolveLivePendingOrderPrice>[0],
  bars: LiveEntryBar[],
) {
  const candidates = bars
    .filter((bar) => (
      Number.isFinite(Number(bar.timestamp))
      && Number.isFinite(Number(bar.open))
      && Number.isFinite(Number(bar.close))
      && Number(bar.timestamp) > Number(order.createdAt)
    ))
    .map((bar) => ({
      timestamp: Number(bar.timestamp),
      open: Number(bar.open),
      close: Number(bar.close),
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
  for (const bar of candidates) {
    const fillPrice = resolveLivePendingOrderPrice(order, bar);
    if (fillPrice != null) return { bar, fillPrice };
  }
  return null;
}
