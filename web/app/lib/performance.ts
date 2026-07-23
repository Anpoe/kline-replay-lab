export type PerformanceRecord = {
  totalPnl: number;
  realizedPnl: number;
  floatingPnl: number;
  status: "active" | "completed";
  closedTradePnls: number[];
  planScores: number[];
  updatedAt: string;
};

export type PerformanceMetrics = {
  sessions: number;
  completedSessions: number;
  completionRate: number;
  totalPnl: number;
  realizedPnl: number;
  floatingPnl: number;
  averagePnl: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  flatTrades: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  maxDrawdown: number;
  planCount: number;
  averagePlanScore: number;
};

export function summarizePerformance(records: PerformanceRecord[]): PerformanceMetrics {
  const closedTradePnls = records.flatMap((record) => record.closedTradePnls);
  const planScores = records.flatMap((record) => record.planScores);
  const winningTrades = closedTradePnls.filter((pnl) => pnl > 0).length;
  const losingTrades = closedTradePnls.filter((pnl) => pnl < 0).length;
  const flatTrades = closedTradePnls.length - winningTrades - losingTrades;
  const grossProfit = closedTradePnls
    .filter((pnl) => pnl > 0)
    .reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(closedTradePnls
    .filter((pnl) => pnl < 0)
    .reduce((sum, pnl) => sum + pnl, 0));
  const totalPnl = records.reduce((sum, record) => sum + record.totalPnl, 0);
  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;

  [...records]
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .forEach((record) => {
      cumulativePnl += record.totalPnl;
      peakPnl = Math.max(peakPnl, cumulativePnl);
      maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl);
    });

  return {
    sessions: records.length,
    completedSessions: records.filter((record) => record.status === "completed").length,
    completionRate: records.length
      ? Math.round(records.filter((record) => record.status === "completed").length / records.length * 100)
      : 0,
    totalPnl,
    realizedPnl: records.reduce((sum, record) => sum + record.realizedPnl, 0),
    floatingPnl: records.reduce((sum, record) => sum + record.floatingPnl, 0),
    averagePnl: records.length ? totalPnl / records.length : 0,
    closedTrades: closedTradePnls.length,
    winningTrades,
    losingTrades,
    flatTrades,
    winRate: closedTradePnls.length ? Math.round(winningTrades / closedTradePnls.length * 100) : 0,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
    maxDrawdown,
    planCount: planScores.length,
    averagePlanScore: planScores.length
      ? Math.round(planScores.reduce((sum, score) => sum + score, 0) / planScores.length)
      : 0,
  };
}
