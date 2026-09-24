import {
  cashDividendCreditsForBar,
  type CorporateActionEvent,
  type CorporateActionHolding,
} from "./corporateActions.ts";

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
};

function ledgerEntry(
  event: CorporateActionEvent,
  input: LiveCorporateActionInput<CorporateActionHolding, unknown>,
  values: Partial<LiveCorporateActionLedgerEntry>,
): LiveCorporateActionLedgerEntry {
  return {
    eventId: event.id,
    instrumentId: event.instrumentId,
    eventType: event.category === 1 ? "cash-dividend" : "quantity-adjustment",
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
 * Applies only the safe first-phase company-action behavior.  Cash dividends
 * reuse the training-side eligibility calculation; adjusted or unknown price
 * series remain pending so the same economic adjustment is never counted
 * twice. Quantity events stay visible but are not guessed from an opaque
 * provider ratio.
 */
export function applyLiveCorporateActionsBeforeBar<
  TPosition extends CorporateActionHolding,
  TOrder,
>(input: LiveCorporateActionInput<TPosition, TOrder>): LiveCorporateActionResult<TPosition, TOrder> {
  if (!Number.isFinite(input.barTimestamp)) {
    return { cashDelta: 0, ledgerEntries: [], positions: input.positions, pendingOrders: input.pendingOrders, requiresUserAction: false };
  }
  const processed = input.processedEventIds ?? new Set<string>();
  const existingEntries = input.existingEntries ?? new Map<string, LiveCorporateActionLedgerEntry>();
  let cashDelta = 0;
  let requiresUserAction = false;
  const ledgerEntries: LiveCorporateActionLedgerEntry[] = [];
  const dueEvents = input.events
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp <= input.barTimestamp)
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));

  for (const event of dueEvents) {
    const fingerprint = liveCorporateActionFingerprint(event);
    const existing = existingEntries.get(event.id);
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
      continue;
    }
    if (event.category !== 1 || event.cashPer10 <= 0) {
      ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
        status: "pending",
        reason: "数量型公司行为比例尚未标准化，保持只读提示",
      }));
      continue;
    }
    const credit = cashDividendCreditsForBar([event], input.positions, input.barTimestamp)[0];
    if (!credit) {
      ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
        status: "not-eligible",
        amount: 0,
        reason: "除权除息日前没有符合条件的多头持仓",
      }));
      continue;
    }
    cashDelta += input.capitalMode ? credit.amount : 0;
    ledgerEntries.push(ledgerEntry(event, input as LiveCorporateActionInput<CorporateActionHolding, unknown>, {
      status: "applied",
      amount: credit.amount,
      quantityBefore: credit.quantity,
      quantityAfter: credit.quantity,
      reason: input.capitalMode ? "现金分红已计入市场账户现金" : "收益率模式已记录分红事件，不改变购买力",
    }));
  }

  return {
    cashDelta: Number(cashDelta.toFixed(6)),
    ledgerEntries,
    positions: input.positions,
    pendingOrders: input.pendingOrders,
    requiresUserAction,
  };
}

export function terminalLiveCorporateActionIds(
  entries: ReadonlyArray<LiveCorporateActionLedgerEntry>,
) {
  return new Set(entries.filter((entry) => entry.status === "applied" || entry.status === "not-eligible" || entry.status === "corrected").map((entry) => entry.eventId));
}
