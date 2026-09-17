import {
  fetchLocalData,
  readLocalDataJson,
  REQUIRED_LOCAL_DATA_SERVICE_VERSION,
} from "../../lib/localDataService";

import { marketDataWriteResponse } from "../../lib/marketDataWriteGuard";

type LocalTask = Record<string, unknown> | null;

function staleServiceError(version?: number) {
  const current = Number.isFinite(version) ? `当前 v${version}` : "当前版本未知";
  return `本机数据服务版本过旧（${current}，需要 v${REQUIRED_LOCAL_DATA_SERVICE_VERSION}）。请关闭当前窗口后重新启动本地控制面板。`;
}

function isCompatibleService(result: Record<string, unknown>) {
  const version = Number(result.serviceVersion);
  return Number.isFinite(version) && version >= REQUIRED_LOCAL_DATA_SERVICE_VERSION;
}

export async function GET(request: Request) {
  const action = new URL(request.url).searchParams.get("action") ?? "status";
  const path = action === "health"
    ? "/health"
    : action === "catalog-status"
      ? "/catalog/status"
      : "/tasks/current";
  const result = await readLocalDataJson<Record<string, unknown>>(path, 3500);
  if (!result) {
    return Response.json({
      available: false,
      task: null,
      error: "本机数据服务未启动。请关闭当前窗口后重新双击“启动本地网页版.bat”。",
    }, { status: 503 });
  }
  if (!isCompatibleService(result)) {
    return Response.json({
      available: false,
      task: null,
      dataset: null,
      error: staleServiceError(Number(result.serviceVersion)),
    }, { status: 503 });
  }
  return Response.json({ available: true, ...result });
}

export async function POST(request: Request) {
  return marketDataWriteResponse("CN", () => updateLocalData(request));
}

async function updateLocalData(request: Request) {
  const payload = (await request.json()) as {
    action?: "start" | "pause" | "resume" | "catalog-refresh" | "adjustment-start";
    plan?: Record<string, unknown>;
  };
  const path = payload.action === "catalog-refresh"
    ? "/catalog/refresh"
    : payload.action === "adjustment-start"
      ? "/adjustment/start"
    : payload.action === "pause"
    ? "/tasks/current/pause"
    : payload.action === "resume"
      ? "/tasks/current/resume"
      : "/tasks";
  const body = payload.action === "start" || !payload.action
    ? { ...(payload.plan ?? {}) }
    : payload.action === "resume"
      ? {}
      : {};
  try {
    const response = await fetchLocalData(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, 10000);
    const result = await response.json() as { task?: LocalTask; error?: string };
    return Response.json(result, { status: response.status });
  } catch {
    return Response.json({
      error: "无法连接本机数据服务。请重新双击“启动本地网页版.bat”。",
    }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { removeData?: boolean };
  try {
    const response = await fetchLocalData("/tasks/current", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ removeData: Boolean(payload.removeData) }),
    }, 10000);
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ error: "无法连接本机数据服务" }, { status: 503 });
  }
}
