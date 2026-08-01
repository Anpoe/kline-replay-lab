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
  winningSessions: number;
  losingSessions: number;
  flatSessions: number;
  sessionWinRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  maxDrawdown: number;
  planCount: number;
  averagePlanScore: number;
};

export type HabitTrade = {
  result: number;
  holdingBars: number;
  decision?: {
    marketState: string;
    location: string;
    reasons: string[];
    score: number;
    hasStop: boolean;
    hasTarget: boolean;
    hasNote: boolean;
    riskReward?: number;
    source: "pretrade" | "backfilled";
  };
  patterns: string[];
};

export type PerformanceBreakdown = {
  key: string;
  label: string;
  samples: number;
  winningTrades: number;
  losingTrades: number;
  flatTrades: number;
  winRate: number;
  averageResult: number;
  totalResult: number;
  profitFactor: number | null;
  eligible: boolean;
};

export type PerformanceHabitAnalysis = {
  holdingPeriods: PerformanceBreakdown[];
  marketStates: PerformanceBreakdown[];
  locations: PerformanceBreakdown[];
  reasons: PerformanceBreakdown[];
  planTraits: PerformanceBreakdown[];
  patterns: PerformanceBreakdown[];
  combinations: PerformanceBreakdown[];
  attributedTrades: number;
  pretradeAttributedTrades: number;
  backfilledAttributedTrades: number;
};

const MIN_INSIGHT_SAMPLES = 2;

function holdingPeriodLabel(holdingBars: number) {
  if (holdingBars <= 1) return "约 1 根 K 线";
  if (holdingBars <= 3) return "约 2–3 根 K 线";
  if (holdingBars <= 10) return "约 4–10 根 K 线";
  if (holdingBars <= 20) return "约 11–20 根 K 线";
  return "约 21 根 K 线以上";
}

function summarizeBreakdown(
  trades: HabitTrade[],
  dimensions: (trade: HabitTrade) => Array<{ key: string; label: string }>,
) {
  const groups = new Map<string, { label: string; results: number[] }>();
  trades.forEach((trade) => {
    const uniqueDimensions = new Map(dimensions(trade).map((dimension) => [dimension.key, dimension]));
    uniqueDimensions.forEach((dimension) => {
      const group = groups.get(dimension.key) ?? { label: dimension.label, results: [] };
      group.results.push(trade.result);
      groups.set(dimension.key, group);
    });
  });

  return [...groups.entries()]
    .map(([key, group]): PerformanceBreakdown => {
      const winningTrades = group.results.filter((result) => result > 0).length;
      const losingTrades = group.results.filter((result) => result < 0).length;
      const flatTrades = group.results.length - winningTrades - losingTrades;
      const decisiveTrades = winningTrades + losingTrades;
      const grossProfit = group.results.filter((result) => result > 0).reduce((sum, result) => sum + result, 0);
      const grossLoss = Math.abs(group.results.filter((result) => result < 0).reduce((sum, result) => sum + result, 0));
      const totalResult = group.results.reduce((sum, result) => sum + result, 0);
      return {
        key,
        label: group.label,
        samples: group.results.length,
        winningTrades,
        losingTrades,
        flatTrades,
        winRate: decisiveTrades ? Math.round(winningTrades / decisiveTrades * 100) : 0,
        averageResult: group.results.length ? totalResult / group.results.length : 0,
        totalResult,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
        eligible: group.results.length >= MIN_INSIGHT_SAMPLES,
      };
    })
    .sort((left, right) => (
      Number(right.eligible) - Number(left.eligible)
      || right.averageResult - left.averageResult
      || right.samples - left.samples
      || right.winRate - left.winRate
      || left.label.localeCompare(right.label, "zh-CN")
    ))
    .slice(0, 6);
}

export function analyzePerformanceHabits(trades: HabitTrade[]): PerformanceHabitAnalysis {
  const withDecision = trades.filter((trade) => trade.decision);
  return {
    holdingPeriods: summarizeBreakdown(trades, (trade) => {
      const label = holdingPeriodLabel(Math.max(1, Math.round(trade.holdingBars) || 1));
      return [{ key: label, label }];
    }),
    marketStates: summarizeBreakdown(withDecision, (trade) => {
      const label = trade.decision?.marketState.trim();
      return label ? [{ key: label, label }] : [];
    }),
    locations: summarizeBreakdown(withDecision, (trade) => {
      const label = trade.decision?.location.trim();
      return label ? [{ key: label, label }] : [];
    }),
    reasons: summarizeBreakdown(withDecision, (trade) => (
      (trade.decision?.reasons ?? []).map((reason) => ({ key: reason, label: reason }))
    )),
    planTraits: summarizeBreakdown(withDecision, (trade) => {
      const decision = trade.decision;
      if (!decision) return [];
      const completeness = decision.score >= 100
        ? "计划完整度 100%"
        : decision.score >= 70 ? "计划完整度 70–99%" : "计划完整度低于 70%";
      const riskReward = decision.riskReward;
      return [
        { key: completeness, label: completeness },
        { key: `stop-${decision.hasStop}`, label: decision.hasStop ? "填写止损" : "未填写止损" },
        { key: `target-${decision.hasTarget}`, label: decision.hasTarget ? "填写目标" : "未填写目标" },
        { key: `note-${decision.hasNote}`, label: decision.hasNote ? "填写计划说明" : "未填写计划说明" },
        ...(typeof riskReward === "number" && Number.isFinite(riskReward) ? [{
          key: riskReward < 1
            ? "rr-below-1"
            : riskReward < 2 ? "rr-1-2" : riskReward < 3 ? "rr-2-3" : "rr-3-plus",
          label: riskReward < 1
            ? "计划盈亏比低于 1"
            : riskReward < 2 ? "计划盈亏比 1–2" : riskReward < 3 ? "计划盈亏比 2–3" : "计划盈亏比 3 以上",
        }] : []),
      ];
    }),
    patterns: summarizeBreakdown(trades, (trade) => (
      trade.patterns.map((pattern) => ({ key: pattern, label: pattern }))
    )),
    combinations: summarizeBreakdown(withDecision, (trade) => {
      const decision = trade.decision;
      if (!decision) return [];
      const pattern = trade.patterns.length ? trade.patterns.join(" / ") : "未使用形态筛选";
      const reasons = decision.reasons.length ? decision.reasons.slice().sort().join(" + ") : "未填写理由";
      const label = `${pattern} · ${decision.marketState} · ${decision.location} · ${reasons}`;
      return [{ key: label, label }];
    }),
    attributedTrades: withDecision.length,
    pretradeAttributedTrades: withDecision.filter((trade) => trade.decision?.source === "pretrade").length,
    backfilledAttributedTrades: withDecision.filter((trade) => trade.decision?.source === "backfilled").length,
  };
}

export function summarizePerformance(records: PerformanceRecord[]): PerformanceMetrics {
  const closedTradePnls = records.flatMap((record) => record.closedTradePnls);
  const planScores = records.flatMap((record) => record.planScores);
  const winningTrades = closedTradePnls.filter((pnl) => pnl > 0).length;
  const losingTrades = closedTradePnls.filter((pnl) => pnl < 0).length;
  const flatTrades = closedTradePnls.length - winningTrades - losingTrades;
  const decisiveTrades = winningTrades + losingTrades;
  const winningSessions = records.filter((record) => record.totalPnl > 0).length;
  const losingSessions = records.filter((record) => record.totalPnl < 0).length;
  const flatSessions = records.length - winningSessions - losingSessions;
  const decisiveSessions = winningSessions + losingSessions;
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
    winRate: decisiveTrades ? Math.round(winningTrades / decisiveTrades * 100) : 0,
    winningSessions,
    losingSessions,
    flatSessions,
    sessionWinRate: decisiveSessions ? Math.round(winningSessions / decisiveSessions * 100) : 0,
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
