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
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  if (/^(failed to fetch|network request failed|networkerror\b)/i.test(message.trim())) {
    return "网络连接失败，请检查网络或本机数据服务后重试";
  }
  if (message.trim()) return message;
  return fallback;
}
