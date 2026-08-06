import {
  controlMarketSync,
  createMarketSyncRun,
  getActiveMarketSyncStatus,
  getMarketSyncStatus,
  MarketSyncError,
  serializeMarketSyncStatus,
} from "../../../../lib/marketSyncService";

function errorResponse(error: unknown) {
  if (error instanceof MarketSyncError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({
    error: error instanceof Error ? error.message : "美股同步请求失败",
  }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const runId = new URL(request.url).searchParams.get("runId");
    const status = runId
      ? await getMarketSyncStatus(runId)
      : await getActiveMarketSyncStatus();
    if (!status) return Response.json({ run: null, status: null });
    return Response.json(serializeMarketSyncStatus(status));
  } catch (error) {
    return errorResponse(error);
  }
}

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
      return Response.json({ error: "美股同步接口只支持 US" }, { status: 400 });
    }
    if (payload.mode !== "initialize" && payload.mode !== "update") {
      return Response.json({ error: "缺少有效的同步模式" }, { status: 400 });
    }
    const result = await createMarketSyncRun({
      mode: payload.mode,
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
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json().catch(() => ({})) as {
      runId?: string;
      action?: "pause" | "resume" | "cancel" | "retry";
    };
    if (!payload.runId || !payload.action) {
      return Response.json({ error: "缺少 runId 或操作" }, { status: 400 });
    }
    const status = await controlMarketSync(payload.runId, payload.action);
    return Response.json(serializeMarketSyncStatus(status));
  } catch (error) {
    return errorResponse(error);
  }
}
