import type { Mt4Command, Mt4CommandInput, Mt4Status } from './mt4Contracts.ts';

export function mt4CommandDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(Error('已停止，已发送的指令仍需核对。')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  });
}

/** Both bulk close and bulk entry use the existing single-command queue. */
export async function executeMt4Command(command: Mt4CommandInput, options: {
  request: (payload?: { action: 'command'; command: Mt4CommandInput }) => Promise<Mt4Status>;
  validateState: (state: Mt4Status) => void;
  validateReceipt: (receipt: Mt4Command) => void;
  applied: (state: Mt4Status, receipt: Mt4Command) => boolean;
  onRejected: () => void;
  signal?: AbortSignal; now?: () => number; timeoutMs?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  unknownMessage: string; timeoutMessage: string;
}) {
  const now = options.now ?? Date.now, wait = options.wait ?? mt4CommandDelay;
  let state = await options.request({ action: 'command', command });
  const deadline = now() + (options.timeoutMs ?? 30000);
  while (true) {
    if (options.signal?.aborted) throw Error('已停止，已发送的指令仍需核对。');
    options.validateState(state);
    const receipt = state.commands.find(item => item.id === command.id);
    if (receipt) {
      options.validateReceipt(receipt);
      if (['failed', 'cancelled', 'resolved', 'unknown'].includes(receipt.status)) {
        if (receipt.status === 'failed' || receipt.status === 'cancelled') options.onRejected();
        throw Error(receipt.error || options.unknownMessage);
      }
      if (receipt.status === 'succeeded' && options.applied(state, receipt)) return { state, receipt };
    }
    if (now() >= deadline) throw Error(options.timeoutMessage);
    await wait(150, options.signal); state = await options.request();
  }
}
