import type { Mt4CommandInput, Mt4Status } from './mt4Contracts.ts';
import { executeMt4Command } from './mt4CommandRunner.ts';

export type OpenBatchPlan = {
  accountKey: string; login: string; server: string; mode: string; sessionId: string;
  symbol: string; timeframe: number; count: number; command: Mt4CommandInput; commands?: Mt4CommandInput[]; existingTickets: number[];
};
export type OpenBatchProgress = { total: number; completed: number; remaining: number; tickets: number[]; currentIndex?: number };
export type OpenBatchResult = OpenBatchProgress & { outcome: 'complete' | 'stopped'; message: string; pendingCommand?: Mt4CommandInput };
type Options = {
  request: (payload?: { action: 'command'; command: Mt4CommandInput }, signal?: AbortSignal) => Promise<Mt4Status>;
  commandId?: () => string; signal?: AbortSignal; shouldStop?: () => boolean;
  onStatus?: (state: Mt4Status) => void; onProgress?: (progress: OpenBatchProgress) => void;
  onPending?: (command: Mt4CommandInput | null) => void; isDefiniteRejection?: (error: unknown) => boolean;
  beforeEach?: (state: Mt4Status, command: Mt4CommandInput) => void;
  now?: () => number; wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>; timeoutMs?: number;
};
function requireTrading(state: Mt4Status) {
  const a = state.snapshot?.account;
  if (state.connection !== 'connected' || !a?.connected || !state.enabled || !a.tradeAllowed || (a.mode !== 'demo' && !(a.mode === 'real' && a.allowReal))) throw Error('请连接并开启当前账户的 MT4 交易。');
  if (state.unresolved || state.commands.some(c => ['queued', 'sent', 'unknown'].includes(c.status))) throw Error('已有未完成指令，请先等待或核对执行回报。');
  if (state.snapshot!.orderCount > state.snapshot!.orders.length) throw Error('订单列表不完整，请在 MT4 核对后重试。');
}
function requireContext(state: Mt4Status, plan: OpenBatchPlan) {
  const a = state.snapshot?.account;
  if (state.accountKey !== plan.accountKey || state.snapshot?.sessionId !== plan.sessionId || a?.login !== plan.login || a?.server !== plan.server || a?.mode !== plan.mode) throw Error('账户或终端已变化，后续下单已停止。');
  if (state.selection.symbol !== plan.symbol || state.selection.timeframe !== plan.timeframe) throw Error('品种或周期已变化，后续下单已停止。');
  if (state.connection !== 'connected' || !a.connected) throw Error('MT4 已断开，请核对当前指令的执行回报。');
}
export function captureOpenBatchPlan(state: Mt4Status, command: Mt4CommandInput, count: number, commands?: Mt4CommandInput[]): OpenBatchPlan {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw Error('订单数应为 1–10 的整数。');
  requireTrading(state);
  if (commands && (commands.length !== count || new Set(commands.map(c => c.id)).size !== count)) throw Error('每笔订单参数与订单数不一致，请重新检查。');
  if ((commands ?? [command]).some(c => c.type !== 'open' || c.accountKey !== state.accountKey || c.symbol !== state.selection.symbol)) throw Error('下单账户或品种已变化，请重新选择。');
  const snapshot = state.snapshot!;
  return { accountKey: state.accountKey, login: snapshot.account.login, server: snapshot.account.server, mode: snapshot.account.mode, sessionId: snapshot.sessionId,
    symbol: command.symbol, timeframe: state.selection.timeframe, count, command: { ...command }, commands: commands?.map(c => ({ ...c })), existingTickets: [...snapshot.orders, ...snapshot.history].map(order => order.ticket) };
}
export async function runOpenBatch(plan: OpenBatchPlan, options: Options): Promise<OpenBatchResult> {
  const progress: OpenBatchProgress = { total: plan.count, completed: 0, remaining: plan.count, tickets: [] };
  let pendingCommand: Mt4CommandInput | undefined;
  const publish = () => { progress.remaining = progress.total - progress.completed; options.onProgress?.({ ...progress, tickets: [...progress.tickets] }); };
  const clearPending = () => { pendingCommand = undefined; options.onPending?.(null); };
  const request = async (payload?: { action: 'command'; command: Mt4CommandInput }) => {
    if (options.signal?.aborted) throw Error('已停止，已发送的指令仍需核对。');
    const state = await options.request(payload, options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000));
    if (options.signal?.aborted) throw Error('已停止，已发送的指令仍需核对。');
    options.onStatus?.(state); return state;
  };
  publish();
  try {
    for (let index = 0; index < plan.count; index++) {
      if (options.shouldStop?.()) throw Error('已停止后续下单，已成功的订单保留。');
      const state = await request(); requireContext(state, plan); requireTrading(state);
      const command = plan.commands ? { ...plan.commands[index] } : { ...plan.command, id: index === 0 ? plan.command.id : (options.commandId ?? (() => crypto.randomUUID()))() };
      if (state.commands.some(c => c.id === command.id)) throw Error('下单标识已使用，请核对执行回报后重新提交。');
      options.beforeEach?.(state, command);
      if (options.shouldStop?.()) throw Error('已停止后续下单，已成功的订单保留。');
      progress.currentIndex = index + 1; publish(); pendingCommand = command; options.onPending?.(command);
      try {
        const { receipt } = await executeMt4Command(command, {
          request, signal: options.signal, now: options.now, wait: options.wait, timeoutMs: options.timeoutMs,
          validateState: next => requireContext(next, plan),
          validateReceipt: receipt => {
            if (receipt.accountKey !== plan.accountKey || receipt.login !== plan.login || receipt.server !== plan.server || receipt.mode !== plan.mode || receipt.symbol !== plan.symbol || receipt.type !== 'open' || receipt.side !== command.side || receipt.orderType !== command.orderType || !(receipt.ticket > 0 || receipt.status !== 'succeeded') || (receipt.ticket > 0 && (plan.existingTickets.includes(receipt.ticket) || progress.tickets.includes(receipt.ticket)))) throw Error('下单回报与本次批次不一致，请在 MT4 核对。');
          },
          applied: (next, receipt) => [...next.snapshot!.orders, ...next.snapshot!.history].some(order => order.ticket === receipt.ticket && order.symbol === plan.symbol && order.type % 2 === (command.side === 'buy' ? 0 : 1)),
          onRejected: clearPending,
          unknownMessage: '下单结果尚未确认，后续已停止，请在 MT4 核对。', timeoutMessage: '下单回报与订单尚未确认一致，后续已停止，请在 MT4 核对。',
        });
        clearPending(); progress.completed++; progress.tickets.push(receipt.ticket); delete progress.currentIndex; publish();
      } catch (error) { if (options.isDefiniteRejection?.(error)) clearPending(); throw error; }
    }
    return { ...progress, outcome: 'complete', message: '本批订单已全部执行。' };
  } catch (error) { return { ...progress, outcome: 'stopped', pendingCommand, message: error instanceof Error ? error.message : '批量下单已停止，请核对 MT4。' }; }
}
