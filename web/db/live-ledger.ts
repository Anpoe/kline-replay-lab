import {
  liveAccountCurrencyForMarket,
  liveAccountIdForMarket,
  normalizeLiveMarketAccountSnapshot,
  type LiveAccountMarket,
  type LiveMarketAccountSnapshot,
} from "../app/lib/tradingAccount.ts";

const MAX_LIVE_ITEMS = 500;
const MAX_LIVE_JSON_BYTES = 512 * 1024;

type JsonRecord = Record<string, unknown>;

type NormalizedPosition = {
  id: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  entryOrderId: string;
  status: "open" | "closed";
  exitPrice: number | null;
  exitTimestamp: number | null;
  exitOrderId: string | null;
  realizedPnl: number | null;
  entryOrderType: string | null;
  entryIntrabar: boolean | null;
  stopLoss: number | null;
  takeProfit: number | null;
  initialRisk: number | null;
  grossRealizedPnl: number | null;
  entryFee: number | null;
  exitFee: number | null;
  totalFees: number | null;
  exitReason: string | null;
  intrabarAmbiguous: boolean | null;
  engineVersion: string | null;
  sizingMode: string | null;
  riskPercent: number | null;
  riskBudget: number | null;
  marginUsed: number | null;
  payloadVersion: number;
  payload: JsonRecord;
};

type NormalizedPendingOrder = {
  id: string;
  action: "open" | "close";
  side: "buy" | "sell";
  qty: number;
  createdAt: number;
  positionId: string;
  ruleId: string | null;
  ruleVersion: string | null;
  priceBand: unknown | null;
  reservedCash: number | null;
  status: string;
  executeAtTimestamp: number | null;
  orderType: string | null;
  triggerPrice: number | null;
  originalQty: number | null;
  filledQty: number | null;
  remainingQty: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  sizingMode: string | null;
  riskPercent: number | null;
  riskBudget: number | null;
  reservedMargin: number | null;
  engineVersion: string | null;
  payloadVersion: number;
  payload: JsonRecord;
};

type NormalizedExecution = {
  id: string;
  orderId: string;
  positionId: string;
  action: "open" | "close";
  side: "buy" | "sell";
  qty: number;
  price: number;
  timestamp: number;
  realizedPnl: number;
  ruleId: string | null;
  ruleVersion: string | null;
  rawPrice: number | null;
  quotePrice: number | null;
  quoteSide: string | null;
  fee: number | null;
  priceImpactCost: number | null;
  orderType: string | null;
  triggerPrice: number | null;
  reason: string | null;
  intrabarAmbiguous: boolean | null;
  partial: boolean | null;
  remainingQty: number | null;
  notionalValue: number | null;
  marginImpact: number | null;
  accountCurrency: string | null;
  engineVersion: string | null;
  payloadVersion: number;
  payload: JsonRecord;
};

type NormalizedOrderRejection = {
  id: string;
  orderId: string | null;
  code: string;
  message: string;
  timestamp: number;
  ruleId: string;
  ruleVersion: string;
  barEvidence: JsonRecord | null;
  payloadVersion: number;
  payload: JsonRecord;
};

export type NormalizedPortfolio = {
  instrumentId: string;
  accountId: string | null;
  accountVersion: number;
  payloadVersion: number;
  payload: JsonRecord;
  lastProcessedTimestamp: number | null;
  lastProcessedRevision: string | null;
  corporateActionEvents: JsonRecord[];
  symbol: string;
  name: string;
  market: "CN" | "US";
  latestTimestamp: number;
  latestClose: number;
  scanTimestamp: number;
  presetIds: string[];
  presetNames: string[];
  positions: NormalizedPosition[];
  pendingOrders: NormalizedPendingOrder[];
  executions: NormalizedExecution[];
  orderRejections: NormalizedOrderRejection[];
  tradingMode: "return" | "capital";
  initialCapital: number;
  cashBalance: number;
  decision: JsonRecord | null;
  decisionSubmissions: unknown[];
  updatedAt: string;
  sortOrder: number;
};

export type NormalizedLiveAccount = LiveMarketAccountSnapshot;

export type NormalizedWatch = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: "CN" | "US" | "FX" | "GOLD";
  latestTimestamp: number;
  latestClose: number;
  observationTimestamp: number | null;
  observationClose: number | null;
  entryTimestamp: number | null;
  entryPrice: number | null;
  scanTimestamp: number;
  presetIds: string[];
  presetNames: string[];
  updatedAt: string;
  sortOrder: number;
};

type DeleteRequest = {
  instrumentId: string;
  updatedAt: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function payloadVersion(value: unknown) {
  return Math.max(1, Math.trunc(finiteNumber(value, 1)));
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function nullableBooleanInt(value: boolean | null) {
  return value === null ? null : value ? 1 : 0;
}

function stringArray(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

function jsonRecords(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, limit);
}

function jsonText(value: unknown, fallback: unknown) {
  try {
    const serialized = JSON.stringify(value ?? fallback);
    if (typeof serialized === "string"
      && new TextEncoder().encode(serialized).byteLength <= MAX_LIVE_JSON_BYTES) {
      return serialized;
    }
  } catch {
    // Fall through to the bounded fallback.
  }
  return JSON.stringify(fallback);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizePosition(value: unknown): NormalizedPosition | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const side = value.side === "long" || value.side === "short" ? value.side : null;
  const status = value.status === "open" || value.status === "closed" ? value.status : null;
  const qty = finiteNumber(value.qty);
  const entryPrice = finiteNumber(value.entryPrice);
  const entryTimestamp = finiteNumber(value.entryTimestamp);
  const entryOrderId = stringValue(value.entryOrderId);
  if (!id || !side || !status || qty <= 0 || entryPrice <= 0 || !entryOrderId) return null;
  const exitPrice = nullableNumber(value.exitPrice);
  const exitTimestamp = nullableNumber(value.exitTimestamp);
  if (status === "closed" && (exitPrice === null || exitTimestamp === null)) return null;
  return {
    id,
    side,
    qty,
    entryPrice,
    entryTimestamp,
    entryOrderId,
    status,
    exitPrice,
    exitTimestamp,
    exitOrderId: stringValue(value.exitOrderId) || null,
    realizedPnl: nullableNumber(value.realizedPnl),
    entryOrderType: nullableString(value.entryOrderType),
    entryIntrabar: nullableBoolean(value.entryIntrabar),
    stopLoss: nullableNumber(value.stopLoss),
    takeProfit: nullableNumber(value.takeProfit),
    initialRisk: nullableNumber(value.initialRisk),
    grossRealizedPnl: nullableNumber(value.grossRealizedPnl),
    entryFee: nullableNumber(value.entryFee),
    exitFee: nullableNumber(value.exitFee),
    totalFees: nullableNumber(value.totalFees),
    exitReason: nullableString(value.exitReason),
    intrabarAmbiguous: nullableBoolean(value.intrabarAmbiguous),
    engineVersion: nullableString(value.engineVersion),
    sizingMode: nullableString(value.sizingMode),
    riskPercent: nullableNumber(value.riskPercent),
    riskBudget: nullableNumber(value.riskBudget),
    marginUsed: nullableNumber(value.marginUsed),
    payloadVersion: payloadVersion(value.payloadVersion),
    payload: value,
  };
}

function normalizePendingOrder(value: unknown): NormalizedPendingOrder | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const action = value.action === "open" || value.action === "close" ? value.action : null;
  const side = value.side === "buy" || value.side === "sell" ? value.side : null;
  const qty = finiteNumber(value.qty);
  const createdAt = finiteNumber(value.createdAt);
  const positionId = stringValue(value.positionId);
  if (!id || !action || !side || qty <= 0 || !positionId) return null;
  return {
    id,
    action,
    side,
    qty,
    createdAt,
    positionId,
    ruleId: stringValue(value.ruleId) || null,
    ruleVersion: stringValue(value.ruleVersion) || null,
    priceBand: isRecord(value.priceBand) ? value.priceBand : null,
    reservedCash: nullableNumber(value.reservedCash),
    status: nullableString(value.status) ?? "pending",
    executeAtTimestamp: nullableNumber(value.executeAtTimestamp),
    orderType: nullableString(value.orderType),
    triggerPrice: nullableNumber(value.triggerPrice),
    originalQty: nullableNumber(value.originalQty),
    filledQty: nullableNumber(value.filledQty),
    remainingQty: nullableNumber(value.remainingQty),
    stopLoss: nullableNumber(value.stopLoss),
    takeProfit: nullableNumber(value.takeProfit),
    sizingMode: nullableString(value.sizingMode),
    riskPercent: nullableNumber(value.riskPercent),
    riskBudget: nullableNumber(value.riskBudget),
    reservedMargin: nullableNumber(value.reservedMargin),
    engineVersion: nullableString(value.engineVersion),
    payloadVersion: payloadVersion(value.payloadVersion),
    payload: value,
  };
}

function normalizeExecution(value: unknown): NormalizedExecution | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const orderId = stringValue(value.orderId);
  const positionId = stringValue(value.positionId);
  const action = value.action === "open" || value.action === "close" ? value.action : null;
  const side = value.side === "buy" || value.side === "sell" ? value.side : null;
  const qty = finiteNumber(value.qty);
  const price = finiteNumber(value.price);
  const timestamp = finiteNumber(value.timestamp);
  const realizedPnl = finiteNumber(value.realizedPnl);
  if (!id || !orderId || !positionId || !action || !side || qty <= 0 || price <= 0) return null;
  return {
    id,
    orderId,
    positionId,
    action,
    side,
    qty,
    price,
    timestamp,
    realizedPnl,
    ruleId: stringValue(value.ruleId) || null,
    ruleVersion: stringValue(value.ruleVersion) || null,
    rawPrice: nullableNumber(value.rawPrice),
    quotePrice: nullableNumber(value.quotePrice),
    quoteSide: nullableString(value.quoteSide),
    fee: nullableNumber(value.fee),
    priceImpactCost: nullableNumber(value.priceImpactCost),
    orderType: nullableString(value.orderType),
    triggerPrice: nullableNumber(value.triggerPrice),
    reason: nullableString(value.reason),
    intrabarAmbiguous: nullableBoolean(value.intrabarAmbiguous),
    partial: nullableBoolean(value.partial),
    remainingQty: nullableNumber(value.remainingQty),
    notionalValue: nullableNumber(value.notionalValue),
    marginImpact: nullableNumber(value.marginImpact),
    accountCurrency: nullableString(value.accountCurrency),
    engineVersion: nullableString(value.engineVersion),
    payloadVersion: payloadVersion(value.payloadVersion),
    payload: value,
  };
}

function normalizeOrderRejection(value: unknown): NormalizedOrderRejection | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const code = stringValue(value.code);
  const message = stringValue(value.message);
  const ruleId = stringValue(value.ruleId);
  const ruleVersion = stringValue(value.ruleVersion);
  if (!id || !code || !message || !ruleId || !ruleVersion) return null;
  return {
    id,
    orderId: stringValue(value.orderId) || null,
    code,
    message,
    timestamp: finiteNumber(value.timestamp),
    ruleId,
    ruleVersion,
    barEvidence: isRecord(value.barEvidence) ? value.barEvidence : null,
    payloadVersion: payloadVersion(value.payloadVersion),
    payload: value,
  };
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function normalizePortfolio(value: unknown, sortOrder = 0): NormalizedPortfolio | null {
  if (!isRecord(value)) return null;
  const instrumentId = stringValue(value.instrumentId);
  const market = value.market === "CN" || value.market === "US" ? value.market : null;
  const symbol = stringValue(value.symbol, instrumentId);
  const name = stringValue(value.name, symbol);
  const updatedAt = stringValue(value.updatedAt, new Date(0).toISOString());
  if (!instrumentId || !market || !symbol || !name) return null;
  const positions = uniqueById(
    (Array.isArray(value.positions) ? value.positions : [])
      .map(normalizePosition)
      .filter((item): item is NormalizedPosition => Boolean(item)),
  );
  const pendingOrders = uniqueById(
    (Array.isArray(value.pendingOrders) ? value.pendingOrders : [])
      .map(normalizePendingOrder)
      .filter((item): item is NormalizedPendingOrder => Boolean(item)),
  );
  const executions = uniqueById(
    (Array.isArray(value.executions) ? value.executions : [])
      .map(normalizeExecution)
      .filter((item): item is NormalizedExecution => Boolean(item)),
  );
  const orderRejections = uniqueById(
    (Array.isArray(value.orderRejections) ? value.orderRejections : [])
      .map(normalizeOrderRejection)
      .filter((item): item is NormalizedOrderRejection => Boolean(item)),
  );
  return {
    instrumentId,
    accountId: stringValue(value.accountId) || null,
    accountVersion: payloadVersion(value.accountVersion),
    payloadVersion: payloadVersion(value.payloadVersion),
    payload: value,
    lastProcessedTimestamp: nullableNumber(value.lastProcessedTimestamp),
    lastProcessedRevision: stringValue(value.lastProcessedRevision) || null,
    corporateActionEvents: jsonRecords(value.corporateActionEvents),
    symbol,
    name,
    market,
    latestTimestamp: finiteNumber(value.latestTimestamp),
    latestClose: finiteNumber(value.latestClose),
    scanTimestamp: finiteNumber(value.scanTimestamp),
    presetIds: stringArray(value.presetIds),
    presetNames: stringArray(value.presetNames),
    positions,
    pendingOrders,
    executions,
    orderRejections,
    tradingMode: value.tradingMode === "capital" ? "capital" : "return",
    initialCapital: finiteNumber(value.initialCapital),
    cashBalance: finiteNumber(value.cashBalance),
    decision: isRecord(value.decision) ? value.decision : null,
    decisionSubmissions: Array.isArray(value.decisionSubmissions)
      ? value.decisionSubmissions.slice(0, 500)
      : [],
    updatedAt,
    sortOrder: Number.isFinite(value.sortOrder) ? Math.round(Number(value.sortOrder)) : sortOrder,
  };
}

function normalizeLiveAccount(value: unknown): NormalizedLiveAccount | null {
  const record = isRecord(value) ? value : {};
  const market: LiveAccountMarket | null = record.market === "CN" || record.market === "US"
    ? record.market
    : null;
  if (!market) return null;
  return normalizeLiveMarketAccountSnapshot({
    ...record,
    id: stringValue(record.id || record.accountId, liveAccountIdForMarket(market)),
    currency: record.currency ?? liveAccountCurrencyForMarket(market),
  });
}

export function normalizeWatch(value: unknown, sortOrder = 0): NormalizedWatch | null {
  if (!isRecord(value)) return null;
  const instrumentId = stringValue(value.instrumentId);
  const market = value.market === "CN" || value.market === "US" || value.market === "FX" || value.market === "GOLD"
    ? value.market
    : null;
  const symbol = stringValue(value.symbol, instrumentId);
  const name = stringValue(value.name, symbol);
  const updatedAt = stringValue(value.updatedAt, new Date(0).toISOString());
  if (!instrumentId || !market || !symbol || !name) return null;
  return {
    instrumentId,
    symbol,
    name,
    market,
    latestTimestamp: finiteNumber(value.latestTimestamp),
    latestClose: finiteNumber(value.latestClose),
    observationTimestamp: nullableNumber(value.observationTimestamp),
    observationClose: nullableNumber(value.observationClose),
    entryTimestamp: nullableNumber(value.entryTimestamp),
    entryPrice: nullableNumber(value.entryPrice),
    scanTimestamp: finiteNumber(value.scanTimestamp),
    presetIds: stringArray(value.presetIds),
    presetNames: stringArray(value.presetNames),
    updatedAt,
    sortOrder: Number.isFinite(value.sortOrder) ? Math.round(Number(value.sortOrder)) : sortOrder,
  };
}

function normalizeDeletes(value: unknown): DeleteRequest[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const record = typeof item === "string"
      ? { instrumentId: item, updatedAt: null }
      : isRecord(item)
        ? { instrumentId: stringValue(item.instrumentId), updatedAt: stringValue(item.updatedAt) || null }
        : null;
    if (!record?.instrumentId || seen.has(record.instrumentId)) return [];
    seen.add(record.instrumentId);
    return [record];
  }).slice(0, MAX_LIVE_ITEMS);
}

function bindNullableNumber(value: number | null) {
  return value;
}

function liveAccountUpsertStatement(db: D1Database, account: NormalizedLiveAccount, force = false) {
  const conflict = force
    ? `ON CONFLICT(account_id) DO UPDATE SET
        market = excluded.market, currency = excluded.currency, display_name = excluded.display_name,
        status = excluded.status, trading_mode = excluded.trading_mode,
        initial_capital = excluded.initial_capital, risk_capital = excluded.risk_capital,
        cash_balance = excluded.cash_balance, reserved_cash = excluded.reserved_cash,
        reserved_margin = excluded.reserved_margin, equity = excluded.equity,
        available_cash = excluded.available_cash, account_version = excluded.account_version,
        payload_version = excluded.payload_version, payload_json = excluded.payload_json,
        execution_profile_json = excluded.execution_profile_json,
        execution_profile_version = excluded.execution_profile_version,
        execution_engine_version = excluded.execution_engine_version,
        execution_switch_state = excluded.execution_switch_state,
        switched_at = excluded.switched_at, previous_account_version = excluded.previous_account_version,
        market_rule_version = excluded.market_rule_version, data_contract_version = excluded.data_contract_version,
        legacy_pending_order_count = excluded.legacy_pending_order_count,
        carried_position_count = excluded.carried_position_count, needs_user_action = excluded.needs_user_action,
        last_processed_timestamp = excluded.last_processed_timestamp,
        last_processed_revision = excluded.last_processed_revision,
        updated_at = excluded.updated_at, archived_at = excluded.archived_at`
    : `ON CONFLICT(account_id) DO UPDATE SET
        market = excluded.market, currency = excluded.currency, display_name = excluded.display_name,
        status = excluded.status, trading_mode = excluded.trading_mode,
        initial_capital = excluded.initial_capital, risk_capital = excluded.risk_capital,
        cash_balance = excluded.cash_balance, reserved_cash = excluded.reserved_cash,
        reserved_margin = excluded.reserved_margin, equity = excluded.equity,
        available_cash = excluded.available_cash, account_version = excluded.account_version,
        payload_version = excluded.payload_version, payload_json = excluded.payload_json,
        execution_profile_json = excluded.execution_profile_json,
        execution_profile_version = excluded.execution_profile_version,
        execution_engine_version = excluded.execution_engine_version,
        execution_switch_state = excluded.execution_switch_state,
        switched_at = excluded.switched_at, previous_account_version = excluded.previous_account_version,
        market_rule_version = excluded.market_rule_version, data_contract_version = excluded.data_contract_version,
        legacy_pending_order_count = excluded.legacy_pending_order_count,
        carried_position_count = excluded.carried_position_count, needs_user_action = excluded.needs_user_action,
        last_processed_timestamp = excluded.last_processed_timestamp,
        last_processed_revision = excluded.last_processed_revision,
        updated_at = excluded.updated_at, archived_at = excluded.archived_at
      WHERE excluded.updated_at >= live_accounts.updated_at
        AND excluded.account_version > live_accounts.account_version`;
  return db.prepare(`INSERT INTO live_accounts
      (account_id, market, currency, display_name, status, trading_mode,
       initial_capital, risk_capital, cash_balance, reserved_cash, reserved_margin,
       equity, available_cash, account_version, payload_version, payload_json,
       settings_json, execution_profile_json, execution_profile_version,
       execution_engine_version, execution_switch_state, switched_at, previous_account_version,
       market_rule_version, data_contract_version, legacy_pending_order_count,
       carried_position_count, needs_user_action,
       last_processed_timestamp, last_processed_revision, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflict}`)
    .bind(
      account.id,
      account.market,
      account.currency,
      account.displayName,
      account.status,
      account.tradingMode,
      account.initialCapital,
      account.riskCapital,
      account.cashBalance,
      account.reservedCash,
      account.reservedMargin,
      account.equity,
      account.availableCash,
      account.version,
      account.payloadVersion,
      jsonText(account, {}),
      "{}",
      jsonText(account.executionProfile, {}),
      account.executionProfileVersion,
      account.executionEngineVersion,
      account.executionSwitchState,
      account.switchedAt,
      account.previousAccountVersion,
      account.marketRuleVersion,
      account.dataContractVersion,
      account.legacyPendingOrderCount,
      account.carriedPositionCount,
      account.needsUserAction ? 1 : 0,
      account.lastProcessedTimestamp,
      account.lastProcessedRevision,
      account.createdAt,
      account.updatedAt,
      account.status === "archived" ? account.updatedAt : null,
    );
}

function portfolioUpsertStatement(db: D1Database, portfolio: NormalizedPortfolio, force = false) {
  const conflict = force
    ? `ON CONFLICT(instrument_id) DO UPDATE SET
        account_id = COALESCE(excluded.account_id, live_portfolios.account_id),
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, decision_json = excluded.decision_json,
        decision_submissions_json = excluded.decision_submissions_json,
        trading_mode = excluded.trading_mode, initial_capital = excluded.initial_capital,
        cash_balance = excluded.cash_balance, updated_at = excluded.updated_at,
        account_version = excluded.account_version, payload_version = excluded.payload_version,
        payload_json = excluded.payload_json, last_processed_timestamp = excluded.last_processed_timestamp,
        last_processed_revision = excluded.last_processed_revision,
        corporate_action_events_json = excluded.corporate_action_events_json, sort_order = excluded.sort_order`
    : `ON CONFLICT(instrument_id) DO UPDATE SET
        account_id = COALESCE(excluded.account_id, live_portfolios.account_id),
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, decision_json = excluded.decision_json,
        decision_submissions_json = excluded.decision_submissions_json,
        trading_mode = excluded.trading_mode, initial_capital = excluded.initial_capital,
        cash_balance = excluded.cash_balance, updated_at = excluded.updated_at,
        account_version = CASE WHEN excluded.account_id IS NULL
          THEN live_portfolios.account_version ELSE excluded.account_version END,
        payload_version = excluded.payload_version, payload_json = excluded.payload_json,
        last_processed_timestamp = excluded.last_processed_timestamp,
        last_processed_revision = excluded.last_processed_revision,
        corporate_action_events_json = excluded.corporate_action_events_json, sort_order = excluded.sort_order
      WHERE excluded.updated_at >= live_portfolios.updated_at
        AND (excluded.account_id IS NULL OR EXISTS (
          SELECT 1 FROM live_accounts
          WHERE account_id = excluded.account_id
            AND account_version = excluded.account_version
        ))`;
  return db.prepare(`INSERT INTO live_portfolios
      (instrument_id, account_id, symbol, name, market, latest_timestamp, latest_close,
       scan_timestamp, preset_ids_json, preset_names_json, decision_json,
       decision_submissions_json, trading_mode, initial_capital, cash_balance,
       account_version, payload_version, payload_json, last_processed_timestamp,
       last_processed_revision, corporate_action_events_json, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflict}`)
    .bind(
      portfolio.instrumentId,
      portfolio.accountId,
      portfolio.symbol,
      portfolio.name,
      portfolio.market,
      portfolio.latestTimestamp,
      portfolio.latestClose,
      portfolio.scanTimestamp,
      JSON.stringify(portfolio.presetIds),
      JSON.stringify(portfolio.presetNames),
      portfolio.decision ? jsonText(portfolio.decision, null) : null,
      jsonText(portfolio.decisionSubmissions, []),
      portfolio.tradingMode,
      portfolio.initialCapital,
      portfolio.cashBalance,
      portfolio.accountVersion,
      portfolio.payloadVersion,
      jsonText(portfolio.payload, {}),
      portfolio.lastProcessedTimestamp,
      portfolio.lastProcessedRevision,
      jsonText(portfolio.corporateActionEvents, []),
      portfolio.updatedAt,
      portfolio.sortOrder,
    );
}

function watchUpsertStatement(db: D1Database, watch: NormalizedWatch, force = false) {
  const conflict = force
    ? `ON CONFLICT(instrument_id) DO UPDATE SET
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        observation_timestamp = excluded.observation_timestamp, observation_close = excluded.observation_close,
        entry_timestamp = excluded.entry_timestamp, entry_price = excluded.entry_price,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, updated_at = excluded.updated_at,
        sort_order = excluded.sort_order`
    : `ON CONFLICT(instrument_id) DO UPDATE SET
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        latest_timestamp = excluded.latest_timestamp, latest_close = excluded.latest_close,
        observation_timestamp = excluded.observation_timestamp, observation_close = excluded.observation_close,
        entry_timestamp = excluded.entry_timestamp, entry_price = excluded.entry_price,
        scan_timestamp = excluded.scan_timestamp, preset_ids_json = excluded.preset_ids_json,
        preset_names_json = excluded.preset_names_json, updated_at = excluded.updated_at,
        sort_order = excluded.sort_order
      WHERE excluded.updated_at >= live_watchlist.updated_at`;
  return db.prepare(`INSERT INTO live_watchlist
      (instrument_id, symbol, name, market, latest_timestamp, latest_close,
       observation_timestamp, observation_close, entry_timestamp, entry_price,
       scan_timestamp, preset_ids_json, preset_names_json, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${conflict}`)
    .bind(
      watch.instrumentId,
      watch.symbol,
      watch.name,
      watch.market,
      watch.latestTimestamp,
      watch.latestClose,
      bindNullableNumber(watch.observationTimestamp),
      bindNullableNumber(watch.observationClose),
      bindNullableNumber(watch.entryTimestamp),
      bindNullableNumber(watch.entryPrice),
      watch.scanTimestamp,
      JSON.stringify(watch.presetIds),
      JSON.stringify(watch.presetNames),
      watch.updatedAt,
      watch.sortOrder,
    );
}

function childStatements(db: D1Database, portfolio: NormalizedPortfolio) {
  const writeGuard = `EXISTS (
    SELECT 1 FROM live_portfolios
    WHERE instrument_id = ? AND updated_at = ?
  )`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM live_positions WHERE portfolio_instrument_id = ? AND ${writeGuard}`)
      .bind(portfolio.instrumentId, portfolio.instrumentId, portfolio.updatedAt),
    db.prepare(`DELETE FROM live_pending_orders WHERE portfolio_instrument_id = ? AND ${writeGuard}`)
      .bind(portfolio.instrumentId, portfolio.instrumentId, portfolio.updatedAt),
    db.prepare(`DELETE FROM live_executions WHERE portfolio_instrument_id = ? AND ${writeGuard}`)
      .bind(portfolio.instrumentId, portfolio.instrumentId, portfolio.updatedAt),
    db.prepare(`DELETE FROM live_order_rejections WHERE portfolio_instrument_id = ? AND ${writeGuard}`)
      .bind(portfolio.instrumentId, portfolio.instrumentId, portfolio.updatedAt),
  ];
  for (const position of portfolio.positions) {
    statements.push(db.prepare(`INSERT INTO live_positions
      (id, account_id, portfolio_instrument_id, side, qty, entry_price, entry_timestamp,
       entry_order_id, entry_order_type, entry_intrabar, status, exit_price, exit_timestamp,
       exit_order_id, realized_pnl, gross_realized_pnl, entry_fee, exit_fee, total_fees,
       stop_loss, take_profit, initial_risk, exit_reason, intrabar_ambiguous, engine_version,
       sizing_mode, risk_percent, risk_budget, margin_used, payload_version, payload_json)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ${writeGuard}`)
      .bind(position.id, portfolio.accountId, portfolio.instrumentId, position.side, position.qty, position.entryPrice,
        position.entryTimestamp, position.entryOrderId, position.entryOrderType, nullableBooleanInt(position.entryIntrabar),
        position.status, position.exitPrice, position.exitTimestamp, position.exitOrderId, position.realizedPnl,
        position.grossRealizedPnl, position.entryFee, position.exitFee, position.totalFees, position.stopLoss,
        position.takeProfit, position.initialRisk, position.exitReason, nullableBooleanInt(position.intrabarAmbiguous),
        position.engineVersion, position.sizingMode, position.riskPercent, position.riskBudget, position.marginUsed,
        position.payloadVersion, jsonText(position.payload, {}), portfolio.instrumentId, portfolio.updatedAt));
  }
  for (const order of portfolio.pendingOrders) {
    statements.push(db.prepare(`INSERT INTO live_pending_orders
      (id, account_id, portfolio_instrument_id, action, side, qty, created_at, position_id,
       rule_id, rule_version, price_band_json, reserved_cash, status, execute_at_timestamp,
       order_type, trigger_price, original_qty, filled_qty, remaining_qty, stop_loss, take_profit,
       sizing_mode, risk_percent, risk_budget, reserved_margin, engine_version, payload_version, payload_json)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ${writeGuard}`)
      .bind(order.id, portfolio.accountId, portfolio.instrumentId, order.action, order.side, order.qty, order.createdAt,
        order.positionId, order.ruleId, order.ruleVersion,
        order.priceBand ? jsonText(order.priceBand, null) : null, order.reservedCash, order.status,
        order.executeAtTimestamp, order.orderType, order.triggerPrice, order.originalQty, order.filledQty,
        order.remainingQty, order.stopLoss, order.takeProfit, order.sizingMode, order.riskPercent,
        order.riskBudget, order.reservedMargin, order.engineVersion, order.payloadVersion, jsonText(order.payload, {}),
        portfolio.instrumentId, portfolio.updatedAt));
  }
  for (const execution of portfolio.executions) {
    statements.push(db.prepare(`INSERT INTO live_executions
      (id, account_id, portfolio_instrument_id, order_id, position_id, action, side, qty,
       price, timestamp, realized_pnl, rule_id, rule_version, raw_price, quote_price, quote_side,
       fee, price_impact_cost, order_type, trigger_price, reason, intrabar_ambiguous, partial,
       remaining_qty, notional_value, margin_impact, account_currency, engine_version,
       payload_version, payload_json)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ${writeGuard}`)
      .bind(execution.id, portfolio.accountId, portfolio.instrumentId, execution.orderId, execution.positionId,
        execution.action, execution.side, execution.qty, execution.price, execution.timestamp,
        execution.realizedPnl, execution.ruleId, execution.ruleVersion, execution.rawPrice, execution.quotePrice,
        execution.quoteSide, execution.fee, execution.priceImpactCost, execution.orderType, execution.triggerPrice,
        execution.reason, nullableBooleanInt(execution.intrabarAmbiguous), nullableBooleanInt(execution.partial),
        execution.remainingQty, execution.notionalValue, execution.marginImpact, execution.accountCurrency,
        execution.engineVersion, execution.payloadVersion, jsonText(execution.payload, {}), portfolio.instrumentId,
        portfolio.updatedAt));
  }
  for (const rejection of portfolio.orderRejections) {
    statements.push(db.prepare(`INSERT INTO live_order_rejections
      (id, account_id, portfolio_instrument_id, order_id, code, message, timestamp,
       rule_id, rule_version, payload_version, payload_json)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ${writeGuard}`)
      .bind(rejection.id, portfolio.accountId, portfolio.instrumentId, rejection.orderId, rejection.code,
        rejection.message, rejection.timestamp, rejection.ruleId, rejection.ruleVersion,
        rejection.payloadVersion, jsonText(rejection.payload, {}), portfolio.instrumentId, portfolio.updatedAt));
  }
  return statements;
}

async function runInChunks(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) {
    const chunk = statements.slice(index, index + 80);
    if (chunk.length) await db.batch(chunk);
  }
}

export async function migrateLegacyLiveData(db: D1Database) {
  const marker = await db
    .prepare("SELECT value FROM app_metadata WHERE key = 'live_data_migrated_v1'")
    .first<{ value: string }>();
  if (marker) return;
  const row = await db
    .prepare("SELECT value FROM app_metadata WHERE key = 'training_preferences_v1'")
    .first<{ value: string }>();
  const legacy = parseJson<JsonRecord>(row?.value, {});
  const portfolioIds = new Set<string>();
  const childIds = {
    position: new Set<string>(),
    pending: new Set<string>(),
    execution: new Set<string>(),
    rejection: new Set<string>(),
  };
  const portfolioStatements: D1PreparedStatement[] = [];
  const childStatementsByPortfolio: D1PreparedStatement[] = [];
  for (const [index, value] of (Array.isArray(legacy.livePortfolios) ? legacy.livePortfolios : []).entries()) {
    const portfolio = normalizePortfolio(value, index);
    if (!portfolio || portfolioIds.has(portfolio.instrumentId)) continue;
    portfolioIds.add(portfolio.instrumentId);
    portfolioStatements.push(portfolioUpsertStatement(db, portfolio, true));
    childStatementsByPortfolio.push(
      db.prepare("DELETE FROM live_positions WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
      db.prepare("DELETE FROM live_pending_orders WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
      db.prepare("DELETE FROM live_executions WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
      db.prepare("DELETE FROM live_order_rejections WHERE portfolio_instrument_id = ?").bind(portfolio.instrumentId),
    );
    for (const position of portfolio.positions) {
      if (!childIds.position.has(position.id)) {
        childIds.position.add(position.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_positions
          (id, portfolio_instrument_id, side, qty, entry_price, entry_timestamp,
           entry_order_id, status, exit_price, exit_timestamp, exit_order_id, realized_pnl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(position.id, portfolio.instrumentId, position.side, position.qty, position.entryPrice,
            position.entryTimestamp, position.entryOrderId, position.status, position.exitPrice,
            position.exitTimestamp, position.exitOrderId, position.realizedPnl));
      }
    }
    for (const order of portfolio.pendingOrders) {
      if (!childIds.pending.has(order.id)) {
        childIds.pending.add(order.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_pending_orders
          (id, portfolio_instrument_id, action, side, qty, created_at, position_id,
           rule_id, rule_version, price_band_json, reserved_cash, execute_at_timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(order.id, portfolio.instrumentId, order.action, order.side, order.qty, order.createdAt,
            order.positionId, order.ruleId, order.ruleVersion,
            order.priceBand ? jsonText(order.priceBand, null) : null, order.reservedCash,
            order.executeAtTimestamp));
      }
    }
    for (const execution of portfolio.executions) {
      if (!childIds.execution.has(execution.id)) {
        childIds.execution.add(execution.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_executions
          (id, portfolio_instrument_id, order_id, position_id, action, side, qty,
           price, timestamp, realized_pnl, rule_id, rule_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(execution.id, portfolio.instrumentId, execution.orderId, execution.positionId,
            execution.action, execution.side, execution.qty, execution.price, execution.timestamp,
            execution.realizedPnl, execution.ruleId, execution.ruleVersion));
      }
    }
    for (const rejection of portfolio.orderRejections) {
      if (!childIds.rejection.has(rejection.id)) {
        childIds.rejection.add(rejection.id);
        childStatementsByPortfolio.push(db.prepare(`INSERT OR REPLACE INTO live_order_rejections
          (id, portfolio_instrument_id, order_id, code, message, timestamp, rule_id, rule_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(rejection.id, portfolio.instrumentId, rejection.orderId, rejection.code,
            rejection.message, rejection.timestamp, rejection.ruleId, rejection.ruleVersion));
      }
    }
  }
  await runInChunks(db, portfolioStatements);
  await runInChunks(db, childStatementsByPortfolio);

  const watchIds = new Set<string>();
  const watchStatements: D1PreparedStatement[] = [];
  for (const [index, value] of (Array.isArray(legacy.liveWatchlist) ? legacy.liveWatchlist : []).entries()) {
    const watch = normalizeWatch(value, index);
    if (!watch || watchIds.has(watch.instrumentId)) continue;
    watchIds.add(watch.instrumentId);
    watchStatements.push(watchUpsertStatement(db, watch, true));
  }
  await runInChunks(db, watchStatements);
  await db.prepare(
    "INSERT INTO app_metadata (key, value) VALUES ('live_data_migrated_v1', '1')",
  ).run();
}

type PortfolioRow = {
  instrumentId: string;
  accountId: string | null;
  symbol: string;
  name: string;
  market: "CN" | "US";
  latestTimestamp: number;
  latestClose: number;
  scanTimestamp: number;
  presetIdsJson: string;
  presetNamesJson: string;
  decisionJson: string | null;
  decisionSubmissionsJson: string;
  tradingMode: "return" | "capital";
  initialCapital: number;
  cashBalance: number;
  accountVersion: number;
  payloadVersion: number;
  lastProcessedTimestamp: number | null;
  lastProcessedRevision: string | null;
  corporateActionEventsJson: string;
  updatedAt: string;
};

type AccountRow = {
  id: string;
  market: LiveAccountMarket;
  currency: "CNY" | "USD";
  displayName: string;
  status: string;
  tradingMode: "return" | "capital";
  initialCapital: number;
  riskCapital: number;
  cashBalance: number;
  reservedCash: number;
  reservedMargin: number;
  equity: number;
  availableCash: number;
  version: number;
  payloadVersion: number;
  executionProfileJson: string;
  executionProfileVersion: string | null;
  executionEngineVersion: string;
  executionSwitchState: string;
  switchedAt: string | null;
  previousAccountVersion: number | null;
  marketRuleVersion: string | null;
  dataContractVersion: string | null;
  legacyPendingOrderCount: number;
  carriedPositionCount: number;
  needsUserAction: number;
  lastProcessedTimestamp: number | null;
  lastProcessedRevision: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function readLiveState(db: D1Database) {
  const [accountResult, portfolioResult, positionResult, pendingResult, executionResult, rejectionResult, watchResult] = await Promise.all([
    db.prepare(`SELECT account_id AS id, market, currency, display_name AS displayName,
      status, trading_mode AS tradingMode, initial_capital AS initialCapital,
      risk_capital AS riskCapital, cash_balance AS cashBalance,
      reserved_cash AS reservedCash, reserved_margin AS reservedMargin,
      equity, available_cash AS availableCash, account_version AS version,
      payload_version AS payloadVersion, execution_profile_json AS executionProfileJson,
      execution_profile_version AS executionProfileVersion,
      execution_engine_version AS executionEngineVersion, execution_switch_state AS executionSwitchState,
      switched_at AS switchedAt, previous_account_version AS previousAccountVersion,
      market_rule_version AS marketRuleVersion, data_contract_version AS dataContractVersion,
      legacy_pending_order_count AS legacyPendingOrderCount,
      carried_position_count AS carriedPositionCount, needs_user_action AS needsUserAction,
      last_processed_timestamp AS lastProcessedTimestamp,
      last_processed_revision AS lastProcessedRevision, created_at AS createdAt,
      updated_at AS updatedAt
      FROM live_accounts ORDER BY market, status, updated_at DESC, account_id`).all<AccountRow>(),
    db.prepare(`SELECT instrument_id AS instrumentId, symbol, name, market,
      account_id AS accountId,
      latest_timestamp AS latestTimestamp, latest_close AS latestClose,
      scan_timestamp AS scanTimestamp, preset_ids_json AS presetIdsJson,
      preset_names_json AS presetNamesJson, decision_json AS decisionJson,
      decision_submissions_json AS decisionSubmissionsJson, trading_mode AS tradingMode,
      initial_capital AS initialCapital, cash_balance AS cashBalance,
      account_version AS accountVersion, payload_version AS payloadVersion,
      last_processed_timestamp AS lastProcessedTimestamp,
      last_processed_revision AS lastProcessedRevision,
      corporate_action_events_json AS corporateActionEventsJson, updated_at AS updatedAt
      FROM live_portfolios ORDER BY sort_order ASC, updated_at DESC, instrument_id ASC`).all<PortfolioRow>(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, side, qty,
      entry_price AS entryPrice, entry_timestamp AS entryTimestamp, entry_order_id AS entryOrderId,
      entry_order_type AS entryOrderType, entry_intrabar AS entryIntrabar, status,
      exit_price AS exitPrice, exit_timestamp AS exitTimestamp,
      exit_order_id AS exitOrderId, realized_pnl AS realizedPnl,
      gross_realized_pnl AS grossRealizedPnl, entry_fee AS entryFee, exit_fee AS exitFee,
      total_fees AS totalFees, stop_loss AS stopLoss, take_profit AS takeProfit,
      initial_risk AS initialRisk, exit_reason AS exitReason, intrabar_ambiguous AS intrabarAmbiguous,
      engine_version AS engineVersion, sizing_mode AS sizingMode, risk_percent AS riskPercent,
      risk_budget AS riskBudget, margin_used AS marginUsed,
      payload_version AS payloadVersion, payload_json AS payloadJson
      FROM live_positions ORDER BY id`).all(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, action, side, qty,
      created_at AS createdAt, position_id AS positionId, rule_id AS ruleId,
      rule_version AS ruleVersion, price_band_json AS priceBandJson,
      reserved_cash AS reservedCash, status, execute_at_timestamp AS executeAtTimestamp,
      order_type AS orderType, trigger_price AS triggerPrice, original_qty AS originalQty,
      filled_qty AS filledQty, remaining_qty AS remainingQty, stop_loss AS stopLoss,
      take_profit AS takeProfit, sizing_mode AS sizingMode, risk_percent AS riskPercent,
      risk_budget AS riskBudget, reserved_margin AS reservedMargin, engine_version AS engineVersion,
      payload_version AS payloadVersion, payload_json AS payloadJson
      FROM live_pending_orders ORDER BY id`).all(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, order_id AS orderId,
      position_id AS positionId, action, side, qty, price, timestamp,
      realized_pnl AS realizedPnl, rule_id AS ruleId, rule_version AS ruleVersion,
      raw_price AS rawPrice, quote_price AS quotePrice, quote_side AS quoteSide,
      fee, price_impact_cost AS priceImpactCost, order_type AS orderType,
      trigger_price AS triggerPrice, reason, intrabar_ambiguous AS intrabarAmbiguous,
      partial, remaining_qty AS remainingQty, notional_value AS notionalValue,
      margin_impact AS marginImpact, account_currency AS accountCurrency,
      engine_version AS engineVersion,
      payload_version AS payloadVersion, payload_json AS payloadJson
      FROM live_executions ORDER BY timestamp, id`).all(),
    db.prepare(`SELECT id, portfolio_instrument_id AS portfolioInstrumentId, order_id AS orderId,
      code, message, timestamp, rule_id AS ruleId, rule_version AS ruleVersion,
      payload_version AS payloadVersion, payload_json AS payloadJson
      FROM live_order_rejections ORDER BY timestamp, id`).all(),
    db.prepare(`SELECT instrument_id AS instrumentId, symbol, name, market,
      latest_timestamp AS latestTimestamp, latest_close AS latestClose,
      observation_timestamp AS observationTimestamp, observation_close AS observationClose,
      entry_timestamp AS entryTimestamp, entry_price AS entryPrice,
      scan_timestamp AS scanTimestamp, preset_ids_json AS presetIdsJson,
      preset_names_json AS presetNamesJson, updated_at AS updatedAt
      FROM live_watchlist ORDER BY sort_order ASC, updated_at DESC, instrument_id ASC`).all(),
  ]);
  const portfolios = (portfolioResult.results as PortfolioRow[]).map((row) => ({
    id: row.instrumentId,
    instrumentId: row.instrumentId,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    latestTimestamp: row.latestTimestamp,
    latestClose: row.latestClose,
    scanTimestamp: row.scanTimestamp,
    presetIds: parseJson<string[]>(row.presetIdsJson, []),
    presetNames: parseJson<string[]>(row.presetNamesJson, []),
    positions: [] as Array<Record<string, unknown>>,
    pendingOrders: [] as Array<Record<string, unknown>>,
    executions: [] as Array<Record<string, unknown>>,
    orderRejections: [] as Array<Record<string, unknown>>,
    tradingMode: row.tradingMode,
    initialCapital: row.initialCapital,
    cashBalance: row.cashBalance,
    accountVersion: row.accountVersion,
    payloadVersion: row.payloadVersion,
    ...(row.lastProcessedTimestamp === null ? {} : { lastProcessedTimestamp: row.lastProcessedTimestamp }),
    ...(row.lastProcessedRevision === null ? {} : { lastProcessedRevision: row.lastProcessedRevision }),
    corporateActionEvents: parseJson<JsonRecord[]>(row.corporateActionEventsJson, []),
    ...(parseJson<JsonRecord | null>(row.decisionJson, null) ? { decision: parseJson<JsonRecord>(row.decisionJson, {}) } : {}),
    decisionSubmissions: parseJson<unknown[]>(row.decisionSubmissionsJson, []),
    updatedAt: row.updatedAt,
  }));
  const portfolioMap = new Map(portfolios.map((portfolio) => [portfolio.instrumentId, portfolio]));
  for (const row of positionResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    const payload = parseJson<JsonRecord>(String(row.payloadJson ?? ""), {});
    portfolio.positions.push({
      ...payload,
      id: String(row.id), side: row.side, qty: Number(row.qty), entryPrice: Number(row.entryPrice),
      entryTimestamp: Number(row.entryTimestamp), entryOrderId: String(row.entryOrderId), status: row.status,
      ...(row.entryOrderType === null ? {} : { entryOrderType: String(row.entryOrderType) }),
      ...(row.entryIntrabar === null ? {} : { entryIntrabar: Boolean(Number(row.entryIntrabar)) }),
      ...(row.exitPrice === null ? {} : { exitPrice: Number(row.exitPrice) }),
      ...(row.exitTimestamp === null ? {} : { exitTimestamp: Number(row.exitTimestamp) }),
      ...(row.exitOrderId === null ? {} : { exitOrderId: String(row.exitOrderId) }),
      ...(row.realizedPnl === null ? {} : { realizedPnl: Number(row.realizedPnl) }),
      ...(row.grossRealizedPnl === null ? {} : { grossRealizedPnl: Number(row.grossRealizedPnl) }),
      ...(row.entryFee === null ? {} : { entryFee: Number(row.entryFee) }),
      ...(row.exitFee === null ? {} : { exitFee: Number(row.exitFee) }),
      ...(row.totalFees === null ? {} : { totalFees: Number(row.totalFees) }),
      ...(row.stopLoss === null ? {} : { stopLoss: Number(row.stopLoss) }),
      ...(row.takeProfit === null ? {} : { takeProfit: Number(row.takeProfit) }),
      ...(row.initialRisk === null ? {} : { initialRisk: Number(row.initialRisk) }),
      ...(row.exitReason === null ? {} : { exitReason: String(row.exitReason) }),
      ...(row.intrabarAmbiguous === null ? {} : { intrabarAmbiguous: Boolean(Number(row.intrabarAmbiguous)) }),
      ...(row.engineVersion === null ? {} : { engineVersion: String(row.engineVersion) }),
      ...(row.sizingMode === null ? {} : { sizingMode: String(row.sizingMode) }),
      ...(row.riskPercent === null ? {} : { riskPercent: Number(row.riskPercent) }),
      ...(row.riskBudget === null ? {} : { riskBudget: Number(row.riskBudget) }),
      ...(row.marginUsed === null ? {} : { marginUsed: Number(row.marginUsed) }),
    });
  }
  for (const row of pendingResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    const payload = parseJson<JsonRecord>(String(row.payloadJson ?? ""), {});
    portfolio.pendingOrders.push({
      ...payload,
      id: String(row.id), action: row.action, side: row.side, qty: Number(row.qty),
      createdAt: Number(row.createdAt), positionId: String(row.positionId),
      ...(row.ruleId === null ? {} : { ruleId: String(row.ruleId) }),
      ...(row.ruleVersion === null ? {} : { ruleVersion: String(row.ruleVersion) }),
      ...(row.priceBandJson === null ? {} : { priceBand: parseJson(row.priceBandJson as string, null) }),
      ...(row.reservedCash === null ? {} : { reservedCash: Number(row.reservedCash) }),
      status: String(row.status ?? "pending"),
      ...(row.executeAtTimestamp === null ? {} : { executeAtTimestamp: Number(row.executeAtTimestamp) }),
      ...(row.orderType === null ? {} : { orderType: String(row.orderType) }),
      ...(row.triggerPrice === null ? {} : { triggerPrice: Number(row.triggerPrice) }),
      ...(row.originalQty === null ? {} : { originalQty: Number(row.originalQty) }),
      ...(row.filledQty === null ? {} : { filledQty: Number(row.filledQty) }),
      ...(row.remainingQty === null ? {} : { remainingQty: Number(row.remainingQty) }),
      ...(row.stopLoss === null ? {} : { stopLoss: Number(row.stopLoss) }),
      ...(row.takeProfit === null ? {} : { takeProfit: Number(row.takeProfit) }),
      ...(row.sizingMode === null ? {} : { sizingMode: String(row.sizingMode) }),
      ...(row.riskPercent === null ? {} : { riskPercent: Number(row.riskPercent) }),
      ...(row.riskBudget === null ? {} : { riskBudget: Number(row.riskBudget) }),
      ...(row.reservedMargin === null ? {} : { reservedMargin: Number(row.reservedMargin) }),
      ...(row.engineVersion === null ? {} : { engineVersion: String(row.engineVersion) }),
    });
  }
  for (const row of executionResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    const payload = parseJson<JsonRecord>(String(row.payloadJson ?? ""), {});
    portfolio.executions.push({
      ...payload,
      id: String(row.id), orderId: String(row.orderId), positionId: String(row.positionId),
      action: row.action, side: row.side, qty: Number(row.qty), price: Number(row.price),
      timestamp: Number(row.timestamp), realizedPnl: Number(row.realizedPnl),
      ...(row.ruleId === null ? {} : { ruleId: String(row.ruleId) }),
      ...(row.ruleVersion === null ? {} : { ruleVersion: String(row.ruleVersion) }),
      ...(row.rawPrice === null ? {} : { rawPrice: Number(row.rawPrice) }),
      ...(row.quotePrice === null ? {} : { quotePrice: Number(row.quotePrice) }),
      ...(row.quoteSide === null ? {} : { quoteSide: String(row.quoteSide) }),
      ...(row.fee === null ? {} : { fee: Number(row.fee) }),
      ...(row.priceImpactCost === null ? {} : { priceImpactCost: Number(row.priceImpactCost) }),
      ...(row.orderType === null ? {} : { orderType: String(row.orderType) }),
      ...(row.triggerPrice === null ? {} : { triggerPrice: Number(row.triggerPrice) }),
      ...(row.reason === null ? {} : { reason: String(row.reason) }),
      ...(row.intrabarAmbiguous === null ? {} : { intrabarAmbiguous: Boolean(Number(row.intrabarAmbiguous)) }),
      ...(row.partial === null ? {} : { partial: Boolean(Number(row.partial)) }),
      ...(row.remainingQty === null ? {} : { remainingQty: Number(row.remainingQty) }),
      ...(row.notionalValue === null ? {} : { notionalValue: Number(row.notionalValue) }),
      ...(row.marginImpact === null ? {} : { marginImpact: Number(row.marginImpact) }),
      ...(row.accountCurrency === null ? {} : { accountCurrency: String(row.accountCurrency) }),
      ...(row.engineVersion === null ? {} : { engineVersion: String(row.engineVersion) }),
    });
  }
  for (const row of rejectionResult.results as Array<Record<string, unknown>>) {
    const portfolio = portfolioMap.get(String(row.portfolioInstrumentId));
    if (!portfolio) continue;
    const payload = parseJson<JsonRecord>(String(row.payloadJson ?? ""), {});
    portfolio.orderRejections.push({
      ...payload,
      id: String(row.id), ...(row.orderId === null ? {} : { orderId: String(row.orderId) }),
      code: String(row.code), message: String(row.message), timestamp: Number(row.timestamp),
      ruleId: String(row.ruleId), ruleVersion: String(row.ruleVersion),
    });
  }
  const watchlist = (watchResult.results as Array<Record<string, unknown>>).map((row) => ({
    id: `watch:${String(row.instrumentId)}`,
    instrumentId: String(row.instrumentId), symbol: String(row.symbol), name: String(row.name),
    market: row.market, latestTimestamp: Number(row.latestTimestamp), latestClose: Number(row.latestClose),
    ...(row.observationTimestamp === null ? {} : { observationTimestamp: Number(row.observationTimestamp) }),
    ...(row.observationClose === null ? {} : { observationClose: Number(row.observationClose) }),
    ...(row.entryTimestamp === null ? {} : { entryTimestamp: Number(row.entryTimestamp) }),
    ...(row.entryPrice === null ? {} : { entryPrice: Number(row.entryPrice) }),
    scanTimestamp: Number(row.scanTimestamp),
    presetIds: parseJson<string[]>(String(row.presetIdsJson), []),
    presetNames: parseJson<string[]>(String(row.presetNamesJson), []),
    updatedAt: String(row.updatedAt),
  }));
  const accountPortfolioIds = new Map<string, string[]>();
  for (const portfolio of portfolios) {
    const accountId = typeof portfolio.accountId === "string" ? portfolio.accountId : "";
    if (!accountId) continue;
    const items = accountPortfolioIds.get(accountId) ?? [];
    items.push(portfolio.instrumentId);
    accountPortfolioIds.set(accountId, items);
  }
  const accounts = (accountResult.results as AccountRow[]).flatMap((row) => {
    const account = normalizeLiveAccount({
      id: row.id,
      market: row.market,
      currency: row.currency,
      displayName: row.displayName,
      status: row.status,
      tradingMode: row.tradingMode,
      initialCapital: row.initialCapital,
      riskCapital: row.riskCapital,
      cashBalance: row.cashBalance,
      reservedCash: row.reservedCash,
      reservedMargin: row.reservedMargin,
      equity: row.equity,
      availableCash: row.availableCash,
      version: row.version,
      payloadVersion: row.payloadVersion,
      executionProfile: parseJson<JsonRecord>(row.executionProfileJson, {}),
      executionProfileVersion: row.executionProfileVersion,
      executionEngineVersion: row.executionEngineVersion,
      executionSwitchState: row.executionSwitchState,
      switchedAt: row.switchedAt,
      previousAccountVersion: row.previousAccountVersion,
      marketRuleVersion: row.marketRuleVersion,
      dataContractVersion: row.dataContractVersion,
      legacyPendingOrderCount: row.legacyPendingOrderCount,
      carriedPositionCount: row.carriedPositionCount,
      needsUserAction: Boolean(Number(row.needsUserAction)),
      lastProcessedTimestamp: row.lastProcessedTimestamp,
      lastProcessedRevision: row.lastProcessedRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      portfolioInstrumentIds: accountPortfolioIds.get(row.id) ?? [],
    });
    return account ? [account] : [];
  });
  return { accounts, portfolios, watchlist };
}

export async function applyLiveStatePatch(db: D1Database, value: unknown) {
  if (!isRecord(value)) throw new Error("live state patch must be an object");
  const hasAccounts = Object.prototype.hasOwnProperty.call(value, "accountUpserts");
  const hasPortfolios = Object.prototype.hasOwnProperty.call(value, "portfolioUpserts")
    || Object.prototype.hasOwnProperty.call(value, "portfolioDeletes");
  const hasWatchlist = Object.prototype.hasOwnProperty.call(value, "watchlistUpserts")
    || Object.prototype.hasOwnProperty.call(value, "watchlistDeletes");
  if (!hasAccounts && !hasPortfolios && !hasWatchlist) throw new Error("live state patch is empty");
  const accountUpserts = (Array.isArray(value.accountUpserts) ? value.accountUpserts : [])
    .slice(0, 16)
    .map(normalizeLiveAccount)
    .filter((item): item is NormalizedLiveAccount => Boolean(item));
  const portfolioUpserts = (Array.isArray(value.portfolioUpserts) ? value.portfolioUpserts : [])
    .slice(0, MAX_LIVE_ITEMS)
    .map((item, index) => normalizePortfolio(item, index))
    .filter((item): item is NormalizedPortfolio => Boolean(item));
  const watchUpserts = (Array.isArray(value.watchlistUpserts) ? value.watchlistUpserts : [])
    .slice(0, MAX_LIVE_ITEMS)
    .map((item, index) => normalizeWatch(item, index))
    .filter((item): item is NormalizedWatch => Boolean(item));
  const portfolioDeletes = normalizeDeletes(value.portfolioDeletes);
  const watchDeletes = normalizeDeletes(value.watchlistDeletes);
  const portfolioIds = new Set<string>();
  const watchIds = new Set<string>();
  const accountIds = new Set<string>();
  let accountUpdated = 0;
  let accountSkipped = 0;
  let portfolioUpdated = 0;
  let portfolioSkipped = 0;
  let watchUpdated = 0;
  let watchSkipped = 0;
  const atomic = value.atomic === true;

  if (atomic) {
    const statements: D1PreparedStatement[] = [];
    const operations: Array<{ kind: "account" | "portfolio" | "watch"; offset: number }> = [];
    const addOperation = (kind: "account" | "portfolio" | "watch", operationStatements: D1PreparedStatement[]) => {
      if (!operationStatements.length) return;
      operations.push({ kind, offset: statements.length });
      statements.push(...operationStatements);
    };
    for (const account of accountUpserts) {
      if (accountIds.has(account.id)) continue;
      accountIds.add(account.id);
      addOperation("account", [liveAccountUpsertStatement(db, account)]);
    }
    for (const portfolio of portfolioUpserts) {
      if (portfolioIds.has(portfolio.instrumentId)) continue;
      portfolioIds.add(portfolio.instrumentId);
      addOperation("portfolio", [portfolioUpsertStatement(db, portfolio), ...childStatements(db, portfolio)]);
    }
    for (const item of portfolioDeletes) {
      if (portfolioIds.has(item.instrumentId)) continue;
      portfolioIds.add(item.instrumentId);
      addOperation("portfolio", [
        db.prepare(`DELETE FROM live_portfolios
          WHERE instrument_id = ? AND (? IS NULL OR updated_at <= ?)`)
          .bind(item.instrumentId, item.updatedAt, item.updatedAt),
        db.prepare("DELETE FROM live_positions WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
        db.prepare("DELETE FROM live_pending_orders WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
        db.prepare("DELETE FROM live_executions WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
        db.prepare("DELETE FROM live_order_rejections WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
      ]);
    }
    for (const watch of watchUpserts) {
      if (watchIds.has(watch.instrumentId)) continue;
      watchIds.add(watch.instrumentId);
      addOperation("watch", [watchUpsertStatement(db, watch)]);
    }
    for (const item of watchDeletes) {
      if (watchIds.has(item.instrumentId)) continue;
      watchIds.add(item.instrumentId);
      addOperation("watch", [db.prepare(`DELETE FROM live_watchlist
        WHERE instrument_id = ? AND (? IS NULL OR updated_at <= ?)`)
        .bind(item.instrumentId, item.updatedAt, item.updatedAt)]);
    }
    const results = statements.length ? await db.batch(statements) : [];
    for (const operation of operations) {
      const changed = (results[operation.offset] as { meta?: { changes?: number } })?.meta?.changes;
      if (operation.kind === "account") {
        if (changed === 0) accountSkipped += 1;
        else accountUpdated += 1;
      } else if (operation.kind === "portfolio") {
        if (changed === 0) portfolioSkipped += 1;
        else portfolioUpdated += 1;
      } else if (changed === 0) {
        watchSkipped += 1;
      } else {
        watchUpdated += 1;
      }
    }
    return { accountUpdated, accountSkipped, portfolioUpdated, portfolioSkipped, watchUpdated, watchSkipped };
  }
  for (const account of accountUpserts) {
    if (accountIds.has(account.id)) continue;
    accountIds.add(account.id);
    const result = await liveAccountUpsertStatement(db, account).run();
    const changed = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changed === 0) accountSkipped += 1;
    else accountUpdated += 1;
  }
  for (const portfolio of portfolioUpserts) {
    if (portfolioIds.has(portfolio.instrumentId)) continue;
    portfolioIds.add(portfolio.instrumentId);
    const batchResults = await db.batch([
      portfolioUpsertStatement(db, portfolio),
      ...childStatements(db, portfolio),
    ]);
    const changed = (batchResults[0] as { meta?: { changes?: number } })?.meta?.changes;
    if (changed === 0) {
      portfolioSkipped += 1;
      continue;
    }
    portfolioUpdated += 1;
  }
  for (const item of portfolioDeletes) {
    if (portfolioIds.has(item.instrumentId)) continue;
    const results = await db.batch([
      db.prepare(`DELETE FROM live_portfolios
        WHERE instrument_id = ? AND (? IS NULL OR updated_at <= ?)`)
        .bind(item.instrumentId, item.updatedAt, item.updatedAt),
      db.prepare("DELETE FROM live_positions WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
      db.prepare("DELETE FROM live_pending_orders WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
      db.prepare("DELETE FROM live_executions WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
      db.prepare("DELETE FROM live_order_rejections WHERE portfolio_instrument_id = ?").bind(item.instrumentId),
    ]);
    const changed = (results[0] as { meta?: { changes?: number } })?.meta?.changes;
    if (changed === 0) continue;
    portfolioUpdated += 1;
  }
  for (const watch of watchUpserts) {
    if (watchIds.has(watch.instrumentId)) continue;
    watchIds.add(watch.instrumentId);
    const result = await watchUpsertStatement(db, watch).run();
    const changed = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changed === 0) watchSkipped += 1;
    else watchUpdated += 1;
  }
  for (const item of watchDeletes) {
    if (watchIds.has(item.instrumentId)) continue;
    const result = await db.prepare(`DELETE FROM live_watchlist
      WHERE instrument_id = ? AND (? IS NULL OR updated_at <= ?)`)
      .bind(item.instrumentId, item.updatedAt, item.updatedAt).run();
    const changed = (result as { meta?: { changes?: number } }).meta?.changes;
    if (changed !== 0) watchUpdated += 1;
  }
  return {
    accountUpdated,
    accountSkipped,
    portfolioUpdated,
    portfolioSkipped,
    watchUpdated,
    watchSkipped,
  };
}
