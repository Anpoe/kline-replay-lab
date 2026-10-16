import type { Mt4CommandInput, Mt4Order, Mt4Status } from "./mt4Contracts.ts";

type Target = Pick<Mt4Order, "ticket" | "symbol" | "type" | "lots" | "openTime">;
export type CloseAllPlan = { accountKey: string; login: string; server: string; mode: string; sessionId: string; positions: Target[] };
export type CloseAllProgress = { total: number; closed: number; absent: number; remaining: number; currentTicket?: number };
export type CloseAllResult = CloseAllProgress & { outcome: "complete" | "stopped"; message: string; pendingCommand?: Mt4CommandInput; currentPositions: number };
type Options = {
  request: (payload?: { action: "command"; command: Mt4CommandInput }, signal?: AbortSignal) => Promise<Mt4Status>;
  commandId?: () => string; signal?: AbortSignal; shouldStop?: () => boolean;
  onStatus?: (state: Mt4Status) => void; onProgress?: (progress: CloseAllProgress) => void;
  onPending?: (command: Mt4CommandInput | null) => void; isDefiniteRejection?: (error: unknown) => boolean;
  now?: () => number; wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>; timeoutMs?: number;
};
const active = new Set(["queued", "sent", "unknown"]);
const targets = (state: Mt4Status): Target[] => (state.snapshot?.orders ?? []).filter(o => o.type < 2)
  .map(({ ticket, symbol, type, lots, openTime }) => ({ ticket, symbol, type, lots, openTime })).sort((a,b) => a.ticket-b.ticket);
function requireComplete(state: Mt4Status) {
  if (!state.snapshot || state.snapshot.orderCount > state.snapshot.orders.length) throw Error("持仓列表不完整，请在 MT4 核对全部订单后重试。");
}
function requireTrading(state: Mt4Status) {
  const a = state.snapshot?.account;
  if (state.connection !== "connected" || !a?.connected) throw Error("MT4 已断开，请重新验证连接。");
  if (!state.enabled || !a.tradeAllowed || (a.mode !== "demo" && !(a.mode === "real" && a.allowReal))) throw Error("请先开启当前账户的 MT4 交易。");
  if (state.unresolved || state.commands.some(c => active.has(c.status))) throw Error("已有未完成指令，请先等待或核对执行回报。");
}
function requireContext(state: Mt4Status, plan: CloseAllPlan) {
  const a = state.snapshot?.account;
  if (state.accountKey !== plan.accountKey || state.snapshot?.sessionId !== plan.sessionId || a?.login !== plan.login || a?.server !== plan.server || a?.mode !== plan.mode) throw Error("账户或终端已变化，请重新确认全部平仓范围。");
  requireComplete(state);
  if (state.connection !== "connected" || !a.connected) throw Error("MT4 已断开，请读取并核对执行回报。");
}
export function captureCloseAllPlan(state: Mt4Status): CloseAllPlan {
  requireComplete(state); requireTrading(state);
  const snapshot = state.snapshot!;
  const positions = targets(state);
  if (!positions.length) throw Error("当前没有可平仓的持仓。");
  return { accountKey: state.accountKey, login: snapshot.account.login, server: snapshot.account.server, mode: snapshot.account.mode, sessionId: snapshot.sessionId, positions };
}
function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve,reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort",abort); reject(Error("已停止，已发送的指令仍需核对。")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort",abort); resolve(); }, milliseconds);
    signal?.addEventListener("abort",abort,{once:true}); if (signal?.aborted) abort();
  });
}
export async function runCloseAll(plan: CloseAllPlan, slippage: number, options: Options): Promise<CloseAllResult> {
  const now = options.now ?? Date.now, wait = options.wait ?? delay;
  const progress: CloseAllProgress = {total:plan.positions.length,closed:0,absent:0,remaining:plan.positions.length};
  let state: Mt4Status | undefined, pendingCommand: Mt4CommandInput | undefined;
  const publish = () => { progress.remaining = progress.total-progress.closed-progress.absent; options.onProgress?.({...progress}); };
  const assertRunning = () => { if (options.signal?.aborted) throw Error("已停止，已发送的指令仍需核对。"); };
  const request = async (payload?: {action:"command";command:Mt4CommandInput}) => {
    assertRunning();
    state = await options.request(payload, options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000));
    assertRunning(); options.onStatus?.(state); return state;
  };
  publish();
  try {
    if (!Number.isInteger(slippage) || slippage < 0 || slippage > 1000) throw Error("允许滑点应为 0–1000 的整数，请在下单设置中修改。");
    const first = await request(); requireContext(first,plan); requireTrading(first);
    if (JSON.stringify(targets(first)) !== JSON.stringify(plan.positions)) throw Error("持仓已变化，请重新确认全部平仓范围。");
    for (const target of plan.positions) {
      assertRunning();
      if (options.shouldStop?.()) throw Error("已停止后续平仓。");
      const current = await request(); requireContext(current,plan); requireTrading(current);
      const order = targets(current).find(o => o.ticket === target.ticket);
      if (!order) { progress.absent++; delete progress.currentTicket; publish(); continue; }
      if (JSON.stringify(order) !== JSON.stringify(target)) throw Error(`订单 ${target.ticket} 已变化，请重新核对持仓。`);
      const command: Mt4CommandInput = {id:(options.commandId ?? (()=>crypto.randomUUID()))(),accountKey:plan.accountKey,type:"close",symbol:target.symbol,ticket:target.ticket,slippage};
      progress.currentTicket = target.ticket; publish();
      if (options.shouldStop?.()) throw Error("已停止后续平仓。");
      pendingCommand = command; options.onPending?.(command);
      let next: Mt4Status;
      try { next = await request({action:"command",command}); }
      catch(e) { if (options.isDefiniteRejection?.(e)) { pendingCommand = undefined; options.onPending?.(null); } throw e; }
      const deadline = now() + (options.timeoutMs ?? 30000);
      while (true) {
        assertRunning(); requireContext(next,plan);
        const receipt = next.commands.find(c => c.id === command.id);
        if (receipt) {
          if (receipt.accountKey !== plan.accountKey || receipt.login !== plan.login || receipt.server !== plan.server || receipt.mode !== plan.mode || receipt.symbol !== target.symbol || receipt.ticket !== target.ticket || receipt.type !== "close") throw Error("平仓回报与本次订单不一致，请在 MT4 核对。");
          if (["failed","cancelled","resolved","unknown"].includes(receipt.status)) {
            if (receipt.status === "failed" || receipt.status === "cancelled") { pendingCommand = undefined; options.onPending?.(null); }
            throw Error(receipt.error || "平仓结果尚未确认，请在 MT4 核对执行回报。");
          }
          if (receipt.status === "succeeded" && !next.snapshot!.orders.some(o => o.ticket === target.ticket)) {
            pendingCommand = undefined; options.onPending?.(null); progress.closed++; delete progress.currentTicket; publish(); break;
          }
        }
        if (now() >= deadline) throw Error("平仓回报与持仓尚未确认一致，请重新读取并在 MT4 核对。");
        await wait(150,options.signal); next = await request();
      }
    }
    return {...progress,outcome:"complete",message:"本次确认的持仓已处理。",currentPositions:state ? targets(state).length : 0};
  } catch(e) {
    return {...progress,outcome:"stopped",message:e instanceof Error ? e.message : "全部平仓已停止，请核对执行回报。",pendingCommand,currentPositions:state ? targets(state).length : progress.remaining};
  }
}
