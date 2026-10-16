import type { TradeMarker } from '../components/KLineReplayChart';
import type { Mt4Order } from '../features/mt4/mt4Contracts';
export type HistoryFilter = { symbol:string; from:string; to:string; showOnChart:boolean };
export type HistoryPreferences = { version:1; accountKey:string; accounts:Record<string,HistoryFilter> };
export function dateRangeBounds(from?:string,to?:string):{start:number|null;end:number|null};
export function readHistoryPreferences(raw:string|null):HistoryPreferences;
export function rememberHistoryFilter(preferences:HistoryPreferences,accountKey:string,filter:HistoryFilter):HistoryPreferences;
export function mt4PeriodEnd(timestamp:number,timeframe:number):number;
export function buildMt4HistoryMarkers(orders:Mt4Order[],bars:{timestamp:number}[],timeframe:number,accountKey:string):Array<TradeMarker & { accountKey:string;symbol:string;ticket:number }>;
