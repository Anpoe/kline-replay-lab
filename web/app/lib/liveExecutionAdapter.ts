import {
  executeBarStep,
  type EngineFill,
  type EngineOrder,
  type EnginePosition,
  type EngineRejection,
  type ExecutionBar,
  type ExecutionCostProfile,
  type ExecutionStepResult,
} from "./executionEngine.ts";
import type { InstrumentEconomics } from "./fxTrading.ts";

export type LiveExecutionBar = ExecutionBar & {
  closed?: boolean;
  turnover?: number | null;
  source?: string;
  qualityFlags?: string[];
  revision?: string | null;
  priceBasis?: "raw" | "adjusted" | "unknown";
};

export type LiveExecutionValidation =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type LiveExecutionFill = EngineFill & {
  barEvidence: LiveExecutionBar;
};

export type LiveExecutionRejection = EngineRejection & {
  timestamp: number;
  barEvidence: LiveExecutionBar;
};

export type LiveExecutionRunInput<
  TOrder extends EngineOrder = EngineOrder,
  TPosition extends EnginePosition = EnginePosition,
> = {
  bars: LiveExecutionBar[];
  orders: TOrder[];
  positions: TPosition[];
  profile?: Partial<ExecutionCostProfile>;
  cashBalance: number;
  capitalMode: boolean;
  instrumentEconomics?: InstrumentEconomics;
  validateFill?: (order: TOrder, rawPrice: number, bar: LiveExecutionBar) => LiveExecutionValidation;
  validateProtectiveFill?: (
    position: TPosition,
    side: "buy" | "sell",
    rawPrice: number,
    reason: "stop_loss" | "take_profit",
    bar: LiveExecutionBar,
  ) => LiveExecutionValidation;
  skipProtectiveExits?: boolean;
};

export type LiveExecutionRunResult<
  TOrder extends EngineOrder,
  TPosition extends EnginePosition,
> = {
  positions: TPosition[];
  remainingOrders: TOrder[];
  fills: LiveExecutionFill[];
  rejections: LiveExecutionRejection[];
  cashBalance: number;
  processedBars: LiveExecutionBar[];
  lastStep?: ExecutionStepResult<TOrder, TPosition>;
};

function completeBar(value: LiveExecutionBar): value is LiveExecutionBar & Required<Pick<ExecutionBar, "timestamp" | "open" | "high" | "low" | "close">> {
  const timestamp = Number(value.timestamp);
  const open = Number(value.open);
  const high = Number(value.high);
  const low = Number(value.low);
  const close = Number(value.close);
  return value.closed !== false
    && Number.isFinite(timestamp)
    && Number.isFinite(open)
    && Number.isFinite(high)
    && Number.isFinite(low)
    && Number.isFinite(close)
    && timestamp > 0
    && open > 0
    && high >= Math.max(open, close)
    && low > 0
    && low <= Math.min(open, close);
}

/**
 * Produces a stable content identity when a market provider does not expose
 * its own revision.  It intentionally includes volume and turnover so a
 * corrected non-price field is visible without ever re-entering the engine.
 */
export function stableLiveBarRevision(bar: Pick<LiveExecutionBar, "timestamp" | "open" | "high" | "low" | "close" | "volume" | "turnover" | "source" | "qualityFlags" | "priceBasis">) {
  const qualityFlags = [...(bar.qualityFlags ?? [])].sort().join(",");
  return [
    "ohlcv-v1",
    bar.timestamp,
    bar.open,
    bar.high,
    bar.low,
    bar.close,
    bar.volume ?? "",
    bar.turnover ?? "",
    bar.source ?? "",
    qualityFlags,
    bar.priceBasis ?? "unknown",
  ].join("|");
}

function normalizedBars(bars: LiveExecutionBar[]) {
  const byTimestamp = new Map<number, LiveExecutionBar>();
  for (const bar of bars) {
    if (!completeBar(bar)) continue;
    byTimestamp.set(Number(bar.timestamp), {
      ...bar,
      timestamp: Number(bar.timestamp),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      ...(bar.volume == null ? { volume: null } : { volume: Number(bar.volume) }),
      ...(bar.turnover == null ? { turnover: null } : { turnover: Number(bar.turnover) }),
      revision: bar.revision ?? stableLiveBarRevision({
        ...bar,
        timestamp: Number(bar.timestamp),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: bar.volume == null ? null : Number(bar.volume),
        turnover: bar.turnover == null ? null : Number(bar.turnover),
      }),
    });
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

/**
 * Replays only complete live bars through the same deterministic execution
 * engine used by training.  The caller owns the cursor; this adapter never
 * invents or rewinds history and simply evaluates the bars it receives.
 */
export function executeLiveBars<
  TOrder extends EngineOrder,
  TPosition extends EnginePosition,
>(input: LiveExecutionRunInput<TOrder, TPosition>): LiveExecutionRunResult<TOrder, TPosition> {
  const bars = normalizedBars(input.bars);
  let positions = input.positions;
  let remainingOrders = input.orders;
  let cashBalance = input.cashBalance;
  const fills: LiveExecutionFill[] = [];
  const rejections: LiveExecutionRejection[] = [];
  let lastStep: ExecutionStepResult<TOrder, TPosition> | undefined;

  for (const bar of bars) {
    const eligibleOrders = remainingOrders.filter((order) => Number(order.createdAt) < bar.timestamp);
    const deferredOrders = remainingOrders.filter((order) => Number(order.createdAt) >= bar.timestamp);
    const result = executeBarStep<TOrder, TPosition>({
      orders: eligibleOrders,
      positions,
      bar,
      profile: input.profile,
      cashBalance,
      capitalMode: input.capitalMode,
      instrumentEconomics: input.instrumentEconomics,
      validateFill: input.validateFill
        ? (order, rawPrice) => input.validateFill!(order, rawPrice, bar)
        : undefined,
      validateProtectiveFill: input.validateProtectiveFill
        ? (position, side, rawPrice, reason) => input.validateProtectiveFill!(position, side, rawPrice, reason, bar)
        : undefined,
      skipProtectiveExits: input.skipProtectiveExits,
    });
    positions = result.positions;
    remainingOrders = [...deferredOrders, ...result.remainingOrders];
    cashBalance = result.cashBalance;
    fills.push(...result.fills.map((fill) => ({ ...fill, barEvidence: { ...bar } })));
    rejections.push(...result.rejections.map((rejection) => ({
      ...rejection,
      timestamp: bar.timestamp,
      barEvidence: { ...bar },
    })));
    lastStep = result;
  }

  return {
    positions,
    remainingOrders,
    fills,
    rejections,
    cashBalance,
    processedBars: bars,
    lastStep,
  };
}
