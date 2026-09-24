import { applyLiveTradingCommand } from "../../../db/live-command";
import { ensureSchema, getRawDb } from "../../../db/runtime";
import { TradingCommandError } from "../../lib/tradingCommands";

export async function POST(request: Request) {
  await ensureSchema();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "交易命令请求格式不正确", code: "invalid_command" }, { status: 400 });
  }
  try {
    const result = await applyLiveTradingCommand(getRawDb(), payload);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof TradingCommandError ? error.code : "invalid_command";
    return Response.json({
      error: error instanceof Error ? error.message : "交易命令执行失败",
      code,
    }, { status: code === "account_version_conflict" ? 409 : 400 });
  }
}
