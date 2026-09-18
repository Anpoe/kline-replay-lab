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
