import type { Mt4ClockReading } from './mt4Clock.mjs';
export function mt4CandleCountdown(input: Mt4ClockReading & { openTime: number; timeframe: number; connected: boolean }): string | null;
export function mt4CandleCloseTime(openTime: number, timeframe: number): number | null;
