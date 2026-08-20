import type {
  LiveScanMarket,
  LiveScanResult,
  LiveScanSort,
} from "./liveScanContracts.ts";

export function normalizeLiveScanLimit(value: unknown) {
  const limit = Number(value);
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
    },
    sort: input.sort,
    limit: normalizeLiveScanLimit(input.limit),
  };
}

export function normalizeLiveScanError(error: unknown, fallback = "实盘筛选失败") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
