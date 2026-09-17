export type ProtectionPriceKind = "stop-loss" | "take-profit";
export type ProtectionLineKind = ProtectionPriceKind | "entry-trigger";

export type ProtectionLine = {
  id: string;
  kind: ProtectionLineKind;
  price: number;
  timestamp: number;
  label: string;
  movable: boolean;
  source: "draft" | "position";
  positionId?: string;
  side?: "long" | "short";
};

type ProtectionPosition = {
  id: string;
  status: "open" | "closed";
  side: "long" | "short";
  entryTimestamp: number;
  stopLoss?: number;
  takeProfit?: number;
};

type DeriveProtectionLinesInput = {
  currentTimestamp: number;
  draftTriggerPrice?: number;
  draftTriggerOrderType?: "limit" | "stop";
  draftStopLoss?: number;
  draftTakeProfit?: number;
  positions: ProtectionPosition[];
  hoveredClosedPositionId: string | null;
  movable: boolean;
};

type ResetConsumedStopDraftInput = {
  previousPositions: ProtectionPosition[];
  nextPositions: ProtectionPosition[];
  orderStopLoss: string;
  decisionStop: string;
};

type ResetConsumedOpenFillStopDraftInput = {
  orders: Array<{
    id: string;
    action: "open" | "close";
    stopLoss?: number;
  }>;
  fills: Array<{
    orderId: string;
    action: "open" | "close";
  }>;
  orderStopLoss: string;
  decisionStop: string;
};

function positivePrice(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined;
}

function resetStopDraftMatchingPrices(
  consumedStops: number[],
  orderStopLoss: string,
  decisionStop: string,
) {
  const clearIfConsumed = (value: string) => {
    const price = positivePrice(Number(value));
    return price != null && consumedStops.includes(price) ? "" : value;
  };
  return {
    orderStopLoss: clearIfConsumed(orderStopLoss),
    decisionStop: clearIfConsumed(decisionStop),
  };
}

export function deriveProtectionLines({
  currentTimestamp,
  draftTriggerPrice,
  draftTriggerOrderType,
  draftStopLoss,
  draftTakeProfit,
  positions,
  hoveredClosedPositionId,
  movable,
}: DeriveProtectionLinesInput): ProtectionLine[] {
  const lines: ProtectionLine[] = [];
  const triggerPrice = positivePrice(draftTriggerPrice);
  const stopLoss = positivePrice(draftStopLoss);
  const takeProfit = positivePrice(draftTakeProfit);

  if (triggerPrice != null) lines.push({
    id: "draft-entry-trigger",
    kind: "entry-trigger",
    price: triggerPrice,
    timestamp: currentTimestamp,
    label: draftTriggerOrderType === "stop"
      ? "突破单（Stop Order）"
      : draftTriggerOrderType === "limit"
        ? "限价单（Limit Order）"
        : "计划触发",
    movable,
    source: "draft",
  });
  if (stopLoss != null) lines.push({
    id: "draft-stop-loss",
    kind: "stop-loss",
    price: stopLoss,
    timestamp: currentTimestamp,
    label: "计划 SL",
    movable,
    source: "draft",
  });
  if (takeProfit != null) lines.push({
    id: "draft-take-profit",
    kind: "take-profit",
    price: takeProfit,
    timestamp: currentTimestamp,
    label: "计划 TP",
    movable,
    source: "draft",
  });

  positions
    .filter((position) => position.status === "open")
    .forEach((position, index) => {
      const positionStop = positivePrice(position.stopLoss);
      const positionTarget = positivePrice(position.takeProfit);
      if (positionStop != null) lines.push({
        id: `${position.id}:stop-loss`,
        kind: "stop-loss",
        price: positionStop,
        timestamp: position.entryTimestamp,
        label: `SL #${index + 1}`,
        movable,
        source: "position",
        positionId: position.id,
        side: position.side,
      });
      if (positionTarget != null) lines.push({
        id: `${position.id}:take-profit`,
        kind: "take-profit",
        price: positionTarget,
        timestamp: position.entryTimestamp,
        label: `TP #${index + 1}`,
        movable,
        source: "position",
        positionId: position.id,
        side: position.side,
      });
    });

  const hoveredClosedPosition = hoveredClosedPositionId
    ? positions.find((position) => (
      position.id === hoveredClosedPositionId && position.status === "closed"
    ))
    : undefined;
  const historicalStop = positivePrice(hoveredClosedPosition?.stopLoss);
  if (hoveredClosedPosition && historicalStop != null) lines.push({
    id: `${hoveredClosedPosition.id}:historical-stop-loss`,
    kind: "stop-loss",
    price: historicalStop,
    timestamp: hoveredClosedPosition.entryTimestamp,
    label: "历史 SL",
    movable: false,
    source: "position",
    positionId: hoveredClosedPosition.id,
    side: hoveredClosedPosition.side,
  });

  return lines;
}

export function resetConsumedStopDraftAfterOpenFills({
  orders,
  fills,
  orderStopLoss,
  decisionStop,
}: ResetConsumedOpenFillStopDraftInput) {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const consumedStops = fills
    .filter((fill) => fill.action === "open")
    .map((fill) => orderById.get(fill.orderId))
    .filter((order) => order?.action === "open")
    .map((order) => positivePrice(order?.stopLoss))
    .filter((price): price is number => price != null);
  return resetStopDraftMatchingPrices(consumedStops, orderStopLoss, decisionStop);
}

export function resetConsumedStopDraftAfterFlatten({
  previousPositions,
  nextPositions,
  orderStopLoss,
  decisionStop,
}: ResetConsumedStopDraftInput) {
  const previouslyOpen = previousPositions.filter((position) => position.status === "open");
  if (!previouslyOpen.length || nextPositions.some((position) => position.status === "open")) {
    return { orderStopLoss, decisionStop };
  }

  const consumedStops = previouslyOpen
    .map((position) => positivePrice(position.stopLoss))
    .filter((price): price is number => price != null);
  return resetStopDraftMatchingPrices(consumedStops, orderStopLoss, decisionStop);
}
