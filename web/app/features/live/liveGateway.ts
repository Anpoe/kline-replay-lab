import type { LiveScanMarket, LiveScanResponse } from "./liveScanContracts.ts";

export type LiveGatewayFetchInit = {
  cache?: "no-store";
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type LiveGatewayResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

export type LiveGatewayFetch = (
  input: string,
  init?: LiveGatewayFetchInit,
) => Promise<LiveGatewayResponse>;

export type LiveStatePayload = {
  portfolios?: unknown;
  watchlist?: unknown;
};

export type LiveStateDelta = {
  portfolioUpserts: unknown[];
  portfolioDeletes: unknown[];
  watchlistUpserts: unknown[];
  watchlistDeletes: unknown[];
};

export type LiveStateSaveResult = {
  portfolioSkipped?: number;
  watchSkipped?: number;
};

export type LivePriceRefreshPayload = {
  prices?: Array<{
    instrumentId: string;
    timestamp: number;
    open: number;
    close: number;
    previousClose?: number;
    realtime?: boolean;
    dailyBarClosed?: boolean;
    quoteTimestamp?: number;
    volume?: number | null;
    turnover?: number | null;
    entryBars?: Array<{
      timestamp: number;
      open: number;
      close: number;
    }>;
  }>;
};

function withSignal(
  init: LiveGatewayFetchInit,
  signal?: AbortSignal,
): LiveGatewayFetchInit {
  return signal ? { ...init, signal } : init;
}

async function readApiError(response: LiveGatewayResponse, fallback: string) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const error = (payload as { error?: unknown }).error;
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Keep the fallback for malformed error responses.
  }
  return fallback;
}

async function requestJson<T>(
  fetcher: LiveGatewayFetch,
  input: string,
  init: LiveGatewayFetchInit,
  fallback: string,
  useApiError = false,
): Promise<T> {
  const response = await fetcher(input, init);
  if (!response.ok) {
    throw new Error(useApiError ? await readApiError(response, fallback) : fallback);
  }
  return await response.json() as T;
}

export function createLiveGateway(fetcher: LiveGatewayFetch) {
  const loadState = (signal?: AbortSignal) => requestJson<LiveStatePayload>(
    fetcher,
    "/api/live-state",
    withSignal({ cache: "no-store" }, signal),
    "读取实盘数据失败",
  );

  const saveState = (delta: LiveStateDelta, signal?: AbortSignal) => requestJson<LiveStateSaveResult>(
    fetcher,
    "/api/live-state",
    withSignal({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(delta),
    }, signal),
    "保存实盘数据失败",
  );

  const scan = (request: unknown, signal?: AbortSignal) => requestJson<LiveScanResponse>(
    fetcher,
    "/api/live-scan",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }, signal),
    "实盘筛选失败",
    true,
  );

  const refreshPrices = (
    market: LiveScanMarket,
    instrumentIds: string[],
    entryAfterOrSignal: Record<string, number> | AbortSignal = {},
    signal?: AbortSignal,
  ) => {
    // Preserve the old third-argument AbortSignal contract for callers that
    // do not need historical entry bars.
    const legacySignal: AbortSignal | undefined = "aborted" in entryAfterOrSignal
      ? entryAfterOrSignal as AbortSignal
      : undefined;
    const entryAfter = legacySignal ? {} : entryAfterOrSignal;
    const requestSignal = signal ?? legacySignal;
    return requestJson<LivePriceRefreshPayload>(
      fetcher,
      "/api/live-scan",
      withSignal({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "refresh",
          market,
          instrumentIds,
          ...(Object.keys(entryAfter).length ? { entryAfter } : {}),
        }),
      }, requestSignal),
      `${market === "CN" ? "A 股" : "美股"}最新价同步失败`,
      true,
    );
  };

  return { loadState, saveState, scan, refreshPrices };
}
