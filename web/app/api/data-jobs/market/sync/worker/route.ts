import {
  MarketSyncError,
  processNextMarketSyncBatch,
  serializeMarketSyncStatus,
} from "../../../../../lib/marketSyncService";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as { runId?: string };
    if (!payload.runId) {
      return Response.json({ error: "缺少 runId" }, { status: 400 });
    }
    const status = await processNextMarketSyncBatch(payload.runId);
    return Response.json(serializeMarketSyncStatus(status));
  } catch (error) {
    if (error instanceof MarketSyncError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({
      error: error instanceof Error ? error.message : "美股同步批次执行失败",
    }, { status: 500 });
  }
}
