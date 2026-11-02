import type { KLineData } from 'klinecharts';
export type CandleHistoryState = { identity?: string; bars: KLineData[]; digits?: number; loading: boolean; error: string; hasBefore: boolean; hasAfter: boolean };
export type CandlePage = { bars: KLineData[]; hasBefore: boolean; hasAfter?: boolean; digits?: number };
export function mergeCandles(previous: KLineData[], incoming: KLineData[]): KLineData[];
export function createCandleHistory<C extends { live: boolean }, P extends CandlePage>(options: {
  load: (query: C & { before?: number; after?: number; focus?: number }, signal: AbortSignal) => Promise<P>;
  onChange: (state: CandleHistoryState) => void;
  keyOf: (context: C, focus: number) => string;
  validate?: (page: P, context: C) => void;
  loadInitial?: boolean;
}): {
  getState(): CandleHistoryState;
  setContext(context: C | null, seed?: KLineData[], focus?: number): void;
  update(seed: KLineData[]): void;
  extend(direction: 'before' | 'after'): Promise<void> | undefined;
  retry(): Promise<void> | undefined;
  dispose(): void;
};
