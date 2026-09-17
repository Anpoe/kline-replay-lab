import { fetchLocalData, readLocalDataJson } from "../../lib/localDataService";
import { loadProviderSecrets } from "../../lib/providerCredentials";
import { marketDataWriteResponse } from "../../lib/marketDataWriteGuard";

type MaintenanceResponse = {
  maintenanceTask?: Record<string, unknown> | null;
  error?: string;
};

export async function GET() {
  const result = await readLocalDataJson<MaintenanceResponse>("/maintenance/cn/status", 3500);
  if (!result) {
    return Response.json({ maintenanceTask: null, error: "本机数据服务未启动" }, { status: 503 });
  }
  return Response.json(result);
}

export async function POST(request: Request) {
  return marketDataWriteResponse("CN", () => updateMaintenance(request));
}

async function updateMaintenance(request: Request) {
  const payload = (await request.json()) as {
    action?: "start" | "pause" | "resume";
    mode?: "incremental" | "repair";
    repairDays?: number;
  };
  const action = payload.action ?? "start";
  const path = action === "pause"
    ? "/maintenance/cn/pause"
    : action === "resume"
      ? "/maintenance/cn/resume"
      : "/maintenance/cn/start";
  try {
    const { secrets } = await loadProviderSecrets();
    const response = await fetchLocalData(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: payload.mode,
        repairDays: payload.repairDays,
        token: secrets.tushareToken ?? null,
      }),
    }, 10_000);
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ error: "无法连接本机数据服务，请重新启动本地网页版" }, { status: 503 });
  }
}
