import { fetchLocalData, readLocalDataJson } from "../../lib/localDataService";
import type { CorporateActionEvent } from "../../lib/corporateActions";
import { marketDataWriteResponse } from "../../lib/marketDataWriteGuard";

type CorporateActionsResponse = {
  corporateActions?: Record<string, unknown> | null;
  events?: CorporateActionEvent[];
  error?: string;
};

export async function GET(request: Request) {
  const instrument = new URL(request.url).searchParams.get("instrument") ?? "";
  if (instrument && !/^\d{6}\.(SH|SZ|BJ)$/.test(instrument)) {
    return Response.json({ error: "品种代码无效" }, { status: 400 });
  }
  const result = await readLocalDataJson<CorporateActionsResponse>(
    `/corporate-actions${instrument ? `?instrument=${encodeURIComponent(instrument)}` : ""}`,
    12_000,
  );
  if (!result) return Response.json({ corporateActions: null, events: [], error: "本机数据服务未启动" }, { status: 503 });
  return Response.json(result);
}

export async function POST(request: Request) {
  return marketDataWriteResponse("CN", () => updateCorporateActions(request));
}

async function updateCorporateActions(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { action?: "start" | "pause" | "resume" };
  const action = payload.action ?? "start";
  try {
    const response = await fetchLocalData("/corporate-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }, 12_000);
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ error: "无法连接本机数据服务" }, { status: 503 });
  }
}
