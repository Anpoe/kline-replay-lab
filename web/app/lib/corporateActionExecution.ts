import { cashDividendCreditsForBar, type CashDividendCredit, type CorporateActionEvent, type CorporateActionHolding } from "./corporateActions.ts";

export const CORPORATE_ACTION_APPLIED_EVENT_TYPE = "corporate_action_applied";

export type CorporateActionPosition = CorporateActionHolding & {
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
};
export type CorporateActionOrder = {
  id: string;
  action: "open" | "close";
  qty: number;
  createdAt: number;
  positionId: string;
  triggerPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  originalQty?: number;
  filledQty?: number;
  openingGapReferencePrice?: number;
};
export type AppliedCorporateAction = {
  event: CorporateActionEvent;
  quantityBefore: number;
  quantityAfter: number;
  positionIds: string[];
  cancelledOrderIds: string[];
};

/** Quantity/cost changes precede all fills. Historical fills and fees stay intact.
 * Cash dividends remain separate income: subtracting them from cost as well
 * would count the same benefit twice. Opaque TDX expansion/consolidation ratios
 * and paid rights subscriptions cannot safely be inferred from candle gaps. */
export function applyCorporateActionsBeforeBar<
  TPosition extends CorporateActionPosition,
  TOrder extends CorporateActionOrder,
>(input: {
  events: CorporateActionEvent[];
  positions: TPosition[];
  pendingOrders: TOrder[];
  barTimestamp: number;
  previousTimestamp?: number;
  previousClose?: number;
  priceBasis: "raw" | "adjusted" | "unknown";
  processedEventIds?: ReadonlySet<string>;
  creditedDividendEventIds?: ReadonlySet<string>;
  aggregatedBarEndTimestamp?: number;
}) {
  let positions = input.positions;
  let pendingOrders = input.pendingOrders;
  let referenceClose = input.previousClose;
  const dividendCredits: CashDividendCredit[] = [];
  const appliedEvents: AppliedCorporateAction[] = [];
  const cancelledOrderIds: string[] = [];
  const unchanged = (blockedReason = "") => ({ positions: input.positions, pendingOrders: input.pendingOrders, referenceClose: input.previousClose, dividendCredits: [] as CashDividendCredit[], appliedEvents: [] as AppliedCorporateAction[], cancelledOrderIds: [] as string[], blockedReason });
  if (!Number.isFinite(input.barTimestamp) || input.priceBasis === "adjusted") return unchanged();
  const processed = new Set(input.processedEventIds);
  const aggregatedBarEnd = input.aggregatedBarEndTimestamp;
  if (aggregatedBarEnd != null && input.events.some(event => event.timestamp > (input.previousTimestamp ?? -Infinity)
    && event.timestamp <= aggregatedBarEnd && !processed.has(event.id))
    && (positions.some(position => position.status === "open") || pendingOrders.length > 0)) {
    return unchanged("不复权周线或月线包含权息事件，已暂停回放；请使用日线或复权行情重新训练。");
  }
  const dueEvents = input.events.filter(event => Number.isFinite(event.timestamp) && event.timestamp <= input.barTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  for (const event of dueEvents) {
    const eligible = positions.filter(position => position.status === "open" && position.entryTimestamp < event.timestamp && position.qty > 0);
    const oldOrders = pendingOrders.filter(order => order.createdAt < event.timestamp);
    const exposed = eligible.length > 0 || oldOrders.length > 0;
    const crossed = input.previousTimestamp == null || event.timestamp > input.previousTimestamp;
    const supported = event.category === 1
      && [event.cashPer10, event.bonusSharesPer10, event.rightsSharesPer10].every(value => Number.isFinite(value) && value >= 0)
      && event.rightsSharesPer10 === 0;
    const ratio = 1 + event.bonusSharesPer10 / 10;
    const cashPerShare = event.cashPer10 / 10;
    // This reference is also needed when the event was already recorded in a
    // restored state. Only a newly crossed event changes the previous close.
    if (crossed && supported && referenceClose != null) referenceClose = (referenceClose - cashPerShare) / ratio;
    if (processed.has(event.id)) continue;
    if (!exposed) {
      processed.add(event.id);
      appliedEvents.push({ event, quantityBefore: 0, quantityAfter: 0, positionIds: [], cancelledOrderIds: [] });
      continue;
    }
    if (input.priceBasis !== "raw") return unchanged("行情复权口径未确认，已暂停回放；请重新加载有明确复权口径的训练数据。");
    if (!supported) return unchanged("该权息事件的数量比例或配股处理尚未确认，已暂停回放；请选择复权行情重新训练。");
    if (!crossed) return unchanged("当前持仓跨过了尚未处理的权息事件，已暂停回放；请从除权日前重新训练。");
    if (eligible.some(position => position.side !== "long" || (ratio !== 1 && (!Number.isFinite(position.entryPrice) || Number(position.entryPrice) <= 0)))) {
      return unchanged("该持仓缺少可靠的除权调整依据，已暂停回放；请从除权日前重新训练。");
    }
    const adjustedLevel = (value: number | undefined) => value == null ? undefined : (value - cashPerShare) / ratio;
    if (eligible.some(position => [position.stopLoss, position.takeProfit].some(value => value != null && (!Number.isFinite(value) || Number(adjustedLevel(value)) <= 0)))
      || oldOrders.some(order => [order.triggerPrice, order.stopLoss, order.takeProfit].some(value => value != null && (!Number.isFinite(value) || Number(adjustedLevel(value)) <= 0)))) {
      return unchanged("除权后的保护价无法可靠计算，已暂停回放；请检查保护条件或重新训练。");
    }
    const credits = cashDividendCreditsForBar([event], positions, input.barTimestamp, input.creditedDividendEventIds);
    dividendCredits.push(...credits);
    const eligibleIds = new Set(eligible.map(position => position.id));
    positions = positions.map(position => eligibleIds.has(position.id) ? {
      ...position,
      qty: position.qty * ratio,
      entryPrice: position.entryPrice == null ? undefined : position.entryPrice / ratio,
      stopLoss: adjustedLevel(position.stopLoss),
      takeProfit: adjustedLevel(position.takeProfit),
    } : position);
    const cancelled = oldOrders.filter(order => order.action === "open").map(order => order.id);
    pendingOrders = pendingOrders.filter(order => !cancelled.includes(order.id)).map(order => (
      order.createdAt < event.timestamp && order.action === "close" && eligibleIds.has(order.positionId)
        ? { ...order, qty: order.qty * ratio, originalQty: order.originalQty == null ? undefined : order.originalQty * ratio, filledQty: order.filledQty == null ? undefined : order.filledQty * ratio,
          triggerPrice: adjustedLevel(order.triggerPrice), stopLoss: adjustedLevel(order.stopLoss), takeProfit: adjustedLevel(order.takeProfit), openingGapReferencePrice: adjustedLevel(order.openingGapReferencePrice) }
        : order
    ));
    const quantityBefore = eligible.reduce((sum, position) => sum + position.qty, 0);
    appliedEvents.push({ event, quantityBefore, quantityAfter: quantityBefore * ratio, positionIds: [...eligibleIds], cancelledOrderIds: cancelled });
    cancelledOrderIds.push(...cancelled);
    processed.add(event.id);
  }
  return { positions, pendingOrders, referenceClose, dividendCredits, appliedEvents, cancelledOrderIds, blockedReason: "" };
}
