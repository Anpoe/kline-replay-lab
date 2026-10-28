import type { KLineData } from 'klinecharts';
import type { Mt4Analysis, Mt4Decision } from './mt4Analysis';
import type { Mt4Order } from './mt4Contracts';

export type ArchiveAccount = { accountKey: string; login: string; server: string; mode: string; currency: string; updatedAt: number; symbols: string[]; market?: { complete?: number; queued?: number; missing?: number }; scan: { total?: number; offset?: number; complete?: boolean } };
export type ArchiveAnalysis = { revision: number; data: Mt4Analysis | null; updatedAt: number };
export type ArchiveOrder = Mt4Order & { timeframe: number; firstSeen: number; lastSeen: number; position?: number };
export type ArchiveTrade = { accountKey: string; symbol: string; timeframe: number; order: Mt4Order; digits: number; bars: KLineData[]; focusCovered?: boolean; analysis: ArchiveAnalysis;
  events: { id: number; observedAt: number; capturedAt: number; source: string; order: Mt4Order; evidence: { chart: { symbol: string; timeframe: number; bars: KLineData[] } | null; analysis: ArchiveAnalysis | null } }[] };
export type ArchiveContext = { accountKey: string; symbol: string; timeframe: number; scope?: string };
export type DecisionPlanSource = { timeframe: number; scope: string; decisionId: string };
export type ArchiveDecisionPlan = { timeframe: number; scope: string; decision: Mt4Decision };
export type ArchiveDecisionPlans = { plans: ArchiveDecisionPlan[]; nextOffset: number | null };

export type HistoryFilter = { symbol: string; from: string; to: string; showOnChart: boolean };
export type HistoryFilterSelection = { account: ArchiveAccount; filter: HistoryFilter; navigate: boolean };
export type HistoryRecords = { accountKey: string; chartSymbol: string; orders: ArchiveOrder[]; limited: boolean; showOnChart: boolean };
export type HistoryChartSelection = { accountKey: string; order: ArchiveOrder; focus: number; nonce: number };
export type ArchiveChart = { accountKey: string; symbol: string; timeframe: number; bars: KLineData[]; digits: number; limited: boolean; updatedAt: number };
