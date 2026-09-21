import type {
  LiveScanMarket,
  LiveScanResult,
  LiveScanSort,
} from "./liveScanContracts.ts";

export function calculateDailyChangePct(close: unknown, previousClose: unknown) {
  const current = Number(close);
  const previous = Number(previousClose);
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(previous) || previous <= 0) return null;
  return (current / previous - 1) * 100;
}

export function normalizeLiveScanLimit(value: unknown) {
  const limit = Number(value);
  if (value === 0 || value === "0") return 0;
  return Number.isFinite(limit) ? Math.min(500, Math.max(50, Math.round(limit))) : 100;
}

export function selectLiveNavigatorIndex(
  results: readonly Pick<LiveScanResult, "instrumentId">[],
  instrumentId: string | undefined,
  fallbackIndex: number,
) {
  if (!results.length) return 0;
  const byIdentity = instrumentId ? results.findIndex((result) => result.instrumentId === instrumentId) : -1;
  if (byIdentity >= 0) return byIdentity;
  return Math.min(results.length - 1, Math.max(0, Math.round(fallbackIndex)));
}

export function buildLiveScanRequest(input: {
  market: LiveScanMarket;
  presetIds: string[];
  presets: unknown[];
  minPrice: string;
  maxPrice: string;
  minVolume: string;
  minChangePct: string;
  maxChangePct: string;
  excludeLimitUp?: boolean;
  sort: LiveScanSort;
  limit: number;
}) {
  return {
    market: input.market,
    presetIds: input.presetIds,
    presets: input.presets,
    filters: {
      ...(input.minPrice ? { minPrice: Number(input.minPrice) } : {}),
      ...(input.maxPrice ? { maxPrice: Number(input.maxPrice) } : {}),
      ...(input.minVolume ? { minAverageVolume: Number(input.minVolume) } : {}),
      ...(input.minChangePct ? { minChangePct: Number(input.minChangePct) } : {}),
      ...(input.maxChangePct ? { maxChangePct: Number(input.maxChangePct) } : {}),
      ...(input.market === "CN" && input.excludeLimitUp ? { excludeLimitUp: true } : {}),
    },
    sort: input.sort,
    limit: normalizeLiveScanLimit(input.limit),
  };
}

export function normalizeLiveScanError(error: unknown, fallback = "实盘筛选失败") {
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
