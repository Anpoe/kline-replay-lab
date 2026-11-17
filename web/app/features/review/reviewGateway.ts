import { chunkSessionState, SESSION_CHUNK_PAGE } from "../../lib/sessionChunks.ts";
import { loadTrainingCheckpoint, removeTrainingCheckpoint } from "../../lib/trainingCheckpoint.ts";
import { createUuid } from "../../lib/uuid.ts";

export type ReviewGatewayFetchInit = {
  cache?: "no-store";
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type ReviewGatewayResponse = {
  ok: boolean;
  status?: number;
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
  const savedVersions = new Map<string, string>();
  const savedChunks = new Map<string, { revision: string; hashes: string[]; savedAt: string }>();
  const deletingSessions = new Set<string>();
  const saveQueues = new Map<string, {
    pending: (() => Promise<void>) | null;
    finished: Promise<void>;
    waiters: { resolve: () => void; reject: (error: unknown) => void }[];
  }>();
  const loadSessions = async <T = unknown>(includeAll = false, signal?: AbortSignal,
    scope?: { instrumentId: string; timeframe: string }): Promise<T[]> => {
    const params = new URLSearchParams();
    if (includeAll) params.set("all", "1");
    if (scope) {
      params.set("instrument", scope.instrumentId);
      params.set("timeframe", scope.timeframe);
    }
    const payload = await requestJson<SessionListPayload>(
      fetcher,
      `/api/sessions${params.size ? `?${params}` : ""}`,
      withSignal({}, signal),
      "读取训练记录失败",
    );
    const sessions = Array.isArray(payload.sessions) ? payload.sessions as Record<string, unknown>[] : [];
    for (const session of sessions) {
      if (typeof session.id === "string" && typeof session.updatedAt === "string"
        && (savedVersions.get(session.id) ?? "") < session.updatedAt) savedVersions.set(session.id, session.updatedAt);
    }
    const checkpoint = await loadTrainingCheckpoint<{
      id: string; instrumentId: string; timeframe: string; updatedAt: string; dataSnapshotId?: string;
      state: Record<string, unknown>;
      checkpointAcknowledged?: boolean;
    }>().catch(() => null);
    if (checkpoint?.id && checkpoint.state && !checkpoint.checkpointAcknowledged && (!scope
      || (scope.instrumentId === checkpoint.instrumentId && scope.timeframe === checkpoint.timeframe))) {
      let index = sessions.findIndex(session => session.id === checkpoint.id);
      if (index < 0) {
        const response = await fetcher(`/api/sessions?id=${encodeURIComponent(checkpoint.id)}`, withSignal({ cache: "no-store" }, signal));
        if (response.ok) {
          const payload = await response.json() as { session?: Record<string, unknown> };
          if (payload.session) {
            sessions.push(payload.session);
            index = sessions.length - 1;
            if (typeof payload.session.updatedAt === "string") savedVersions.set(checkpoint.id, payload.session.updatedAt);
          }
        } else if (response.status === 404) {
          const trash = await fetcher(`/api/sessions?id=${encodeURIComponent(checkpoint.id)}&trash=1`, withSignal({ cache: "no-store" }, signal));
          if (trash.status === 404) sessions.unshift({
            id: checkpoint.id, instrumentId: checkpoint.instrumentId, timeframe: checkpoint.timeframe,
            dataSnapshotId: checkpoint.dataSnapshotId ?? checkpoint.state.dataSnapshotId,
            stateJson: JSON.stringify(checkpoint.state), createdAt: checkpoint.updatedAt, updatedAt: checkpoint.updatedAt,
          });
        }
      }
      if (index >= 0 && String(sessions[index].updatedAt) < checkpoint.updatedAt) {
        sessions[index] = { ...sessions[index], stateJson: JSON.stringify(checkpoint.state), updatedAt: checkpoint.updatedAt };
      }
    }
    return sessions as T[];
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

  const saveSessionNow = async (session: unknown, signal?: AbortSignal) => {
    const body = JSON.stringify(session);
    const value = session as { id?: string; state?: Record<string, unknown> } | null;
    if (body.length > 65_536 && value?.id && value.state) {
      const chunks = await chunkSessionState(value.state);
      const revision = createUuid();
      const metadata = { ...value };
      delete metadata.state;
      const previous = savedChunks.get(value.id);
      const reusable = previous?.savedAt === savedVersions.get(value.id) ? previous : undefined;
      const changedChunks = chunks.filter(chunk => reusable?.hashes[chunk.index] !== chunk.hash);
      const post = async (payload: unknown) => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            const response = await fetcher("/api/sessions", withSignal({
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
            }, signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)));
            if (!response.ok && response.status && response.status < 500) {
              throw Object.assign(new Error(await readError(response, "保存训练记录失败")), { retryable: false });
            }
            await ensureOk(response, "保存训练记录失败");
            return await response.json() as { missing?: number[]; savedAt?: string };
          } catch (error) {
            if (attempt >= 2 || signal?.aborted || (error as { retryable?: boolean })?.retryable === false) throw error;
          }
        }
      };
      await post({ ...metadata, action: "begin-session", revision, count: chunks.length,
        expectedUpdatedAt: savedVersions.get(value.id), reuseRevision: reusable?.revision });
      for (let offset = 0; offset < changedChunks.length; offset += SESSION_CHUNK_PAGE) {
        const page = changedChunks.slice(offset, offset + SESSION_CHUNK_PAGE);
        const result = await post({ action: "session-chunks", id: value.id, revision,
          chunks: page.map(({ index, hash }) => ({ index, hash })) });
        if (!Array.isArray(result.missing)) throw new Error("保存训练记录失败");
        const missing = page.filter(chunk => result.missing!.includes(chunk.index));
        if (missing.length) await post({ action: "session-chunks", id: value.id, revision, chunks: missing });
      }
      const result = await post({ action: "commit-session", id: value.id, revision });
      if (result.savedAt) {
        savedVersions.set(value.id, result.savedAt);
        savedChunks.set(value.id, { revision, hashes: chunks.map(chunk => chunk.hash), savedAt: result.savedAt });
      }
      return;
    }
    const response = await fetcher("/api/sessions", withSignal({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: savedVersions.has(value?.id ?? "")
        ? JSON.stringify({ ...value, expectedUpdatedAt: savedVersions.get(value!.id!) }) : body,
    }, signal));
    if (!response.ok) throw Object.assign(new Error("保存训练记录失败"), { retryable: response.status !== 409 });
    const result = await response.json() as { savedAt?: string };
    if (value?.id && result?.savedAt) savedVersions.set(value.id, result.savedAt);
    if (value?.id) savedChunks.delete(value.id);
  };

  const saveSession = (session: unknown, signal?: AbortSignal): Promise<void> => {
    const id = (session as { id?: string } | null)?.id ?? "";
    if (deletingSessions.has(id)) return Promise.reject(new Error("训练删除处理中，请稍后重试保存"));
    const existing = saveQueues.get(id);
    if (existing) {
      existing.pending = () => saveSessionNow(session, signal);
      return new Promise((resolve, reject) => existing.waiters.push({ resolve, reject }));
    }
    const queue = { pending: null as (() => Promise<void>) | null, finished: Promise.resolve(),
      waiters: [] as { resolve: () => void; reject: (error: unknown) => void }[] };
    saveQueues.set(id, queue);
    return new Promise<void>((resolve, reject) => {
      queue.waiters.push({ resolve, reject });
      queue.finished = (async () => {
        let job: (() => Promise<void>) | null = () => saveSessionNow(session, signal);
        while (job) {
          const waiters = queue.waiters.splice(0);
          try {
            await job();
            waiters.forEach(waiter => waiter.resolve());
          } catch (error) {
            waiters.forEach(waiter => waiter.reject(error));
          }
          job = queue.pending;
          queue.pending = null;
        }
        saveQueues.delete(id);
      })();
    });
  };

  const restoreSession = async (sessionId: string, signal?: AbortSignal) => {
    const query = encodeURIComponent(sessionId);
    const response = await fetcher(`/api/sessions?id=${query}`, withSignal({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    }, signal));
    await ensureOk(response, "恢复训练失败");
    const payload = await response.json() as { restoredAt?: string };
    if (payload?.restoredAt) savedVersions.set(sessionId, payload.restoredAt);
  };

  const deleteSession = async (sessionId: string, permanent = false, signal?: AbortSignal) => {
    deletingSessions.add(sessionId);
    try {
      const queue = saveQueues.get(sessionId);
      if (queue) {
        queue.pending = null;
        queue.waiters.splice(0).forEach(waiter => waiter.reject(new Error("训练删除处理中，请稍后重试保存")));
        await queue.finished;
      }
      const query = encodeURIComponent(sessionId);
      const input = permanent
        ? `/api/sessions?id=${query}&permanent=1`
        : `/api/sessions?id=${query}`;
      const response = await fetcher(input, withSignal({ method: "DELETE" }, signal));
      await ensureOk(response, permanent ? "彻底删除失败" : "删除训练记录失败");
      await removeTrainingCheckpoint(sessionId);
      savedVersions.delete(sessionId);
      savedChunks.delete(sessionId);
    } finally {
      deletingSessions.delete(sessionId);
    }
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
