import type {
  DataMarket,
  MarketDataRefreshNotice,
  MarketDataRefreshReason,
} from "./marketDataContracts.ts";

export function acceptsMarketDataResponse(activeMarket: string, requestMarket: string) {
  return activeMarket === requestMarket;
}

export function createMarketDataRefreshNotice(input: {
  market: DataMarket;
  reason: MarketDataRefreshReason;
  changed?: boolean;
  message?: string;
}): MarketDataRefreshNotice {
  return {
    market: input.market,
    reason: input.reason,
    changed: input.changed ?? true,
    ...(input.message ? { message: input.message } : {}),
  };
}

export function normalizeMarketDataError(error: unknown, fallback = "市场数据操作失败") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
