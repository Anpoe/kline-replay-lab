import type { KLineData } from "klinecharts";
import { timeframeBucketKey, type SupportedTimeframe } from "./timeframeAggregation";

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
