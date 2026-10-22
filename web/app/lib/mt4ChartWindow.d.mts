import type { Mt4ClockAnchor } from './mt4Clock.mjs';
import type { KLineData } from 'klinecharts';
export type Mt4ChartMotionSettings = { enabled: boolean; startSeconds: number; endSeconds: number };
export type Mt4ChartWindowState = 'live' | 'frozen' | 'paused' | 'clock' | 'waiting';
export type Mt4CandleClock = { serverTime?: number; receivedAt: number; connected: boolean; timeframe: number; anchor?: Mt4ClockAnchor };
export type Mt4ChartFrame<T extends KLineData> = { scope: string; bars: T[] };
export const DEFAULT_MT4_CHART_MOTION: Readonly<Mt4ChartMotionSettings>;
export function normalizeMt4ChartMotion(value: unknown): Mt4ChartMotionSettings;
export function mt4ChartWindow(input: Mt4CandleClock & { settings: Mt4ChartMotionSettings; openTime: number; now: number; monotonicNow?: number }): Mt4ChartWindowState;
export function selectMt4ChartFrame<T extends KLineData>(previous: Mt4ChartFrame<T> | null, next: { scope: string; bars: T[]; window: Mt4ChartWindowState }): Mt4ChartFrame<T>;

export type Mt4FloatingOrder = { ticket: number; symbol: string; openTime: number; type: number; lots?: number; profit: number; swap: number; commission: number };
export type Mt4FloatingInput = { profit: number; orders: Mt4FloatingOrder[] };
export type Mt4FloatingFrame = { scope: string; barTimestamp: number; profit: number; orderProfits: Record<string, number> };
export function mt4FloatingOrderKey(order: Pick<Mt4FloatingOrder, 'ticket' | 'symbol' | 'openTime' | 'type' | 'lots'>): string;
export function selectMt4FloatingFrame(previous: Mt4FloatingFrame | null, next: Mt4FloatingInput & { scope: string; barTimestamp: number; window: Mt4ChartWindowState }): Mt4FloatingFrame;
