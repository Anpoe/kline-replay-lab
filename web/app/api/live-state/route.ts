import { applyLiveStatePatch, readLiveState } from "../../../db/live-ledger";
import { ensureSchema, getRawDb } from "../../../db/runtime";

export async function GET() {
  await ensureSchema();
  const state = await readLiveState(getRawDb());
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  await ensureSchema();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "实时模拟数据请求格式不正确" }, { status: 400 });
  }
  try {
    const result = await applyLiveStatePatch(getRawDb(), payload);
    return Response.json({ saved: true, ...result });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "实时模拟数据保存失败",
    }, { status: 400 });
  }
}
