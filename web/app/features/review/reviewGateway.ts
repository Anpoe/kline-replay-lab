export type ReviewGatewayFetchInit = {
  cache?: "no-store";
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type ReviewGatewayResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

export type ReviewGatewayFetch = (
  input: string,
  init?: ReviewGatewayFetchInit,
) => Promise<ReviewGatewayResponse>;

type SessionListPayload = {
  sessions?: unknown;
  error?: unknown;
};

type SnapshotAnalysisItem = {
  snapshotId: string;
  entryTimestamps: number[];
};

function withSignal(init: ReviewGatewayFetchInit, signal?: AbortSignal): ReviewGatewayFetchInit {
  return signal ? { ...init, signal } : init;
}

async function readError(response: ReviewGatewayResponse, fallback: string) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const message = (payload as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // The fallback keeps network and malformed error responses consistent.
  }
  return fallback;
}

async function ensureOk(response: ReviewGatewayResponse, fallback: string) {
  if (response.ok) return;
  throw new Error(await readError(response, fallback));
}

async function requestJson<T>(
  fetcher: ReviewGatewayFetch,
  input: string,
  init: ReviewGatewayFetchInit,
  fallback: string,
) {
  const response = await fetcher(input, init);
  await ensureOk(response, fallback);
  return await response.json() as T;
}

export function createReviewGateway(fetcher: ReviewGatewayFetch) {
  const loadSessions = async <T = unknown>(includeAll = false, signal?: AbortSignal): Promise<T[]> => {
    const payload = await requestJson<SessionListPayload>(
      fetcher,
      includeAll ? "/api/sessions?all=1" : "/api/sessions",
      withSignal({}, signal),
      "读取训练记录失败",
    );
    return Array.isArray(payload.sessions) ? payload.sessions as T[] : [];
  };

  const loadTrashSessions = async <T = unknown>(signal?: AbortSignal): Promise<T[]> => {
    const payload = await requestJson<SessionListPayload>(
      fetcher,
      "/api/sessions?trash=1&all=1",
      withSignal({ cache: "no-store" }, signal),
      "读取回收站失败",
    );
    return Array.isArray(payload.sessions) ? payload.sessions as T[] : [];
  };

  const saveSession = async (session: unknown, signal?: AbortSignal) => {
    const response = await fetcher("/api/sessions", withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    }, signal));
    if (!response.ok) throw new Error("保存训练记录失败");
  };

  const restoreSession = async (sessionId: string, signal?: AbortSignal) => {
    const query = encodeURIComponent(sessionId);
    const response = await fetcher(`/api/sessions?id=${query}`, withSignal({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    }, signal));
    await ensureOk(response, "恢复训练失败");
  };

  const deleteSession = async (sessionId: string, permanent = false, signal?: AbortSignal) => {
    const query = encodeURIComponent(sessionId);
    const input = permanent
      ? `/api/sessions?id=${query}&permanent=1`
      : `/api/sessions?id=${query}`;
    const response = await fetcher(input, withSignal({ method: "DELETE" }, signal));
    await ensureOk(response, permanent ? "彻底删除失败" : "删除训练记录失败");
  };

  const loadSnapshot = async <T = unknown>(
    snapshotId: string,
    options: {
      startTimestamp?: number;
      endTimestamp?: number;
      lookbackBars?: number;
    } = {},
    signal?: AbortSignal,
  ): Promise<T> => {
    const params = new URLSearchParams({ id: snapshotId });
    if (Number.isFinite(options.startTimestamp)) params.set("startTimestamp", String(options.startTimestamp));
    if (Number.isFinite(options.endTimestamp)) params.set("endTimestamp", String(options.endTimestamp));
    if (Number.isFinite(options.lookbackBars)) params.set("lookbackBars", String(options.lookbackBars));
    return requestJson<T>(
      fetcher,
      `/api/snapshots?${params.toString()}`,
      withSignal({}, signal),
      "训练绑定的数据快照不存在，无法进行确定性恢复",
    );
  };

  const loadSnapshotAnalysis = async <T = unknown>(items: SnapshotAnalysisItem[], signal?: AbortSignal): Promise<T> => (
    requestJson<T>(
      fetcher,
      "/api/snapshots/analysis",
      withSignal({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      }, signal),
      "读取快照分析失败",
    )
  );

  return {
    loadSessions,
    loadTrashSessions,
    saveSession,
    restoreSession,
    deleteSession,
    loadSnapshot,
    loadSnapshotAnalysis,
  };
}
