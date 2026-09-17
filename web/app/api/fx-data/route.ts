import { ensureSchema, getRawDb } from "../../../db/runtime";
import {
  createFxTask,
  getFxCatalog,
  getFxTask,
  getFxTaskView,
  type FxTaskMode,
} from "../../lib/fxDataService";

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const market = url.searchParams.get("market")?.trim().toUpperCase() === "GOLD" ? "GOLD" : "FX";
  const task = await getFxTask(getRawDb(), url.searchParams.get("taskId") ?? undefined, url.searchParams.get("pairId") ?? undefined, url.searchParams.has("market") ? market : undefined);
  return Response.json({ task: getFxTaskView(task), pairs: getFxCatalog(market), qualitySummary: task ? getFxTaskView(task)?.quality ?? null : null });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as { mode?: FxTaskMode; pairId?: unknown; startDate?: unknown; endDate?: unknown; rawTimeframe?: unknown; targetTimeframes?: unknown; keepRawCsv?: unknown };
  if (body.mode !== "initialize" && body.mode !== "update") return Response.json({ error: "缺少行情任务模式" }, { status: 400 });
  try {
    const task = await createFxTask(getRawDb(), body.mode, body);
    return Response.json({ task: getFxTaskView(task) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "外汇任务创建失败" }, { status: 400 });
  }
}
