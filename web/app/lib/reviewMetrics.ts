import {
  accountNotional,
  accountPnl,
  sourceQuotePrice,
  type InstrumentEconomics,
} from "./fxTrading.ts";
import { CORPORATE_ACTION_APPLIED_EVENT_TYPE } from "./corporateActionExecution.ts";

type ReviewCorporateActionEvent = { type?: string; barTimestamp?: number; payload?: Record<string, unknown> };
type ReviewAction = { timestamp: number; ratio: number; cashPerShare: number; positionIds: string[] };

function positionActions(position: ReviewPosition, actions: ReviewAction[]) {
  return actions.filter(action => action.timestamp > position.entryTimestamp
    && (position.exitTimestamp == null || action.timestamp <= position.exitTimestamp)
    && action.positionIds.some(id => position.id === id || position.id.startsWith(`${id}:partial:`)));
}

function unitsAt(position: ReviewPosition, timestamp: number, actions: ReviewAction[]) {
  const futureRatio = actions.filter(action => action.timestamp > timestamp).reduce((ratio, action) => ratio * action.ratio, 1);
  const dividend = position.side === "long" ? actions.filter(action => action.timestamp <= timestamp).reduce((sum, action, index) => {
    const ratioFromEvent = actions.slice(index).reduce((ratio, next) => ratio * next.ratio, 1);
    return sum + position.qty / ratioFromEvent * action.cashPerShare;
  }, 0) : 0;
  return { entryPrice: position.entryPrice * futureRatio, qty: position.qty / futureRatio, dividend };
}

export const REVIEW_METRICS_VERSION = "2026.10-v4";

export type ReviewCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ReviewPosition = {
  id: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  entryIntrabar?: boolean;
  decisionSubmissionId?: string;
  status: "open" | "closed";
  exitPrice?: number;
  exitTimestamp?: number;
  realizedPnl?: number;
  grossRealizedPnl?: number;
  entryFee?: number;
  exitFee?: number;
  totalFees?: number;
  initialRisk?: number;
  exitReason?: string;
  intrabarAmbiguous?: boolean;
  instrumentEconomics?: InstrumentEconomics;
};

export type HorizonMetric = {
  bars: number;
  timestamp?: number;
  pnl?: number;
  returnPct?: number;
};

export type DeterministicTradeMetric = {
  positionId: string;
  decisionSubmissionId?: string;
  side: "long" | "short";
  qty: number;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  holdingBars: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  initialRisk?: number;
  rMultiple?: number;
  mfe: number;
  mae: number;
  mfeR?: number;
  maeR?: number;
  exitEfficiencyPct?: number;
  mfeTimestamp: number;
  maeTimestamp: number;
  exitReason?: string;
  intrabarAmbiguous: boolean;
  horizons: HorizonMetric[];
  evidenceComplete: boolean;
};

export type DeterministicReviewMetrics = {
  version: string;
  generatedFromBarCount: number;
  closedTrades: number;
  rQualifiedTrades: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  totalR?: number;
  averageR?: number;
  expectancy: number;
  expectancyR?: number;
  averageWin: number;
  averageLoss: number;
  payoffRatio: number | null;
  profitFactor: number | null;
  profitFactorInfinite: boolean;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownPeakTimestamp?: number;
  maxDrawdownTroughTimestamp?: number;
  maxUnderwaterBars: number;
  maxConsecutiveLosses: number;
  evidenceComplete: boolean;
  trades: DeterministicTradeMetric[];
};

const DEFAULT_HORIZONS = [1, 3, 5, 10];

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function findBarIndex(bars: ReviewCandle[], timestamp: number) {
  return bars.findIndex((bar) => bar.timestamp === timestamp);
}

function tradeMetric(
  position: ReviewPosition,
  bars: ReviewCandle[],
  horizons: number[],
  spreadBps: number,
  actions: ReviewAction[],
): DeterministicTradeMetric | null {
  if (position.status !== "closed" || position.exitTimestamp == null || position.exitPrice == null) return null;
  const entryIndex = findBarIndex(bars, position.entryTimestamp);
  const exitIndex = findBarIndex(bars, position.exitTimestamp);
  const evidenceComplete = entryIndex >= 0 && exitIndex >= entryIndex;
  const rangeStartIndex = entryIndex + (position.entryIntrabar ? 1 : 0);
  const range = evidenceComplete ? bars.slice(rangeStartIndex, exitIndex + 1) : [];
  let mfe = 0;
  let mae = 0;
  let mfeTimestamp = position.entryTimestamp;
  let maeTimestamp = position.entryTimestamp;
  const holdingActions = positionActions(position, actions);
  const pnlAt = (sourcePrice: number, timestamp: number) => {
    const units = unitsAt(position, timestamp, holdingActions);
    const exitSide = position.side === "long" ? "sell" : "buy";
    const quotePrice = sourceQuotePrice(exitSide, sourcePrice, spreadBps, position.instrumentEconomics);
    return (accountPnl(
      units.entryPrice,
      quotePrice,
      units.qty,
      position.side,
      position.instrumentEconomics,
    ) ?? 0) + units.dividend;
  };

  if (evidenceComplete && position.entryIntrabar) {
    const entryClose = pnlAt(bars[entryIndex].close, bars[entryIndex].timestamp);
    if (entryClose > mfe) mfe = entryClose;
    if (entryClose < mae) mae = entryClose;
  }

  for (const bar of range) {
    const favorablePrice = position.side === "long" ? bar.high : bar.low;
    const adversePrice = position.side === "long" ? bar.low : bar.high;
    const favorable = pnlAt(favorablePrice, bar.timestamp);
    const adverse = pnlAt(adversePrice, bar.timestamp);
    if (favorable > mfe) {
      mfe = favorable;
      mfeTimestamp = bar.timestamp;
    }
    if (adverse < mae) {
      mae = adverse;
      maeTimestamp = bar.timestamp;
    }
  }

  const fees = finite(position.totalFees, finite(position.entryFee) + finite(position.exitFee));
  const grossPnl = Number.isFinite(Number(position.grossRealizedPnl))
    ? Number(position.grossRealizedPnl)
    : finite(position.realizedPnl) + fees;
  const netPnl = Number.isFinite(Number(position.realizedPnl))
    ? Number(position.realizedPnl)
    : grossPnl - fees;
  const initialRisk = finite(position.initialRisk) > 0 ? finite(position.initialRisk) : undefined;
  const entryNotional = Math.abs(accountNotional(
    position.entryPrice,
    position.qty,
    position.instrumentEconomics,
  ) ?? position.entryPrice * position.qty);

  return {
    positionId: position.id,
    decisionSubmissionId: position.decisionSubmissionId,
    side: position.side,
    qty: position.qty,
    entryTimestamp: position.entryTimestamp,
    exitTimestamp: position.exitTimestamp,
    entryPrice: position.entryPrice,
    exitPrice: position.exitPrice,
    holdingBars: evidenceComplete ? Math.max(1, exitIndex - entryIndex) : 0,
    grossPnl,
    fees,
    netPnl,
    initialRisk,
    rMultiple: initialRisk ? netPnl / initialRisk : undefined,
    mfe,
    mae,
    mfeR: initialRisk ? mfe / initialRisk : undefined,
    maeR: initialRisk ? mae / initialRisk : undefined,
    exitEfficiencyPct: mfe > 0 ? netPnl / mfe * 100 : undefined,
    mfeTimestamp,
    maeTimestamp,
    exitReason: position.exitReason,
    intrabarAmbiguous: position.intrabarAmbiguous === true,
    horizons: horizons.map((barsAfterEntry) => {
      const bar = entryIndex >= 0 ? bars[entryIndex + barsAfterEntry] : undefined;
      if (!bar) return { bars: barsAfterEntry };
      const pnl = pnlAt(bar.close, bar.timestamp);
      return {
        bars: barsAfterEntry,
        timestamp: bar.timestamp,
        pnl,
        returnPct: entryNotional > 0 ? pnl / entryNotional * 100 : 0,
      };
    }),
    evidenceComplete,
  };
}

function equityDrawdown(
  bars: ReviewCandle[],
  positions: ReviewPosition[],
  initialCapital: number,
  spreadBps: number,
  actions: ReviewAction[],
) {
  if (!bars.length) return {
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    maxUnderwaterBars: 0,
    peakTimestamp: undefined,
    troughTimestamp: undefined,
  };
  let peakEquity = initialCapital;
  let peakTimestamp = bars[0].timestamp;
  let currentUnderwaterBars = 0;
  let maxUnderwaterBars = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let drawdownPeakTimestamp: number | undefined;
  let troughTimestamp: number | undefined;

  for (const bar of bars) {
    const pnl = positions.reduce((sum, position) => {
      if (position.entryTimestamp > bar.timestamp) return sum;
      const units = unitsAt(position, bar.timestamp, positionActions(position, actions));
      if (position.status === "closed" && position.exitTimestamp != null && position.exitTimestamp <= bar.timestamp) {
        return sum + finite(position.realizedPnl) + units.dividend;
      }
      const exitSide = position.side === "long" ? "sell" : "buy";
      const quotePrice = sourceQuotePrice(exitSide, bar.close, spreadBps, position.instrumentEconomics);
      const floating = accountPnl(
        units.entryPrice,
        quotePrice,
        units.qty,
        position.side,
        position.instrumentEconomics,
      ) ?? 0;
      return sum + floating - finite(position.entryFee) + units.dividend;
    }, 0);
    const equity = initialCapital + pnl;
    if (equity >= peakEquity) {
      peakEquity = equity;
      peakTimestamp = bar.timestamp;
      currentUnderwaterBars = 0;
      continue;
    }
    currentUnderwaterBars += 1;
    maxUnderwaterBars = Math.max(maxUnderwaterBars, currentUnderwaterBars);
    const drawdown = peakEquity - equity;
    const drawdownPct = peakEquity > 0 ? drawdown / peakEquity * 100 : 0;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = drawdownPct;
      drawdownPeakTimestamp = peakTimestamp;
      troughTimestamp = bar.timestamp;
    }
  }
  return { maxDrawdown, maxDrawdownPct, maxUnderwaterBars, peakTimestamp: drawdownPeakTimestamp, troughTimestamp };
}

export function calculateDeterministicReviewMetrics(input: {
  bars: ReviewCandle[];
  positions: ReviewPosition[];
  initialCapital: number;
  horizons?: number[];
  spreadBps?: number;
  corporateActionEvents?: ReviewCorporateActionEvent[];
}): DeterministicReviewMetrics {
  const bars = [...input.bars]
    .filter((bar) => Number.isFinite(bar.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  const horizons = (input.horizons ?? DEFAULT_HORIZONS)
    .map((value) => Math.max(1, Math.round(value)))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right);
  const seen = new Set<string>();
  const actions = (input.corporateActionEvents ?? []).flatMap(event => {
    if (event.type !== CORPORATE_ACTION_APPLIED_EVENT_TYPE || !Number.isFinite(event.barTimestamp)) return [];
    const id = String(event.payload?.eventId ?? "");
    if (!id || seen.has(id)) return [];
    const ratio = 1 + Number(event.payload?.bonusSharesPer10 ?? 0) / 10;
    const cashPerShare = Number(event.payload?.cashPer10 ?? 0) / 10;
    if (!Number.isFinite(ratio) || ratio < 1 || !Number.isFinite(cashPerShare) || cashPerShare < 0) return [];
    seen.add(id);
    return [{ timestamp: event.barTimestamp!, ratio, cashPerShare, positionIds: Array.isArray(event.payload?.positionIds) ? event.payload.positionIds.filter((value): value is string => typeof value === "string") : [] }];
  }).sort((a, b) => a.timestamp - b.timestamp);
  const trades = input.positions
    .map((position) => tradeMetric(position, bars, horizons, Math.max(0, finite(input.spreadBps)), actions))
    .filter((metric): metric is DeterministicTradeMetric => Boolean(metric))
    .sort((left, right) => left.exitTimestamp - right.exitTimestamp || left.positionId.localeCompare(right.positionId));
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const rTrades = trades.filter((trade) => trade.rMultiple != null);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const totalR = rTrades.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0);
  let maxConsecutiveLosses = 0;
  let currentLosses = 0;
  for (const trade of trades) {
    currentLosses = trade.netPnl < 0 ? currentLosses + 1 : 0;
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
  }
  const drawdown = equityDrawdown(
    bars,
    input.positions,
    Math.max(0, finite(input.initialCapital)),
    Math.max(0, finite(input.spreadBps)),
    actions,
  );

  return {
    version: REVIEW_METRICS_VERSION,
    generatedFromBarCount: bars.length,
    closedTrades: trades.length,
    rQualifiedTrades: rTrades.length,
    grossPnl: trades.reduce((sum, trade) => sum + trade.grossPnl, 0),
    fees: trades.reduce((sum, trade) => sum + trade.fees, 0),
    netPnl: trades.reduce((sum, trade) => sum + trade.netPnl, 0),
    totalR: rTrades.length ? totalR : undefined,
    averageR: rTrades.length ? totalR / rTrades.length : undefined,
    expectancy: trades.length ? trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length : 0,
    expectancyR: rTrades.length ? totalR / rTrades.length : undefined,
    averageWin: wins.length ? grossProfit / wins.length : 0,
    averageLoss: losses.length ? grossLoss / losses.length : 0,
    payoffRatio: losses.length && grossLoss > 0 ? (wins.length ? grossProfit / wins.length : 0) / (grossLoss / losses.length) : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    profitFactorInfinite: grossLoss === 0 && grossProfit > 0,
    maxDrawdown: drawdown.maxDrawdown,
    maxDrawdownPct: drawdown.maxDrawdownPct,
    maxDrawdownPeakTimestamp: drawdown.peakTimestamp,
    maxDrawdownTroughTimestamp: drawdown.troughTimestamp,
    maxUnderwaterBars: drawdown.maxUnderwaterBars,
    maxConsecutiveLosses,
    evidenceComplete: trades.every((trade) => trade.evidenceComplete),
    trades,
  };
}
