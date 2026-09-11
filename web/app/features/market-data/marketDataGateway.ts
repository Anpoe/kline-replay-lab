import { marketSyncWorkerCoordinator } from "../../lib/marketSyncWorkerCoordinator.ts";

export type MarketDataGatewayFetchInit = {
  cache?: "no-store";
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type MarketDataGatewayResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

export type MarketDataGatewayFetch = (
  input: string,
  init?: MarketDataGatewayFetchInit,
) => Promise<MarketDataGatewayResponse>;

export type MarketDataStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type MarketDataFxAction =
  | { type: "initialize"; payload: unknown }
  | { type: "update"; payload: unknown }
  | { type: "task"; taskId: string; action: "pause" | "resume" | "retry" | "cancel" };

export const marketDataStorageKeys = Object.freeze({
  onboarding: "kline-training:data-onboarding",
});

function withSignal(
  init: MarketDataGatewayFetchInit,
  signal?: AbortSignal,
): MarketDataGatewayFetchInit {
  return signal ? { ...init, signal } : init;
}

async function readApiError(response: MarketDataGatewayResponse, fallback: string) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const error = (payload as { error?: unknown }).error;
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Use the stable fallback for malformed error responses.
  }
  return fallback;
}

async function requestJson<T>(
  fetcher: MarketDataGatewayFetch,
  input: string,
  init: MarketDataGatewayFetchInit,
  fallback: string,
): Promise<T> {
  const response = await fetcher(input, init);
  if (!response.ok) throw new Error(await readApiError(response, fallback));
  return await response.json() as T;
}

async function requestNoContent(
  fetcher: MarketDataGatewayFetch,
  input: string,
  init: MarketDataGatewayFetchInit,
  fallback: string,
) {
  const response = await fetcher(input, init);
  if (!response.ok) throw new Error(await readApiError(response, fallback));
}

export function createMarketDataStorageGateway(storage: MarketDataStorage) {
  const loadOnboardingPlan = <T = Record<string, unknown>>(): T | null => {
    const stored = storage.getItem(marketDataStorageKeys.onboarding);
    if (stored == null) return null;
    try {
      return JSON.parse(stored) as T;
    } catch {
      storage.removeItem(marketDataStorageKeys.onboarding);
      return null;
    }
  };

  const saveOnboardingPlan = (plan: unknown) => {
    storage.setItem(marketDataStorageKeys.onboarding, JSON.stringify(plan));
  };

  const removeOnboardingPlan = () => {
    storage.removeItem(marketDataStorageKeys.onboarding);
  };

  return { loadOnboardingPlan, saveOnboardingPlan, removeOnboardingPlan };
}

export function createMarketDataGateway(fetcher: MarketDataGatewayFetch) {
  const loadAutoUpdateStatus = <T = unknown>(signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/data-auto-update",
    withSignal({ cache: "no-store" }, signal),
    "读取后台自动更新状态失败",
  );

  const loadProviders = <T = unknown>(signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/data-providers",
    withSignal({}, signal),
    "读取数据源状态失败",
  );

  const loadJobs = <T = unknown>(market: string, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    `/api/data-jobs?market=${encodeURIComponent(market)}`,
    withSignal({}, signal),
    "读取下载任务失败",
  );

  const loadMarketSync = <T = unknown>(runId?: string, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    `/api/data-jobs/market/sync${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`,
    withSignal({ cache: "no-store" }, signal),
    "读取市场同步任务失败",
  );

  const loadLocalTask = <T = unknown>(signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/local-data",
    withSignal({}, signal),
    "读取本机数据任务失败",
  );

  const loadCatalogTask = <T = unknown>(signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/local-data?action=catalog-status",
    withSignal({}, signal),
    "读取名称目录任务失败",
  );

  const loadCnMaintenanceTask = <T = unknown>(signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/cn-maintenance",
    withSignal({}, signal),
    "读取 A 股维护任务失败",
  );

  const loadFxTask = <T = unknown>(pairIdOrSignal?: string | AbortSignal, signal?: AbortSignal) => {
    const pairId = typeof pairIdOrSignal === "string" ? pairIdOrSignal : undefined;
    const requestSignal = typeof pairIdOrSignal === "string" ? signal : pairIdOrSignal ?? signal;
    return requestJson<T>(
      fetcher,
      `/api/fx-data${pairId ? `?pairId=${encodeURIComponent(pairId)}` : ""}`,
      withSignal({ cache: "no-store" }, requestSignal),
      "读取行情数据任务失败",
    );
  };

  const startLocalInitialization = <T = unknown>(plan: unknown, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/local-data",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", plan }),
    }, signal),
    "初始化任务创建失败",
  );

  const localTaskAction = <T = unknown>(action: "pause" | "resume" | "catalog-refresh", signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/local-data",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }, signal),
    "任务操作失败",
  );

  const removeLocalTask = <T = unknown>(removeData = false, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/local-data",
    withSignal({
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ removeData }),
    }, signal),
    "移除本机数据任务失败",
  );

  const cnMaintenanceAction = <T = unknown>(
    action: "start" | "pause" | "resume",
    mode: "incremental" | "repair" = "incremental",
    repairDays = 30,
    signal?: AbortSignal,
  ) => requestJson<T>(
    fetcher,
    "/api/cn-maintenance",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, mode, repairDays }),
    }, signal),
    "A 股维护任务操作失败",
  );

  const runDownloadJob = <T = unknown>(id: string, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/data-jobs/run",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }, signal),
    "下载失败",
  );

  const startMarketSync = <T = unknown>(
    market: string,
    mode: "initialize" | "update",
    instrumentIds?: string[],
    signal?: AbortSignal,
  ) => requestJson<T>(
      fetcher,
      "/api/data-jobs/market/sync",
      withSignal({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          market,
          mode,
          ...(instrumentIds?.length ? { instrumentIds } : {}),
        }),
      }, signal),
      "市场同步任务创建失败",
    );

  const marketSyncWorker = <T = unknown>(runId: string, signal?: AbortSignal) =>
    marketSyncWorkerCoordinator.request(runId, () => requestJson<T>(
      fetcher,
      "/api/data-jobs/market/sync/worker",
      withSignal({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      }, signal),
      "市场同步批次执行失败",
    ));

  const marketSyncAction = <T = unknown>(runId: string, action: "pause" | "resume" | "cancel" | "retry", signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/data-jobs/market/sync",
    withSignal({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, action }),
    }, signal),
    "市场同步任务操作失败",
  );

  const runFxTask = <T = unknown>(taskId: string, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/fx-data/run",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId }),
    }, signal),
      "行情任务请求失败",
  );

  const fxDataAction = <T = unknown>(action: MarketDataFxAction, signal?: AbortSignal) => {
    const input = action.type === "initialize"
      ? "/api/fx-data/initialize"
      : action.type === "update"
        ? "/api/fx-data/update"
        : "/api/fx-data/task";
    const body = action.type === "task"
      ? { taskId: action.taskId, action: action.action }
      : action.payload;
    return requestJson<T>(
      fetcher,
      input,
      withSignal({
        method: action.type === "task" ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }, signal),
      "行情任务操作失败",
    );
  };

  const updateJob = <T = unknown>(id: string, action: "pause" | "resume" | "retry", signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/data-jobs",
    withSignal({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
    }, signal),
    "下载任务操作失败",
  );

  const deleteJob = (id: string, signal?: AbortSignal) => requestNoContent(
    fetcher,
    `/api/data-jobs?id=${encodeURIComponent(id)}`,
    withSignal({ method: "DELETE" }, signal),
    "删除下载任务失败",
  );

  const loadProviderSettings = <T = unknown>(signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/provider-settings",
    withSignal({ cache: "no-store" }, signal),
    "读取供应商设置失败",
  );

  const saveProviderSettings = <T = unknown>(payload: unknown, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/provider-settings",
    withSignal({
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, signal),
    "保存供应商设置失败",
  );

  const deleteProviderSettings = <T = unknown>(provider: string, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    `/api/provider-settings?provider=${encodeURIComponent(provider)}`,
    withSignal({ method: "DELETE" }, signal),
    "清除供应商设置失败",
  );

  const loadInstrumentCatalog = <T = unknown>(signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/candles?instruments=1",
    withSignal({ cache: "no-store" }, signal),
    "读取品种目录失败",
  );

  const loadCoverage = <T = unknown>(
    page: number,
    pageSize: number,
    query: string,
    market: string,
    signal?: AbortSignal,
  ) => requestJson<T>(
    fetcher,
    `/api/candles?coverage=1&page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(pageSize))}&q=${encodeURIComponent(query)}&market=${encodeURIComponent(market)}`,
    withSignal({}, signal),
    "读取行情覆盖范围失败",
  );

  const deleteCoverage = <T = unknown>(selections: unknown[], signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/candles",
    withSignal({
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selections }),
    }, signal),
    "删除行情数据失败",
  );

  const importCandles = <T = unknown>(payload: unknown, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/candles",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, signal),
    "导入行情数据失败",
  );

  const loadCandles = <T = unknown>(instrumentId: string, timeframe: string, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    `/api/candles?instrument=${encodeURIComponent(instrumentId)}&timeframe=${encodeURIComponent(timeframe)}`,
    withSignal({}, signal),
    "读取候选 K 线失败",
  );

  const createSnapshot = <T = unknown>(payload: unknown, signal?: AbortSignal) => requestJson<T>(
    fetcher,
    "/api/snapshots",
    withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, signal),
    "不可变行情快照创建失败",
  );

  return {
    loadAutoUpdateStatus,
    loadProviders,
    loadJobs,
    loadMarketSync,
    loadLocalTask,
    loadCatalogTask,
    loadCnMaintenanceTask,
    loadFxTask,
    startLocalInitialization,
    localTaskAction,
    removeLocalTask,
    cnMaintenanceAction,
    runDownloadJob,
    startMarketSync,
    marketSyncWorker,
    marketSyncAction,
    runFxTask,
    fxDataAction,
    updateJob,
    deleteJob,
    loadProviderSettings,
    saveProviderSettings,
    deleteProviderSettings,
    loadInstrumentCatalog,
    loadCoverage,
    deleteCoverage,
    importCandles,
    loadCandles,
    createSnapshot,
  };
}
