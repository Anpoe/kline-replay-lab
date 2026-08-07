import { ensureSchema, getRawDb } from "../../../../db/runtime";
import { createFxTask, getFxTaskView } from "../../../lib/fxDataService";

export async function POST(request: Request) {
  await ensureSchema();
  try {
    const body = await request.json() as Record<string, unknown>;
    const task = await createFxTask(getRawDb(), "initialize", body);
    return Response.json({ task: getFxTaskView(task) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "外汇历史任务创建失败" }, { status: 400 });
  }
}
