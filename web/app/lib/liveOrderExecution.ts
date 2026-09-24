import {
  resolveOrderRawPrice,
  type EngineOrder,
  type ExecutionBar,
} from "./executionEngine.ts";

export type LiveOrderPrice = Pick<ExecutionBar, "timestamp" | "open" | "high" | "low" | "close" | "volume"> & {
  turnover?: number | null;
  closed?: boolean;
  source?: string;
  qualityFlags?: string[];
  revision?: string | null;
};

export type LiveEntryBar = LiveOrderPrice;

export function resolveLivePendingOrderPrice(
  order: Pick<EngineOrder, "action" | "side" | "qty" | "createdAt" | "positionId" | "orderType" | "triggerPrice" | "executeAtTimestamp">,
  price: LiveOrderPrice,
) {
  if (order.createdAt >= price.timestamp) return null;
  const high = Number.isFinite(Number(price.high)) ? price.high : Math.max(price.open, price.close);
  const low = Number.isFinite(Number(price.low)) ? price.low : Math.min(price.open, price.close);
  return resolveOrderRawPrice(order as EngineOrder, {
    timestamp: price.timestamp,
    open: price.open,
    high,
    low,
    close: price.close,
    volume: price.volume,
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
      && Number(bar.open) > 0
      && bar.closed !== false
      && Number(bar.timestamp) > Number(order.createdAt)
    ))
    .map((bar) => ({
      timestamp: Number(bar.timestamp),
      open: Number(bar.open),
      high: Number.isFinite(Number(bar.high))
        ? Number(bar.high)
        : Math.max(Number(bar.open), Number(bar.close)),
      low: Number.isFinite(Number(bar.low))
        ? Number(bar.low)
        : Math.min(Number(bar.open), Number(bar.close)),
      close: Number(bar.close),
      volume: bar.volume == null ? null : Number(bar.volume),
      ...(bar.turnover == null ? {} : { turnover: Number(bar.turnover) }),
      ...(bar.closed === undefined ? {} : { closed: bar.closed }),
      ...(bar.source ? { source: bar.source } : {}),
      ...(bar.qualityFlags ? { qualityFlags: [...bar.qualityFlags] } : {}),
      ...(bar.revision ? { revision: bar.revision } : {}),
    }))
    .filter((bar) => (
      bar.low > 0
      && bar.high >= Math.max(bar.open, bar.close)
      && bar.low <= Math.min(bar.open, bar.close)
    ))
    .sort((left, right) => left.timestamp - right.timestamp);
  for (const bar of candidates) {
    const fillPrice = resolveLivePendingOrderPrice(order, bar);
    if (fillPrice != null) return { bar, fillPrice };
  }
  return null;
}
