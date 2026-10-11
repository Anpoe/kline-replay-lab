import {
  type CorporateActionEvent,
  type CorporateActionHolding,
} from "./corporateActions.ts";
import { applyCorporateActionsBeforeBar, type CorporateActionOrder, type CorporateActionPosition } from "./corporateActionExecution.ts";

export type LiveCorporateActionLedgerEntry = {
  eventId: string;
  instrumentId: string;
  eventType: "cash-dividend" | "quantity-adjustment";
  date: string;
  timestamp: number;
  status: "applied" | "not-eligible" | "pending" | "corrected";
  source?: string;
  priceBasis?: "raw" | "adjusted" | "unknown";
  currency?: "CNY" | "USD";
  amount?: number;
  quantityBefore?: number;
  quantityAfter?: number;
  reason?: string;
  revision?: string | null;
  eventFingerprint?: string;
  appliedAt: string;
};

export type LiveCorporateActionResult<TPosition extends CorporateActionHolding, TOrder> = {
  cashDelta: number;
  ledgerEntries: LiveCorporateActionLedgerEntry[];
  positions: TPosition[];
  pendingOrders: TOrder[];
  requiresUserAction: boolean;
  referenceClose?: number;
};

type LiveCorporateActionInput<TPosition extends CorporateActionHolding, TOrder> = {
  events: CorporateActionEvent[];
  positions: TPosition[];
  pendingOrders: TOrder[];
  barTimestamp: number;
  priceBasis: "raw" | "adjusted" | "unknown";
  currency: "CNY" | "USD";
  capitalMode: boolean;
  processedEventIds?: ReadonlySet<string>;
  existingEntries?: ReadonlyMap<string, LiveCorporateActionLedgerEntry>;
  now?: string;
  revision?: string | null;
  previousTimestamp?: number;
  previousClose?: number;
};

function ledgerEntry(
  event: CorporateActionEvent,
  input: LiveCorporateActionInput<CorporateActionHolding, unknown>,
  values: Partial<LiveCorporateActionLedgerEntry>,
): LiveCorporateActionLedgerEntry {
  return {
    eventId: event.id,
    instrumentId: event.instrumentId,
    eventType: event.category === 1 && !event.bonusSharesPer10 ? "cash-dividend" : "quantity-adjustment",
    date: event.date,
    timestamp: event.timestamp,
    status: "pending",
    source: event.source,
    priceBasis: input.priceBasis,
    currency: input.currency,
    revision: input.revision ?? null,
    eventFingerprint: liveCorporateActionFingerprint(event),
    appliedAt: input.now ?? new Date().toISOString(),
    ...values,
  };
}

export function liveCorporateActionFingerprint(event: CorporateActionEvent) {
  return [
    event.id,
    event.instrumentId,
    event.timestamp,
    event.category,
    event.cashPer10,
    event.bonusSharesPer10,
    event.rightsSharesPer10,
    event.rightsPrice,
    event.shareRatio ?? "",
    event.source ?? "",
  ].join("|");
}

/**
 * Reuses the training adjustment before execution. Opaque quantity ratios and
 * corrections pause processing rather than guessing or replaying old fills.
 */
export function applyLiveCorporateActionsBeforeBar<
  TPosition extends CorporateActionPosition,
  TOrder extends CorporateActionOrder,
>(input: LiveCorporateActionInput<TPosition, TOrder>): LiveCorporateActionResult<TPosition, TOrder> {
  if (!Number.isFinite(input.barTimestamp)) {
    return { cashDelta: 0, ledgerEntries: [], positions: input.positions, pendingOrders: input.pendingOrders, requiresUserAction: false };
  }
  const processed = input.processedEventIds ?? new Set<string>();
  const existingEntries = input.existingEntries ?? new Map<string, LiveCorporateActionLedgerEntry>();
  let cashDelta = 0;
  let positions = input.positions;
  let pendingOrders = input.pendingOrders;
  let referenceClose = input.previousClose;
  let requiresUserAction = false;
  const ledgerEntries: LiveCorporateActionLedgerEntry[] = [];
  const dueEvents = input.events
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp <= input.barTimestamp)
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));

  for (const event of dueEvents) {
    const fingerprint = liveCorporateActionFingerprint(event);
    const existing = existingEntries.get(event.id);
    if (existing?.status === "applied" && event.bonusSharesPer10 > 0 && existing.quantityAfter === existing.quantityBefore
      && positions.some(position => position.status === "open" && position.entryTimestamp < event.timestamp)) {
      requiresUserAction = true;
      ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
        status: "corrected", reason: "这笔持仓的送转股数尚未处理，已暂停账户；请核对后新建账户。",
      }));
      break;
    }
    if (existing?.status === "corrected" && existing.eventFingerprint === fingerprint) continue;
    if (existing?.eventFingerprint && existing.eventFingerprint !== fingerprint
      && (existing.status === "applied" || existing.status === "not-eligible" || existing.status === "corrected")) {
      requiresUserAction = true;
      ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
        status: "corrected",
        eventFingerprint: fingerprint,
        reason: "数据源更正了已记账公司行为，已暂停自动处理，请确认或新建账户",
      }));
      continue;
    }
    if (processed.has(event.id)) continue;
    if (input.priceBasis !== "raw") {
      ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
        status: "pending",
        reason: input.priceBasis === "adjusted" ? "成交价格已包含调整口径，等待确认后不重复计入" : "行情复权口径未知，暂不自动记账",
      }));
      if (input.priceBasis === "unknown" && (positions.some(position => position.status === "open" && position.entryTimestamp < event.timestamp)
        || pendingOrders.some(order => order.createdAt < event.timestamp))) requiresUserAction = true;
      continue;
    }
    const action = applyCorporateActionsBeforeBar({
      events: [event], positions, pendingOrders,
      barTimestamp: input.barTimestamp, previousTimestamp: input.previousTimestamp,
      priceBasis: input.priceBasis, previousClose: referenceClose,
    });
    if (action.blockedReason) {
      requiresUserAction = true;
      ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
        status: "pending",
        reason: action.blockedReason,
      }));
      break;
    }
    positions = action.positions;
    pendingOrders = action.pendingOrders;
    referenceClose = action.referenceClose;
    const applied = action.appliedEvents[0];
    const credit = action.dividendCredits[0];
    if (!applied?.quantityBefore && !applied?.cancelledOrderIds.length) {
      ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
        status: "not-eligible",
        amount: 0,
        reason: "除权除息日前没有符合条件的多头持仓",
      }));
      continue;
    }
    cashDelta += input.capitalMode ? credit?.amount ?? 0 : 0;
    ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
      status: "applied",
      amount: credit?.amount ?? 0,
      quantityBefore: applied.quantityBefore,
      quantityAfter: applied.quantityAfter,
      reason: event.bonusSharesPer10 > 0
        ? "送转股数、持仓成本和保护价已调整；除权日前的开仓委托已取消"
        : input.capitalMode ? "现金分红已计入市场账户现金" : "收益率模式已记录分红事件，不改变购买力",
    }));
  }

  return {
    cashDelta: Number(cashDelta.toFixed(6)),
    ledgerEntries,
    positions,
    pendingOrders,
    requiresUserAction,
    referenceClose,
  };
}

export function terminalLiveCorporateActionIds(
  entries: ReadonlyArray<LiveCorporateActionLedgerEntry>,
) {
  return new Set(entries.filter((entry) => entry.status === "applied" || entry.status === "not-eligible" || entry.status === "corrected").map((entry) => entry.eventId));
}
