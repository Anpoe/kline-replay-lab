import type { KLineData } from 'klinecharts';
export type Mt4CandleContext = { accountKey: string; symbol: string; timeframe: number; live: boolean };
export type Mt4CandlePage = { accountKey: string; symbol: string; timeframe: number; bars: KLineData[]; hasBefore: boolean; hasAfter: boolean; digits: number; updatedAt: number };
export type Mt4CandleHistoryState = { identity?: string; bars: KLineData[]; digits?: number; loading: boolean; error: string; hasBefore: boolean; hasAfter: boolean };
export function mergeMt4Candles(previous: KLineData[], incoming: KLineData[]): KLineData[];
export function createMt4CandleHistory(options: { load: (query: Mt4CandleContext & { before?: number; after?: number; focus?: number }, signal: AbortSignal) => Promise<Mt4CandlePage>; onChange: (state: Mt4CandleHistoryState) => void }): {
  getState(): Mt4CandleHistoryState;
  setContext(context: Mt4CandleContext | null, seed?: KLineData[], focus?: number): void;
  update(seed: KLineData[]): void;
  extend(direction: 'before' | 'after'): Promise<void> | undefined;
  retry(): Promise<void> | undefined;
  dispose(): void;
};
