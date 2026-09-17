import { ensureSchema, getRawDb } from "../../../db/runtime";
import { clearMarketData } from "../../lib/marketDataClear";
import { isDataMarket, MarketDataBusyError } from "../../lib/marketDataWriteGuard";
import { fetchLocalData } from "../../lib/localDataService";

export async function DELETE(request: Request) {
  const payload = await request.json().catch(() => null) as { market?: unknown; confirmation?: unknown } | null;
  if (!isDataMarket(payload?.market) || payload?.confirmation !== payload.market) {
    return Response.json({ error: "请确认要清空的市场后重试。" }, { status: 400 });
  }
  try {
    await ensureSchema();
    const result = await clearMarketData(getRawDb(), payload.market, {
      async clearLocalData() {
        let response: Response;
        try {
          response = await fetchLocalData("/data/clear-market", {
            method: "DELETE", headers: { "content-type": "application/json" },
            body: JSON.stringify({ market: "CN", confirmation: "CN" }),
          }, 120000);
        } catch {
          throw new Error("未能确认 A 股清空结果，请从控制面板检查数据服务，恢复连接后重试。");
        }
        const result = await response.json() as { cleared?: boolean; error?: string };
        if (response.status === 404) throw new Error("当前数据服务暂不支持清空，请更新应用并从控制面板重新启动后重试。");
        if (response.status === 409) throw new MarketDataBusyError(result.error ?? "A 股行情任务仍在处理中，请暂停后重试。");
        if (!response.ok || result.cleared !== true) throw new Error(result.error ?? "A 股行情未能完成清空，请重试。");
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "行情清空未完成，请重试。" }, {
      status: error instanceof MarketDataBusyError ? 409 : 503,
    });
  }
}
