import {
  accountNotional,
  accountPnl,
  isMarginEconomics,
  marginAccountSnapshot,
  quoteSourcePrice,
  requiredMargin,
  sourceQuotePrice,
  type InstrumentEconomics,
  type MarginAccountSnapshot,
} from "./fxTrading.ts";

export const EXECUTION_ENGINE_VERSION = "2026.08-v4";

export type OrderType = "market" | "limit" | "stop";
export type IntrabarConflictPolicy = "conservative" | "optimistic" | "seeded";
export type ExecutionReason = "order" | "stop_loss" | "take_profit" | "training_end" | "session_end" | "liquidation";

export type ExecutionCostProfile = {
  commissionRateBps: number;
  minimumCommission: number;
  slippageBps: number;
  spreadBps: number;
  maxVolumeParticipationPct: number;
  intrabarConflictPolicy: IntrabarConflictPolicy;
};

export const DEFAULT_EXECUTION_COST_PROFILE: ExecutionCostProfile = {
  commissionRateBps: 0,
  minimumCommission: 0,
  slippageBps: 0,
  spreadBps: 0,
  maxVolumeParticipationPct: 0,
  intrabarConflictPolicy: "conservative",
};

export type ExecutionBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type EngineOrder = {
  id: string;
  action: "open" | "close";
  side: "buy" | "sell";
  qty: number;
  createdAt: number;
  positionId: string;
  orderType?: OrderType;
  triggerPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  executeAtTimestamp?: number;
  reason?: ExecutionReason;
  originalQty?: number;
  filledQty?: number;
  reservedCash?: number;
  sizingMode?: "fixed" | "risk-percent";
  riskPercent?: number;
  riskBudget?: number;
  reservedMargin?: number;
  instrumentEconomics?: InstrumentEconomics;
};

export type EnginePosition = {
  id: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  entryOrderId: string;
  entryOrderType?: OrderType;
  entryIntrabar?: boolean;
  status: "open" | "closed";
  exitPrice?: number;
  exitTimestamp?: number;
  exitOrderId?: string;
  realizedPnl?: number;
  grossRealizedPnl?: number;
  entryFee?: number;
  exitFee?: number;
  totalFees?: number;
  stopLoss?: number;
  takeProfit?: number;
  initialRisk?: number;
  exitReason?: ExecutionReason;
  intrabarAmbiguous?: boolean;
  engineVersion?: string;
  sizingMode?: "fixed" | "risk-percent";
  riskPercent?: number;
  riskBudget?: number;
  marginUsed?: number;
  instrumentEconomics?: InstrumentEconomics;
};

export type EngineFill = {
  id: string;
  orderId: string;
  positionId: string;
  action: "open" | "close";
  side: "buy" | "sell";
  qty: number;
  price: number;
  rawPrice: number;
  quotePrice?: number;
  quoteSide?: "bid" | "ask" | "mid";
  timestamp: number;
  realizedPnl: number;
  grossRealizedPnl: number;
  fee: number;
  priceImpactCost: number;
  orderType: OrderType;
  triggerPrice?: number;
  reason: ExecutionReason;
  intrabarAmbiguous?: boolean;
  partial?: boolean;
  remainingQty?: number;
  notionalValue?: number;
  marginImpact?: number;
  accountCurrency?: string;
  engineVersion: string;
};

export type EngineRejection = {
  orderId?: string;
  positionId?: string;
  code: string;
  message: string;
};

type FillValidation = { ok: true } | { ok: false; code: string; message: string };

export type ExecutionStepInput<
  TOrder extends EngineOrder = EngineOrder,
  TPosition extends EnginePosition = EnginePosition,
> = {
  orders: TOrder[];
  positions: TPosition[];
  bar: ExecutionBar;
  profile?: Partial<ExecutionCostProfile>;
  cashBalance: number;
  capitalMode: boolean;
  instrumentEconomics?: InstrumentEconomics;
  validateFill?: (order: TOrder, rawPrice: number) => FillValidation;
  validateProtectiveFill?: (
    position: TPosition,
    side: "buy" | "sell",
    rawPrice: number,
    reason: "stop_loss" | "take_profit",
  ) => FillValidation;
  skipProtectiveExits?: boolean;
};

export type ExecutionStepResult<TOrder extends EngineOrder, TPosition extends EnginePosition> = {
  positions: TPosition[];
  remainingOrders: TOrder[];
  fills: EngineFill[];
  rejections: EngineRejection[];
  cashBalance: number;
  consumedOrderIds: string[];
  marginAccount?: MarginAccountSnapshot;
  liquidation?: {
    triggered: true;
    checkPrice: number;
    cancelledOrderIds: string[];
    marginBefore: MarginAccountSnapshot;
    marginAfter: MarginAccountSnapshot;
  };
};

export function normalizeExecutionCostProfile(
  value: Partial<ExecutionCostProfile> | undefined,
): ExecutionCostProfile {
  const nonNegative = (candidate: unknown, fallback: number, maximum: number) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, parsed)) : fallback;
  };
  const policy = value?.intrabarConflictPolicy;
  return {
    commissionRateBps: nonNegative(value?.commissionRateBps, 0, 10_000),
    minimumCommission: nonNegative(value?.minimumCommission, 0, 1_000_000),
    slippageBps: nonNegative(value?.slippageBps, 0, 10_000),
    spreadBps: nonNegative(value?.spreadBps, 0, 10_000),
    maxVolumeParticipationPct: nonNegative(value?.maxVolumeParticipationPct, 0, 100),
    intrabarConflictPolicy: policy === "optimistic" || policy === "seeded" ? policy : "conservative",
  };
}

export function availableBarFillQuantity(
  bar: ExecutionBar,
  profile: Partial<ExecutionCostProfile> | undefined,
  economics?: InstrumentEconomics,
) {
  // Spot-FX volume is tick activity rather than centralized tradable units.
  if (economics?.quantityUnit === "lot") return Number.POSITIVE_INFINITY;
  const participation = normalizeExecutionCostProfile(profile).maxVolumeParticipationPct;
  const volume = Number(bar.volume);
  if (participation <= 0 || !Number.isFinite(volume) || volume <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(volume * participation / 100));
}

function resolveOrderPriceOnBar(order: EngineOrder, bar: ExecutionBar): number | null {
  if (order.executeAtTimestamp != null && order.executeAtTimestamp > bar.timestamp) return null;
  const orderType = order.orderType ?? "market";
  if (orderType === "market") return bar.open;
  const trigger = Number(order.triggerPrice);
  if (!Number.isFinite(trigger) || trigger <= 0) return null;

  if (orderType === "limit") {
    if (order.side === "buy") {
      if (bar.low > trigger) return null;
      return bar.open <= trigger ? bar.open : trigger;
    }
    if (bar.high < trigger) return null;
    return bar.open >= trigger ? bar.open : trigger;
  }

  if (order.side === "buy") {
    if (bar.high < trigger) return null;
    return bar.open >= trigger ? bar.open : trigger;
  }
  if (bar.low > trigger) return null;
  return bar.open <= trigger ? bar.open : trigger;
}

export function resolveOrderRawPrice(order: EngineOrder, bar: ExecutionBar): number | null {
  return resolveOrderPriceOnBar(order, bar);
}

type ResolvedExecutionPrice = {
  sourcePrice: number;
  quotePrice: number;
  quoteSide: "bid" | "ask" | "mid";
};

function quoteSide(side: "buy" | "sell", economics?: InstrumentEconomics): "bid" | "ask" | "mid" {
  if (economics?.quoteBasis !== "bid") return "mid";
  return side === "buy" ? "ask" : "bid";
}

function quotedBar(
  side: "buy" | "sell",
  bar: ExecutionBar,
  profile: ExecutionCostProfile,
  economics?: InstrumentEconomics,
): ExecutionBar {
  return {
    ...bar,
    open: sourceQuotePrice(side, bar.open, profile.spreadBps, economics),
    high: sourceQuotePrice(side, bar.high, profile.spreadBps, economics),
    low: sourceQuotePrice(side, bar.low, profile.spreadBps, economics),
    close: sourceQuotePrice(side, bar.close, profile.spreadBps, economics),
  };
}

function resolveOrderExecutionPrice(
  order: EngineOrder,
  bar: ExecutionBar,
  profile: ExecutionCostProfile,
  economics?: InstrumentEconomics,
): ResolvedExecutionPrice | null {
  if (economics?.quoteBasis !== "bid") {
    const sourcePrice = resolveOrderPriceOnBar(order, bar);
    if (sourcePrice == null) return null;
    return {
      sourcePrice,
      quotePrice: sourceQuotePrice(order.side, sourcePrice, profile.spreadBps, economics),
      quoteSide: "mid",
    };
  }
  const quotePrice = resolveOrderPriceOnBar(order, quotedBar(order.side, bar, profile, economics));
  if (quotePrice == null) return null;
  return {
    sourcePrice: quoteSourcePrice(order.side, quotePrice, profile.spreadBps, economics),
    quotePrice,
    quoteSide: quoteSide(order.side, economics),
  };
}

export function executionPriceFromQuote(
  side: "buy" | "sell",
  quotePrice: number,
  profile: Partial<ExecutionCostProfile> | undefined,
) {
  const normalized = normalizeExecutionCostProfile(profile);
  const direction = side === "buy" ? 1 : -1;
  return quotePrice * (1 + direction * normalized.slippageBps / 10_000);
}

export function executionPrice(
  side: "buy" | "sell",
  rawPrice: number,
  profile: Partial<ExecutionCostProfile> | undefined,
  economics?: InstrumentEconomics,
) {
  const normalized = normalizeExecutionCostProfile(profile);
  if (economics?.quoteBasis !== "bid") {
    const direction = side === "buy" ? 1 : -1;
    const impactBps = normalized.slippageBps + normalized.spreadBps / 2;
    return rawPrice * (1 + direction * impactBps / 10_000);
  }
  const quotePrice = sourceQuotePrice(side, rawPrice, normalized.spreadBps, economics);
  return executionPriceFromQuote(side, quotePrice, normalized);
}

export function executionFee(
  price: number,
  qty: number,
  profile: Partial<ExecutionCostProfile> | undefined,
  economics?: InstrumentEconomics,
) {
  const normalized = normalizeExecutionCostProfile(profile);
  if (normalized.commissionRateBps <= 0) return 0;
  const notional = accountNotional(price, qty, economics);
  if (notional == null) return Number.NaN;
  return Math.max(normalized.minimumCommission, Math.abs(notional) * normalized.commissionRateBps / 10_000);
}

export function estimatedBuyCashRequired(
  rawPrice: number,
  qty: number,
  profile: Partial<ExecutionCostProfile> | undefined,
  economics?: InstrumentEconomics,
) {
  const price = executionPrice("buy", rawPrice, profile, economics);
  const notional = accountNotional(price, qty, economics);
  if (notional == null) return Number.POSITIVE_INFINITY;
  return notional + executionFee(price, qty, profile, economics);
}

function stringHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveProtectiveExitOnBar(
  position: EnginePosition,
  bar: ExecutionBar,
  policy: IntrabarConflictPolicy,
): { reason: "stop_loss" | "take_profit"; rawPrice: number; ambiguous: boolean } | null {
  if (position.status !== "open" || position.entryTimestamp >= bar.timestamp) return null;
  const stop = Number(position.stopLoss);
  const target = Number(position.takeProfit);
  const hasStop = Number.isFinite(stop) && stop > 0;
  const hasTarget = Number.isFinite(target) && target > 0;
  const stopHit = hasStop && (position.side === "long" ? bar.low <= stop : bar.high >= stop);
  const targetHit = hasTarget && (position.side === "long" ? bar.high >= target : bar.low <= target);
  if (!stopHit && !targetHit) return null;

  const ambiguous = stopHit && targetHit;
  let reason: "stop_loss" | "take_profit";
  if (!ambiguous) reason = stopHit ? "stop_loss" : "take_profit";
  else if (policy === "optimistic") reason = "take_profit";
  else if (policy === "seeded") {
    reason = stringHash(`${position.id}:${bar.timestamp}`) % 2 === 0 ? "stop_loss" : "take_profit";
  } else reason = "stop_loss";

  const level = reason === "stop_loss" ? stop : target;
  let rawPrice = level;
  if (position.side === "long") {
    if (reason === "stop_loss" && bar.open < level) rawPrice = bar.open;
    if (reason === "take_profit" && bar.open > level) rawPrice = bar.open;
  } else {
    if (reason === "stop_loss" && bar.open > level) rawPrice = bar.open;
    if (reason === "take_profit" && bar.open < level) rawPrice = bar.open;
  }
  return { reason, rawPrice, ambiguous };
}

export function resolveProtectiveExit(
  position: EnginePosition,
  bar: ExecutionBar,
  policy: IntrabarConflictPolicy,
) {
  return resolveProtectiveExitOnBar(position, bar, policy);
}

function resolveProtectiveExecution(
  position: EnginePosition,
  bar: ExecutionBar,
  policy: IntrabarConflictPolicy,
  profile: ExecutionCostProfile,
  economics?: InstrumentEconomics,
): (ResolvedExecutionPrice & { reason: "stop_loss" | "take_profit"; ambiguous: boolean }) | null {
  const side = position.side === "long" ? "sell" : "buy";
  if (economics?.quoteBasis !== "bid") {
    const protective = resolveProtectiveExitOnBar(position, bar, policy);
    if (!protective) return null;
    return {
      reason: protective.reason,
      ambiguous: protective.ambiguous,
      sourcePrice: protective.rawPrice,
      quotePrice: sourceQuotePrice(side, protective.rawPrice, profile.spreadBps, economics),
      quoteSide: "mid",
    };
  }
  const protective = resolveProtectiveExitOnBar(
    position,
    quotedBar(side, bar, profile, economics),
    policy,
  );
  if (!protective) return null;
  return {
    reason: protective.reason,
    ambiguous: protective.ambiguous,
    sourcePrice: quoteSourcePrice(side, protective.rawPrice, profile.spreadBps, economics),
    quotePrice: protective.rawPrice,
    quoteSide: quoteSide(side, economics),
  };
}

function cashFlow(
  side: "buy" | "sell",
  price: number,
  qty: number,
  fee: number,
  economics?: InstrumentEconomics,
) {
  const notional = accountNotional(price, qty, economics) ?? Number.POSITIVE_INFINITY;
  return side === "buy" ? -(notional + fee) : notional - fee;
}

function closePosition<TPosition extends EnginePosition>(
  position: TPosition,
  side: "buy" | "sell",
  resolvedPrice: ResolvedExecutionPrice,
  bar: ExecutionBar,
  profile: ExecutionCostProfile,
  orderId: string,
  orderType: OrderType,
  reason: ExecutionReason,
  triggerPrice?: number,
  ambiguous = false,
  requestedQty = position.qty,
) {
  const quantity = Math.max(0, Math.min(position.qty, Number(requestedQty)));
  const fullyClosed = quantity >= position.qty - 1e-10;
  const allocationRatio = quantity / position.qty;
  const allocatedEntryFee = Number(position.entryFee ?? 0) * allocationRatio;
  const allocatedInitialRisk = position.initialRisk == null
    ? undefined
    : Number(position.initialRisk) * allocationRatio;
  const economics = position.instrumentEconomics;
  const price = executionPriceFromQuote(side, resolvedPrice.quotePrice, profile);
  const fee = executionFee(price, quantity, profile, economics);
  const grossRealizedPnl = accountPnl(position.entryPrice, price, quantity, position.side, economics) ?? 0;
  const totalFees = allocatedEntryFee + fee;
  const realizedPnl = grossRealizedPnl - totalFees;
  const allocatedMargin = Number(position.marginUsed ?? 0) * allocationRatio;
  const closedPositionId = fullyClosed
    ? position.id
    : `${position.id}:partial:${orderId}:${bar.timestamp}`;
  const closedPosition = {
    ...position,
    id: closedPositionId,
    qty: quantity,
    status: "closed" as const,
    exitPrice: price,
    exitTimestamp: bar.timestamp,
    exitOrderId: orderId,
    grossRealizedPnl,
    realizedPnl,
    entryFee: allocatedEntryFee,
    exitFee: fee,
    totalFees,
    marginUsed: allocatedMargin,
    initialRisk: allocatedInitialRisk,
    exitReason: reason,
    intrabarAmbiguous: ambiguous || undefined,
    engineVersion: EXECUTION_ENGINE_VERSION,
  } as TPosition;
  const remainingPosition = fullyClosed ? undefined : {
    ...position,
    qty: position.qty - quantity,
    entryFee: Number(position.entryFee ?? 0) - allocatedEntryFee,
    totalFees: Number(position.entryFee ?? 0) - allocatedEntryFee,
    marginUsed: Math.max(0, Number(position.marginUsed ?? 0) - allocatedMargin),
    initialRisk: position.initialRisk == null
      ? undefined
      : Math.max(0, Number(position.initialRisk) - Number(allocatedInitialRisk ?? 0)),
    engineVersion: EXECUTION_ENGINE_VERSION,
  } as TPosition;
  const fill: EngineFill = {
    id: `fill:${orderId}:${bar.timestamp}`,
    orderId,
    positionId: closedPositionId,
    action: "close",
    side,
    qty: quantity,
    price,
    rawPrice: resolvedPrice.sourcePrice,
    quotePrice: resolvedPrice.quotePrice,
    quoteSide: resolvedPrice.quoteSide,
    timestamp: bar.timestamp,
    realizedPnl,
    grossRealizedPnl,
    fee,
    priceImpactCost: Math.abs(accountPnl(resolvedPrice.sourcePrice, price, quantity, "long", economics) ?? 0),
    orderType,
    triggerPrice,
    reason,
    intrabarAmbiguous: ambiguous || undefined,
    partial: !fullyClosed || undefined,
    remainingQty: remainingPosition?.qty,
    notionalValue: accountNotional(price, quantity, economics) ?? undefined,
    marginImpact: allocatedMargin > 0 ? -allocatedMargin : undefined,
    accountCurrency: economics?.accountCurrency,
    engineVersion: EXECUTION_ENGINE_VERSION,
  };
  const balanceFlow = isMarginEconomics(economics)
    ? grossRealizedPnl - fee
    : cashFlow(side, price, quantity, fee, economics);
  return { closedPosition, remainingPosition, fill, fee, balanceFlow };
}

function remainingOrderAfterFill<TOrder extends EngineOrder>(order: TOrder, filledQty: number) {
  const remainingQty = Math.max(0, order.qty - filledQty);
  if (remainingQty <= 0) return null;
  const previouslyFilled = Math.max(0, Number(order.filledQty ?? 0));
  const originalQty = Math.max(order.qty + previouslyFilled, Number(order.originalQty ?? 0));
  const reservedCash = order.reservedCash == null
    ? undefined
    : Number(order.reservedCash) * remainingQty / order.qty;
  const reservedMargin = order.reservedMargin == null
    ? undefined
    : Number(order.reservedMargin) * remainingQty / order.qty;
  return {
    ...order,
    qty: remainingQty,
    originalQty,
    filledQty: previouslyFilled + filledQty,
    reservedCash,
    reservedMargin,
  } as TOrder;
}

export function executeBarStep<
  TOrder extends EngineOrder,
  TPosition extends EnginePosition,
>(input: ExecutionStepInput<TOrder, TPosition>): ExecutionStepResult<TOrder, TPosition> {
  const profile = normalizeExecutionCostProfile(input.profile);
  const positions = input.positions.map((position) => ({ ...position })) as TPosition[];
  const fills: EngineFill[] = [];
  const rejections: EngineRejection[] = [];
  const consumedOrderIds: string[] = [];
  let cashBalance = input.cashBalance;
  let availableQuantity = availableBarFillQuantity(input.bar, profile, input.instrumentEconomics);

  // Protection that existed before this bar is resolved before manual orders.
  // Newly opened lots are intentionally not eligible until the following bar.
  const positionsEligibleForProtection = input.skipProtectiveExits ? 0 : positions.length;
  for (let index = 0; index < positionsEligibleForProtection; index += 1) {
    if (availableQuantity <= 0) break;
    const position = positions[index];
    const economics = position.instrumentEconomics ?? input.instrumentEconomics;
    const protective = resolveProtectiveExecution(
      position,
      input.bar,
      profile.intrabarConflictPolicy,
      profile,
      economics,
    );
    if (!protective) continue;
    const side = position.side === "long" ? "sell" : "buy";
    const orderId = `protect:${position.id}:${input.bar.timestamp}`;
    const validation = input.validateProtectiveFill?.(
      position,
      side,
      protective.sourcePrice,
      protective.reason,
    ) ?? { ok: true as const };
    if (!validation.ok) {
      rejections.push({
        orderId,
        positionId: position.id,
        code: validation.code,
        message: validation.message,
      });
      continue;
    }
    const closed = closePosition(
      position,
      side,
      protective,
      input.bar,
      profile,
      orderId,
      protective.reason === "stop_loss" ? "stop" : "limit",
      protective.reason,
      protective.reason === "stop_loss" ? position.stopLoss : position.takeProfit,
      protective.ambiguous,
      Math.min(position.qty, availableQuantity),
    );
    if (closed.remainingPosition) {
      positions[index] = closed.remainingPosition;
      positions.push(closed.closedPosition);
    } else positions[index] = closed.closedPosition;
    fills.push(closed.fill);
    if (input.capitalMode) cashBalance += closed.balanceFlow;
    availableQuantity -= closed.fill.qty;
  }

  let remainingOrders: TOrder[] = [];
  for (const order of input.orders) {
    if (order.executeAtTimestamp != null && order.executeAtTimestamp > input.bar.timestamp) {
      remainingOrders.push(order);
      continue;
    }
    const orderEconomics = order.instrumentEconomics ?? input.instrumentEconomics;
    const resolvedPrice = resolveOrderExecutionPrice(order, input.bar, profile, orderEconomics);
    if (resolvedPrice == null) {
      remainingOrders.push(order);
      continue;
    }
    if (availableQuantity <= 0) {
      remainingOrders.push(order);
      continue;
    }
    const validation = input.validateFill?.(order, resolvedPrice.sourcePrice) ?? { ok: true as const };
    if (!validation.ok) {
      consumedOrderIds.push(order.id);
      rejections.push({ orderId: order.id, positionId: order.positionId, code: validation.code, message: validation.message });
      continue;
    }

    if (order.action === "open") {
      const fillQty = Math.min(order.qty, availableQuantity);
      const price = executionPriceFromQuote(order.side, resolvedPrice.quotePrice, profile);
      const fee = executionFee(price, fillQty, profile, orderEconomics);
      const marginRequired = requiredMargin(price, fillQty, orderEconomics);
      if (!Number.isFinite(fee) || marginRequired == null) {
        consumedOrderIds.push(order.id);
        rejections.push({
          orderId: order.id,
          positionId: order.positionId,
          code: "currency_conversion_unavailable",
          message: "账户币种与交易品种无法自动换算，请设置报价币到账户币的换算率",
        });
        continue;
      }
      const marginMode = isMarginEconomics(orderEconomics);
      const flow = marginMode ? -fee : cashFlow(order.side, price, fillQty, fee, orderEconomics);
      if (input.capitalMode && marginMode) {
        const snapshot = marginAccountSnapshot({
          balance: cashBalance,
          positions,
          sourcePrice: resolvedPrice.sourcePrice,
          spreadBps: profile.spreadBps,
          economics: orderEconomics!,
        });
        if (Number(marginRequired) + fee > snapshot.availableMargin + 0.000001) {
          consumedOrderIds.push(order.id);
          rejections.push({
            orderId: order.id,
            positionId: order.positionId,
            code: "insufficient_margin_at_fill",
            message: `成交需要保证金 ${Number(marginRequired).toFixed(2)}，当前可用保证金仅 ${snapshot.availableMargin.toFixed(2)}`,
          });
          continue;
        }
      } else if (input.capitalMode && flow < 0 && cashBalance + flow < -0.000001) {
        consumedOrderIds.push(order.id);
        rejections.push({
          orderId: order.id,
          positionId: order.positionId,
          code: "insufficient_cash_at_fill",
          message: `成交需要 ${Math.abs(flow).toFixed(2)}，可用资金仅 ${cashBalance.toFixed(2)}`,
        });
        continue;
      }
      const side = order.side === "buy" ? "long" : "short";
      const stopLoss = Number(order.stopLoss);
      const takeProfit = Number(order.takeProfit);
      const previouslyFilled = Math.max(0, Number(order.filledQty ?? 0));
      const positionId = previouslyFilled > 0
        ? `${order.positionId}:partial:${previouslyFilled}`
        : order.positionId;
      const stopExecutionPrice = Number.isFinite(stopLoss) && stopLoss > 0
        ? orderEconomics?.quoteBasis === "bid"
          ? executionPriceFromQuote(order.side === "buy" ? "sell" : "buy", stopLoss, profile)
          : executionPrice(order.side === "buy" ? "sell" : "buy", stopLoss, profile, orderEconomics)
        : undefined;
      const estimatedStopFee = stopExecutionPrice == null
        ? 0
        : executionFee(stopExecutionPrice, fillQty, profile, orderEconomics);
      const initialRisk = Number.isFinite(stopLoss) && stopLoss > 0
        ? Math.abs(accountPnl(price, Number(stopExecutionPrice), fillQty, side, orderEconomics) ?? 0)
          + fee + estimatedStopFee
        : undefined;
      positions.push({
        id: positionId,
        side,
        qty: fillQty,
        entryPrice: price,
        entryTimestamp: input.bar.timestamp,
        entryOrderId: order.id,
        entryOrderType: order.orderType ?? "market",
        entryIntrabar: (order.orderType ?? "market") !== "market"
          && Math.abs(resolvedPrice.sourcePrice - input.bar.open) > Number.EPSILON,
        status: "open",
        entryFee: fee,
        totalFees: fee,
        stopLoss: Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : undefined,
        takeProfit: Number.isFinite(takeProfit) && takeProfit > 0 ? takeProfit : undefined,
        initialRisk,
        sizingMode: order.sizingMode,
        riskPercent: order.riskPercent,
        riskBudget: order.riskBudget,
        marginUsed: marginMode ? Number(marginRequired) : undefined,
        instrumentEconomics: orderEconomics,
        engineVersion: EXECUTION_ENGINE_VERSION,
      } as TPosition);
      const remainder = remainingOrderAfterFill(order, fillQty);
      fills.push({
        id: `fill:${order.id}:${input.bar.timestamp}`,
        orderId: order.id,
        positionId,
        action: "open",
        side: order.side,
        qty: fillQty,
        price,
        rawPrice: resolvedPrice.sourcePrice,
        quotePrice: resolvedPrice.quotePrice,
        quoteSide: resolvedPrice.quoteSide,
        timestamp: input.bar.timestamp,
        realizedPnl: 0,
        grossRealizedPnl: 0,
        fee,
        priceImpactCost: Math.abs(accountPnl(resolvedPrice.sourcePrice, price, fillQty, "long", orderEconomics) ?? 0),
        orderType: order.orderType ?? "market",
        triggerPrice: order.triggerPrice,
        reason: "order",
        partial: Boolean(remainder) || undefined,
        remainingQty: remainder?.qty,
        notionalValue: accountNotional(price, fillQty, orderEconomics) ?? undefined,
        marginImpact: marginMode ? Number(marginRequired) : undefined,
        accountCurrency: orderEconomics?.accountCurrency,
        engineVersion: EXECUTION_ENGINE_VERSION,
      });
      if (input.capitalMode) cashBalance += flow;
      availableQuantity -= fillQty;
      if (remainder) remainingOrders.push(remainder);
      else consumedOrderIds.push(order.id);
      continue;
    }

    const positionIndex = positions.findIndex((position) => position.id === order.positionId && position.status === "open");
    if (positionIndex < 0) {
      consumedOrderIds.push(order.id);
      rejections.push({
        orderId: order.id,
        positionId: order.positionId,
        code: "position_not_open",
        message: "仓位已由保护单平仓，当前委托已取消",
      });
      continue;
    }
    const position = positions[positionIndex];
    const fillQty = Math.min(order.qty, position.qty, availableQuantity);
    const positionEconomics = position.instrumentEconomics ?? orderEconomics;
    const closeResolvedPrice = positionEconomics === orderEconomics
      ? resolvedPrice
      : resolveOrderExecutionPrice(order, input.bar, profile, positionEconomics);
    if (!closeResolvedPrice) {
      remainingOrders.push(order);
      continue;
    }
    const closed = closePosition(
      position,
      order.side,
      closeResolvedPrice,
      input.bar,
      profile,
      order.id,
      order.orderType ?? "market",
      order.reason ?? "order",
      order.triggerPrice,
      false,
      fillQty,
    );
    if (closed.remainingPosition) {
      positions[positionIndex] = closed.remainingPosition;
      positions.push(closed.closedPosition);
    } else positions[positionIndex] = closed.closedPosition;
    fills.push(closed.fill);
    if (input.capitalMode) cashBalance += closed.balanceFlow;
    availableQuantity -= closed.fill.qty;
    const remainder = closed.remainingPosition
      ? remainingOrderAfterFill(order, closed.fill.qty)
      : null;
    if (remainder) remainingOrders.push(remainder);
    else consumedOrderIds.push(order.id);
  }

  let liquidation: ExecutionStepResult<TOrder, TPosition>["liquidation"];
  const marginEconomics = positions.find((position) => (
    position.status === "open" && isMarginEconomics(position.instrumentEconomics)
  ))?.instrumentEconomics ?? input.instrumentEconomics;
  if (input.capitalMode && isMarginEconomics(marginEconomics)) {
    const open = positions.filter((position) => position.status === "open");
    const onlyLong = open.length > 0 && open.every((position) => position.side === "long");
    const onlyShort = open.length > 0 && open.every((position) => position.side === "short");
    const checkPrice = onlyLong ? input.bar.low : onlyShort ? input.bar.high : input.bar.close;
    const marginBefore = marginAccountSnapshot({
      balance: cashBalance,
      positions,
      sourcePrice: checkPrice,
      spreadBps: profile.spreadBps,
      economics: marginEconomics!,
    });
    if (marginBefore.liquidationRequired) {
      const cancelledOrderIds = remainingOrders.map((order) => order.id);
      consumedOrderIds.push(...cancelledOrderIds);
      remainingOrders = [];
      for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index];
        if (position.status !== "open") continue;
        const side = position.side === "long" ? "sell" : "buy";
        const economics = position.instrumentEconomics ?? marginEconomics;
        const quotePrice = sourceQuotePrice(side, checkPrice, profile.spreadBps, economics);
        const closed = closePosition(
          position,
          side,
          { sourcePrice: checkPrice, quotePrice, quoteSide: quoteSide(side, economics) },
          input.bar,
          profile,
          `liquidation:${position.id}:${input.bar.timestamp}`,
          "market",
          "liquidation",
        );
        positions[index] = closed.closedPosition;
        fills.push(closed.fill);
        cashBalance += closed.balanceFlow;
      }
      const marginAfter = marginAccountSnapshot({
        balance: cashBalance,
        positions,
        sourcePrice: input.bar.close,
        spreadBps: profile.spreadBps,
        economics: marginEconomics!,
      });
      liquidation = { triggered: true, checkPrice, cancelledOrderIds, marginBefore, marginAfter };
    }
  }

  const marginAccount = isMarginEconomics(marginEconomics)
    ? marginAccountSnapshot({
      balance: cashBalance,
      positions,
      sourcePrice: input.bar.close,
      spreadBps: profile.spreadBps,
      reservedMargin: remainingOrders.reduce((sum, order) => sum + Math.max(0, Number(order.reservedMargin ?? 0)), 0),
      economics: marginEconomics!,
    })
    : undefined;
  return {
    positions,
    remainingOrders,
    fills,
    rejections,
    cashBalance,
    consumedOrderIds: [...new Set(consumedOrderIds)],
    marginAccount,
    liquidation,
  };
}
