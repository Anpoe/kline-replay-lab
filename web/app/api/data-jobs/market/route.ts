import {
  createMarketSyncRun,
  MarketSyncError,
  serializeMarketSyncStatus,
  getMarketSyncStatus,
} from "../../../lib/marketSyncService";

/**
 * Compatibility facade for older callers. New callers should use
 * /api/data-jobs/market/sync directly.
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as {
      market?: string;
      mode?: "initialize" | "update";
      instrumentIds?: string[];
      startDate?: string;
      endDate?: string;
    };
    if (payload.market && payload.market !== "US") {
      return Response.json({ error: "美股批量任务只支持 US" }, { status: 400 });
    }
    const result = await createMarketSyncRun({
      mode: payload.mode === "initialize" ? "initialize" : "update",
      instrumentIds: payload.instrumentIds,
      startDate: payload.startDate,
      endDate: payload.endDate,
    });
    const status = await getMarketSyncStatus(result.run.id);
    return Response.json({
      ...(serializeMarketSyncStatus(status) ?? { run: result.run }),
      reused: result.reused,
      instrumentCount: result.instrumentCount,
      eligibleCount: result.eligibleCount,
      skippedSymbols: result.skippedSymbols,
    }, { status: result.reused ? 200 : 202 });
  } catch (error) {
    if (error instanceof MarketSyncError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({
      error: error instanceof Error ? error.message : "美股任务创建失败",
    }, { status: 500 });
  }
}
