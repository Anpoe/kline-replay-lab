import { ensureSchema, getRawDb } from "../../../../db/runtime";
import { failFxTask, getFxTask, getFxTaskView, runFxTask } from "../../../lib/fxDataService";

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as { taskId?: string };
  if (!body.taskId) return Response.json({ error: "缺少外汇任务 ID" }, { status: 400 });
  const db = getRawDb();
  const existing = await getFxTask(db, body.taskId);
  if (!existing) return Response.json({ error: "外汇任务不存在" }, { status: 404 });
  try {
    const task = await runFxTask(db, body.taskId);
    return Response.json({ task: getFxTaskView(task) });
  } catch (error) {
    const task = await failFxTask(db, body.taskId, error);
    return Response.json({ task: getFxTaskView(task), error: error instanceof Error ? error.message : "外汇任务执行失败" }, { status: 502 });
  }
}
