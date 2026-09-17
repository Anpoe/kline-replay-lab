import type { KLineData } from "klinecharts";
import { timeframeBucketKey, type SupportedTimeframe } from "./timeframeAggregation.ts";

export type CorporateActionEvent = {
  id: string;
  instrumentId: string;
  date: string;
  timestamp: number;
  category: number;
  label: string;
  description: string;
  cashPer10: number;
  bonusSharesPer10: number;
  rightsSharesPer10: number;
  rightsPrice: number;
  shareRatio?: number | null;
};

export type CorporateActionMarker = CorporateActionEvent & {
  price: number;
  barTimestamp: number;
};

export type CorporateActionHolding = {
  id: string;
  side: "long" | "short";
  qty: number;
  status: "open" | "closed";
  entryTimestamp: number;
};

export type CashDividendCredit = {
  eventId: string;
  instrumentId: string;
  date: string;
  cashPer10: number;
  quantity: number;
  amount: number;
};

export const CASH_DIVIDEND_INCOME_EVENT_TYPE = "cash_dividend_income_credited" as const;

/**
 * Cash dividends are credited against the lots held before the ex-date.  A
 * lot opened on the ex-date is intentionally excluded, even when its bar is
 * processed at the same timestamp as the corporate-action event.
 */
export function cashDividendCreditsForBar(
  events: CorporateActionEvent[],
  holdings: CorporateActionHolding[],
  barTimestamp: number,
  creditedEventIds: ReadonlySet<string> = new Set<string>(),
): CashDividendCredit[] {
  if (!Number.isFinite(barTimestamp)) return [];
  const eligibleQuantityByEvent = (event: CorporateActionEvent) => holdings
    .filter((holding) => (
      holding.status === "open"
      && holding.side === "long"
      && Number.isFinite(holding.qty)
      && holding.qty > 0
      && Number.isFinite(holding.entryTimestamp)
      && holding.entryTimestamp < event.timestamp
    ))
    .reduce((sum, holding) => sum + holding.qty, 0);

  return events.flatMap((event) => {
    if (
      event.category !== 1
      || creditedEventIds.has(event.id)
      || !Number.isFinite(event.timestamp)
      || event.timestamp > barTimestamp
      || !Number.isFinite(event.cashPer10)
      || event.cashPer10 <= 0
    ) return [];
    const quantity = eligibleQuantityByEvent(event);
    const amount = Number((quantity * event.cashPer10 / 10).toFixed(6));
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(amount) || amount <= 0) return [];
    return [{
      eventId: event.id,
      instrumentId: event.instrumentId,
      date: event.date,
      cashPer10: event.cashPer10,
      quantity,
      amount,
    }];
  });
}

export function cashDividendIncomeFromEvents(
  events: ReadonlyArray<{ type?: unknown; payload?: Record<string, unknown> }>,
) {
  const total = events.reduce((sum, event) => {
    if (event.type !== CASH_DIVIDEND_INCOME_EVENT_TYPE) return sum;
    const amount = Number(event.payload?.amount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
  return Number(total.toFixed(6));
}

export function corporateActionMarkersForBars(
  events: CorporateActionEvent[],
  bars: KLineData[],
  timeframe: string,
  timezone: string,
  cutoffTimestamp: number | null,
  hidden = false,
): CorporateActionMarker[] {
  if (hidden || !bars.length) return [];
  const cutoff = cutoffTimestamp ?? bars.at(-1)?.timestamp ?? Number.POSITIVE_INFINITY;
  return events.flatMap((event) => {
    if (!Number.isFinite(event.timestamp) || event.timestamp > cutoff) return [];
    const bar = timeframe === "1d"
      ? bars.find((candidate) => candidate.timestamp >= event.timestamp)
      : bars.find((candidate) => timeframeBucketKey(candidate.timestamp, timeframe as SupportedTimeframe, timezone)
        === timeframeBucketKey(event.timestamp, timeframe as SupportedTimeframe, timezone));
    if (!bar || bar.timestamp > cutoff) return [];
    return [{ ...event, price: Number(bar.low ?? bar.close), barTimestamp: bar.timestamp }];
  });
}
