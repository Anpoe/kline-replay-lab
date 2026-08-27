import { ensureSchema, getRawDb } from "../../../../db/runtime";
import { getFxTask, getFxTaskView, patchFxTask } from "../../../lib/fxDataService";

export async function GET(request: Request) {
  await ensureSchema();
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!taskId) return Response.json({ error: "缺少行情任务 ID" }, { status: 400 });
  const task = await getFxTask(getRawDb(), taskId);
  if (!task) return Response.json({ error: "行情任务不存在" }, { status: 404 });
  return Response.json({ task: getFxTaskView(task) });
}

export async function PATCH(request: Request) {
  await ensureSchema();
  const body = await request.json() as { taskId?: string; action?: "pause" | "resume" | "retry" | "cancel" };
  if (!body.taskId || !body.action) return Response.json({ error: "缺少任务 ID 或操作" }, { status: 400 });
  try {
    const task = await patchFxTask(getRawDb(), body.taskId, body.action);
    return Response.json({ task: getFxTaskView(task) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "外汇任务操作失败" }, { status: 400 });
  }
}
