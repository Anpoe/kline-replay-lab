import { fetchLocalData, readLocalDataJson } from "../../lib/localDataService";

type LocalTask = Record<string, unknown> | null;

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
  return Response.json({ available: true, ...result });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    action?: "start" | "pause" | "resume" | "catalog-refresh";
    plan?: Record<string, unknown>;
  };
  const path = payload.action === "catalog-refresh"
    ? "/catalog/refresh"
    : payload.action === "pause"
    ? "/tasks/current/pause"
    : payload.action === "resume"
      ? "/tasks/current/resume"
      : "/tasks";
  try {
    const response = await fetchLocalData(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.action === "start" || !payload.action ? payload.plan ?? {} : {}),
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
