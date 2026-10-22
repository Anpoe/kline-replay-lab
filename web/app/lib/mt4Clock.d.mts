export type Mt4ClockAnchor = { serverTime: number; monotonicTime: number };
export type Mt4ClockState = { scope: string; receivedAt: number; anchor: Mt4ClockAnchor };
export type Mt4ClockReading = { serverTime?: number; receivedAt: number; anchor?: Mt4ClockAnchor; now: number; monotonicNow?: number };
export function synchronizeMt4Clock(previous: Mt4ClockState | null, input: Omit<Mt4ClockReading, 'anchor'> & { scope: string; connected: boolean; monotonicNow: number }): Mt4ClockState | null;
export function mt4ServerTime(input: Mt4ClockReading): number;
